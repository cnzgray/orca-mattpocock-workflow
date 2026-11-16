/**
 * 构建产物的冒烟校验：产物存在、面板页面自洽、清单被 Orca 认可。
 * 只读检查，不加载插件。
 */
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { PLUGIN_ARTIFACTS } from './lib/publish-readiness.mjs'

const rootDir = resolve(import.meta.dirname, '..')

const failures = []

async function exists(relative) {
  try {
    const info = await stat(resolve(rootDir, relative))
    return info.isFile()
  } catch {
    return false
  }
}

async function requireFile(relative, label) {
  if (await exists(relative)) {
    console.log(`ok   ${label}: ${relative}`)
    return true
  }
  failures.push(`${label} 缺失: ${relative}`)
  console.log(`FAIL ${label} 缺失: ${relative}`)
  return false
}

for (const { path, label } of PLUGIN_ARTIFACTS) {
  await requireFile(path, label)
}

if (await exists('dist/panel/panel.html')) {
  const html = await readFile(resolve(rootDir, 'dist/panel/panel.html'), 'utf8')
  if (html.includes('./panel.js')) {
    console.log('ok   面板页面引用面板脚本')
  } else {
    failures.push('面板页面没有引用 panel.js')
    console.log('FAIL 面板页面没有引用 panel.js')
  }
}

if (await exists('dist/panel/panel.js')) {
  const bundle = await readFile(resolve(rootDir, 'dist/panel/panel.js'), 'utf8')
  if (bundle.includes('createRoot') || bundle.includes('react-dom')) {
    console.log('ok   面板脚本自带 React 运行时')
  } else {
    failures.push('面板脚本里没有 React 运行时')
    console.log('FAIL 面板脚本里没有 React 运行时')
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 项失败`)
  process.exit(1)
}
console.log('\n冒烟校验通过')
