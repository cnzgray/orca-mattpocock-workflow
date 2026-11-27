/**
 * 仓库作用域的解析：在某个工作区里跑 `git worktree list --porcelain`，
 * 取第一条仍然存在的 worktree 根目录（通常是主 worktree）。
 *
 * 作用域只决定缓存归到哪一份：同一仓库的多个 worktree 共用一份工单状态，
 * 但 git / gh / glab / tea 仍然在各自工作区里跑。
 *
 * 解析失败（不是 git 仓库、没有 git、输出不可解析）时退回工作区根目录，
 * 行为与没有作用域时一致。成功解析出的结果按工作区在进程内缓存：面板每个请求都会问一次，
 * 不能每次都跑一条 git 命令。失败不缓存，下一次请求重新解析。
 */
import { stat } from 'node:fs/promises'
import { normalize } from 'node:path'

import { parseWorktreeRoots, pickExistingRoot } from '../core/repository-scope.ts'
import type { CommandRunner } from '../core/ticket.ts'

/** 按工作区根目录解析仓库作用域；解析不出来时返回工作区自己。 */
export type RepositoryScopeResolver = (workspaceRoot: string) => Promise<string>

/** 作用域解析依赖。 */
export interface RepositoryScopeDeps {
  readonly run: CommandRunner
  /** 目录是否存在；默认读文件系统。 */
  readonly exists?: (path: string) => Promise<boolean>
}

/**
 * 创建仓库作用域解析器。
 * @param deps - 命令执行器与可选的目录判断。
 * @returns 按工作区缓存结果的解析函数。
 */
export function createRepositoryScopeResolver(deps: RepositoryScopeDeps): RepositoryScopeResolver {
  const exists = deps.exists ?? directoryExists
  const cache = new Map<string, Promise<string>>()

  return (workspaceRoot) => {
    const cached = cache.get(workspaceRoot)
    if (cached !== undefined) return cached

    const resolving = resolveScope(deps, exists, workspaceRoot)
    // 进行中的解析照样共享，并发请求只跑一次 git。
    const pending = resolving.then((root) => root ?? workspaceRoot)
    cache.set(workspaceRoot, pending)
    // 解析失败只退回工作区、不缓存：一次瞬时失败不能让这个 worktree
    // 一直用自己的键，与同仓库的其它 worktree 拆成两份缓存直到宿主重启。
    void resolving.then((root) => {
      if (root === undefined && cache.get(workspaceRoot) === pending) {
        cache.delete(workspaceRoot)
      }
    })
    return pending
  }
}

/**
 * 跑一次 git 并选出作用域。
 * @param deps - 依赖。
 * @param exists - 目录是否存在。
 * @param workspaceRoot - 当前工作区根目录。
 * @returns 仓库作用域根目录；命令失败或没有可用 worktree 时是 undefined。
 */
async function resolveScope(
  deps: RepositoryScopeDeps,
  exists: (path: string) => Promise<boolean>,
  workspaceRoot: string,
): Promise<string | undefined> {
  try {
    const output = await deps.run('git', ['worktree', 'list', '--porcelain'], {
      cwd: workspaceRoot,
    })
    return await pickExistingRoot(parseWorktreeRoots(output.stdout).map(normalize), exists)
  } catch {
    // 不是 git 仓库、没装 git、输出不可解析：交给调用方退回工作区。
    return undefined
  }
}

/**
 * 目录是否存在。
 *
 * 权限不足、挂载点掉线等判断不了的情况按存在处理：宁可让作用域停在主 worktree，
 * 也不因为一次读不到就把它退回到当前工作区。
 * @param path - 目录路径。
 * @returns 是否存在。
 */
async function directoryExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}
