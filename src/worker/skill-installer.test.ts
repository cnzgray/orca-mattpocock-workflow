import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { installPoolSkills } from './skill-installer.ts'
import { createWorkflowSkills, renderSkillFile } from './workflow-skills.ts'

let target = ''

beforeEach(async () => {
  target = await mkdtemp(join(tmpdir(), 'mattwf-skills-'))
})

afterEach(async () => {
  await rm(target, { recursive: true, force: true })
})

describe('入池技能安装', () => {
  it('把两个入池技能复制进目标目录', async () => {
    const result = await installPoolSkills({ targets: [target] })

    expect(result.failed).toEqual([])
    expect(result.installed.map((entry) => entry.skill).sort()).toEqual([
      'mattwf-bug',
      'mattwf-feature',
    ])
    for (const skill of createWorkflowSkills()) {
      const copied = await readFile(join(target, skill.name, 'SKILL.md'), 'utf8')
      expect(copied).toBe(renderSkillFile(skill))
    }
  })

  it('目标目录写不进去时报告失败而不是抛错', async () => {
    const blocker = join(target, 'blocker')
    await writeFile(blocker, 'not a directory')

    const result = await installPoolSkills({ targets: [join(blocker, 'skills')] })

    expect(result.installed).toEqual([])
    expect(result.failed).toHaveLength(2)
    expect(result.failed[0]?.reason).toBeTruthy()
  })
})
