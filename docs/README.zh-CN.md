[English](README.md) | 简体中文

# 文档

## 语言约定

- **公开文档**同时维护英文与简体中文。英文文件占规范路径（`README.md`、`docs/development.md`、
  `GLOSSARY.md`、`src/*/README.md`），中文译文放在同目录的 `*.zh-CN.md`。每一对文件开头都有语言切换链接；
  改内容时在同一个 PR 里同时更新两份。
- **代理运行文档**（`AGENTS.md`、`CLAUDE.md`、`docs/agents/*.md`）保持简体中文：它们配置本仓库的
  中文代理工作流，不属于面向用户的文档。
- **技能正文**（`skills/*/SKILL.md`）保持简体中文：它们是提示词内容，不是界面文案，不跟随面板语言设置。
- **面板界面**通过 `language` 插件设置（`auto` / `zh-CN` / `en`）在运行时切换语言。
  消息目录在 `src/protocol/i18n.ts`；`src/panel/i18n-guard.test.ts` 拦住面板组件里的中文字面量。
- **插件清单字符串**（`orca-plugin.json` 的描述与命令标题）用英文：Orca 清单 schema 没有按语言
  分字段的能力。面板内部渲染的内容全部跟随语言设置。

## 指南

| 主题 | English | 简体中文 |
| --- | --- | --- |
| 项目概览与发布 | [README](../README.md) | [README](../README.zh-CN.md) |
| 开发与发布流程 | [development.md](development.md) | [development.zh-CN.md](development.zh-CN.md) |
| 领域术语 | [GLOSSARY](../GLOSSARY.md) | [GLOSSARY](../GLOSSARY.zh-CN.md) |
| 适配器 | [src/adapters](../src/adapters/README.md) | [src/adapters](../src/adapters/README.zh-CN.md) |
| 核心逻辑 | [src/core](../src/core/README.md) | [src/core](../src/core/README.zh-CN.md) |
| 面板 | [src/panel](../src/panel/README.md) | [src/panel](../src/panel/README.zh-CN.md) |
| 协议 | [src/protocol](../src/protocol/README.md) | [src/protocol](../src/protocol/README.zh-CN.md) |
| 技能 | [skills](../skills/README.md) | [skills](../skills/README.zh-CN.md) |

代理运行文档（只有中文）：

- [工单后端与 spec 流程](agents/issue-tracker.md)
- [Triage 标签](agents/triage-labels.md)
- [域文档](agents/domain.md)
