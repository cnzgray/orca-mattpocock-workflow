[English](README.md) | 简体中文

# protocol

worker 与面板之间的消息类型和常量。

- 只放类型和常量，不放逻辑；
- `i18n.ts` 是面板与 worker 共用的消息目录（`zh-CN` / `en` 两份，键一一对应），
  语言解析与插值在 `src/panel/i18n.ts`；
- 不依赖任何其他目录（这是约定，不是工具强制）；
- 面板只能通过这里定义的类型与 worker 通信，不能直接导入 `core`、`adapters`、`worker`。

RPC 方法（面板用 `orca.plugin.request(方法名, 参数)` 调用，worker 用同名处理器应答）：

- `snapshot.get` / `snapshot.refresh` / `snapshot.resolveBlockers`：列表快照与阻塞补齐；
- `snapshot.loadMore`：按快照的游标取下一段工单并追加到已加载的列表，参数是 `{ workspaceRoot }`；
  一次取全的后端原样返回当前快照；
- `snapshot.cache`：读取或清空本地快照库（缓存按仓库计，同一仓库的多个 worktree 共用一份）；
- `env.check`：环境检查；
- `ticket.get`：读取单张工单详情，参数是 `{ workspaceRoot, ref, number }`；
- `ticket.update`：提交一次变更补丁，参数在详情参数上再加 `patch`，成功返回 `{ applied: true }`；
- `ticket.options`：读取仓库的标签与可分配用户，参数是 `{ workspaceRoot }`，返回 `TicketOptions`；
- `ticket.delete`：永久删除一张工单，参数在详情参数上再加 `confirm: 'delete'`，成功返回 `{ deleted: true }`；
- `ticket.worktree`：为一张远端工单创建 Orca 托管的 worktree，参数是 `{ workspaceRoot, ref, number }`，
  返回 worktree 标识、绝对路径、分支名、显示名、工单链接与 `created`（同分支已有工作区时为 false）；
  链接取自后端详情，Orca 认不出时不挂载、只写进注释，面板仍显示原链接；
- `avatar.read`：把后端给出的 http(s) 头像地址读成 `data:image/…`。面板 frame 的 CSP 只放行
  `data:` 图片，远程地址会被宿主拦掉；worker 代理下载，响应只接受 `image/*`、上限 1 MiB。

`workspaceRoot` 由 worker 自己解析：面板不填路径，worker 认领不到工作区时通过
`workspace.candidates` 事件把候选推一次（附带所属聚焦上下文键，面板据此判断选择是否还有效）；
用户选定后由面板在后续请求里带上候选的 `path`，worker 把它记在当前聚焦上下文里，
之后省略 `workspaceRoot` 的请求与刷新命令都沿用它。

`workspaceRoot` 是命令执行的位置（git / gh / glab / tea 都在它下面跑）；缓存身份由宿主换成
**仓库作用域**（该仓库的主 worktree 根目录）：同一仓库的多个 worktree 共用一份快照库条目、
一份内存快照、一条增量链与一次后端探测。本地 Markdown 是例外——它的「仓库」就是当前工作区的
`.scratch/`，缓存按工作区隔离。协议形状不变，面板仍然只传 `workspaceRoot`。

错误码里与详情相关的是 `ticket-not-found`（编号不存在或已被删除）与
`capability-unsupported`（当前后端不提供所请求的详情、补全候选、写 / 删除能力或远端链接）。
worktree 另有两个错误码：`orca-missing`（找不到 Orca 命令行，属于环境问题）与
`worktree-create-failed`（创建失败，消息里带命令行的诊断；Orca 拒绝工单链接时换成中文说明）。
删除时没有权限用 `fetch-failed`，消息里写明需要哪种角色。界面按错误码给出统一文案。

详情里的创建人、评论作者与分配人都是 `TicketAuthor`（登录名 / 展示名 / 头像地址），
与列表快照的创建人同一形状；本地 Markdown 的创建人与评论作者为 null、分配人为空数组。

## 快照载荷

`snapshot.get`、`snapshot.refresh`、`snapshot.loadMore` 与 `snapshot.resolveBlockers` 都返回同一个
`WorkspaceSnapshot`：

- 工单级：判定结果（`status`、`category`）、关闭时间（`closedAt`，能给才给）、阻塞引用（`blockedBy`，
  能给才给；GitHub 列表查询没有依赖边）、分配人登录名（`assignees`，没有分配人时为空数组）与父级引用
  （`parent`，能给才给；跨仓库父票是 `owner/name#编号`，GitLab epic 是 `&iid`）；
- 快照级：仓库标识、后端、实例主机、拉取时间、已加载数与总数、阻塞是否定稿、当前登录用户
  （`viewer`，识别不出时为 null；人员筛选靠它判断「我」是谁），以及父子能力来源
  （`hierarchy`：`native` / `convention` / `none`）。`none` 时面板禁用父子布局并说明，
  平铺照常；父子关系不参与判定、统计或指标；
- 分页：`hasMore` 为 true 时后端还有未加载的工单，界面据此给出「加载更多」入口。游标只在宿主内部
  流转（快照库条目里的 `nextCursor`），不暴露给面板；一次取全的后端 `hasMore` 恒为 false；
- 指标级：`metrics`，含三个压力维度（`PressureDimension` / `PressureTier`）、关键数字、样本覆盖度
  （`coverage`）与关注清单（`attention`）。`MetricValue` 用 `value: null` + `gap` 表示后端给不出的指标；
  维度数据不足时 `PressureDimensionReport.tier` 为 `null`，总档位只合并可判档的维度。

指标由宿主在列表返回时算一次、阻塞补齐完成后重算，界面只渲染，不重复判定。阈值与判定规则在 core。

`snapshot-test-support.ts` 只是测试夹具（全零指标载荷），生产代码不导入；它和消息类型放在一起，是为了让 host 与 client 的测试共用同一份默认值。
