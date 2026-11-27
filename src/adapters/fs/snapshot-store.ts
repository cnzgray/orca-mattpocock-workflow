/**
 * 本地快照库的文件实现：按缓存键一个目录，票文件 → 变化日志 → meta 的顺序提交。
 *
 * 缓存键由后端类型决定：托管后端是仓库作用域（主 worktree 根目录），
 * 本地 Markdown 是工作区根目录。同一仓库的多个 worktree 因此只占一个目录。
 *
 * 目录里的布局是内部私事：
 *
 * ```
 * <hash>.dir/
 *   meta.json        提交点：库版本、仓库身份、远端版本、票引用与墓碑
 *   tickets/<hash>.json  每张票一个文件，只存后端原始数据
 *   changes.jsonl    追加式变化日志，按库版本分界
 * ```
 *
 * 一次写入固定为「票文件 → 变化日志 → meta」；meta 是提交点。中途崩溃只会留下
 * 孤儿票文件或未提交的日志尾巴，读路径按 meta 的票引用解析，看不到半批数据；
 * 下一次写入按 meta 版本清掉未提交尾巴与孤儿文件。
 *
 * 缓存目录在用户主目录下（`~/.orca-mattpocock-workflow/cache`）；
 * 主目录不可写时退回系统临时目录。插件不写用户的工作区，只写自己这个目录。
 */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { storeKeyOf } from '../../core/repository-scope.ts'
import {
  parseSnapshotStoreMeta,
  parseSnapshotTicket,
  serializeSnapshotStoreMeta,
  serializeSnapshotTicket,
  type SnapshotStoreChangeSet,
  type SnapshotStoreEntry,
  type SnapshotStoreInput,
  type SnapshotStoreMeta,
} from '../../core/snapshot-store.ts'
import type { SnapshotMetrics } from '../../protocol/tracker.ts'
import type { Ticket, TicketState } from '../../core/ticket.ts'

/** 缓存条目超过多少天没有更新就淘汰。 */
export const SNAPSHOT_STORE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 最多保留多少个仓库的缓存。 */
export const SNAPSHOT_STORE_MAX_ENTRIES = 20

/** 变化日志最多保留多少条提交；更早的客户端基线请求退回整份。 */
export const SNAPSHOT_STORE_CHANGE_LOG_LIMIT = 512

/** 缓存目录名；用户主目录下的一个子目录，只属于这个插件。 */
const DIRECTORY_NAME = 'orca-mattpocock-workflow'

/** 目录里的文件名。布局是内部私事，调用方只认 {@link SnapshotStore}。 */
const META_FILE = 'meta.json'
const TICKETS_DIRECTORY = 'tickets'
const CHANGE_LOG_FILE = 'changes.jsonl'

/** 本地快照库的读写能力。worker 只依赖这个接口，测试用内存实现。 */
export interface SnapshotStore {
  /**
   * 读取某个缓存键的缓存条目；没有、损坏或不可用时是 undefined。
   * 键是仓库作用域（托管后端）或工作区根目录（本地 Markdown）。
   */
  read(key: string): Promise<SnapshotStoreEntry | undefined>
  /**
   * 批量提交一个条目，返回新的本地库版本。
   * 只写变化的票文件；变化日志与 meta 按顺序收尾。
   */
  write(entry: SnapshotStoreInput): Promise<number>
  /** 删除某个缓存键的缓存条目。 */
  remove(key: string): Promise<void>
  /** 列出全部可用的缓存条目。 */
  list(): Promise<readonly SnapshotStoreEntry[]>
  /** 清空缓存；返回清掉的条目数。 */
  clear(): Promise<number>
  /**
   * 按规则淘汰条目；返回清掉的条目数。
   * 旧版本（按 worktree 存的文件）与内容损坏的目录读不出来，在这里一并清掉。
   */
  prune(now: number): Promise<number>
  /** 按变更补丁局部更新缓存里的一张票；缓存里没有这张票时返回 false。 */
  patchTicket(
    key: string,
    ref: string,
    patch: { readonly labels?: readonly string[]; readonly state?: TicketState },
  ): Promise<boolean>
  /** 从缓存里移除一张票；缓存里没有这张票时返回 false。 */
  removeTicket(key: string, ref: string): Promise<boolean>
  /** 当前库版本；没有条目或 meta 损坏时是 undefined（0 是合法版本，不用它冒充）。 */
  revision(key: string): Promise<number | undefined>
  /**
   * 读取从某个库版本到现在的变化集（含墓碑）。
   * @param key - 缓存键。
   * @param fromRevision - 客户端手上的库版本。
   * @returns 变化集；日志已轮转、条目损坏或版本不可比时为 undefined，调用方退回整份。
   */
  changesSince(key: string, fromRevision: number): Promise<SnapshotStoreChangeSet | undefined>
  /** 缓存目录的位置，用符号形式给出。 */
  location(): string
}

