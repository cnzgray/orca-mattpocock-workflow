# 域文档

探索本仓库代码之前，按这里的规则读域文档。

## 动手前先读

- 仓库根的 **`GLOSSARY.zh-CN.md`**（中文代理用这份；英文写作规范版是 `GLOSSARY.md`；单上下文布局，没有 `GLOSSARY-MAP.md`）；
- **`docs/adr/`** 里与本区域相关的 ADR。

仓库里现在只有 `docs/adr/` 还不存在。**不存在就静静跳过**：不要提示缺失，也不要主动建议先建。
它在真正需要的时候才长出来——某个决策第一次被记录。

## 文件结构

本仓库是单上下文（single-context）：

```
/
├── GLOSSARY.md            ← 领域术语表（英文规范版）
├── GLOSSARY.zh-CN.md      ← 领域术语表（中文）
├── docs/README.md         ← 文档索引与语言约定（中文版 README.zh-CN.md）
├── docs/adr/              ← 架构决策记录，0001-*.md 起编号
├── docs/agents/           ← agent 读的约定（本文件所在处）
├── docs/development.md    ← Orca 命令行加载开发插件的流程（英文规范版）
├── docs/development.zh-CN.md ← 同一流程的中文版
├── src/                   ← adapters / core / panel / protocol / worker
└── skills/                ← 随插件分发的入池技能
```

`pnpm-workspace.yaml` 只是 pnpm 10 的构建白名单（`allowBuilds`），不是多包工作区；
没有 `packages/*`，也没有 `workspaces` 字段，所以不存在按上下文拆分的术语表。

## 用术语表的词汇

产出里出现领域概念时（issue 标题、重构提案、假设、测试名），用 `GLOSSARY.zh-CN.md` 定义的那个词；
英文写作时用 `GLOSSARY.md`。不要漂到术语表明确避开的同义词上。

本仓库已有的固定词：**工单**（issue/ticket 的统一称呼）、**入池**（把原始描述写成工单）、
**判定**（由标签推导技能动作）、**可接 / 阻塞 / 已关闭**（列表的四个分组）、
**提示词**（写进剪贴板的 `/implement #40` 这类手势）。这些词已散落在 README 与 `src/protocol` 里，
新写文档沿用它们。

需要的概念术语表里还没有，这是个信号：要么你在发明本项目不用的语言（重新考虑），
要么确实有缺口（记下来，等它被解决时补进术语表）。

## ADR 冲突要摊开说

产出与既有 ADR 矛盾时，明确摆出来，而不是悄悄盖过去：

> _与 ADR-0007（本地 markdown 作为默认后端）冲突，但值得重开，因为……_
