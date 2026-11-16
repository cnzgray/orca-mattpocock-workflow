[English](development.md) | 简体中文

# 开发

用 Orca 命令行把本仓库加载成开发插件，边改边看。全部命令都在本仓库根目录执行。

## 准备

```bash
pnpm install      # 会自动跑一次 build
pnpm typecheck
pnpm test
pnpm build        # 产物：dist/worker/main.mjs、dist/panel/panel.{html,js,css}
```

清单（`orca-plugin.json`）指向 `dist/` 里的产物；其中四个文件入库、source map 不入库。**改了 `src/` 必须先
`pnpm build`，否则 worker 跑的还是旧代码**——这一点最容易踩：`orca plugin dev reload`
重启的是 worker，不是构建。

Orca 命令行与桌面端版本要一致（`orca --version` 与应用内版本同源）。本机已装的 CLI 在
`/Applications/Orca.app/Contents/Resources/bin/orca`。

## 加载与审批

```bash
orca plugin validate .          # 离线校验清单，不跑插件代码；退出码 0/1/2/3
orca plugin dev load .          # 加载成开发插件
```

插件会跑代码、也要工作区读写权限，所以第一次加载会被拦下，命令打印授权清单与指纹：

```
local.mattpocock-workflow 0.1.0 needs approval before it can run.
Approving MattWorkflow (…) grants:
- Runs its own code in a separate Node.js process …
Fingerprint: ap1-014bde73684c890b2bbec2b2ac55dd75
Next step: To approve, run: orca plugin dev load . --approve ap1-014bde73684c890b2bbec2b2ac55dd75
```

照抄那条带 `--approve` 的命令重新执行即可：

```bash
orca plugin dev load . --approve ap1-014bde73684c890b2bbec2b2ac55dd75
```

退出码含义：`0` 成功，`1` 出错，`2` 插件无效，`3` 需要审批（或指纹过期）。
指纹绑在这个插件、版本、文件与权限组合上：之后改代码不再问，新增权限或改命令才要重新批。

审批后的插件 key 是 `local.mattpocock-workflow`，后面几条命令按它指代。

## 日常循环

```bash
orca plugin dev watch .          # 加载 + 持续打印日志与重载，Ctrl-C 退出
```

`watch` 是开发时最常用的一条：加载目录、打印面板与 worker 的每一行日志、每次文件改动触发的
重载、以及状态变化（errored / invalid 会带错误）。`Ctrl-C` 会卸载这个开发目录（如果它本来就是
加载状态，则保留）。加 `--check` 每次加载与重载后都跑一遍 `orca plugin check`；加
`--shot <目录> --shot-panel tickets` 每次重载后存一张面板 PNG。

不想一直挂着时，用手动重载：

```bash
pnpm build                     # 先构建
orca plugin dev reload .      # 再重载（漏掉的文件改动也用它补）
```

改了命令或快捷键后要重新审批，`reload` 会提示新的指纹。

## 看面板

```bash
orca plugin open local.mattpocock-workflow --panel tickets   # 在右侧栏打开
orca plugin shot local.mattpocock-workflow --panel tickets --out shots/tickets.png
orca plugin dev inspect local.mattpocock-workflow            # 面板 DevTools（仅桌面端）
orca plugin logs local.mattpocock-workflow                  # worker 最近打印的日志
orca plugin list --json                                      # 所有插件的状态，dev 目录标 isDev
```

面板在 iframe 里跑，没有网络权限（`img-src data:`）：远端头像地址不能直接交给 `<img>`，
日志里出现 `blocked img-src https://avatars.githubusercontent.com` 说明有代码绕过了 worker 代理。
头像统一走 `avatar.read`：worker 下载图片并转成 data URL，面板再渲染。

## 语言

面板右上角的下拉写插件设置 `language`（`auto` / `zh-CN` / `en`），改完即时生效。
`auto` 跟随 Orca 的界面语言（`orca.locale`），`zh*` 落中文、`en*` 落英文，其余落中文。
同一个设置也在 Orca 的 Settings → Plugins 里可改；面板订阅设置变更，不用重载。

文案只维护 `src/protocol/i18n.ts` 的两份目录；`src/panel/*` 里出现中文字面量会被
`src/panel/i18n-guard.test.ts` 拦住。技能正文固定用 `zh-CN` 目录，`skills/` 下的内容不随界面语言变化。

## 调 worker