/** 文件实现的依赖；测试可以注入目录与提交阶段钩子。 */
export interface SnapshotStoreDeps {
  /** 用户主目录；默认取 `node:os` 的 homedir()。 */
  readonly home?: string | undefined
  /** 系统临时目录；默认取 `node:os` 的 tmpdir()。 */
  readonly tmp?: string | undefined
  /** 直接指定缓存根目录；给定时不看主目录。 */
  readonly root?: string | undefined
  /**
   * 提交阶段钩子；只在测试里用来模拟中途失败。
   * 阶段是 `tickets`（票文件已写）、`log`（日志已追加）、`meta`（meta 尚未写）。
   */
  readonly onCommitStage?:
    | ((stage: 'tickets' | 'log' | 'meta') => Promise<void> | void)
    | undefined
}

/**
 * 创建基于文件系统的本地快照库。
 * @param deps - 可选的目录覆盖。
 * @returns 本地快照库。
 */
export function createNodeSnapshotStore(deps: SnapshotStoreDeps = {}): SnapshotStore {
  const home = resolveHome(deps)
  const fallbackRoot = join(resolveTmp(deps), `${DIRECTORY_NAME}-cache`)
  const preferredRoot =
    deps.root ?? (home === undefined ? fallbackRoot : join(home, `.${DIRECTORY_NAME}`, 'cache'))
  const preferredDisplay =
    deps.root ?? (home === undefined ? '系统临时目录' : `~/.${DIRECTORY_NAME}/cache`)

  let root = preferredRoot
  let display = preferredDisplay
  let checked = false

  /**
   * 确认缓存目录可用；主目录不可写时退回系统临时目录。
   * 只在第一次使用时检查，之后一直用同一个目录。
   */
  const resolveRoot = async (): Promise<string> => {
    if (checked) return root
    checked = true
    if (await isWritable(preferredRoot)) {
      root = preferredRoot
      display = preferredDisplay
      return root
    }
    root = fallbackRoot
    display = '系统临时目录'
    return root
  }

  return {
    ...entryOperations(resolveRoot, deps.onCommitStage),
    ...ticketOperations(resolveRoot, deps.onCommitStage),
    revision: async (key) => (await readMetaAt(await resolveRoot(), key))?.storeRevision,
    changesSince: async (key, fromRevision) =>
      readChangesSince(await resolveRoot(), key, fromRevision),
    location: () => display,
  }
}

/** 条目级别的读写与淘汰。 */
function entryOperations(
  resolveRoot: () => Promise<string>,
  onCommitStage: SnapshotStoreDeps['onCommitStage'],
): Pick<
  SnapshotStore,
  'read' | 'write' | 'remove' | 'list' | 'clear' | 'prune'
