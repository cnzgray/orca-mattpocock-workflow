/**
 * 发布就绪判定：只看一份从提交导出的发布树与旁路元数据，不做任何 IO。
 *
 * 运行器（`scripts/release-check.mjs`）负责导出树、重建产物、跑 Orca 校验、
 * 查询仓库 topic 与可见性；这里只给出「可发布 / 不可发布 + 原因」。
 */

/** 目录站收录开关：仓库必须带这个 topic。 */
export const ORCA_TOPIC = 'orca-plugin'

/** 入库的构建产物清单：发布树里有且只有这四个文件。 */
export const PLUGIN_ARTIFACTS = [
  { path: 'dist/worker/main.mjs', label: 'worker 入口' },
  { path: 'dist/panel/panel.html', label: '面板页面' },
  { path: 'dist/panel/panel.js', label: '面板脚本' },
  { path: 'dist/panel/theme.css', label: '面板主题样式' },
]

const ARTIFACT_PATHS = new Set(PLUGIN_ARTIFACTS.map((artifact) => artifact.path))
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const VERSION_TAG_PATTERN = /^v\d+\.\d+\.\d+$/
const REGULAR_MODES = new Set(['100644', '100755'])

/**
 * 从 LICENSE 正文识别 SPDX 标识。只覆盖目录站会检测到的常见许可证。
 *
 * @param {string} text
 * @returns {'MIT' | 'Apache-2.0' | null}
 */
export function detectLicense(text) {
  if (text.includes('Permission is hereby granted, free of charge')) return 'MIT'
  if (/Apache License\s+Version 2\.0/.test(text)) return 'Apache-2.0'
  return null
}

/**
 * @typedef {{
 *   path: string,
 *   mode: string,
 * }} GitEntry
 *
 * @typedef {{
 *   name: string,
 *   commit: string,
 *   annotated: boolean,
 * }} Tag
 *
 * @typedef {{
 *   visibility?: string,
 *   topics?: string[],
 *   defaultBranch?: string | null,
 * }} Repository
 *
 * @typedef {{
 *   tree: Map<string, string | Buffer>,
 *   rebuilt: Map<string, string | Buffer>,
 *   gitEntries?: GitEntry[],
 *   tags?: Tag[],
 *   headCommit: string,
 *   repository?: Repository | null,
 * }} ReadinessInput
 *
 * @typedef {{
 *   ok: boolean,
 *   failures: Array<Record<string, string>>,
 *   warnings: Array<Record<string, string>>,
 *   facts: { commit: string, version: string | null, license: string | null },
 * }} ReadinessResult
 */

/**
 * @param {ReadinessInput} input
 * @returns {ReadinessResult}
 */