面板请求走 `orca.plugin.request(name, input)`，落到 worker 里 `orca.panels.handle(name, …)`
注册的同名处理器。命令行可以绕过面板直接调：

```bash
orca plugin dev request . snapshot.get --data '{}' --json
orca plugin dev request . workspace.current --data '{}' --json
```

名字取自 `src/protocol/tracker.ts` 的 `RPC_METHODS`，外加三个面板专用处理器：
`workspace.current`、`workspace.open`、`skills.install`。`--data` 是入参 JSON，省略时处理器收到
`null`；`--panel` 指定调用方面板 id（默认 `orca-cli`）；`--timeout-ms` 限制等待时间。

装了（非开发目录）的插件会被拒绝调用，要用 `dev request` 就得把目录加载成开发插件。

刚在 `src/` 里新增或改名处理器后，要先 `pnpm build` 再 `orca plugin dev reload`：
worker 只有重启才会重新注册 handler，否则报 `unknown_method: no panel handler named …`。
如果 `reload` 后仍是这条错误，说明宿主复用了旧 worker：
`orca plugin dev unload . && orca plugin dev load .` 会强制换一个。

## 造事件

worker 与面板都订阅 `workspace.changed`，可以手动造一次：

```bash
orca plugin dev emit . workspace.changed --data '{"context":{"branch":"main","displayName":"demo","terminals":[]}}' --json
```

载荷按宿主的 schema 校验，不合法会直接被拒。`workspace.changed` 的载荷是
`{ context: { workspaceId?, branch, displayName, terminals: [{ id, title? }] } }`；
`branch` 与 `displayName` 必填，`workspaceId` 可选。输出里的 `delivered` 分别说明 worker 与
多少个打开的面板收到了。

## 类型

```bash
orca plugin types .             # 写 .orca/types/orca/*.d.ts 与 tsconfig.json
```

`.orca/` 已在 `.gitignore` 里，`orca plugin dev load` 遇到用 TypeScript 的目录会自动刷新它。
本仓库没有把 `tsconfig.json` 指向这份类型：`src/worker/orca-types.ts` 是手写的最小接口集，
只覆盖用到的宿主 API，改动面比跟随整份类型小。

## 装成本机正式插件

开发插件只适合边改边看；要像普通插件一样常驻 Orca，用文件夹安装：

```bash
pnpm build                     # dist/ 是清单指向的产物
pnpm run pack:plugin                      # 产出 .orca/plugin-package（运行时文件副本）
orca plugin dev unload .       # 先摘掉同 key 的开发插件，否则 key 冲突
orca plugin install .orca/plugin-package
```

第一次装会打印授权清单与指纹，照抄它给的 `--approve` 命令重跑一次。装好后的 key 是
`local.mattpocock-workflow`，来源是 `.orca/plugin-package` 这个文件夹，`orca plugin list`
里不再标 `isDev`。

不要直接 `orca plugin install .`：文件夹安装会复制整个目录，只跳过根目录的 `.git`，
`node_modules` 里 pnpm 的符号链接会让安装失败（`symlink not allowed in plugin content`）。
`.orca/plugin-package` 只放 `orca-plugin.json`、`README.md`、`dist/`、`skills/`，
目录本来就在 `.gitignore` 里。

日常更新：

```bash
pnpm build && pnpm run pack:plugin
orca plugin update local.mattpocock-workflow
```

文件夹安装的 update 会重新复制这个目录；新增权限、命令、面板或换了版本时可能要求重新审批，
命令会打印新指纹。插件私有数据在 `~/Library/Application Support/orca/plugins-data/` 下，按 key 存。

## 收尾

```bash
orca plugin dev unload .        # 摘掉开发目录
```

卸载不需要审批；同 key 的已安装插件会回来，并按它自己的权限重新要求审批。

## 发布

开发目录加载不是分发形态。发布走 Git 树：目录站与 `orca plugin install` 看到的都是版本标签指向的
那次提交里的文件，所以构建产物必须入库。npm registry 与 Release 附件都不是 Orca 的插件通道；
把 `…/releases/download/…` 粘给安装命令会被静默解析成默认分支，装到没有产物的源码树。

### 发布流程

1. 构建并确认测试通过：

   ```bash
   pnpm typecheck && pnpm test && pnpm build:release
   ```

