/**
 * 发布就绪检查：唯一的发布闸门。
 *
 * 从当前提交导出发布树（等价于安装与目录站看到的字节），在树里重建产物并比对，
 * 跑 Orca 自己的校验器，再核对版本标签、许可证、topic 与仓库可见性。
 * 通过后打印目录条目；任何失败都退出 1。
 *
 * 需要本机的 Orca 命令行；gh 只用于查询收录条件，不可用时降级为警告。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

import { buildPlugin } from './build.mjs'
import { PLUGIN_ARTIFACTS, evaluateReleaseReadiness } from './lib/publish-readiness.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const MAC_ORCA_CLI = '/Applications/Orca.app/Contents/Resources/bin/orca'
const STATUS_PAGE_BASE = 'https://www.onorca.dev/plugins'
const MAX_BUFFER = 16 * 1024 * 1024

const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-release-'))

try {
  await main()
} catch (error) {
  console.error(`发布检查失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

async function main() {
  const headCommit = git(['rev-parse', 'HEAD']).trim()
  const dirty = git(['status', '--porcelain']).trim() !== ''
  const exportDir = join(tempRoot, 'tree')

  await mkdir(exportDir)
  const archivePath = join(tempRoot, 'head.tar')
  git(['archive', `--output=${archivePath}`, '--format=tar', 'HEAD'])
  run('tar', ['-xf', archivePath, '-C', exportDir])

  const tree = await readTree(exportDir)
  const gitEntries = readGitEntries()
  const tags = readTags()
  const repository = readRepository()

  const orca = resolveOrcaCli()
  const orcaFailures = orca === null ? [{ code: 'orca_cli_missing' }] : validateTree(orca, exportDir)
  const { rebuilt, error: buildError } = await rebuild(exportDir)

  const result = evaluateReleaseReadiness({
    tree,
    rebuilt,
    gitEntries,
    tags,
    headCommit,
    repository: repository.value,
  })

  if (dirty) result.warnings.push({ code: 'worktree_dirty' })
  if (repository.value === null && repository.note !== null) {
    const warning = result.warnings.find(({ code }) => code === 'repository_unknown')
    if (warning !== undefined) warning.detail = repository.note
  }
  if (buildError !== null) result.failures.push({ code: 'build_failed', detail: buildError })
  result.failures.push(...orcaFailures)
  result.ok = result.failures.length === 0

  printReport(result)

  if (!result.ok) {
    process.exitCode = 1
    return
  }

  const release = readReleaseEntry(orca)
  if (release.error !== undefined) {
    console.error(`\n打印目录条目失败：${release.error}`)
    process.exitCode = 1
    return
  }
  if (release.note !== null) console.log(`\n注意：${release.note}`)
  if (release.ownerWarning !== null) console.log(`⚠ ${release.ownerWarning}`)
  printReleaseEntry(release.entry)
}

/**
 * 在导出的发布树里重建，并按约定的产物清单读回字节。
 *
 * 必须就地构建：esbuild 会把源码路径写成相对产物文件的注释，产物目录与仓库布局
 * 不一致时字节就不同。导出树是临时副本，覆盖它的 dist 不影响要比较的已提交字节
 * （已读进 tree map）。
 *
 * 依赖仍从本仓库的 node_modules 解析，esbuild 会把它们的真实路径写进 bundle；
 * 比对前把这段「导出树 → 本仓库 node_modules」的相对前缀还原成 `node_modules/`，
 * 与在仓库根构建的产物一致。
 *
 * @param {string} exportDir
 */
async function rebuild(exportDir) {
  try {
    await buildPlugin({
      rootDir: exportDir,
      distDir: join(exportDir, 'dist'),
      logLevel: 'warning',
      nodePaths: [resolve(repoRoot, 'node_modules')],
      sourcemap: false,
    })
  } catch (error) {
    return { rebuilt: new Map(), error: error instanceof Error ? error.message : String(error) }
  }

  const dependencyPrefix = relative(
    await realpath(exportDir),
    await realpath(join(repoRoot, 'node_modules')),
  )
    .split(sep)
    .join('/')

  const rebuilt = new Map()
  for (const { path } of PLUGIN_ARTIFACTS) {
    const content = await readFile(join(exportDir, path))
    rebuilt.set(path, normalizeDependencyPaths(content, dependencyPrefix))
  }
  return { rebuilt, error: null }
}

/**
 * @param {Buffer} content
 * @param {string} dependencyPrefix
 */
function normalizeDependencyPaths(content, dependencyPrefix) {
  if (dependencyPrefix === '') return content
  const text = content.toString('utf8')
  const from = `${dependencyPrefix}/`
  if (!text.includes(from)) return content
  return Buffer.from(text.replaceAll(from, 'node_modules/'), 'utf8')
}

/**
 * 从 HEAD 导出的树里读全部文件（相对路径 → 字节或链接目标）。
 *
 * @param {string} dir
 */
async function readTree(dir) {
  const files = new Map()

  async function walk(prefix) {
    const entries = await readdir(join(dir, prefix), { withFileTypes: true })
    for (const entry of entries) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) await walk(path)
      else if (entry.isSymbolicLink()) files.set(path, await readlink(join(dir, path)))
      else if (entry.isFile()) files.set(path, await readFile(join(dir, path)))
    }
  }

  await walk('')
  return files
}

