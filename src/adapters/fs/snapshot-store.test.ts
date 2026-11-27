import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { storeKeyOf } from '../../core/repository-scope.ts'
import { SNAPSHOT_STORE_VERSION, type SnapshotStoreEntry } from '../../core/snapshot-store.ts'
import type { Ticket } from '../../core/ticket.ts'
import { emptyMetrics } from '../../protocol/snapshot-test-support.ts'
import {
  SNAPSHOT_STORE_CHANGE_LOG_LIMIT,
  SNAPSHOT_STORE_MAX_ENTRIES,
  SNAPSHOT_STORE_TTL_MS,
  createNodeSnapshotStore,
} from './snapshot-store.ts'

let root = ''
let workspace = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mattwf-store-'))
  workspace = join(root, 'workspace')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

function ticket(number: number, overrides: Partial<Ticket> = {}): Ticket {
  return {
    ref: `#${String(number)}`,
    number,
    title: `票 ${String(number)}`,
    state: 'open',
    labels: ['ready-for-agent'],
    author: null,
    assignees: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

function entry(overrides: Partial<SnapshotStoreEntry> = {}): SnapshotStoreEntry {
  return {
    version: SNAPSHOT_STORE_VERSION,
    scopeRoot: workspace,
    workspaceRoot: workspace,
    backend: 'github',
    repository: 'cnzgray/repo',
    repositoryKey: 'github@github.com/cnzgray/repo',
    repositoryHost: 'github.com',
    fetchedAt: 1_000,
    viewer: 'cnzgray',
    loaded: 1,
    total: 1,
    tickets: [ticket(1)],
    hierarchy: 'native',
    revision: { id: '1:2026-01-01T00:00:00Z', total: 1 },
    storeRevision: 0,
    ...overrides,
  }
}

function store() {
  return createNodeSnapshotStore({ root: join(root, 'cache'), home: root, tmp: root })
}

function key(): string {
  return storeKeyOf('github', workspace, workspace)
}

describe('本地快照库的目录实现', () => {
  it('写入后能读回同一份条目，并给出第一个库版本', async () => {
    const cache = store()
    const original = entry({ storeRevision: 0 })

    const revision = await cache.write(original)
    const restored = await cache.read(key())

    expect(revision).toBe(1)
    expect(restored).toEqual({ ...original, storeRevision: 1 })
  })

  it('库版本单调自增', async () => {
    const cache = store()
    const first = await cache.write(entry())
    const second = await cache.write(entry({ fetchedAt: 2_000 }))

    expect(first).toBe(1)
    expect(second).toBe(2)
    await expect(cache.revision(key())).resolves.toBe(2)
  })

  it('概览指标随写入落库，读侧不用重算', async () => {
    const cache = store()
    const metrics = emptyMetrics({ openBacklog: 7, readyCapacity: 3 })

    await cache.write(entry({ metrics }))

    const restored = await cache.read(key())
    expect(restored?.metrics).toEqual(metrics)
  })

  it('没有条目时读到 undefined，版本也是 undefined', async () => {
    const cache = store()

    await expect(cache.read(key())).resolves.toBeUndefined()
    await expect(cache.revision(key())).resolves.toBeUndefined()
  })

  it('只改一张票时只更新那张票', async () => {
    const cache = store()
    await cache.write(entry({ tickets: [ticket(1), ticket(2)], metrics: emptyMetrics() }))

    const patched = await cache.patchTicket(key(), '#1', { state: 'closed' })

    expect(patched).toBe(true)
    const stored = await cache.read(key())
    expect(stored?.tickets.find((item) => item.ref === '#1')?.state).toBe('closed')
    expect(stored?.tickets.find((item) => item.ref === '#2')).toEqual(ticket(2))
    // 改票后旧指标不再与列表同源，清空让读侧重算。
    expect(stored?.metrics).toBeUndefined()
  })

  it('删除走墓碑：列表里消失，变化集把它报成 removed', async () => {
    const cache = store()
    await cache.write(entry({ tickets: [ticket(1), ticket(2)] }))
    const before = await cache.revision(key())

    await expect(cache.removeTicket(key(), '#1')).resolves.toBe(true)

    const stored = await cache.read(key())
    expect(stored?.tickets.map((item) => item.ref)).toEqual(['#2'])
    const changes = await cache.changesSince(key(), before ?? 0)
    expect(changes?.tickets).toEqual([])
    expect(changes?.removed).toEqual(['#1'])
  })

  it('按版本读变化集：变化行、墓碑与重新出现都说得清', async () => {
    const cache = store()
    const first = await cache.write(entry({ tickets: [ticket(1), ticket(3)] }))
    await cache.write(
      entry({
        fetchedAt: 2_000,
        tickets: [ticket(1, { title: '改过标题' }), ticket(2)],
      }),
    )

    const changes = await cache.changesSince(key(), first)

    expect(changes?.revision).toBe(2)
    expect(changes?.tickets.map((item) => item.ref)).toEqual(['#1', '#2'])
    expect(changes?.tickets.find((item) => item.ref === '#1')?.title).toBe('改过标题')
    expect(changes?.removed).toEqual(['#3'])

    // 再写回 #3：同一窗口的最终状态是「存在」，墓碑消失。
    await cache.write(
      entry({
        fetchedAt: 3_000,
        tickets: [ticket(1, { title: '改过标题' }), ticket(2), ticket(3)],
      }),
    )
    const again = await cache.changesSince(key(), first)
    expect(again?.tickets.map((item) => item.ref)).toEqual(['#1', '#2', '#3'])
    expect(again?.removed).toEqual([])
  })

  it('从当前版本读变化集是空的，未来版本读不出来', async () => {
    const cache = store()
    const revision = await cache.write(entry())

    await expect(cache.changesSince(key(), revision)).resolves.toEqual({
      fromRevision: revision,
      revision,
      tickets: [],
      removed: [],
    })
    await expect(cache.changesSince(key(), revision + 1)).resolves.toBeUndefined()
  })

  it('提交中途崩溃时旧 meta 仍可读，下一次写入自愈', async () => {
    await store().write(entry({ tickets: [ticket(1)] }))
    const crashing = createNodeSnapshotStore({
      root: join(root, 'cache'),
      home: root,
      tmp: root,
      onCommitStage: (stage) => {
        if (stage === 'meta') throw new Error('模拟 meta 前崩溃')
      },
    })

    await expect(
      crashing.write(entry({ fetchedAt: 2_000, tickets: [ticket(1), ticket(2)] })),
    ).rejects.toThrow('模拟 meta 前崩溃')

    // 旧 meta 是提交点：新票文件与日志尾巴都不可见。
    const old = await store().read(key())
    expect(old?.tickets.map((item) => item.ref)).toEqual(['#1'])
    expect(old?.storeRevision).toBe(1)

    // 下一次正常提交把日志尾巴与孤儿票文件收掉，读到的仍是完整条目。
    await store().write(entry({ fetchedAt: 1_500, tickets: [ticket(1)] }))
    const healed = await store().read(key())
    expect(healed?.tickets.map((item) => item.ref)).toEqual(['#1'])
  })

  it('变化日志超过上限后，过旧的基线退回整份', async () => {
    const cache = store()
    await cache.write(entry())
    for (let index = 0; index < SNAPSHOT_STORE_CHANGE_LOG_LIMIT; index += 1) {
      await cache.write(entry({ fetchedAt: 1_000 + index }))
    }

    await expect(cache.changesSince(key(), 0)).resolves.toBeUndefined()
    const current = await cache.revision(key())
    await expect(cache.changesSince(key(), (current ?? 1) - 1)).resolves.toBeDefined()
  }, 20_000)

  it('清空后条目全部消失并返回清掉的数量', async () => {
    const cache = store()
    await cache.write(entry())

    await expect(cache.clear()).resolves.toBe(1)
    await expect(cache.list()).resolves.toEqual([])
  })

  it('缓存键指向的目录已经不在时清掉对应条目', async () => {
    const cache = store()
    const gone = join(root, 'gone')
    await cache.write(entry({ scopeRoot: gone, workspaceRoot: gone }))

    await expect(cache.prune(1_000)).resolves.toBe(1)
    await expect(cache.list()).resolves.toEqual([])
  })

  it('长期未更新的条目被淘汰', async () => {
    const cache = store()
    await mkdir(root, { recursive: true })
    // 键指向存在的目录（root），只有时间条件让它该被淘汰。
    await cache.write(entry({ scopeRoot: root, workspaceRoot: root, fetchedAt: 1_000 }))

    const removed = await cache.prune(1_000 + SNAPSHOT_STORE_TTL_MS + 1)

    expect(removed).toBe(1)
    await expect(cache.list()).resolves.toEqual([])
  })

  it('条目数量超过上限时按最后使用时间淘汰最旧的', async () => {
    const cache = store()
    const extra = SNAPSHOT_STORE_MAX_ENTRIES + 1
    for (let index = 0; index < extra; index += 1) {
      const directory = join(root, `workspace-${String(index)}`)
      await mkdir(directory, { recursive: true })
      await cache.write(entry({ scopeRoot: directory, workspaceRoot: directory, fetchedAt: index }))
    }

    const removed = await cache.prune(10_000)

    expect(removed).toBe(1)
    const remaining = await cache.list()
    expect(remaining).toHaveLength(SNAPSHOT_STORE_MAX_ENTRIES)
    expect(remaining.some((item) => item.fetchedAt === 0)).toBe(false)
  })

  it('同一仓库的两个 worktree 只占一份缓存', async () => {
    const cache = store()
    const main = join(root, 'main')
    const attached = join(root, 'attached')
    await mkdir(main, { recursive: true })
    await mkdir(attached, { recursive: true })

    await cache.write(entry({ scopeRoot: main, workspaceRoot: main, fetchedAt: 1_000 }))
    await cache.write(entry({ scopeRoot: main, workspaceRoot: attached, fetchedAt: 2_000 }))

    const entries = await cache.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.workspaceRoot).toBe(attached)
    await expect(cache.read(main)).resolves.toMatchObject({ workspaceRoot: attached })
  })

  it('本地 Markdown 按工作区各存一份', async () => {
    const cache = store()
    const main = join(root, 'main')
    const attached = join(root, 'attached')
    await mkdir(main, { recursive: true })
    await mkdir(attached, { recursive: true })

    await cache.write(
      entry({ backend: 'markdown', scopeRoot: main, workspaceRoot: main, fetchedAt: 1_000 }),
    )
    await cache.write(
      entry({ backend: 'markdown', scopeRoot: main, workspaceRoot: attached, fetchedAt: 2_000 }),
    )

    await expect(cache.list()).resolves.toHaveLength(2)
    await expect(cache.read(attached)).resolves.toMatchObject({ workspaceRoot: attached })
  })

  it('清理时删掉升级前按工作区存的旧条目', async () => {
    const cache = store()
    await mkdir(join(root, 'cache'), { recursive: true })
    await writeFile(join(root, 'cache', 'legacy.json'), JSON.stringify({ version: 1 }))

    const removed = await cache.prune(1_000)

    expect(removed).toBe(1)
    await expect(cache.list()).resolves.toEqual([])
  })

  it('清空时把读不出来的文件一起删掉', async () => {
    const cache = store()
    await mkdir(join(root, 'cache'), { recursive: true })
    await writeFile(join(root, 'cache', 'broken.json'), 'not json')

    await expect(cache.clear()).resolves.toBe(1)
  })

  it('缓存里没有这张票时变更返回 false', async () => {
    const cache = store()
    await cache.write(entry())

    await expect(cache.patchTicket(key(), '#99', { state: 'closed' })).resolves.toBe(false)
  })

  it('缓存位置用符号形式给出', () => {
    const withHome = createNodeSnapshotStore({ home: root })
    const withoutHome = createNodeSnapshotStore({ home: '' })

    expect(withHome.location()).toBe('~/.orca-mattpocock-workflow/cache')
    expect(withoutHome.location()).toBe('系统临时目录')
  })
})
