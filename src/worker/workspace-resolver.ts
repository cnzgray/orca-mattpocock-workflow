/**
 * 工作区根目录的解析。
 *
 * Orca 的面板拿不到工作区路径，
 * 只能由 worker 自己解析：读当前工作区的上下文，再在全部工作区里认领一个。
 *
 * 认领规则：宿主在上下文里给了工作区 id（worker 侧的 `workspace.readContext` 会带）
 * 就按 id 精确认领；否则先看用户在同一聚焦上下文里显式选过的工作区，再按上下文里的
 * 显示名与工作区名精确匹配，再按分支匹配，唯一命中才采用；命中不了就把候选列表交给
 * 面板让用户选。
 *
 * 显示名与分支都不是可靠的唯一线索：空白显示名不参与匹配；未命名工作区的显示名
 * 会退化成它的分支名，`main` 会被大量工作区共用。这两种情况都不能当作唯一名称，
 * 要继续看终端标题里的工作目录。
 */
import { homedir } from 'node:os'

import { isRecord } from '../core/json.ts'
import type { OrcaWorkerApi } from './orca-types.ts'

/** 一个工作区候选。 */
export interface WorkspaceCandidate {
  readonly id: string
  readonly name: string
  /** 工作区在宿主机上的路径；agent 与 git 命令都在这里跑。 */
  readonly path: string
  readonly branch: string | null
  /** 所属仓库名；工作区名是分支别名时用它认领。 */
  readonly project: string | null
  readonly kind: 'worktree' | 'folder'
}

/** 解析结果。三种状态都带聚焦上下文的键：面板据此判断选择是否还有效。 */
export type WorkspaceResolution =
  | {
      readonly status: 'resolved'
      readonly root: string
      readonly candidate: WorkspaceCandidate
      readonly contextKey: string
    }
  | {
      readonly status: 'ambiguous'
      readonly candidates: readonly WorkspaceCandidate[]
      readonly contextKey: string
    }
  | {
      readonly status: 'unresolved'
      readonly candidates: readonly WorkspaceCandidate[]
      readonly contextKey: string
    }

/**
 * 记住用户显式选择所需的私有存储。
 *
 * Orca 的 `storage:own` 在 worker 与面板间共享，worker 重启后也可能换新；
 * 只依赖它把选择带到下一次运行，读不到或写失败时退回进程内记忆。
 */
export interface WorkspacePreferenceStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

/** 工作区解析器。 */
export interface WorkspaceResolver {
  /** 解析当前工作区的根目录；认领成功的结果按上下文缓存。 */
  resolve(): Promise<WorkspaceResolution>
  /** 丢弃缓存；工作区切换后调用。 */
  invalidate(): void
  /**
   * 记住用户显式选择的工作区，绑定到当前聚焦上下文。
   * 同一上下文里省略 `workspaceRoot` 的请求（包括刷新命令）沿用它。
   */
  prefer(path: string): Promise<void>
}

/** 存显式选择的键。 */
const PREFERENCE_KEY = 'workspace-selection'

/** 存档格式版本；结构变了就整体作废。 */
const PREFERENCE_VERSION = 1

/** 一次显式选择：绑定在哪个聚焦上下文、选了哪条路径。 */
interface WorkspacePreference {
  readonly contextKey: string
  readonly path: string
}

/**
 * 创建工作区解析器。
 * @param host - 宿主方法调用入口。
 * @param storage - 插件私有存储；不可用时只记在进程内。
 * @returns 解析器。
 */