/** @returns {Array<{ mode: string, path: string }>} */
function readGitEntries() {
  const output = git(['ls-tree', '-r', '-z', '--full-tree', 'HEAD'])
  return output
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => {
      const tab = record.indexOf('\t')
      const mode = record.slice(0, tab).split(' ')[0]
      return { mode, path: record.slice(tab + 1) }
    })
}

/** @returns {Array<{ name: string, commit: string, annotated: boolean }>} */
function readTags() {
  const format = '%(refname:short)%09%(objecttype)%09%(objectname)%09%(*objectname)'
  const output = git(['for-each-ref', 'refs/tags', `--format=${format}`])
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name, objectType, objectName, dereferenced] = line.split('\t')
      return {
        name,
        annotated: objectType === 'tag',
        commit: dereferenced === undefined || dereferenced === '' ? objectName : dereferenced,
      }
    })
}

/**
 * 查仓库可见性与 topic。gh 不可用或未登录时返回 null，由判定层降级为警告。
 */
function readRepository() {
  const result = spawnSync(
    'gh',
    ['repo', 'view', '--json', 'visibility,repositoryTopics,defaultBranchRef'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      timeout: 15_000,
    },
  )

  if (result.error !== undefined || result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.trim()
    return { value: null, note: reason === '' ? 'gh 查询失败' : reason }
  }

  try {
    const payload = JSON.parse(result.stdout)
    const topics = Array.isArray(payload.repositoryTopics)
      ? payload.repositoryTopics
          .map((topic) => (typeof topic === 'string' ? topic : topic?.name))
          .filter((topic) => typeof topic === 'string')
      : []
    const defaultBranch =
      typeof payload.defaultBranchRef?.name === 'string' ? payload.defaultBranchRef.name : null
    return {
      value: { visibility: payload.visibility, topics, defaultBranch },
      note: null,
    }
  } catch {
    return { value: null, note: 'gh 返回的不是合法 JSON' }
  }
}

function repositorySlug() {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) return null

  const match = result.stdout.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  return match === null ? null : `${match[1]}/${match[2]}`
}

function resolveOrcaCli() {
  const explicit = process.env.ORCA_CLI
  if (explicit !== undefined && explicit !== '') {
    const probe = spawnSync(explicit, ['--version'], { encoding: 'utf8', stdio: 'ignore' })
    if (probe.error === undefined && probe.status === 0) return explicit
    return null
  }

  const onPath = spawnSync('orca', ['--version'], { encoding: 'utf8', stdio: 'ignore' })
  if (onPath.error === undefined && onPath.status === 0) return 'orca'

  return existsSync(MAC_ORCA_CLI) ? MAC_ORCA_CLI : null
}

/**
 * @param {string} orca
 * @param {string} exportDir
 * @returns {Array<Record<string, string>>}
 */
function validateTree(orca, exportDir) {
  const result = run(orca, ['plugin', 'validate', exportDir, '--json'])
  let payload = null
  try {
    payload = JSON.parse(result.stdout)
  } catch {
    payload = null
  }

  if (result.status === 0 && payload?.ok !== false && payload?.result?.valid !== false) return []

  const errors = Array.isArray(payload?.result?.errors) ? payload.result.errors : []
  const detail =
    payload?.error?.message ??
    (errors.length > 0 ? errors.join('; ') : null) ??
    (result.stderr.trim() === '' ? `退出码 ${result.status}` : result.stderr.trim())
  return [{ code: 'orca_invalid', detail }]
}

/**
 * @param {string} orca
 * @returns {{
 *   entry: Record<string, unknown>,
 *   note: string | null,
 *   ownerWarning: string | null,
 *   error?: undefined,
 * } | { entry?: undefined, note?: undefined, ownerWarning?: undefined, error: string }}
 */
function readReleaseEntry(orca) {
  const result = run(orca, ['plugin', 'release-entry', repoRoot, '--json'])
  let payload = null
  try {
    payload = JSON.parse(result.stdout)
  } catch {
    payload = null
  }

  if (result.status === 0 && payload?.ok === true && payload?.result?.entry !== undefined) {
    return {
      entry: payload.result.entry,
      note: typeof payload.result.note === 'string' ? payload.result.note : null,
      ownerWarning: typeof payload.result.ownerWarning === 'string' ? payload.result.ownerWarning : null,
    }
  }

  const detail =
    payload?.error?.message ??
    (result.stderr.trim() === '' ? `退出码 ${result.status}` : result.stderr.trim())
  return { error: detail }
}

/**
 * @param {string} command
 * @param {string[]} args
 */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  })
  if (result.error !== undefined) {
    throw new Error(`${command} 无法运行：${result.error.message}`)
  }
  return result
}

/**
 * @param {string[]} args
 */
function git(args) {
  const result = run('git', args)
  if (result.status !== 0) {
    const detail = result.stderr.trim() === '' ? `退出码 ${result.status}` : result.stderr.trim()
    throw new Error(`git ${args.join(' ')} 失败：${detail}`)
  }
  return result.stdout
}

