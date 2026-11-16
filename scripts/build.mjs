/**
 * 构建产物：
 *   dist/worker/main.mjs   Orca worker 入口（Node，ESM，打包第三方依赖）
 *   dist/panel/panel.html  面板页面，自带 bundle 与主题变量注入点
 *   dist/panel/panel.js    面板应用（React 自打包，因为 Orca 面板不提供宿主 React）
 *   dist/panel/theme.css   面板主题样式
 *
 * `pnpm build` 生成带 source map 的开发产物；`pnpm build:release` 生成入库产物，
 * 不写 source map。发布就绪检查用同一套参数在导出的发布树里重建，产物字节才能与
 * 入库文件直接比对。
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { build, context } from 'esbuild'

const repoRoot = resolve(import.meta.dirname, '..')

const panelHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>MattWorkflow</title>
    <style>
      html, body, #root { height: 100%; margin: 0; }
      body {
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        font-size: 13px;
        color: var(--orca-foreground, #ddd);
        background: var(--orca-background, transparent);
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script src="./panel.js"></script>
  </body>
</html>
`

function workerOptions({ rootDir, distDir, logLevel, nodePaths, sourcemap }) {
  return {
    absWorkingDir: rootDir,
    entryPoints: [resolve(rootDir, 'src/worker/main.ts')],
    outfile: resolve(distDir, 'worker/main.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap,
    logLevel,
    ...(nodePaths === undefined ? {} : { nodePaths }),
  }
}

function panelOptions({ rootDir, distDir, logLevel, nodePaths, sourcemap }) {
  return {
    absWorkingDir: rootDir,
    entryPoints: [resolve(rootDir, 'src/panel/main.tsx')],
    outfile: resolve(distDir, 'panel/panel.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap,
    logLevel,
    ...(nodePaths === undefined ? {} : { nodePaths }),
  }
}

async function prepareDist({ rootDir, distDir }) {
  await rm(distDir, { recursive: true, force: true })
  await mkdir(resolve(distDir, 'panel'), { recursive: true })
  await writeFile(resolve(distDir, 'panel/panel.html'), panelHtml)
}

/**
 * 从 rootDir 的源码构建一份完整产物到 distDir。
 *
 * @param {{
 *   rootDir: string,
 *   distDir?: string,
 *   logLevel?: 'info' | 'warning' | 'silent',
 *   nodePaths?: string[],
 *   sourcemap?: boolean,
 * }} options
 */
export async function buildPlugin({
  rootDir,
  distDir = resolve(rootDir, 'dist'),
  logLevel = 'info',
  nodePaths,
  sourcemap = true,
}) {
  await prepareDist({ rootDir, distDir })
  await build(workerOptions({ rootDir, distDir, logLevel, nodePaths, sourcemap }))
  await build(panelOptions({ rootDir, distDir, logLevel, nodePaths, sourcemap }))
  await cp(resolve(rootDir, 'src/panel/theme.css'), resolve(distDir, 'panel/theme.css'))
}

async function watchPlugin({ rootDir, distDir }) {
  await prepareDist({ rootDir, distDir })
  await cp(resolve(rootDir, 'src/panel/theme.css'), resolve(distDir, 'panel/theme.css'))

  const worker = await context(workerOptions({ rootDir, distDir, logLevel: 'info' }))
  const panel = await context(panelOptions({ rootDir, distDir, logLevel: 'info' }))
  await worker.watch()
  await panel.watch()
  console.log('watching: worker + panel')
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename

if (invokedDirectly) {
  if (process.argv.includes('--watch')) {
    await watchPlugin({ rootDir: repoRoot, distDir: resolve(repoRoot, 'dist') })
  } else {
    const release = process.argv.includes('--release')
    await buildPlugin({ rootDir: repoRoot, sourcemap: !release })
    console.log(release ? 'build:release ok' : 'build ok')
  }
}
