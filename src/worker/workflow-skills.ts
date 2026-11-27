/**
 * 入池命令的技能正文。
 *
 * 正文是给 agent 的指令——把用户的报告写成一张原始工单放进池里，然后停下。
 * 标签和候选下一步都从 protocol 的流程定义与标签映射读取，不手写命令名。
 *
 * Orca 插件不能注册运行时技能，正文以仓库文件 `skills/<命令名>/SKILL.md` 落盘，
 * 由用户显式触发安装动作后复制进 agent 的技能目录。
 */
import {
  FLOW_COMMANDS,
  INTAKE_COMMANDS,
  NEXT_STEPS,
  type IntakeCommandDefinition,
  type IntakeKind,
} from '../protocol/flow.ts'
import { MESSAGES, type MessageId } from '../protocol/i18n.ts'
import { TRACKER_LABELS, type TrackerLabelNames } from '../protocol/labels.ts'

/** 技能正文用英文目录渲染：技能是给 agent 读的规约，不随界面语言变化。 */
const EN = MESSAGES['en']

/** 一个入池技能的定义。 */
export interface WorkflowSkillDefinition {
  readonly name: string
  readonly description: string
  /** 技能正文；写入 `SKILL.md` 的 frontmatter 之后。 */
  readonly content: string
}

interface IntakeCopy {
  /** 命令在做什么；第一段正文。 */
  readonly intro: MessageId
  /** 建票缺了就要追问的硬信息。 */
  readonly hardInfo: MessageId
  /** 票正文的小节标题。 */
  readonly sections: readonly MessageId[]
}

const INTAKE_COPY: Record<IntakeKind, IntakeCopy> = {
  bug: {
    intro: 'flow.skill.intake.bug.intro',
    hardInfo: 'flow.skill.intake.bug.hardInfo',
    sections: [
      'flow.skill.intake.bug.section1',
      'flow.skill.intake.bug.section2',
      'flow.skill.intake.bug.section3',
      'flow.skill.intake.bug.section4',
    ],
  },
  feature: {
    intro: 'flow.skill.intake.feature.intro',
    hardInfo: 'flow.skill.intake.feature.hardInfo',
    sections: [
      'flow.skill.intake.feature.section1',
      'flow.skill.intake.feature.section2',
      'flow.skill.intake.feature.section3',
    ],
  },
}

/**
 * 生成两个入池命令的定义。
 * @param labels - 跟踪器的标签名；测试可注入别的映射。
 * @returns 缺陷与需求两个命令，顺序固定。
 */
export function createWorkflowSkills(
  labels: TrackerLabelNames = TRACKER_LABELS,
): readonly WorkflowSkillDefinition[] {
  return [
    createWorkflowSkill(INTAKE_COMMANDS.bug, labels),
    createWorkflowSkill(INTAKE_COMMANDS.feature, labels),
  ]
}

/**
 * 把技能定义渲染成 `SKILL.md` 的完整内容。
 * @param skill - 技能定义。
 * @returns 带 frontmatter 的 Markdown 文件内容。
 */
export function renderSkillFile(skill: WorkflowSkillDefinition): string {
  return [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    '---',
    '',
    skill.content,
    '',
  ].join('\n')
}

function createWorkflowSkill(
  intake: IntakeCommandDefinition,
  labels: TrackerLabelNames,
): WorkflowSkillDefinition {
  const command = FLOW_COMMANDS[intake.command]
  return {
    name: command.name,
    description: EN[intake.descriptionKey],
    content: intakeContent(intake, labels),
  }
}

function intakeContent(intake: IntakeCommandDefinition, labels: TrackerLabelNames): string {
  const copy = INTAKE_COPY[intake.kind]
  const labelList = intake.labelRoles.map((role) => labels[role]).join(', ')

  return [
    EN[copy.intro],
    '',
    '## Read first',
    "- The repository's domain glossary: write the title and body in the project's own words.",
    '- The issue-tracker and triage-label docs the setup skill generated in this repository: confirm which tracker is in use, how to file a ticket, and how labels are written.',
    '',
    '## Boundaries',
    '- Do not read code, reproduce, or locate a root cause; do not split the ticket, create a parent ticket, or declare blocking relations on your own.',
    '- When the user explicitly says to split into several tickets or merge into one, do exactly that.',
    '- Slots the user provided are scaffolding only. Treat an unfilled slot as missing information; never put the slot text or an empty title into the ticket.',
    `- When hard information is missing (${EN[copy.hardInfo]}), decide yourself whether to ask: file the ticket when it is enough, otherwise ask first, at most two or three questions.`,
    '- Before filing, search the tracker for open tickets that look like duplicates; if you find any, stop and show the candidates to the user for confirmation.',
    '- When the user mentions several things at once without saying whether to split or merge, ask first.',
    '- Follow the language convention of the tickets already in the repository for title and body.',
    '',
    '## Images',
    '- Upload an image the user pasted when it proves the problem.',
    '- Do not put an image into the ticket when it is unrelated, or when it can be transcribed as text.',
    '- When an image may contain local paths, accounts, tokens or private data, ask the user before uploading.',
    '- When the current tracker cannot take images, describe the image in text and remind the user to add it manually.',
    '',
    '## Filing',
    '- State what it is in one sentence as the title.',
    '- Organize the body with the structure below; delete any section that has no content:',
    ...copy.sections.map((section, index) => `  ${String(index + 1)}. ${EN[section]}`),
    '- Do not write file paths or line numbers.',
    `- Apply these labels: ${labelList}.`,
    '- File the ticket the way the tracker docs read above describe.',
    '',
    '## After filing',
    '- Output only the ticket link and one line of next-step suggestion, then stop; do not start working.',
    '- Write the suggestion as one line: `<client gesture><command> <ticket reference> — <one-line reason>`, with `<client gesture>` matching the user\'s current client (Claude Code `/`, omp `/skill:`, Codex `$`); use #N for remote backends and a file path for local Markdown.',
    '- Pick one recommendation from the candidates below, plus at most one alternative:',
    ...intake.nextSteps.map(nextStepLine),
  ].join('\n')
}

function nextStepLine(id: IntakeCommandDefinition['nextSteps'][number]): string {
  const step = NEXT_STEPS[id]
  const name = FLOW_COMMANDS[step.command].name
  const reminder = step.reminderKey === null ? '' : ` (${EN[step.reminderKey]})`
  // 只写命令名：客户端手势由用户当前客户端决定，正文不替它选。
  return `- ${name} ${EN['flow.skill.ticketReference']} — ${EN[step.whenKey]}${reminder}`
}