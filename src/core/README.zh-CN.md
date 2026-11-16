[English](README.md) | 简体中文

# core

纯业务逻辑：工单模型、远端解析、后端选择、本地 Markdown 解析、工单详情与变更规划、指标与压力判档、环境检查的顺序与依赖判定等。

- 不做任何 IO：不读写文件、不发网络请求、不启动子进程；
- 正式代码只依赖自己；允许用 `import type` 引用 `protocol` 里的纯类型（例如 `BackendKind`），
  不产生运行时依赖（这是约定，不是工具强制）；
- 行、分支、函数覆盖率目标不低于 80%（当前没有 CI 强制）。

工单详情相关：

- `ticket.ts` 里的 `TicketDetail` / `TicketComment` / `TicketPatch` 是适配器与宿主共用的模型；
  `Ticket` 上的 `parent` 是父级引用，`TrackerSnapshot` / `TrackerChanges` 的 `hierarchy`
  声明父子能力来源（`native` / `convention` / `none`）；两者只用于列表组织，不参与判定；
  详情里的创建人、评论作者与分配人都是结构化的 `TicketAuthor`（登录名 / 展示名 / 头像地址），
  写侧的分配人补丁仍是登录名数组；
- `author.ts` 是远端用户的唯一解析入口：`readAuthor` / `readAuthors` 按各后端字段名取值，
  登录名为空时整条用户按 null 处理（不从列表里消失），头像只放行 http(s) 绝对地址，
  实例内相对路径按后端给出的基准补全；列表与详情共用同一份规则。`readLogins` 用同样的容错口径
  只取登录名，供列表快照的分配人使用（不读展示名与头像）；
- `snapshot-store.ts` 是本地快照库的条目模型（格式版本 3）：保存当前用户 `viewer` 与每张票的
  分配人登录名 `assignees`；版本不符、字段缺失或类型不对时整份作废，由宿主自动全量重拉；
- `ticket-detail.ts` 只做纯计算与字段校验：目标集合与当前集合的差异（`diffSets` / `resolveTargetSet` /
  `planSetChange` / `isEmptyDiff`），以及三个远端后端共用的详情字段读取（`readRequiredString`、
  `readNameList`、`sortCommentsByTime`、`requireTicketNumber`、`invalidDetail`）；
  「分配给我」由适配器解析用户名后作为 `self` 并入目标集合；
- 补全候选的归一化也在这里：`normalizeLabelColor` 把颜色统一成小写 `#rrggbb`，
  `dedupeBy` 按名字去重并保留首次出现的顺序；
- `markdown.ts` 里的 `parseMarkdownDetail` 把本地工单文件切成标题、正文与评论段落；
  `parseMarkdownTickets` 同时解析 `Parent:` 行：只看 `## Comments` 之前，取第一个数字，
  只认同 feature 下的另一张工单；缺失、自引用与跨 feature 都按无父级处理；
- `snapshot-store.ts` 的条目格式版本升到 3，保存快照级的 `hierarchy` 与工单级的 `parent`；
  版本不符或枚举非法时整份作废，避免把缺父子字段的旧缓存当成完整的树；
- `worktree.ts` 推导 worktree 的分支名、工作区名与注释（工作区名与分支名同值），按 Orca 的 URL 路由表判定工单链接能否挂载
  （自建 Gitea / GitHub 的 `/issues/<n>` 不挂，链接补进注释），拼装 Orca 命令行参数，并解析它的 JSON 输出；
- `repository-scope.ts` 解析 `git worktree list --porcelain`，给出仓库作用域（主 worktree 根目录）
  与缓存键：托管后端按仓库归并，本地 Markdown 按工作区隔离；
- `orca-cli.ts` 决定 Orca 命令行的候选顺序并校验 `--version` 输出，Linux 上同名读屏软件会被排除。

## 指标与压力判档（`metrics.ts`）

`computeMetrics` 接收已判定的工单、快照时间、总数、时间数据可用性与阈值，输出指标、三个压力维度与关注清单。
判定与文案分离：core 只给档位、触发指标与缺口原因（`light` / `normal` / `tight`、`MetricGap`），中文文案在界面的
`overview-text.ts` 里，改文案不会改判定。

阈值集中在 `PRESSURE_THRESHOLDS`，三条规则：

| 维度 | 看什么                   | 轻松                    | 吃紧                     |
| ---- | ------------------------ | ----------------------- | ------------------------ |
| 规模 | 开放积压、近 30 天净流入 | 积压 < 10 且净流入 ≤ 0  | 积压 ≥ 30 或净流入 ≥ 6   |
| 阻塞 | 阻塞票 ÷ 开放票          | < 15%                   | > 35%                    |
| 时效 | 陈旧率、停滞票           | 陈旧率 < 20% 且停滞 ≤ 3 | 陈旧率 > 40% 或停滞 ≥ 11 |

总档位取三者中最重的一维。**初稿校准**：用本插件仓库（20 张票、开放 10、近 30 天新开 20、关闭 10、净流入 +10）核对，
积压 10 张判“正常”、净流入 +10 判“吃紧”；结论是初稿对刚建立、票全在窗口内的仓库偏严。阈值是初稿，后续校准只改
`PRESSURE_THRESHOLDS`，判定逻辑与界面文案不动。

数据诚实性：本地 Markdown 的文件时间不算工单时间（`timestamps: false`），时效维度整体标“不可用”（`tier: null`），
流量指标也标不可用；后端不给关闭时间时关闭类指标标 `no-closed-time`；GitHub 列表查询给不出依赖边时链深度标
`no-dependency-edges`。不可得指标一律用 `null` + `gap` 表达，不用 0 冒充。样本被截断时，关闭类指标可能低估，
由关闭数派生的净流入可能高估，界面分别标注。

阻塞依赖边用 `Ticket.ref` 而不是裸编号：远端是 `#15`，本地 Markdown 是相对路径。本地编号只在同一个 feature 内唯一，
裸编号无法跨 feature 找回票，链深度也就无从计算。
