import { basename, dirname } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { CommandError } from '../core/tracker-error.ts'
import { createCommandRunner } from './subprocess-runner.ts'

describe('命令执行器', () => {
  it('成功时返回标准输出与可执行文件路径', async () => {
    const run = createCommandRunner()

    const output = await run(process.execPath, ['-e', 'process.stdout.write("ok")'])

    expect(output.stdout).toBe('ok')
    expect(output.stderr).toBe('')
    expect(output.executable).toBe(process.execPath)
  })

  it('非零退出时映射为 failed', async () => {
    const run = createCommandRunner()

    const error = await run(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(3)']).catch(
      (failure: unknown) => failure,
    )

    expect(error).toBeInstanceOf(CommandError)
    expect(error instanceof CommandError && error.kind).toBe('failed')
    expect(error instanceof CommandError && error.exitCode).toBe(3)
    expect(error instanceof CommandError && error.stderr).toBe('boom')
  })

  it('找不到可执行文件时映射为 not-found', async () => {
    const run = createCommandRunner()

    const error = await run('mattwf-does-not-exist', []).catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(CommandError)
    expect(error instanceof CommandError && error.kind).toBe('not-found')
  })

  it('超过调用方给的时限时映射为 timeout', async () => {
    const run = createCommandRunner()

    const error = await run(
      process.execPath,
      ['-e', 'setTimeout(() => undefined, 5000)'],
      { timeoutMs: 50 },
    ).catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(CommandError)
    expect(error instanceof CommandError && error.kind).toBe('timeout')
  })

  it.skipIf(process.platform !== 'win32')('resolves native Windows executable names through PATH', async () => {
    vi.stubEnv('PATH', dirname(process.execPath))
    try {
      const output = await createCommandRunner()(basename(process.execPath, '.exe'), ['--version'])
      expect(output.executable).toBe(process.execPath)
      expect(output.stdout.trim()).toBe(process.version)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('在指定目录里执行命令', async () => {
    const run = createCommandRunner()

    const output = await run(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], {
      cwd: dirname(process.execPath),
    })

    expect(output.stdout).toBe(dirname(process.execPath))
  })
})
