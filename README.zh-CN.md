[English](README.md) | 简体中文

# orca-mattpocock-workflow

Orca 插件：在右侧栏运行 [mattpocock/skills](https://github.com/mattpocock/skills) 工作流的工单面板。

工单的判定规则、triage 标签、提示词手势与流程说明都在本仓库内实现，
交互按 Orca 插件自身的能力边界设计。

## 视图

- **列表**：读当前工作区的工单，按「可接 / 阻塞 / 其他开放 / 已关闭」判定，支持状态过滤与多键排序；
  工具栏下方还有「分配给我 / 我创建的」两个人员开关，与状态筛选交叉生效，两个都开时取并集；
  可在**平铺**（默认）与**父子**两种布局间切换：父子模式把子票缩进挂在父票下，父行可折叠整棵子树并显示可见子票数；
  父票被筛掉或还没加载时，子票升到顶层并显示父级引用徽标；
  每张票给出技能动作徽标，点击「复制提示词」把 `/implement #40` 这类手势写进剪贴板；
  能开工的远端工单还有一个「建 worktree」动作，一次点击就建出 Orca 托管的 worktree。
- **概览**：一屏给出压力总览（规模 / 阻塞 / 时效）、关键数字、状态与分类构成、最该先看的票。
- **详情**：单张票的时间线、字段、原生阻塞关系。
- **环境检查**：逐项检查主目录、后端选择、Orca 命令行、CLI 安装与登录、仓库可达、工作区初始化、
  本地工单目录、面板用到的技能是否安装；失败项给对应原因的可执行修复方式。
- **流程帮助**：入池与 triage 状态机、需求链、缺陷链、访谈还是画图，以及实现之后的评审与 PR 流程图。

## 能力边界与取舍

Orca 插件的能力由宿主给定，下面是本插件在这些边界内给出的做法：

| 能力 | 本插件的做法 | 说明 |
|---|---|---|
| 提示词填进当前会话 | **复制提示词** | Orca 插件没有「写会话草稿」的能力；复制后由用户自己粘贴 |
| 提示词填进新会话 | 不提供 | Orca 的 `agent.launch` 只起终端型 agent，不构成会话草稿 |
| 注册运行时技能 `/mattwf-feature`、`/mattwf-bug` | 技能文件随插件分发，环境检查里一键安装 | Orca 插件不能贡献技能（`contributes.skills` 是保留点） |
| 插件私有 HTTP 路由 | 面板 ↔ worker 进程内桥（`orca.plugin.request`） | Orca 面板与 worker 同属一个插件，直接用桥 |
| 宿主数据根下的缓存目录 | `~/.orca-mattpocock-workflow/cache/` | Orca 没有对应数据根 |
| 浏览器 `localStorage` 记视图偏好 | `orca.storage` | 插件私有存储，按仓库记筛选、排序与人员开关 |
| 宿主 `subprocess` 服务 | worker 内 `node:child_process` | worker 是独立 Node 进程 |

「建 worktree」只走 Orca 自己的命令行（`orca worktree create`），不用裸 `git worktree`：
分支名按仓库约定从票推导（`feat/4-…` / `bugfix/1-…`），工单链接挂到新 worktree 上，
建完由 Orca 切到新工作区；同分支已有工作区时直接返回既有结果，不会重复创建。
自建 Gitea / GitHub 的 `/issues/<n>` 没有 Orca 认得的 provider 路由，不传 `--reference`，
工单链接改补进 `--comment`，仍然建出工作区；`/pull/<n>`、`/pulls/<n>` 与 GitLab 的
`/-/issues|merge_requests/<n>` 继续挂载。

判定语义统一为一套：可接 / 阻塞 / 已关闭、triage 标签（`needs-triage`、`wontfix`、`ready-for-human` …）、
`Blocked by:` 解析、GitLab 原生阻塞合并。

## 工作区怎么认

Orca 右侧栏是全局的，面板没有「当前会话的工作区」可用。worker 依次尝试：

1. 用户在面板顶部候选里显式选过的工作区（选择记在当前聚焦上下文里，也写进插件私有存储，
   worker 重启或面板重载后仍有效；只有聚焦上下文换了才失效）；
2. 聚焦工作区的显示名与工作区名精确匹配（忽略大小写与首尾空格），再退到仓库名匹配；
   空白显示名不参与匹配，显示名与分支同名时也不当作唯一线索——未命名工作区的显示名会退化成
   分支名，`main` 会被大量工作区共用；
3. 显示名重名时用分支收窄；
4. 仍重名时读终端标题里的工作目录（`~/path/to/repo` 也认），唯一命中即采用；
5. 还是认不出：面板顶部列出候选（项目 · 名称 · 分支 · 路径，每行一个「使用」动作），
   用户点一下就选定；同一份候选只推一次，失败不再周期性自动重试——只有聚焦上下文变化或
   用户主动刷新时才重新尝试。

worker 侧的 `workspace.readContext` 会带工作区 id（与 `workspace.list` 的 id 同源）：有 id 时
直接按 id 认领，「当前上下文」也按 id 识别，两个仓库的 `main` 不会混在一起。旧宿主不给 id 时，
才退回上面的规则，用显示名 + 分支识别上下文；那时两个同名同分支的工作区无法区分，显式选择也按
这个粒度记住。

## 工单后端

按 `origin` 远端自动选择，四种后端共用同一套判定与提示词：

- `github.com` → GitHub（`gh`）
- `gitlab.com` 或 `glab` 已登录的自建实例 → GitLab（`glab`），支持嵌套 group
- `tea` 已登录的自建 Gitea 实例 → Gitea（`tea`）
- 其余情况 → 本地 Markdown（`.scratch/<feature>/issues/*.md`）

远端后端在列表快照里带每张票的分配人登录名与当前登录用户：GitHub 在同一次 GraphQL 查询里
取 `viewer.login` 与 `assignees[].login`，GitLab / Gitea 的列表响应自带分配人、另发一次身份查询。
本地 Markdown 没有创建人与分配人，因此不显示人员筛选行。

本地快照库（`~/.orca-mattpocock-workflow/cache/`）保存当前用户与每张票的分配人；
格式版本已升到 3，旧版本条目按没有缓存处理，升级后第一次打开会全量重拉一次。
身份查询临时失败时沿用同一仓库上一次已知的身份，人员筛选不会因为一次抖动整行消失。

父子关系按后端能力取用，只用于列表布局，不改变判定、统计或写操作：

| 后端 | 父子来源 | 说明 |
|---|---|---|
| GitHub | 原生子工单 | 列表查询同时取父票；跨仓库父票保留 `owner/name#编号`，不误配同号票 |
| GitLab | 工作项层级 | 任务挂在工单下用 `#iid`；epic 只保留 `&iid` 引用，不画 epic 行；层级查询失败时父子模式禁用，刷新重试 |
| Gitea | 无 | 没有原生子工单，父子模式禁用并说明；平铺照常 |
| 本地 Markdown | `Parent:` 约定 | 只认同一 feature 下的工单；见下 |

本地 Markdown 工单的正文前言（`## Comments` 之前）支持这些行：

```
Status: ready-for-agent
Blocked by: 01, 03
Parent: 01
```

`Parent:` 取第一个数字，指向同一 feature 目录下的另一张工单；指向不存在的票、指向自己或跨
feature 时按无父级处理。评论里的 `Parent:` 不改变层级。增量刷新会把变更票引用的父票文件一并读入，
只改子文件也不会丢父级。

## 开发与发布

开发用 Orca 的开发目录加载；发布走 Git 树分发。两者共用同一套构建，但发布树必须自带构建产物。

### 开发

用 Orca 命令行加载开发插件：

```bash
pnpm install      # 自动构建一次
pnpm typecheck
pnpm test
pnpm build        # 产物：dist/worker/main.mjs、dist/panel/panel.{html,js,css}

orca plugin dev load .    # 打印授权指纹，照抄它给的 --approve 命令重跑一次
orca plugin dev watch .   # 持续打印日志与重载；--shot ./shots --shot-panel tickets 存面板截图
```

改了 `src/` 要先 `pnpm build` 再 `orca plugin dev reload`，worker 跑的是 `dist/` 里的产物。
如果新增或改名了 RPC 处理器，`reload` 后仍报
`unknown_method: no panel handler named …`，说明还是旧 worker：用
`orca plugin dev unload . && orca plugin dev load .` 强制换一个 worker。
完整的开发流程——审批指纹、调试 worker 请求、造事件、看日志与截图——见
[docs/development.zh-CN.md](docs/development.zh-CN.md)。

`dist/` 里只有四个文件入库：worker 入口、面板页面、面板脚本与面板主题样式。source map 在本地生成、
不进版本库；克隆后 `pnpm install` 会自动构建一次。开发期不用先提交产物。

装成本机正式插件（不再走 dev load）用文件夹安装：

```bash
pnpm build && pnpm run pack:plugin        # 产出 .orca/plugin-package
orca plugin dev unload .
orca plugin install .orca/plugin-package   # 首次按提示带 --approve <指纹>
```

仓库根不能直接装——`node_modules` 里的符号链接会被拒绝；细节与更新方式见
[docs/development.zh-CN.md](docs/development.zh-CN.md#装成本机正式插件)。

### 发布

发布树就是版本标签指向的那次提交里的文件。Orca 只从 Git 树安装：npm registry 与 Release 附件
都不是通道——把 `…/releases/download/…` 这样的地址粘给 `orca plugin install` 不会报错，
它会被解析成默认分支，装到的是没有产物的源码树。

发布树的要求：

- 四个构建产物随仓库提交：`dist/worker/main.mjs`、`dist/panel/panel.html`、
  `dist/panel/panel.js`、`dist/panel/theme.css`；用 `pnpm build:release` 生成，source map 不入库；
- 仓库根没有符号链接、子模块或未知条目（Orca 的内容校验会拒绝）；
- `LICENSE` 与清单的 `license` 字段一致；
- 清单 `version` 与 `vX.Y.Z` 附注标签一致；
- `main` 同时是默认分支：无版本安装读到的是这次提交；
- 仓库公开并带 `orca-plugin` topic（目录站收录条件；私有仓库只能按 Git URL 安装）。

发布前给发布提交打附注标签，再跑唯一的闸门（检查针对 HEAD，没有标签会直接失败）：

```bash
git tag -a v0.1.0 -m v0.1.0
pnpm release:check
```

它从当前提交导出发布树，用 Orca 自己的校验器离线校验，在树里重建并比对四个产物，
再核对版本标签、许可证、topic 与仓库可见性，最后打印可贴进目录文件的条目。
需要本机 Orca 命令行；`gh` 只用于查询 topic 与可见性，不可用时降级为警告。

通过后推送提交与标签：

```bash
git push origin HEAD v0.1.0
```

使用者按版本安装：

```bash
orca plugin install cnzgray/orca-mattpocock-workflow@v0.1.0
```

首次安装会要求批准一次，批准页列出能力与贡献点；新增能力、命令、面板、事件订阅或抬高执行档位
会触发重新批准。收录状态见
`https://www.onorca.dev/plugins/cnzgray/orca-mattpocock-workflow`。

## 语言

- 面板跟随 `language` 插件设置（`auto` / `zh-CN` / `en`）；`auto` 跟随 Orca 的界面语言。
  消息目录在 `src/protocol/i18n.ts`。
- 公开文档同时维护英文与简体中文（`*.zh-CN.md`）。代理运行文档（`AGENTS.md`、`CLAUDE.md`、
  `docs/agents/`）与技能正文保持简体中文，因为它们配置本仓库的中文代理工作流。
- Orca 清单 schema 没有按语言分字段的能力，清单描述与命令标题用英文；面板内部渲染的内容
  全部跟随语言设置。文档索引与语言约定见 [docs/README.zh-CN.md](docs/README.zh-CN.md)。

## 已知限制

- 提示词只能复制，不能直接写进会话：Orca 插件没有会话草稿接口。
- 入池技能（`mattwf-feature`、`mattwf-bug`）靠环境检查里的安装动作写进 agent 技能目录，
  插件本身不能注册运行时技能。
- 后端 CLI（`gh` / `glab` / `tea`）在 worker 进程里直接调用，走的是用户 PATH，
  不经过 Orca 自己的 CLI 解析与 WSL 回退。

## 许可证

MIT