> {
  const list = async (): Promise<readonly SnapshotStoreEntry[]> => {
    const root = await resolveRoot()
    return (await scanEntryDirectories(root)).flatMap((scanned) =>
      scanned.entry === undefined ? [] : [scanned.entry],
    )
  }

  return {
    read: async (key) => {
      const root = await resolveRoot()
      return readEntryAt(root, key)
    },

    async write(entry) {
      const root = await resolveRoot()
      const key = storeKeyOf(entry.backend, entry.scopeRoot, entry.workspaceRoot)
      const previous = await readEntryAt(root, key)
      const previousByRef = new Map(
        (previous?.tickets ?? []).map((ticket) => [ticket.ref, ticket] as const),
      )
      const nextRefs = new Set(entry.tickets.map((ticket) => ticket.ref))
      const changed = entry.tickets.filter((ticket) => {
        const old = previousByRef.get(ticket.ref)
        return old === undefined || serializeSnapshotTicket(old) !== serializeSnapshotTicket(ticket)
      })
      const removed = (previous?.tickets ?? []).flatMap((ticket) =>
        nextRefs.has(ticket.ref) ? [] : [ticket.ref],
      )
      return commitEntry(
        root,
        key,
        entry,
        {
          tickets: changed,
          removed,
          ...(entry.metrics === undefined ? {} : { metrics: entry.metrics }),
        },
        onCommitStage,
      )
    },

    async remove(key) {
      const root = await resolveRoot()
      await rm(directoryFor(root, key), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
      await rm(legacyFileFor(root, key), { force: true })
    },

    list,

    async clear() {
      const root = await resolveRoot()
      let names: string[]
      try {
        names = await readdir(root)
      } catch {
        return 0
      }
      let removed = 0
      for (const name of names) {
        if (!isEntryDirectory(name) && !isLegacyFile(name)) continue
        await rm(join(root, name), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
        removed += 1
      }
      return removed
    },

    async prune(now) {
      const root = await resolveRoot()
      const kept: SnapshotStoreEntry[] = []
      let removed = 0

      for (const scanned of await scanEntryDirectories(root)) {
        // 版本不符或内容损坏：整份目录读不回来，直接清掉，不影响其它工作区。
        if (scanned.entry === undefined) {
          await rm(scanned.path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
          removed += 1
          continue
        }
        const entry = scanned.entry
        const key = storeKeyOf(entry.backend, entry.scopeRoot, entry.workspaceRoot)
        const gone = await isDirectoryGone(key)
        // 目录确实不存在，或目录还在但超过保留期：删。
        // 路径暂时不可达（gone === false）时不删：挂载点掉线不该把缓存清掉。
        if (gone === true || (gone === undefined && now - entry.fetchedAt > SNAPSHOT_STORE_TTL_MS)) {
          await rm(scanned.path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
          removed += 1
          continue
        }
        kept.push(entry)
      }

      // 升级前的整份 JSON 文件永远读不回来，顺手清掉。
      removed += await removeLegacyFiles(root)

      if (kept.length > SNAPSHOT_STORE_MAX_ENTRIES) {
        kept.sort((left, right) => left.fetchedAt - right.fetchedAt)
        for (const entry of kept.slice(0, kept.length - SNAPSHOT_STORE_MAX_ENTRIES)) {
          await rm(
            directoryFor(root, storeKeyOf(entry.backend, entry.scopeRoot, entry.workspaceRoot)),
            { recursive: true, force: true, maxRetries: 10, retryDelay: 50 },
          )
          removed += 1
        }
      }

      return removed
    },
  }
}

/** 缓存里单张票的局部更新。 */
function ticketOperations(
  resolveRoot: () => Promise<string>,
  onCommitStage: SnapshotStoreDeps['onCommitStage'],
): Pick<SnapshotStore, 'patchTicket' | 'removeTicket'> {
  return {
    async patchTicket(key, ref, patch) {
      const root = await resolveRoot()
      const entry = await readEntryAt(root, key)
      if (entry === undefined) return false
      const index = entry.tickets.findIndex((ticket) => ticket.ref === ref)
      if (index < 0) return false
      const current = entry.tickets[index]
      if (current === undefined) return false

      const updated = {
        ...current,
        ...(patch.labels === undefined ? {} : { labels: patch.labels }),
        ...(patch.state === undefined ? {} : { state: patch.state }),
      }
      const tickets = [...entry.tickets]
      tickets[index] = updated
      await commitEntry(
        root,
        key,
        { ...entry, tickets },
        { tickets: [updated], removed: [] },
        onCommitStage,
      )
      return true
    },

    async removeTicket(key, ref) {
      const root = await resolveRoot()
      const entry = await readEntryAt(root, key)
      if (entry === undefined) return false
      const tickets = entry.tickets.filter((ticket) => ticket.ref !== ref)
      if (tickets.length === entry.tickets.length) return false
      await commitEntry(
        root,
        key,
        { ...entry, tickets },
        { tickets: [], removed: [ref] },
        onCommitStage,
      )
      return true
    },
  }
}

/** 一次提交要写的票与墓碑；`metrics` 省略表示清空旧指标。 */
interface CommitChange {
  /** 需要写文件的票（新增或内容变化）。 */
  readonly tickets: readonly Ticket[]
  /** 这一版不再存在的票引用。 */
  readonly removed: readonly string[]
  /** 写入时算好的概览指标；省略时 meta 不带指标。 */
  readonly metrics?: SnapshotMetrics
}

/**
 * 一次提交：票文件 → 变化日志 → meta，最后清掉孤儿文件。
 * @param root - 缓存根目录。
 * @param key - 缓存键。
 * @param entry - 提交后的条目。
 * @param change - 这次要写的票、墓碑与指标。
 * @param onCommitStage - 测试注入的提交阶段钩子。
 * @returns 新的本地库版本。
 */
async function commitEntry(
  root: string,
  key: string,
  entry: SnapshotStoreInput,
  change: CommitChange,
  onCommitStage: SnapshotStoreDeps['onCommitStage'],
): Promise<number> {
  const directory = directoryFor(root, key)
  const ticketsDirectory = join(directory, TICKETS_DIRECTORY)
  await mkdir(ticketsDirectory, { recursive: true, mode: 0o700 })

  const previousMeta = await readMetaAt(root, key)
  const previousRevision = previousMeta?.storeRevision ?? 0
  const revision = previousRevision + 1

  for (const ticket of change.tickets) {
    await writeFileAtomic(
      join(ticketsDirectory, `${hashOf(ticket.ref)}.json`),
      serializeSnapshotTicket(ticket),
    )
  }
  await onCommitStage?.('tickets')

  await appendChangeRecord(directory, previousRevision, {
    revision,
    upserts: change.tickets.map((ticket) => ticket.ref),
    removed: change.removed,
  })
  await onCommitStage?.('log')

  const ticketRefs = entry.tickets.map((ticket) => ticket.ref)
  const currentRefs = new Set(ticketRefs)
  const tombstones = [
    ...new Set([
      ...(previousMeta?.tombstones ?? []).filter((ref) => !currentRefs.has(ref)),
      ...change.removed,
    ]),
  ]
  const meta: SnapshotStoreMeta = {
    version: entry.version,
    storeRevision: revision,
    scopeRoot: entry.scopeRoot,
    workspaceRoot: entry.workspaceRoot,
    backend: entry.backend,
    repository: entry.repository,
    repositoryKey: entry.repositoryKey,
    repositoryHost: entry.repositoryHost,
    fetchedAt: entry.fetchedAt,
    viewer: entry.viewer,
    total: entry.total,
    ...(entry.nextCursor === undefined ? {} : { nextCursor: entry.nextCursor }),
    hierarchy: entry.hierarchy,
    revision: entry.revision,
    ticketRefs,
    tombstones,
    ...(change.metrics === undefined ? {} : { metrics: change.metrics }),
  }
  await onCommitStage?.('meta')
  await writeFileAtomic(join(directory, META_FILE), serializeSnapshotStoreMeta(meta))

  await removeOrphanTicketFiles(ticketsDirectory, currentRefs)
  await pruneChangeLog(directory)
  return revision
}

/** 读一个条目；读不到、meta 损坏或任一票文件缺失 / 损坏时是 undefined。 */
async function readEntryAt(
  root: string,
  key: string,
): Promise<SnapshotStoreEntry | undefined> {
  return readEntryFromDirectory(directoryFor(root, key))
}

/** 从目录的 meta 与票文件还原一个条目。 */
async function readEntryFromDirectory(directory: string): Promise<SnapshotStoreEntry | undefined> {
  const meta = await readMetaFromDirectory(directory)
  if (meta === undefined) return undefined

  const tickets: Ticket[] = []
  for (const ref of meta.ticketRefs) {
    try {
      const raw = await readFile(join(directory, TICKETS_DIRECTORY, `${hashOf(ref)}.json`), 'utf8')
      const ticket = parseSnapshotTicket(raw)
      if (ticket === undefined || ticket.ref !== ref) return undefined
      tickets.push(ticket)
    } catch {
      // 单个票文件读不出来：整份缓存按没有处理，下一次刷新会重写它。
      return undefined
    }
  }

  return {
    version: meta.version,
    scopeRoot: meta.scopeRoot,
    workspaceRoot: meta.workspaceRoot,
    backend: meta.backend,
    repository: meta.repository,
    repositoryKey: meta.repositoryKey,
    repositoryHost: meta.repositoryHost,
    fetchedAt: meta.fetchedAt,
    viewer: meta.viewer,
    loaded: tickets.length,
    total: meta.total,
    ...(meta.nextCursor === undefined ? {} : { nextCursor: meta.nextCursor }),
    tickets,
    hierarchy: meta.hierarchy,
    revision: meta.revision,
    storeRevision: meta.storeRevision,
    ...(meta.metrics === undefined ? {} : { metrics: meta.metrics }),
  }
}

/** 读某个缓存键的 meta。 */
async function readMetaAt(
  root: string,
  key: string,
): Promise<SnapshotStoreMeta | undefined> {
  return readMetaFromDirectory(directoryFor(root, key))
}

async function readMetaFromDirectory(
  directory: string,
): Promise<SnapshotStoreMeta | undefined> {
  try {
    return parseSnapshotStoreMeta(await readFile(join(directory, META_FILE), 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 读变化集：库版本之后变了哪些行、哪些行被判不存在。
 * 日志轮转、尾部未提交或任一变化票读不出来时返回 undefined，调用方退回整份。
 */
async function readChangesSince(
  root: string,
  key: string,
  fromRevision: number,
): Promise<SnapshotStoreChangeSet | undefined> {
  if (!Number.isInteger(fromRevision) || fromRevision < 0) return undefined

  const directory = directoryFor(root, key)
  const meta = await readMetaFromDirectory(directory)
  if (meta === undefined) return undefined
  if (fromRevision > meta.storeRevision) return undefined

  const log = await readChangeRecords(directory, false)
  if (log === undefined) return undefined
  const committed = log.records.filter((record) => record.revision <= meta.storeRevision)
  if (fromRevision === meta.storeRevision) {
    return { fromRevision, revision: meta.storeRevision, tickets: [], removed: [] }
  }
  const oldest = committed[0]?.revision
  // 起点比日志最老的一条还早：中间有一段变化已经轮转掉了，不能交半份变化集。
  if (oldest === undefined || fromRevision < oldest - 1) return undefined

  const final = new Map<string, 'upsert' | 'removed'>()
  for (const record of committed) {
    if (record.revision <= fromRevision) continue
    for (const ref of record.upserts) final.set(ref, 'upsert')
    for (const ref of record.removed) final.set(ref, 'removed')
  }
  if (final.size === 0) {
    return { fromRevision, revision: meta.storeRevision, tickets: [], removed: [] }
  }

  const changedRefs = new Set(
    [...final].flatMap(([ref, state]) => (state === 'upsert' ? [ref] : [])),
  )
  const tickets: Ticket[] = []
  for (const ref of meta.ticketRefs) {
    if (!changedRefs.has(ref)) continue
    const ticket = await readTicketFile(directory, ref)
    if (ticket === undefined) return undefined
    tickets.push(ticket)
  }
  const removed = [...final].flatMap(([ref, state]) => (state === 'removed' ? [ref] : []))
  return { fromRevision, revision: meta.storeRevision, tickets, removed }
}

/** 读一张变化票；缺失或损坏时返回 undefined。 */
async function readTicketFile(directory: string, ref: string): Promise<Ticket | undefined> {
  try {
    const raw = await readFile(join(directory, TICKETS_DIRECTORY, `${hashOf(ref)}.json`), 'utf8')
    const ticket = parseSnapshotTicket(raw)
    return ticket?.ref === ref ? ticket : undefined
  } catch {
    return undefined
  }
}

/** 变化日志里的一条提交。 */
interface ChangeRecord {
  readonly revision: number
  readonly upserts: readonly string[]
  readonly removed: readonly string[]
}

/**
 * 追加一条提交记录。
 *
 * 上一次提交若在 meta 之前崩溃，日志尾部会留下版本号大于 meta 的记录；
 * 这里先按 meta 版本把尾部截掉再追加，库版本因此始终单调。
 */
async function appendChangeRecord(
  directory: string,
  committedRevision: number,
  record: ChangeRecord,
): Promise<void> {
  const path = join(directory, CHANGE_LOG_FILE)
  const existing = await readChangeRecords(directory, true)
  const committed = (existing?.records ?? []).filter((item) => item.revision <= committedRevision)
  if (existing === undefined || !existing.clean || committed.length !== existing.records.length) {
    await writeFileAtomic(path, serializeChangeRecords(committed))
  }
  await appendFile(path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
}

/** 读变化日志的结果：记录与是否完全干净。 */
interface ChangeLog {
  readonly records: readonly ChangeRecord[]
  /** 尾部有过坏行（崩溃残留），提交前要整段重写。 */
  readonly clean: boolean
}

/**
 * 读变化日志。
 * @param directory - 条目目录。
 * @param tolerant - 为 true 时忽略坏行（提交恢复用）；为 false 时任何坏行都算读不出来。
 * @returns 记录；文件不存在时是空数组；不宽容且内容损坏时是 undefined。
 */
async function readChangeRecords(
  directory: string,
  tolerant: boolean,
): Promise<ChangeLog | undefined> {
  let raw: string
  try {
    raw = await readFile(join(directory, CHANGE_LOG_FILE), 'utf8')
  } catch {
    return { records: [], clean: true }
  }

  const records: ChangeRecord[] = []
  let clean = true
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    const record = parseChangeRecord(line)
    if (record === undefined) {
      if (!tolerant) return undefined
      clean = false
      continue
    }
    records.push(record)
  }
  return { records, clean }
}

/** 解析一行变化日志。 */
function parseChangeRecord(line: string): ChangeRecord | undefined {
  let payload: unknown
  try {
    payload = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof payload !== 'object' || payload === null) return undefined
  const value = payload as Record<string, unknown>
  const revision = value.revision
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return undefined
  const upserts = readStringList(value.upserts)
  const removed = readStringList(value.removed)
  if (upserts === undefined || removed === undefined) return undefined
  return { revision, upserts, removed }
}

function readStringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return undefined
    items.push(item)
  }
  return items
}

function serializeChangeRecords(records: readonly ChangeRecord[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join('')
}

/** 日志超过上限时丢掉最老的记录；轮转窗口外的客户端会退回整份。 */
async function pruneChangeLog(directory: string): Promise<void> {
  const log = await readChangeRecords(directory, true)
  if (log === undefined || log.records.length <= SNAPSHOT_STORE_CHANGE_LOG_LIMIT) return
  await writeFileAtomic(
    join(directory, CHANGE_LOG_FILE),
    serializeChangeRecords(
      log.records.slice(log.records.length - SNAPSHOT_STORE_CHANGE_LOG_LIMIT),
    ),
  )
}

/** 清掉不再被 meta 引用的票文件与临时文件。 */
async function removeOrphanTicketFiles(
  ticketsDirectory: string,
  refs: ReadonlySet<string>,
): Promise<void> {
  let names: string[]
  try {
    names = await readdir(ticketsDirectory)
  } catch {
    return
  }
  const expected = new Set([...refs].map((ref) => `${hashOf(ref)}.json`))
  for (const name of names) {
    if (expected.has(name)) continue
    await rm(join(ticketsDirectory, name), { force: true })
  }
}

/** 某个缓存键对应的目录。 */
function directoryFor(root: string, key: string): string {
  return join(root, `${hashOf(key)}.dir`)
}

/** 升级前的整份缓存文件；只在清理时使用。 */
function legacyFileFor(root: string, key: string): string {
  return join(root, `${hashOf(key)}.json`)
}

function isEntryDirectory(name: string): boolean {
  return name.endsWith('.dir')
}

function isLegacyFile(name: string): boolean {
  return name.endsWith('.json')
}

/** 目录里的一份条目：路径与解析结果。 */
interface ScannedEntry {
  readonly path: string
  readonly entry: SnapshotStoreEntry | undefined
}

/** 扫描缓存目录下的全部条目目录。 */
async function scanEntryDirectories(root: string): Promise<readonly ScannedEntry[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  const scanned: ScannedEntry[] = []
  for (const name of names) {
    if (!isEntryDirectory(name)) continue
    const path = join(root, name)
    scanned.push({ path, entry: await readEntryFromDirectory(path) })
  }
  return scanned
}

/** 删掉升级前的整份 JSON 文件；返回删掉的数量。 */
async function removeLegacyFiles(root: string): Promise<number> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    if (!isLegacyFile(name)) continue
    await rm(join(root, name), { force: true })
    removed += 1
  }
  return removed
}

let temporaryCounter = 0

/**
 * 原子写：先写同目录临时文件再改名。
 * 缓存里有工单标题与创建人，文件权限收紧到只有本人可读。
 */
async function writeFileAtomic(target: string, content: string): Promise<void> {
  temporaryCounter += 1
  const temporary = `${target}.${String(process.pid)}.${String(temporaryCounter)}.tmp`
  try {
    await writeFile(temporary, content, { mode: 0o600 })
    await rename(temporary, target)
    // 覆盖写不会重置权限，显式改一次。
    await chmod(target, 0o600)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * 判断缓存键指向的目录是否已经不在了。
 *
 * 托管后端的键是仓库作用域（主 worktree 根目录），本地 Markdown 的键是工作区；
 * 键指向的目录没了，这份缓存再也命中不了。
 * @param key - 缓存键。
 * @returns 目录确实不存在时为 true；目录不可达时为 false；目录还在时为 undefined。
 */
async function isDirectoryGone(key: string): Promise<boolean | undefined> {
  try {
    await stat(key)
    return undefined
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return true
    // 权限不足、挂载点掉线、设备未就绪都算「暂时不可达」，不删缓存。
    return false
  }
}

/** 缓存键派生的名字：不含路径信息，也不会有非法字符。 */
function hashOf(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

/** 目录能建出来并且可写时为 true。 */
async function isWritable(path: string): Promise<boolean> {
  try {
    await mkdir(path, { recursive: true, mode: 0o700 })
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** 用户主目录；解析不到时是 undefined。空串表示「没有主目录」，用于测试兜底路径。 */
function resolveHome(deps: SnapshotStoreDeps): string | undefined {
  if (deps.home !== undefined) return deps.home.length > 0 ? deps.home : undefined
  try {
    const home = homedir()
    return home.length > 0 ? home : undefined
  } catch {
    return undefined
  }
}

/** 系统临时目录。 */
function resolveTmp(deps: SnapshotStoreDeps): string {
  if (deps.tmp !== undefined && deps.tmp.length > 0) return deps.tmp
  try {
    return tmpdir()
  } catch {
    return '.'
  }
}