export function createWorkspaceResolver(
  host: OrcaWorkerApi['host'],
  storage?: WorkspacePreferenceStore,
): WorkspaceResolver {
  let cached: { readonly key: string; readonly resolution: WorkspaceResolution } | undefined
  // 用户显式选择的工作区；只有聚焦上下文键相同的请求才有资格沿用。
  let preferred: WorkspacePreference | undefined
  let loadingPreference: Promise<void> | undefined

  const persistPreference = async (preference: WorkspacePreference): Promise<void> => {
    if (storage === undefined) return
    try {
      await storage.set(PREFERENCE_KEY, {
        version: PREFERENCE_VERSION,
        contextKey: preference.contextKey,
        path: preference.path,
      })
    } catch {
      // 存不住不影响当前会话：选择至少在 worker 进程内有效。
    }
  }

  const ensurePreference = (): Promise<void> => {
    if (storage === undefined) return Promise.resolve()
    loadingPreference ??= storage
      .get(PREFERENCE_KEY)
      .then((raw) => {
        const stored = readStoredPreference(raw)
        if (stored !== undefined) preferred ??= stored
      })
      .catch(() => {
        // 存储读失败按没有选择处理，不拖住解析。
      })
    return loadingPreference
  }

  return {
    async resolve() {
      await ensurePreference()

      const context = await readContext(host)
      if (context === undefined) {
        cached = undefined
        return { status: 'unresolved', candidates: [], contextKey: '' }
      }

      const key = contextKeyOf(context)
      if (cached?.key === key) return cached.resolution

      const resolution = await matchWorkspace(host, context, preferred)
      // 失败也缓存：同一聚焦上下文里重试不会多出证据，等 workspace.changed、
      // 用户主动刷新或面板重新询问时再 invalidate 后重试。
      cached = { key, resolution }
      return resolution
    },

    invalidate() {
      cached = undefined
    },

    async prefer(path) {
      const context = await readContext(host)
      if (context === undefined) {
        // 没有聚焦的工作区就无处绑定；下一次请求会重新问宿主。
        cached = undefined
        return
      }
      const preference: WorkspacePreference = { contextKey: contextKeyOf(context), path }
      // 面板每个请求都会带上已选路径；同一上下文里没换选择时不必重复写存储。
      if (
        preferred !== undefined &&
        preferred.contextKey === preference.contextKey &&
        preferred.path === path
      ) {
        return
      }
      preferred = preference
      cached = undefined
      await persistPreference(preference)
    },
  }
}

/** 当前工作区的显示名与分支。 */
interface WorkspaceContext {
  /**
   * 宿主给的工作区 id，与 `workspace.list` 的 id 同源；旧宿主或拿不到时缺席。
   * 有它就能区分同名同分支的工作区（两个仓库的 `main`）。
   */
  readonly workspaceId?: string
  readonly displayName: string
  readonly branch: string
  /** 聚焦工作区的终端标题；标题里常带工作目录，是重名时的线索。 */
  readonly terminalTitles: readonly string[]
}

/**
 * 聚焦上下文的键。宿主给了工作区 id 就用 id；否则退回显示名 + 分支。
 *
 * 只用显示名 + 分支时，两个仓库的 `main` 会共用一个键：切过去后缓存与显式选择
 * 都会沿用前一个工作区，面板也看不出上下文变了。
 */
function contextKeyOf(context: WorkspaceContext): string {
  if (context.workspaceId !== undefined) return `id\u0000${context.workspaceId}`
  return `${context.displayName}\u0000${context.branch}`
}

/** 读当前工作区的上下文；没有聚焦的工作区时是 undefined。 */
async function readContext(host: OrcaWorkerApi['host']): Promise<WorkspaceContext | undefined> {
  try {
    const raw = await host.call('workspace.readContext')
    if (!isRecord(raw)) return undefined
    const displayName = raw['displayName']
    const branch = raw['branch']
    if (typeof displayName !== 'string' || typeof branch !== 'string') return undefined
    const terminals = raw['terminals']
    const terminalTitles = Array.isArray(terminals)
      ? terminals
          .map((terminal) =>
            isRecord(terminal) && typeof terminal['title'] === 'string' ? terminal['title'] : '',
          )
          .filter((title) => title.length > 0)
      : []
    const workspaceId = raw['workspaceId']
    return {
      ...(typeof workspaceId === 'string' && workspaceId.length > 0 ? { workspaceId } : {}),
      displayName,
      branch,
      terminalTitles,
    }
  } catch {
    // 宿主读不到上下文时不猜工作区。
    return undefined
  }
}

/** 读存档里的显式选择；结构不对或版本不符时是 undefined。 */
function readStoredPreference(value: unknown): WorkspacePreference | undefined {
  if (!isRecord(value)) return undefined
  if (value['version'] !== PREFERENCE_VERSION) return undefined
  const contextKey = value['contextKey']
  const path = value['path']
  if (typeof contextKey !== 'string' || typeof path !== 'string' || path.length === 0) {
    return undefined
  }
  return { contextKey, path }
}