/**
 * @param {ReturnType<typeof evaluateReleaseReadiness>} result
 */
function printReport(result) {
  const { facts } = result
  const version = facts.version === null ? '未知版本' : facts.version
  console.log(`发布就绪检查：${version} @ ${facts.commit.slice(0, 12)}`)

  for (const failure of result.failures) console.log(`✗ ${describeFailure(failure)}`)
  for (const warning of result.warnings) console.log(`⚠ ${describeWarning(warning)}`)

  const slug = repositorySlug()
  if (slug !== null) console.log(`收录状态页：${STATUS_PAGE_BASE}/${slug}`)

  if (result.ok) {
    console.log('\n✓ 发布树、产物同步、版本标签、许可证与 Orca 校验都通过')
  } else {
    console.log(`\n✗ ${result.failures.length} 项失败；修完重新运行 pnpm release:check`)
  }
}

/**
 * @param {Record<string, string>} failure
 */
function describeFailure(failure) {
  switch (failure.code) {
    case 'manifest_missing':
      return '发布树缺少 orca-plugin.json'
    case 'manifest_invalid':
      return 'orca-plugin.json 不是合法 JSON'
    case 'manifest_version_unsupported':
      return `清单 manifestVersion 不是 2（实际 ${failure.detail}）`
    case 'version_invalid':
      return `清单 version 不是 X.Y.Z（实际 ${failure.detail === '' ? '空' : failure.detail}）`
    case 'license_field_missing':
      return '清单缺少 license 字段'
    case 'license_file_missing':
      return '发布树缺少 LICENSE'
    case 'license_unrecognized':
      return '认不出 LICENSE 的许可证类型'
    case 'license_mismatch':
      return `清单 license 与 LICENSE 不一致：${failure.detail}`
    case 'artifact_missing':
      return `发布树缺少构建产物 ${failure.path}`
    case 'artifact_unexpected':
      return `发布树里有约定之外的 dist 文件 ${failure.path}（source map 不入库）`
    case 'artifact_not_rebuilt':
      return `重建没有产出 ${failure.path}`
    case 'artifact_stale':
      return `${failure.path} 与源码不同步；先 pnpm build:release 再提交`
    case 'manifest_entry_missing':
      return `清单声明的入口不存在：${failure.path}`
    case 'tree_symlink':
      return `Git 树里有符号链接：${failure.path}`
    case 'tree_submodule':
      return `Git 树里有子模块：${failure.path}`
    case 'tree_entry_unknown':
      return `Git 树里有未知条目：${failure.path}（mode ${failure.mode}）`
    case 'tag_missing':
      return `HEAD 没有版本标签；打附注标签：git tag -a ${failure.tag} -m ${failure.tag}`
    case 'tag_not_at_head':
      return `标签 ${failure.tag} 指向 ${failure.detail}，不是 HEAD`
    case 'tag_version_mismatch':
      return `标签 ${failure.tag} 与清单版本不一致；应为 ${failure.detail}`
    case 'tag_lightweight':
      return `标签 ${failure.tag} 是轻量标签；改用 git tag -a`
    case 'tag_ambiguous':
      return `HEAD 有多个版本标签：${failure.detail}`
    case 'build_failed':
      return `从发布树重建失败：${failure.detail}`
    case 'orca_cli_missing':
      return '找不到 Orca 命令行；安装 Orca 桌面端（https://www.onorca.dev），或设置 ORCA_CLI 指向 orca'
    case 'orca_invalid':
      return `Orca 校验未通过：${failure.detail}`
    default:
      return failure.path === undefined ? failure.code : `${failure.code}：${failure.path}`
  }
}

/**
 * @param {Record<string, string>} warning
 */
function describeWarning(warning) {
  switch (warning.code) {
    case 'topic_missing': {
      const slug = repositorySlug()
      const command =
        slug === null
          ? `gh repo edit --add-topic ${warning.topic}`
          : `gh repo edit ${slug} --add-topic ${warning.topic}`
      return `仓库缺少 ${warning.topic} topic；目录站不会收录：${command}`
    }
    case 'repository_not_public':
      return `仓库当前为 ${warning.detail}；目录站只收录公开仓库（Git URL 安装仍可用）`
    case 'default_branch_not_main': {
      const slug = repositorySlug()
      const command =
        slug === null ? 'gh repo edit --default-branch main' : `gh repo edit ${slug} --default-branch main`
      return `默认分支是 ${warning.detail}，不是 main；无版本安装会落到别的树：${command}`
    }
    case 'repository_unknown':
      return `查不到仓库元数据（${warning.detail ?? 'gh 不可用或未登录'}），无法确认 topic 与可见性`
    case 'worktree_dirty':
      return '工作树有未提交改动；检查只针对当前提交（HEAD）'
    default:
      return warning.code
  }
}

/**
 * @param {Record<string, unknown>} entry
 */
function printReleaseEntry(entry) {
  console.log('\n目录条目（贴进 orca-catalog.json 的 releases，最新在前）：')
  console.log(JSON.stringify(entry, null, 2))
}