2. 提交源码与四个产物（source map 被 `.gitignore` 排除）：

   ```text
   dist/worker/main.mjs
   dist/panel/panel.html
   dist/panel/panel.js
   dist/panel/theme.css
   ```

   清单 `version` 设为本次版本（`X.Y.Z`），确认 `LICENSE` 与 `license` 字段一致。

3. 给发布提交打附注标签：

   ```bash
   git tag -a vX.Y.Z -m vX.Y.Z
   ```

4. 跑唯一的发布闸门：

   ```bash
   pnpm release:check
   ```

   检查针对 HEAD：未提交改动不算，没有版本标签会直接失败。它从 HEAD 导出发布树、
   跑 `orca plugin validate` 离线校验、在树里重建并比对四个产物、核对版本/标签/许可证/topic，
   最后打印可贴进目录文件的条目。需要本机 Orca 命令行；`gh` 只用于查 topic 与可见性。

5. 通过后推送提交与标签：

   ```bash
   git push origin HEAD vX.Y.Z
   ```

6. 仓库公开后加 topic：

   ```bash
   gh repo edit cnzgray/orca-mattpocock-workflow --add-topic orca-plugin
   ```

7. 查收录状态：`https://www.onorca.dev/plugins/cnzgray/orca-mattpocock-workflow`。
   通常一小时内收录；状态页会写没收录的具体原因。社区目录由机器检查自动生成；
   官方目录需要 Orca 团队人工审核，本仓库不投。

使用者按固定版本安装：

```bash
orca plugin install cnzgray/orca-mattpocock-workflow@vX.Y.Z
```

### 发布树规则

- 只入库四个构建产物；source map 不入库。
- 仓库根不能有符号链接、子模块或未知条目（Orca 的内容校验拒绝）。
- `LICENSE` 与清单 `license` 一致；`manifestVersion` 为 2；`version` 为 `X.Y.Z`。
- 标签是附注标签，且指向 HEAD。
- `main` 同时是默认分支：无版本安装读到的是这次提交，固定版本用 `vX.Y.Z`。
- 仓库公开并带 `orca-plugin` topic；私有仓库只能按 Git URL 安装，不会进目录。

本仓库当前是私有仓库：Git URL 安装可用，目录收录要等维护者决定公开之后。

### 常见拒绝原因

| 现象 | 原因 | 处理 |
|---|---|---|
| `worker entry dist/worker/main.mjs: ENOENT` | 构建产物没入库 | 提交四个 `dist/` 文件 |
| `plugin Git trees cannot contain symlinks, submodules or unknown entries` | 仓库根有符号链接或子模块 | 换成真实文件或删除 |
| 清单不是 v2 | `manifestVersion` 过期 | 按当前清单格式迁移 |
| 没有可检测的许可证 | 缺 `LICENSE` 或清单 `license`，或内容认不出 | 加 MIT `LICENSE` 与 `license` 字段 |
| 目录站不显示 | 没有 `vX.Y.Z` 标签、仓库私有、fork/归档、缺 topic、owner 仿冒保留名 | 对应修正 |
| 安装到的是源码树、没有产物 | 用了 Release 附件地址 | 改用 `owner/repo@vX.Y.Z` |
| `approval_required` | 新增能力、命令、面板、事件订阅或抬高执行档位 | 按提示重新批准 |
| 二进制文件被拒 | TTF/OTF 字体不允许；图片与 WOFF/WOFF2 允许 | 移除不允许的字体文件 |

### 版本说明模板

发版说明里点名新增的能力、命令、面板与事件订阅，使用者才知道要重新批准什么：

```markdown
## vX.Y.Z

新增能力：…
新增命令：…
新增面板：…
新增事件订阅：…

修复 / 变更：
- …

安装：orca plugin install cnzgray/orca-mattpocock-workflow@vX.Y.Z
```

### 更新与批准

- 首次安装 `trusted-worker` 插件必须批准；批准页列出能力与贡献点。
- 更新若新增能力、抬高执行档位、新增命令/面板/快捷键/事件订阅或换仓库，会触发重新批准；
  不改需求的更新沿用原批准。
- 自动更新默认开启：社区目录的插件满 12 小时才会被自动安装，官方目录立即。

## 相关文档

- `docs/agents/issue-tracker.md`——工单后端与 `gh` / `glab` / `tea` 的约定。
- `docs/agents/triage-labels.md`——七个 triage 标签。
- `src/protocol/README.zh-CN.md`——面板与 worker 之间的请求名与返回形状。
