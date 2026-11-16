[English](README.md) | 简体中文

# adapters

对接外部系统，每个后端一个子目录：

- `github/`：通过 `git` 与 `gh` 读取 `github.com` 仓库的 issue；
- `gitlab/`：通过 `git` 与 `glab` 读取 GitLab issue；列表带 `blocking_issues_count` 时直接判定支持原生阻塞，原生阻塞数在 `resolveBlockers` 补齐阶段读取：否则按实例主机只探测一次，支持时用一次批量 GraphQL 取回阻塞数，失败或空数组时退回 `Blocked by:` 行；要求 `glab` >= 1.126，更早版本未验证；
- `gitea/`：通过 `git` 与 `tea` 读取 Gitea issue 与原生 issue 依赖（只读 `tea api --include`）；
  依赖功能关闭时退回 `Blocked by:` 行。宿主选择后端时探测 `tea logins list --output json`；
- `markdown/`：读取工作区里 `.scratch/<feature>/issues/*.md` 的本地工单；`env.ts` 供环境检查确认工单目录与文件可解析；
- `fs/`：环境检查用的文件系统能力（解析用户主目录、判断文件是否存在）与本地快照库
  （`~/.orca-mattpocock-workflow/cache`，主目录不可写时退回系统临时目录）；
- `github/`、`gitlab/`、`gitea/` 里的 `env.ts`：环境检查的命令行探测（CLI 是否安装、是否登录、仓库是否可达）；
  Gitea 的登录列表与仓库访问复用工单后端的调用方式与解析函数。

每个后端的 `tracker.ts` 实现列表契约，`detail.ts` 实现可选的详情与变更能力，
`options.ts` / `delete.ts` 实现补全候选与删除，共用 `shared.ts` 里的仓库识别、命令执行与错误映射：

| 后端          | 详情正文       | 评论                           | 链接地址 | 标签写 | 分配人写                        | 状态写 | 补全候选                                                   | 删除                                                               |
| ------------- | -------------- | ------------------------------ | -------- | ------ | ------------------------------- | ------ | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| GitHub        | 是             | GraphQL（评论按 `hasNextPage` 翻页，单页 100） | 是       | 是     | 是                              | 是     | `gh label list`；`gh api .../assignees --paginate --slurp` | `gh issue delete --yes`；`viewerPermission` 为 `ADMIN`             |
| GitLab        | 是             | notes 接口（跳过 system note） | 是       | 是     | 是（整体替换，清空用 `!` 前缀） | 是     | labels 与 members/all 分页（只保留 active 成员）           | `glab api --method DELETE`；Owner（access_level ≥ 50）或实例管理员 |
| Gitea         | 是             | comments 接口                  | 是       | 是     | 是（`--set-assignees`）         | 是     | labels 分页（每页 50 条）与 assignees                      | `tea api --method DELETE`；`permissions.admin`                     |
| 本地 Markdown | 是（文件正文） | `## Comments` 段按空行分段     | 否       | 否     | 否                              | 否     | 否                                                         | 否（不改用户手写的文件）                                           |

- 列表分页：GitHub 一次取一页（GraphQL 的 `first` 上限 100），返回 `nextCursor`，
  宿主用 `snapshot.loadMore` 按游标追加；GitLab、Gitea 与本地 Markdown 一次取全，没有 `nextCursor`。
  增量刷新保留已追加的窗口与游标（合并结果不裁剪）；「全量刷新」或「只加载了一部分却没有游标」的
  旧缓存才回到第一页。
- 列表里的人员信息：每张票带分配人登录名（`assignees`），快照带当前登录用户（`viewer`）。
  GitHub 在同一次 GraphQL 查询里取 `viewer.login` 与 `assignees(first: 10)`；GitLab / Gitea 的
  列表响应自带分配人，另发一次 `glab api user` / `tea api /user` 查身份，与列表并行发出。
  身份查询失败只让 `viewer` 为 null，不影响列表；本地 Markdown 的 `viewer` 为 null、分配人为空数组。
  分配人只存登录名，不读展示名与头像。
- 父子能力由每个后端显式声明：GitHub 从列表查询一并取 `parent`（同仓库存 `#编号`，跨仓库存
  `owner/name#编号`）；GitLab 在列表返回后按每批 100 个 iid 查工作项层级（issue / task 父级存
  `#iid`，epic 存 `&iid`，失败只降级能力、不影响列表）；本地 Markdown 解析同一 feature 内的
  `Parent:` 行；Gitea 声明为无。共用契约套件会断言能力声明与父级引用一致，声明为无的后端
  不得出现 `parent`。
- 详情只在打开详情时请求，不进入列表快照；创建人、评论作者与分配人都是结构化用户
  （登录名 / 展示名 / 头像地址），与列表的创建人同源同形：GitHub 的 `author.login` + `avatarUrl`、
  GitLab 的 `username` + `avatar_url`、Gitea 的 `login` + `avatar_url`（相对地址按实例基准补全）；
  本地 Markdown 没有远端用户，创建人与评论作者为 null、分配人为空数组。
  GitHub 详情整条走 GraphQL，一次取全作者、分配人与评论作者的头像；变更前的当前值也只读一次。
- GitLab 详情返回前会把正文与评论里的上传附件内联成 `data:image/`：只认当前项目
  `/uploads/<secret>/<filename>` 的相对地址与同源同项目路径的绝对地址，用已登录的
  `glab api projects/<id>/uploads/<secret>/<filename>` 取原始字节；取图失败、非位图或超过
  大小上限时降级成指向 GitLab 原链接的普通链接。token 只留在 `glab` 进程里，不进协议字段。
- 补全候选把标签颜色统一成小写 `#rrggbb`，重复的标签名 / 用户名只保留第一次出现的项；
- 删除前宿主会再查一次权限；删除成功后不可撤销，编号不存在映射为 `ticket-not-found`；
- 权限查询失败在宿主按“没有权限”处理，详情仍然正常返回，只把删除能力置为 false；
- 变更补丁表达目标集合，适配器用 `core` 的 `planSetChange` 与当前值算成各自 CLI 的增删参数；
  「分配给我」由适配器解析当前登录用户（GitHub 用 `@me`，GitLab / Gitea 先查 `/user`）；
- 本地 Markdown 的引用必须是 `.scratch/<feature>/issues/<name>.md`，越界路径直接拒绝读取。
- 可选字段：能给出关闭时间时填 `closedAt`；能给出阻塞依赖边时填 `blockedBy`（引用集合，不论开闭）。
  GitHub 列表查询只给未关闭阻塞数，整张票省略 `blockedBy`；本地 Markdown 没有关闭时间。

- 只能依赖 `core`；各个后端之间互不依赖（这是约定，不是工具强制）；
- 工单后端共用一套契约测试：同一组用例，每个后端都必须跑通；测试里不连真实服务，用录制好的响应或内存假实现。
  详情、补全候选与删除能力也在这套契约里：实现该能力的后端给出请求与期望输出，省略即表示不实现。
