[English](README.md) | 简体中文

# skills

插件自带的两个入池技能。Orca 插件不能注册运行时技能，所以正文以文件形式落在这里，
由用户在面板里显式触发「安装入池技能」后复制进 agent 会扫描的技能目录：

- `~/.claude/skills`
- `~/.codex/skills`
- `~/.agents/skills`

只写已经存在的目录：凭空造一个目录不会让任何 agent 认它。

| 技能            | 作用                                   |
| --------------- | -------------------------------------- |
| `mattwf-bug`    | 把缺陷报告写成原始工单，只建票不定性   |
| `mattwf-feature`| 把需求写成原始工单，只建票不访谈       |

正文由 `src/worker/workflow-skills.ts` 从 `src/protocol/flow.ts` 的流程定义与
`src/protocol/labels.ts` 的标签映射生成，`workflow-skills.test.ts` 会检查仓库里的
`SKILL.md` 与生成结果一致，改了流程定义要重新生成这两个文件。

正文里的「下一步建议」只写命令名，不写死手势前缀：同一份正文会被装进不同客户端的技能目录，
装的时候无从知道用户用哪个客户端。前缀由用户当前客户端决定（Claude Code 是 `/`，omp 是
`/skill:`，Codex 是 `$`），正文把这三种写法告诉 agent，由它按当前客户端选。

技能正文固定用英文：它们是提示词内容，不是界面文案，不跟随面板的 `language` 设置。
