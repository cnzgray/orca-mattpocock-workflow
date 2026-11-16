import { describe, expect, it } from 'vitest'

import {
  PLUGIN_ARTIFACTS,
  detectLicense,
  evaluateReleaseReadiness,
} from './publish-readiness.mjs'

const HEAD = 'a'.repeat(40)
const OTHER_COMMIT = 'b'.repeat(40)
const VERSION = '1.2.3'

const MIT_TEXT = `MIT License

Copyright (c) 2026 zgray

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.
`

const APACHE_TEXT = `Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/
`

function manifest(overrides = {}) {
  return {
    manifestVersion: 2,
    id: 'mattpocock-workflow',
    name: 'MattWorkflow',
    version: VERSION,
    license: 'MIT',
    main: 'dist/worker/main.mjs',
    contributes: {
      panels: [
        { id: 'tickets', entry: 'dist/panel/panel.html' },
      ],
    },
    ...overrides,
  }
}

function artifactContents() {
  return new Map(PLUGIN_ARTIFACTS.map(({ path }) => [path, `built:${path}`]))
}

function publishTree({
  manifest: declared = manifest(),
  artifacts = artifactContents(),
  extra = new Map(),
  omit = [],
} = {}) {
  const files = new Map()
  files.set('orca-plugin.json', JSON.stringify(declared, null, 2))
  files.set('LICENSE', MIT_TEXT)
  for (const [path, content] of artifacts) files.set(path, content)
  for (const [path, content] of extra) files.set(path, content)
  for (const path of omit) files.delete(path)
  return files
}

function gitEntriesOf(files) {
  return [...files.keys()].map((path) => ({
    mode: '100644',
    path,
  }))
}

function evaluate({
  tree = publishTree(),
  rebuilt = artifactContents(),
  gitEntries,
  tags = [{ name: `v${VERSION}`, commit: HEAD, annotated: true }],
  headCommit = HEAD,
  repository = { visibility: 'public', topics: ['orca-plugin'], defaultBranch: 'main' },
} = {}) {
  return evaluateReleaseReadiness({
    tree,
    rebuilt,
    gitEntries: gitEntries ?? gitEntriesOf(tree),
    tags,
    headCommit,
    repository,
  })
}

function codes(items) {
  return items.map((item) => item.code)
}

describe('许可证识别', () => {
  it('识别 MIT 与 Apache-2.0，认不出时返回 null', () => {
    expect(detectLicense(MIT_TEXT)).toBe('MIT')
    expect(detectLicense(APACHE_TEXT)).toBe('Apache-2.0')
    expect(detectLicense('All rights reserved.')).toBeNull()
    expect(detectLicense('')).toBeNull()
  })
})

