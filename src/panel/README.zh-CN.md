[English](README.md) | 简体中文

# panel

Orca 右侧栏里的 MattWorkflow 面板（`ui: "html"`，独立 frame 里跑的 React 应用）。

## 结构

- `main.tsx`：入口。挂载 React、接宿主事件（`workspace.candidates` / `snapshot.refreshed` /
  `workspace.changed`）、在工作区认领不到时渲染候选列表。启动与 `workspace.changed` 后都问一次
  worker 的 `workspace.current`，由 worker 决定当前路径与候选；失败不自动重试，只在聚焦上下文
  变化或用户主动刷新时重新请求。
- `workspace-picker.tsx`：面板顶部的候选选择区。每行显示项目、名称、分支与路径，点「使用」
  选定；同一分支上的多个工作区靠这些字段区分。
- `transport.ts`：面板与 worker 的唯一通道。方法名与入参出参沿用 `src/protocol/tracker.ts`，
  底层是 `orca.plugin.request`；另外提供 `skills.install` 与 `workspace.current` 两个额外处理器。
- `clipboard.ts`：剪贴板写入的两级路径（剪贴板 API → 隐藏 textarea + `execCommand('copy')`），
  提示词、命令与工单链接的复制共用。
- `worktree-action.tsx`：工单列表行与详情头部的「建 worktree」入口，以及创建结果的原地回报；
  可用性只看快照里已有的判定，本地 Markdown 与未确定工作区不提供入口。
- `injection.ts` + `prompt-copy.tsx`：提示词出口。Orca 没有「填会话输入框」与「开新会话」，
  面板只把提示词复制到剪贴板。`clipboard.ts` 先试剪贴板 API；面板 iframe 没有
  `clipboard-write` 权限策略时会拒绝，此时退回隐藏 textarea + `execCommand('copy')`。
  两条路都失败才给出只读、已全选的文本框由用户手动 ⌘C。
- `view-preference.ts`：按仓库记住筛选、排序、两个人员开关（分配给我 / 我创建的）与布局（平铺 / 父子），
  存在 Orca 的插件私有存储里（一份 JSON 映射，最多 50 个条目；同一仓库的多个 worktree 共用一份）。
  旧存档没有人员或布局字段、字段非法或存储不可用时，人员开关按关闭、布局按平铺回退。
- `ticket-view.ts`：列表的展示逻辑。状态过滤 → 人员过滤 → 排序在这里组合一次，
  人员计数也在这里算；界面只渲染结果，不重复判定。
- `tickets-view.tsx`：列表视图。状态分段控件下方的人员筛选行只在快照带当前用户时渲染，
  两个胶囊开关带计数，任一开关打开时出现「清除」，行尾显示 `@登录名`。
- `ticket-tree.ts`：列表布局的纯函数。把已筛选、排序的可见票构造成渲染行：父子模式给出深度、
  是否有子票、展开状态、父级是否在列表外与后代数；循环与自引用降级为顶层行，不丢票。
  `ancestorRefs` / `expandAncestors` 供从概览定位时展开祖先链。
- `layout-toggle.tsx` / `hierarchy-text.ts` / `hierarchy-notice.tsx`：布局切换、父子来源说明、
  能力为无时的禁用原因，以及覆盖范围与降级提示。布局切换是「已加载」行右侧的图标分段
  （平铺 / 父子），不占筛选工具栏；图标按钮的可访问名称同时写出动作与来源。
  父子能力只影响布局，不参与判定或统计。
- `ticket-list.tsx`：列表行。父子模式多出折叠按钮、缩进、子票数与父级引用徽标；
  平铺模式不显示任何父子装饰。折叠是会话内状态，换工作区时清空，刷新与筛选排序都保留。
- `capabilities.ts`：面板侧能力诊断（面板桥、剪贴板、worker 可达），与环境检查里
  worker 侧的能力合并显示。
- `i18n.ts`：界面语言。解析 `language` 设置（`auto` / `zh-CN` / `en`）与宿主 BCP-47 语言，
  提供插值、React context 与 `<html lang>` 同步；消息目录在 `src/protocol/i18n.ts`。
  面板组件只通过 `useMessages()` 取文案，非 React 模块用 `activeTranslate()`。
- `task-panel.tsx`：面板外壳，在列表、概览、环境检查与流程帮助之间切换。
- `theme.css`：把宿主注入的 `--orca-*` 令牌映射成面板自己的 `--mwf-*` 变量；深浅色跟随宿主。
- `markdown-body.tsx`：自带的极简 Markdown 渲染器。工单正文是不可信输入，因此不解析原始
  HTML，链接只放行 http(s) 与 mailto。GitLab 详情会把上传附件内联成 `data:image/` 位图；
  渲染器只在详情明确启用时把这类 data URL 画成 `img`，其它后端的图片语法保持「`!` + 链接」。
- `avatar-display.ts` + `avatar-source.ts` + `user-avatar.tsx`：列表、详情时间线与分配人共用的头像。
  面板 frame 的 CSP 不放行远端图片（`img-src data:`），所以 `user-avatar.tsx` 只渲染 worker
  代理回来的 data URL；`avatar-source.ts` 负责并发去重并请求 worker，不保留图片字节。
  没有地址或加载失败时退回登录名首字母色块，颜色只由登录名决定。地址白名单、无障碍文本与
  配色规则在 `avatar-display.ts`，可以脱离子进程与 DOM 单测。

## 约束

- 面板只依赖 `src/protocol` 的类型与常量，不导入 `src/core` 或 `src/adapters`。
- 协议里的方法名与参数形状不改；面板按名字调用 worker 注册的 handler。
