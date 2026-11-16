import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildPlugin } from './build.mjs'
import { PLUGIN_ARTIFACTS } from './lib/publish-readiness.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
let tempDir = null

afterEach(async () => {
  if (tempDir !== null) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('发布构建产物集合', () => {
  it('build:release 只产出四个约定文件，不生成 source map', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mwf-build-'))
    const distDir = join(tempDir, 'dist')

    await buildPlugin({
      rootDir: repoRoot,
      distDir,
      logLevel: 'silent',
      sourcemap: false,
    })

    const files = await listFiles(distDir)
    const expected = PLUGIN_ARTIFACTS.map(({ path }) => path.replace(/^dist\//, '')).sort()
    expect(files).toEqual(expected)
    expect(files.some((path) => path.endsWith('.map'))).toBe(false)
  })
})

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listFiles(dir) {
  const files = []

  async function walk(prefix) {
    const entries = await readdir(join(dir, prefix), { withFileTypes: true })
    for (const entry of entries) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(path)
      } else {
        files.push(path)
      }
    }
  }

  await walk('')
  return files.sort()
}