describe('发布就绪判定', () => {
  it('发布树、产物、标签与收录条件都齐备时通过', () => {
    const result = evaluate()

    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.facts).toMatchObject({ version: VERSION, license: 'MIT', commit: HEAD })
  })

  it('缺少某个构建产物时失败并点名文件', () => {
    const result = evaluate({ tree: publishTree({ omit: ['dist/panel/panel.js'] }) })

    expect(result.ok).toBe(false)
    expect(result.failures).toContainEqual({
      code: 'artifact_missing',
      path: 'dist/panel/panel.js',
    })
  })

  it('入库了约定之外的产物（例如 source map）时失败', () => {
    const result = evaluate({
      tree: publishTree({ extra: new Map([['dist/panel/panel.js.map', '{}']]) }),
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toContainEqual({
      code: 'artifact_unexpected',
      path: 'dist/panel/panel.js.map',
    })
  })

  it('产物与源码重建结果不同时失败', () => {
    const rebuilt = artifactContents()
    rebuilt.set('dist/worker/main.mjs', 'rebuilt:different')
    const result = evaluate({ rebuilt })

    expect(result.ok).toBe(false)
    expect(result.failures).toContainEqual({
      code: 'artifact_stale',
      path: 'dist/worker/main.mjs',
    })
  })

  it('重建没有产出约定文件时失败', () => {
    const rebuilt = artifactContents()
    rebuilt.delete('dist/panel/theme.css')
    const result = evaluate({ rebuilt })

    expect(result.ok).toBe(false)
    expect(result.failures).toContainEqual({
      code: 'artifact_not_rebuilt',
      path: 'dist/panel/theme.css',
    })
  })

  it('清单版本不是 X.Y.Z 时失败', () => {
    const result = evaluate({ tree: publishTree({ manifest: manifest({ version: '1.2' }) }) })

    expect(result.ok).toBe(false)
    expect(codes(result.failures)).toContain('version_invalid')
  })

  it('清单不是 v2 时失败', () => {
    const result = evaluate({
      tree: publishTree({ manifest: manifest({ manifestVersion: 1 }) }),
    })

    expect(result.ok).toBe(false)
    expect(codes(result.failures)).toContain('manifest_version_unsupported')
  })

  it('清单元数据缺失或不合法时失败', () => {
    const missing = publishTree({ omit: ['orca-plugin.json'] })
    const broken = publishTree()
    broken.set('orca-plugin.json', '{')

    expect(codes(evaluate({ tree: missing }).failures)).toContain('manifest_missing')
    expect(codes(evaluate({ tree: broken }).failures)).toContain('manifest_invalid')
  })

  it('清单声明的入口文件不存在时失败', () => {
    const result = evaluate({
      tree: publishTree({ manifest: manifest({ main: 'dist/worker/other.mjs' }) }),
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toContainEqual({
      code: 'manifest_entry_missing',
      path: 'dist/worker/other.mjs',
    })
  })

  it('缺少 LICENSE 或清单 license 字段时失败', () => {
    const noLicenseFile = evaluate({ tree: publishTree({ omit: ['LICENSE'] }) })
    const noLicenseField = evaluate({
      tree: publishTree({ manifest: manifest({ license: undefined }) }),
    })

    expect(codes(noLicenseFile.failures)).toContain('license_file_missing')
    expect(codes(noLicenseField.failures)).toContain('license_field_missing')
  })

  it('清单 license 与 LICENSE 文件不一致时失败', () => {
    const result = evaluate({ tree: publishTree({ manifest: manifest({ license: 'Apache-2.0' }) }) })

    expect(result.ok).toBe(false)
    expect(codes(result.failures)).toContain('license_mismatch')
  })

  it('认不出 LICENSE 内容时失败', () => {
    const tree = publishTree()
    tree.set('LICENSE', 'All rights reserved.')
    const result = evaluate({ tree })

    expect(result.ok).toBe(false)
    expect(codes(result.failures)).toContain('license_unrecognized')
  })

  it('Git 树里有符号链接或子模块时失败', () => {
    const tree = publishTree()
    const gitEntries = gitEntriesOf(tree)
    gitEntries.push({ mode: '120000', path: 'CLAUDE.md' })
    gitEntries.push({ mode: '160000', path: 'vendor/skill' })
    const result = evaluate({ tree, gitEntries })

    expect(result.ok).toBe(false)
    expect(result.failures).toContainEqual({ code: 'tree_symlink', path: 'CLAUDE.md' })
    expect(result.failures).toContainEqual({ code: 'tree_submodule', path: 'vendor/skill' })
  })

  it('HEAD 没有版本标签时失败并给出应打的标签', () => {
    const result = evaluate({ tags: [] })

    expect(result.ok).toBe(false)
    expect(result.failures).toContainEqual({ code: 'tag_missing', tag: `v${VERSION}` })
  })

  it('版本标签指向别的提交时失败', () => {
    const result = evaluate({
      tags: [{ name: `v${VERSION}`, commit: OTHER_COMMIT, annotated: true }],
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toContainEqual({
      code: 'tag_not_at_head',
      tag: `v${VERSION}`,
      detail: OTHER_COMMIT,
    })
  })

  it('标签版本与清单版本不一致时失败', () => {
    const result = evaluate({
      tags: [{ name: 'v1.2.4', commit: HEAD, annotated: true }],
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toContainEqual({
      code: 'tag_version_mismatch',
      tag: 'v1.2.4',
      detail: `v${VERSION}`,
    })
  })

  it('版本标签不是附注标签时失败', () => {
    const result = evaluate({
      tags: [{ name: `v${VERSION}`, commit: HEAD, annotated: false }],
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toContainEqual({
      code: 'tag_lightweight',
      tag: `v${VERSION}`,
    })
  })

  it('仓库缺少 orca-plugin topic 时通过但给出警告', () => {
    const result = evaluate({
      repository: { visibility: 'public', topics: [] },
    })

    expect(result.ok).toBe(true)
    expect(result.warnings).toContainEqual({ code: 'topic_missing', topic: 'orca-plugin' })
  })

  it('私有仓库通过但提示目录站不会收录', () => {
    const result = evaluate({
      repository: { visibility: 'private', topics: ['orca-plugin'], defaultBranch: 'main' },
    })

    expect(result.ok).toBe(true)
    expect(result.warnings).toContainEqual({
      code: 'repository_not_public',
      detail: 'private',
    })
  })

  it('默认分支不是 main 时通过但提示无版本安装会落到别的树', () => {
    const result = evaluate({
      repository: { visibility: 'public', topics: ['orca-plugin'], defaultBranch: 'release' },
    })

    expect(result.ok).toBe(true)
    expect(result.warnings).toContainEqual({
      code: 'default_branch_not_main',
      detail: 'release',
    })
  })

  it('查不到仓库元数据时通过但提示无法确认收录条件', () => {
    const result = evaluate({ repository: null })

    expect(result.ok).toBe(true)
    expect(codes(result.warnings)).toContain('repository_unknown')
  })
})
