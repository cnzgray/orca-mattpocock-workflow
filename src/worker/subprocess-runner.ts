/**
 * 用 `node:child_process` 实现 core 的 {@link CommandRunner}。
 *
 * Orca 的 worker 是普通 Node 进程，不需要宿主的子进程服务：
 * 这里只做进程生命周期与输出收集，命令语义和错误码由 adapter 决定。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, extname, join } from 'node:path'

import type {
  BinaryCommandRunner,
  CommandRunner,
  CommandRunOptions,
} from '../core/ticket.ts'
import { CommandError } from '../core/tracker-error.ts'

/** 一次命令最多保留的输出；GraphQL 响应远小于此。 */
const STDOUT_LIMIT_BYTES = 8 * 1024 * 1024
/** 标准错误只用于诊断，留小一点。 */
const STDERR_LIMIT_BYTES = 256 * 1024
/** 远端命令的最长执行时间；超时后终止进程。 */
const COMMAND_TIMEOUT_MS = 30_000
/** 终止阶段留给进程的时间；宽限期内退出就只算被信号终止。 */
const TERMINATION_GRACE_MS = 5_000

/**
 * 桌面端从 Finder 启动时 PATH 只有系统目录，Homebrew 安装的 gh / glab / tea 不在其中。
 * 先按 PATH 找，找不到再试常见的绝对路径；全部失败才算 xxx-missing。
 */
const EXECUTABLE_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  gh: ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'],
  glab: ['/opt/homebrew/bin/glab', '/usr/local/bin/glab'],
  tea: ['/opt/homebrew/bin/tea', '/usr/local/bin/tea'],
}

/**
 * 面板在后台调用 CLI，不需要遥测上报与更新检查。`glab` 默认每次调用都同步
 * 上报遥测，实测每次多花 120–170 ms；首屏要串行调用好几次 `glab`。
 */
const QUIET_CLI_ENV: Readonly<Record<string, string>> = {
  GLAB_SEND_TELEMETRY: 'false',
  GLAB_CHECK_UPDATE: 'false',
}

/**
 * 创建命令执行器。
 * @returns 满足 core `CommandRunner` 的函数。
 */
export function createCommandRunner(): CommandRunner {
  const run = createByteRunner()
  return async (command, args, options) => {
    const output = await run(command, args, options)
    return {
      stdout: output.stdout.toString('utf8'),
      stderr: output.stderr,
      ...(output.executable === undefined ? {} : { executable: output.executable }),
    }
  }
}

/**
 * 创建二进制命令执行器：标准输出保持原始字节。
 *
 * `glab api` 取上传附件时输出的是图片字节，按 UTF-8 解码会把非法序列换成
 * U+FFFD，图片就坏了；这条路径必须避开文本转换。
 * @returns 满足 core `BinaryCommandRunner` 的函数。
 */
export function createBinaryCommandRunner(): BinaryCommandRunner {
  const run = createByteRunner()
  return async (command, args, options) => {
    const output = await run(command, args, options)
    return {
      stdout: output.stdout,
      stderr: output.stderr,
      ...(output.executable === undefined ? {} : { executable: output.executable }),
    }
  }
}

/** 进程层收集到的原始输出；文本执行器只在这里做一次解码。 */
interface ByteRunOutput {
  readonly stdout: Buffer
  readonly stderr: string
  readonly executable?: string | undefined
}

/** 两个公开执行器共用同一套进程与输出收集，只在解释标准输出时分开。 */
function createByteRunner(): (
  command: string,
  args: readonly string[],
  options?: CommandRunOptions,
) => Promise<ByteRunOutput> {
  return async (command, args, options) => {
    const executable = await resolveExecutable(command)
    const cwd = options?.cwd ?? process.cwd()
    const timeoutMs = options?.timeoutMs ?? COMMAND_TIMEOUT_MS
    return await runCommand(executable, command, args, cwd, timeoutMs)
  }
}

/**
 * 解析可执行文件的绝对路径。
 *
 * 先按 PATH 逐个目录找，再试 Homebrew 的常见安装位置；命令自带路径时直接用。
 * @param command - 命令名或路径。
 * @returns 可执行文件的绝对路径。
 */
export async function resolveExecutable(command: string): Promise<string> {
  for (const candidate of candidatesOf(command)) {
    const resolved = await lookup(candidate)
    if (resolved !== undefined) return resolved
  }
  throw new CommandError('not-found', `找不到可执行文件：${command}`, '', null)
}

