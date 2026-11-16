[English](GLOSSARY.md) | 简体中文

# 术语表

本仓库的领域术语。文档、issue、测试名里出现这些概念时用这里的词。

## 仓库作用域

一个仓库的主 worktree 根目录，作为工单缓存的**仓库级身份**。

- 取 `git worktree list --porcelain` 输出里第一条仍然存在的 `worktree <path>`；
  主 worktree 目录被删掉时顺延到下一条存在的。
- 解析失败（不是 git 仓库、没装 git、输出不可解析）时退回当前工作区根目录。
- 托管后端（GitHub / GitLab / Gitea）的本地快照库条目、内存快照、首屏去重、增量链与后端解析结果
  都按它归并：同一仓库的多个 worktree 共用一份。
- 它只是缓存身份，不是命令位置：git / gh / glab / tea 仍然在当前工作区里跑。

代码：`src/core/repository-scope.ts`（纯解析与缓存键）、`src/worker/repository-scope.ts`（跑命令）。
引入于 #7。

## 工作区作用域

当前工作区根目录（面板请求里的 `workspaceRoot`），作为**本地 Markdown 后端**的缓存身份。

- 本地 Markdown 的「仓库」就是当前工作区里的 `.scratch/` 目录树，天然是工作区本地的；
  按工作区隔离，一个 worktree 的本地工单不会串到另一个。
- 非 git 目录里，仓库作用域退回工作区根目录，两者是同一份缓存。

缓存键的选择只写在一处：`storeKeyOf`（托管后端用仓库作用域，本地 Markdown 用工作区作用域）。
引入于 #7。

面板的视图偏好（筛选、排序键、方向、两个人员开关与布局）走同一条规则，但面板拿不到仓库作用域，
用快照里的仓库身份代替：`viewPreferenceKey`（`src/panel/view-preference.ts`）。

_避免_：把仓库作用域叫成「仓库根」「repo root」——那容易被理解成当前 worktree 的 git 顶层目录，
而附属 worktree 的顶层目录恰恰不是仓库作用域。

## 当前用户（viewer）

列表快照里的当前登录用户：远端后端是 GitHub GraphQL 的 `viewer.login`、GitLab 的
`glab api user` 的 `username`、Gitea 的 `tea api /user` 的 `login`；本地 Markdown 没有远端用户，
恒为 `null`。

- 存在快照的 `viewer` 字段与本地快照库条目里，只保存登录名；
- 身份查询失败时不当作列表失败，只把 `viewer` 记为 `null`（全量）或省略（增量，沿用上一次）；
- 全量刷新返回 `null` 但同一仓库有上一次已知身份时沿用上次，避免一次抖动让人员筛选整行消失；
- 界面用它在筛选行显示 `@登录名`，并做大小写不敏感的匹配。

代码：`src/core/ticket.ts`（`TrackerSnapshot.viewer`）、`src/protocol/tracker.ts`
（`WorkspaceSnapshot.viewer`）。

## 人员筛选

列表视图里的两个独立开关：「分配给我」与「我创建的」。数据来自快照里的当前用户与每张票的
分配人登录名；匹配只在 `src/panel/ticket-view.ts` 的展示逻辑里实现一次。

- 两个都关：不按人员过滤；只开一个：只看对应角色；两个都开：取并集（分配给我 ∪ 我创建的）；
- 与状态筛选交叉生效，顺序固定为状态过滤 → 人员过滤 → 排序；
- 计数按当前状态筛选后的集合计算，两个角色互不影响；状态分段与统计仍基于整份快照；
- 登录名比较不区分大小写；创建人为 `null`（本地 Markdown、被匿名）不算「我创建的」；
- 当前用户为 `null` 时整行不渲染，已保存的开关保留，等身份恢复后重新生效。

分配人在列表快照里只存远端登录名（`Ticket.assignees` / `TicketSnapshot.assignees`），
不存展示名与头像；详情里的结构化 `TicketAuthor` 分配人不变。详情里改分配人后，列表快照不会立即
写回（`assignSelf` 需要再查一次当前用户），由下一次刷新拉齐；这期间人员筛选可能仍按旧分配人判断。

## 平铺模式

列表的默认布局：所有票按当前筛选与排序排成一条线，不显示折叠、子票数或父级徽标。
判定、统计与提示词行为与父子模式完全相同。

代码：`src/panel/ticket-tree.ts` 的 `buildTicketRows`（`flat` 分支）与
`src/panel/view-preference.ts` 的 `layout: 'flat'`。引入于 #14。

## 父子模式

按**父子关系**把子票缩进挂在父票下的列表布局。父票可折叠 / 展开整棵子树，
父行显示当前可见树里的后代数。只改变布局，不改变可接 / 阻塞 / 已关闭判定、
筛选、排序、统计或加载更多。

代码：`src/panel/ticket-tree.ts`（树构建、循环与缺失父级降级）、
`src/panel/tickets-view.tsx`（折叠状态与定位展开）。引入于 #14。

## 父子能力

快照声明的父子关系来源：

- `native`：后端提供原生父子工单（GitHub 子工单、GitLab 工作项层级）；
- `convention`：按正文约定推导（本地 Markdown 的 `Parent:` 行）；
- `none`：Gitea 没有原生子工单，或本次刷新取不到层级。

为 `none` 时面板禁用父子模式并说明原因，平铺照常。字段是 `hierarchy`。引入于 #14。

## 父子关系

一张票挂在另一张票下的组织关系，来源见**父子能力**。只用于列表布局：
不做状态汇总，父票不会因为子票全完成就自动变成可接，子票也不会因为父票阻塞就被判成阻塞。

## 父票 / 子票

同一列表里可作为父级的工单叫**父票**，挂在它下面的叫**子票**。
父子模式里父票可折叠整棵子树并显示可见后代数；父级不在当前视图时，子票升到顶层并显示父级引用徽标。

## 父级引用

工单上的 `parent` 字段，只存引用字符串，不复制父票的标题、状态或对象。
形状与 `ref` 一致：同列表里的票是 `#编号` 或相对文件路径；列表外父级是
`owner/name#编号`（GitHub 跨仓库父票）或 `&iid`（GitLab epic）。父级不在当前可见票里时，
子票升到顶层并显示父级引用徽标，不伪造父行。

代码：`src/core/ticket.ts` / `src/protocol/tracker.ts` 的 `parent` 字段。引入于 #14。

_避免_：把父级引用叫成「父票对象」或「父票快照」——它只有引用，父票信息仍从当前列表查。

## 发布树

版本标签指向的那次提交里的文件集合，也就是 Orca 安装与目录站看到的字节。

- 只有 Git 树是分发载体：npm registry 与 Release 附件都不是 Orca 的插件通道。
- 四个构建产物入库：worker 入口、面板页面、面板脚本、面板主题样式；由 `pnpm build:release`
  生成，source map 不入库。
- `main` 同时是默认分支：无版本安装读到的是这次提交，固定版本用 `vX.Y.Z`。
- 仓库根不允许符号链接、子模块与未知条目。
- 发布就绪检查（`pnpm release:check`）是唯一闸门：从 HEAD 导出发布树、跑 Orca 校验、
  在树里重建并比对产物、核对版本标签/许可证/topic，最后打印目录条目。

代码：`scripts/release-check.mjs`（运行器）、`scripts/lib/publish-readiness.mjs`（判定）。
引入于 #11。

_避免_：把 `orca plugin dev load` 的开发目录当成发布形态——它不经过 Git 树，也不会被目录站收录。