export function evaluateReleaseReadiness({
  tree,
  rebuilt,
  gitEntries = [],
  tags = [],
  headCommit,
  repository = null,
}) {
  /** @type {Array<Record<string, string>>} */
  const failures = []
  /** @type {Array<Record<string, string>>} */
  const warnings = []
  /** @type {{ commit: string, version: string | null, license: string | null }} */
  const facts = { commit: headCommit ?? '', version: null, license: null }

  /**
   * @param {string} code
   * @param {Record<string, string>} [extra]
   */
  const fail = (code, extra = {}) => failures.push({ code, ...extra })
  /**
   * @param {string} code
   * @param {Record<string, string>} [extra]
   */
  const warn = (code, extra = {}) => warnings.push({ code, ...extra })

  for (const entry of gitEntries) {
    if (entry.mode === '120000') fail('tree_symlink', { path: entry.path })
    else if (entry.mode === '160000') fail('tree_submodule', { path: entry.path })
    else if (!REGULAR_MODES.has(entry.mode)) {
      fail('tree_entry_unknown', { path: entry.path, mode: entry.mode })
    }
  }

  const manifestText = textOf(tree, 'orca-plugin.json')
  if (manifestText === null) {
    fail('manifest_missing')
    return finish()
  }

  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    fail('manifest_invalid')
    return finish()
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    fail('manifest_invalid')
    return finish()
  }

  if (manifest.manifestVersion !== 2) {
    fail('manifest_version_unsupported', { detail: String(manifest.manifestVersion) })
  }

  const version = typeof manifest.version === 'string' ? manifest.version : ''
  const versionValid = VERSION_PATTERN.test(version)
  if (versionValid) facts.version = version
  else fail('version_invalid', { detail: version })

  const license = typeof manifest.license === 'string' ? manifest.license.trim() : ''
  if (license === '') fail('license_field_missing')

  const licenseText = textOf(tree, 'LICENSE')
  if (licenseText === null) {
    fail('license_file_missing')
  } else {
    const detected = detectLicense(licenseText)
    facts.license = detected
    if (detected === null) fail('license_unrecognized')
    else if (license !== '' && detected !== license) {
      fail('license_mismatch', { detail: `${license} ≠ ${detected}` })
    }
  }

  for (const path of ARTIFACT_PATHS) {
    if (!tree.has(path)) fail('artifact_missing', { path })
  }
  for (const path of tree.keys()) {
    if (path.startsWith('dist/') && !ARTIFACT_PATHS.has(path)) {
      fail('artifact_unexpected', { path })
    }
  }

  for (const path of declaredEntries(manifest)) {
    if (ARTIFACT_PATHS.has(path)) continue
    if (!tree.has(path)) fail('manifest_entry_missing', { path })
  }

  for (const path of ARTIFACT_PATHS) {
    const rebuiltContent = contentOf(rebuilt, path)
    if (rebuiltContent === null) {
      fail('artifact_not_rebuilt', { path })
      continue
    }
    const committed = contentOf(tree, path)
    if (committed !== null && !sameContent(committed, rebuiltContent)) {
      fail('artifact_stale', { path })
    }
  }

  if (versionValid) {
    const versionTagsAtHead = tags.filter(
      (tag) => tag.commit === headCommit && VERSION_TAG_PATTERN.test(tag.name),
    )
    const expectedTag = `v${version}`

    if (versionTagsAtHead.length === 0) {
      const existing = tags.find((tag) => tag.name === expectedTag)
      if (existing) fail('tag_not_at_head', { tag: existing.name, detail: existing.commit })
      else fail('tag_missing', { tag: expectedTag })
    } else if (versionTagsAtHead.length > 1) {
      fail('tag_ambiguous', { detail: versionTagsAtHead.map((tag) => tag.name).join(', ') })
    } else {
      const [tag] = versionTagsAtHead
      if (tag.name !== expectedTag) {
        fail('tag_version_mismatch', { tag: tag.name, detail: expectedTag })
      }
      if (!tag.annotated) fail('tag_lightweight', { tag: tag.name })
    }
  }

  if (repository === null) {
    warn('repository_unknown')
  } else {
    const topics = Array.isArray(repository.topics) ? repository.topics : []
    if (!topics.some((topic) => String(topic).toLowerCase() === ORCA_TOPIC)) {
      warn('topic_missing', { topic: ORCA_TOPIC })
    }
    const visibility = String(repository.visibility ?? 'unknown').toLowerCase()
    if (visibility !== 'public') {
      warn('repository_not_public', { detail: visibility })
    }
    if (typeof repository.defaultBranch === 'string' && repository.defaultBranch !== 'main') {
      warn('default_branch_not_main', { detail: repository.defaultBranch })
    }
  }

  return finish()

  function finish() {
    return { ok: failures.length === 0, failures, warnings, facts }
  }
}

/**
 * @param {Map<string, string | Buffer>} tree
 * @param {string} path
 * @returns {string | null}
 */
function textOf(tree, path) {
  const content = contentOf(tree, path)
  return content === null ? null : asText(content)
}

/**
 * @param {Map<string, string | Buffer>} files
 * @param {string} path
 * @returns {string | Buffer | null}
 */
function contentOf(files, path) {
  return files.has(path) ? files.get(path) : null
}

/**
 * @param {string | Buffer} content
 * @returns {string}
 */
function asText(content) {
  return Buffer.isBuffer(content) ? content.toString('utf8') : content
}

/**
 * @param {string | Buffer} left
 * @param {string | Buffer} right
 * @returns {boolean}
 */
function sameContent(left, right) {
  return Buffer.from(left).equals(Buffer.from(right))
}

/**
 * 清单里声明为文件路径的入口：主入口与每个面板的 entry。
 *
 * @param {Record<string, any>} manifest
 * @returns {string[]}
 */
function declaredEntries(manifest) {
  const entries = []
  if (typeof manifest.main === 'string' && manifest.main !== '') entries.push(manifest.main)

  const panels = manifest.contributes?.panels
  if (Array.isArray(panels)) {
    for (const panel of panels) {
      if (typeof panel?.entry === 'string' && panel.entry !== '') entries.push(panel.entry)
    }
  }
  return entries
}