/** 一个命令要尝试的候选：命令本身，加上 Homebrew 兜底路径。 */
function candidatesOf(command: string): readonly string[] {
  if (isCommandPath(command)) return [command]
  return [command, ...(EXECUTABLE_FALLBACKS[command] ?? [])]
}

/** 在 PATH 或绝对路径上找一个可执行文件。 */
async function lookup(candidate: string): Promise<string | undefined> {
  // Spawn Windows native binaries directly instead of invoking a shell for batch shims.
  const executable = process.platform === 'win32' && extname(candidate) === ''
    ? `${candidate}.exe`
    : candidate
  if (isCommandPath(executable)) {
    return (await isExecutable(executable)) ? executable : undefined
  }
  for (const directory of pathDirectories()) {
    const full = join(directory, executable)
    if (await isExecutable(full)) return full
  }
  return undefined
}

function isCommandPath(command: string): boolean {
  return command.includes('/') || (process.platform === 'win32' && command.includes('\\'))
}

/** PATH 里的目录；空项忽略。 */
function pathDirectories(): readonly string[] {
  const raw = process.env['PATH'] ?? ''
  return raw.split(delimiter).filter((entry) => entry.length > 0)
}

/** 路径存在、是普通文件且可执行时为 true。 */
async function isExecutable(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** 一次命令的收集结果。 */
interface Collected {
  readonly stdout: Buffer
  readonly stderr: string
  readonly exitCode: number | null
}

/**
 * 跑一个命令并收集输出；非零退出按失败处理。
 *
 * 这里用 `new Promise` 而不是 `Promise.withResolvers`：工程的编译目标是 ES2023，
 * 类型库里没有 `withResolvers`。
 */
function runCommand(
  executable: string,
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<ByteRunOutput> {
  return new Promise<ByteRunOutput>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd,
      env: { ...process.env, ...QUIET_CLI_ENV },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdout = new OutputCollector(STDOUT_LIMIT_BYTES)
    const stderr = new OutputCollector(STDERR_LIMIT_BYTES)
    let timedOut = false
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
    })

    const timeout = setTimeout(() => {
      timedOut = true
      terminate(child)
    }, timeoutMs)

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout)
      if (error.code === 'ENOENT') {
        reject(new CommandError('not-found', `找不到可执行文件：${command}`, '', null))
        return
      }
      reject(new CommandError('failed', `${command} 启动失败`, error.message, null))
    })

    child.on('close', (code: number | null) => {
      clearTimeout(timeout)
      const collected: Collected = {
        stdout: stdout.bytes(),
        stderr: stderr.text(),
        exitCode: code,
      }
      if (timedOut) {
        reject(
          new CommandError(
            'timeout',
            `${command} 超时（${String(Math.round(timeoutMs / 1000))} 秒）`,
            collected.stderr,
            collected.exitCode,
            collected.stdout.toString('utf8'),
          ),
        )
        return
      }
      if (collected.exitCode !== 0) {
        const label =
          collected.exitCode === null ? '被信号终止' : `退出码 ${String(collected.exitCode)}`
        reject(
          new CommandError(
            'failed',
            `${command} ${label}`,
            collected.stderr,
            collected.exitCode,
            collected.stdout.toString('utf8'),
          ),
        )
        return
      }
      resolve({
        stdout: collected.stdout,
        stderr: collected.stderr,
        executable,
      })
    })
  })
}

/** 先礼后兵：宽限期内退出就停手，超时再强杀。 */
function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const grace = setTimeout(() => {
    child.kill('SIGKILL')
  }, TERMINATION_GRACE_MS)
  grace.unref()
  child.on('close', () => {
    clearTimeout(grace)
  })
}

/** 按字节上限收集一段输出；超出上限的部分丢弃，保留开头。 */
class OutputCollector {
  private readonly chunks: Buffer[] = []
  private readonly limit: number
  private size = 0

  constructor(limit: number) {
    this.limit = limit
  }

  push(chunk: Buffer): void {
    if (this.size >= this.limit) return
    const room = this.limit - this.size
    const slice = chunk.length > room ? chunk.subarray(0, room) : chunk
    this.chunks.push(slice)
    this.size += slice.length
  }

  text(): string {
    return this.bytes().toString('utf8')
  }

  bytes(): Buffer {
    return Buffer.concat(this.chunks)
  }
}