/**
 * 打出一个可安装的插件目录：`.orca/plugin-package`。
 *
 * `orca plugin install <dir>` 会复制目录里的全部内容，只跳过根目录的 `.git`；
 * 仓库根不能直接装：`node_modules` 里 pnpm 的符号链接会被拒绝。
 * 这里只放运行时需要的东西，装完就是正式插件（key `local.mattpocock-workflow`）。
 */
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const rootDir = resolve(import.meta.dirname, '..')
const outDir = resolve(rootDir, '.orca/plugin-package')
const CONTENT = ['dist', 'skills']
const FILES = ['orca-plugin.json', 'README.md', 'LICENSE']
const MAX_ENTRIES = 2000
const MAX_BYTES = 50 * 1024 * 1024

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

for (const name of FILES) {
  await cp(resolve(rootDir, name), join(outDir, name))
}
for (const name of CONTENT) {
  await cp(resolve(rootDir, name), join(outDir, name), { recursive: true })
}

const manifest = JSON.parse(await readFile(join(outDir, 'orca-plugin.json'), 'utf8'))
const required = [manifest.main, ...(manifest.contributes?.panels ?? []).map((panel) => panel.entry)]
for (const file of required) {
  try {
    await stat(join(outDir, file))
  } catch {
    throw new Error(`打包缺少清单指向的文件：${file}（先跑 pnpm build）`)
  }
}

let entries = 0
let bytes = 0
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    entries += 1
    if (entry.isSymbolicLink()) throw new Error(`插件内容不能有符号链接：${relative(outDir, path)}`)
    if (entry.isDirectory()) {
      await walk(path)
    } else if (entry.isFile()) {
      bytes += (await stat(path)).size
    } else {
      throw new Error(`不支持的条目类型：${relative(outDir, path)}`)
    }
  }
}
await walk(outDir)

if (entries > MAX_ENTRIES) throw new Error(`条目过多：${entries} > ${MAX_ENTRIES}`)
if (bytes > MAX_BYTES) throw new Error(`体积超限：${bytes} > ${MAX_BYTES}`)

console.log(`pack ok: ${relative(rootDir, outDir)} (${entries} entries, ${(bytes / 1024 / 1024).toFixed(1)} MiB)`)
console.log(`next: orca plugin install ${relative(rootDir, outDir)}`)