/**
 * 按显示名认领工作区。
 *
 * 宿主的显示名有时是工作区别名，有时是仓库名；先按工作区名精确匹配，
 * 再退到忽略大小写的匹配，最后按仓库名匹配。
 * @param workspaces - 全部工作区。
 * @param displayName - 宿主的显示名，已去掉首尾空白。
 * @returns 命中的工作区。
 */
function matchByName(
  workspaces: readonly WorkspaceCandidate[],
  displayName: string,
): readonly WorkspaceCandidate[] {
  const exact = workspaces.filter((workspace) => workspace.name === displayName)
  if (exact.length > 0) return exact

  const loose = workspaces.filter(
    (workspace) => workspace.name.trim().toLowerCase() === displayName.toLowerCase(),
  )
  if (loose.length > 0) return loose

  return workspaces.filter(
    (workspace) =>
      workspace.project !== null && workspace.project.toLowerCase() === displayName.toLowerCase(),
  )
}

/**
 * 用终端标题里的工作目录认领工作区。
 *
 * 终端标题常带当前目录（`zgray@host: ~/path/to/repo`），是重名工作区时唯一的路径线索。
 * @param workspaces - 候选工作区。
 * @param titles - 聚焦工作区的终端标题。
 * @returns 唯一命中的工作区；没有或多个命中时是 undefined。
 */
function matchByTerminalTitle(
  workspaces: readonly WorkspaceCandidate[],
  titles: readonly string[],
): WorkspaceCandidate | undefined {
  for (const title of titles) {
    const comparableTitle = comparablePath(title)
    // 每个工作区取它在标题里最长的一次完整命中；同名前缀的兄弟仓库
    // （`~/x/orca` 对 `~/x/orca-workflow`）不算命中。
    const hits: { readonly workspace: WorkspaceCandidate; readonly length: number }[] = []
    for (const workspace of workspaces) {
      const length = Math.max(
        0,
        ...pathForms(workspace.path)
          .filter((form) => containsPath(comparableTitle, form))
          .map((form) => form.length),
      )
      if (length > 0) hits.push({ workspace, length })
    }
    if (hits.length === 0) continue
    // 终端在嵌套工作区的子目录里时，外层与内层都会命中：最深的那个才是当前目录所在。
    const deepest = Math.max(...hits.map((hit) => hit.length))
    const best = hits.filter((hit) => hit.length === deepest)
    if (best.length === 1) return best[0]?.workspace
  }
  return undefined
}

/**
 * 标题里是否出现了这条路径，且两端都落在路径边界上。
 *
 * 只认「后面紧跟路径结束」的命中：结尾、`/`、空白或常见的标题分隔符。
 * 否则 `~/x/orca` 会命中 `~/x/orca-workflow`。
 * @param title - 终端标题。
 * @param path - 一种路径写法。
 * @returns 是否完整命中。
 */
function containsPath(title: string, path: string): boolean {
  if (path.length === 0) return false
  let from = 0
  for (;;) {
    const index = title.indexOf(path, from)
    if (index < 0) return false
    const before = index === 0 ? '' : title.charAt(index - 1)
    const after = title.charAt(index + path.length)
    const startsClean = before === '' || /[\s:'"(\[]/.test(before)
    const endsClean = after === '' || /[\s/:'")\]]/.test(after)
    if (startsClean && endsClean) return true
    from = index + 1
  }
}

/**
 * 路径的两种写法：绝对路径与 `~` 缩写。
 *
 * 终端标题里的目录通常写成 `~/Projects/...`，与工作区的绝对路径对不上。
 * @param path - 工作区绝对路径。
 * @returns 可比较的路径写法。
 */
function pathForms(path: string): readonly string[] {
  const home = comparablePath(homedir())
  const comparable = comparablePath(path)
  const forms = [comparable]
  if (home.length > 0 && comparable.startsWith(`${home}/`)) {
    forms.push(`~${comparable.slice(home.length)}`)
  }
  return forms
}

/** Git Bash and Windows shells can display the same Windows path differently. */
function comparablePath(path: string): string {
  return process.platform === 'win32' ? path.replaceAll('\\', '/').toLowerCase() : path
}

/** 在全部工作区里认领当前工作区。 */
async function matchWorkspace(
  host: OrcaWorkerApi['host'],
  context: WorkspaceContext,
  preferred: WorkspacePreference | undefined,
): Promise<WorkspaceResolution> {
  const key = contextKeyOf(context)
  const workspaces = await listWorkspaces(host)
  if (workspaces.length === 0) return { status: 'unresolved', candidates: [], contextKey: key }

  // 宿主直接告诉了是哪个工作区：这是唯一可靠的线索，压过显式选择与一切猜测。
  if (context.workspaceId !== undefined) {
    const exact = workspaces.find((workspace) => workspace.id === context.workspaceId)
    if (exact !== undefined) return resolved(exact, key)
  }

  // 用户在同一个聚焦上下文里显式选过：直接沿用，不再猜。
  if (preferred !== undefined && preferred.contextKey === key) {
    const chosen = workspaces.find((workspace) => workspace.path === preferred.path)
    if (chosen !== undefined) return resolved(chosen, key)
  }

  const displayName = context.displayName.trim()
  const branch = context.branch.trim()
  // 空白显示名与「显示名就是分支名」都不是唯一线索：分支名会被大量工作区共用，
  // 未命名工作区的显示名还会退化成它。
  const nameIsClue = displayName.length > 0 && displayName !== branch
  const byName = nameIsClue ? matchByName(workspaces, displayName) : []
  if (byName.length === 1) {
    const candidate = byName[0]
    if (candidate !== undefined) return resolved(candidate, key)
  }

  const byBranch =
    branch.length > 0 ? workspaces.filter((workspace) => workspace.branch === branch) : []
  // 名字命中多个时用分支再收一次；名字没命中时直接按分支认领。
  const narrowed = byName.length > 1 ? byName.filter((workspace) => byBranch.includes(workspace)) : byBranch
  // 还是多个：先看终端标题里的工作目录。
  if (narrowed.length > 1) {
    const byTerminal = matchByTerminalTitle(narrowed, context.terminalTitles)
    if (byTerminal !== undefined) return resolved(byTerminal, key)
  }
  if (narrowed.length === 1) {
    const candidate = narrowed[0]
    if (candidate !== undefined) return resolved(candidate, key)
  }

  if (narrowed.length === 0) {
    // 分支也没命中：把全部工作区交给面板，总比停在「未识别到仓库」多一条出路。
    const candidates = byName.length > 1 ? byName : workspaces
    return { status: 'unresolved', candidates, contextKey: key }
  }
  return { status: 'ambiguous', candidates: narrowed, contextKey: key }
}

/** 认领成功的解析结果。 */
function resolved(candidate: WorkspaceCandidate, contextKey: string): WorkspaceResolution {
  return { status: 'resolved', root: candidate.path, candidate, contextKey }
}

/** 读全部工作区；宿主不支持或读取失败时是空列表。 */
async function listWorkspaces(host: OrcaWorkerApi['host']): Promise<readonly WorkspaceCandidate[]> {
  try {
    const raw = await host.call('workspace.list')
    if (!isRecord(raw)) return []
    const workspaces = raw['workspaces']
    if (!Array.isArray(workspaces)) return []

    const candidates: WorkspaceCandidate[] = []
    for (const entry of workspaces) {
      const candidate = readCandidate(entry)
      if (candidate !== undefined) candidates.push(candidate)
    }
    return candidates
  } catch {
    return []
  }
}

/** 读一个工作区条目；字段不合法时是 undefined。 */
function readCandidate(value: unknown): WorkspaceCandidate | undefined {
  if (!isRecord(value)) return undefined
  const id = value['id']
  const name = value['name']
  const path = value['path']
  const branch = value['branch']
  const project = value['project']
  const kind = value['kind']
  if (typeof id !== 'string' || typeof name !== 'string' || typeof path !== 'string') return undefined
  return {
    id,
    name,
    path,
    branch: typeof branch === 'string' ? branch : null,
    project: typeof project === 'string' ? project : null,
    kind: kind === 'folder' ? 'folder' : 'worktree',
  }
}
