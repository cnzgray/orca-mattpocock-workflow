# orca-mattpocock-workflow

## Issue tracker, triage labels and domain docs

### Issue tracker

Issues 与 spec 住在 `cnzgray/orca-mattpocock-workflow` 的 GitHub Issues（私有仓库），全部操作走 `gh` CLI。见 `docs/agents/issue-tracker.md`。

### Triage labels

七个角色的标签名沿用默认值（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`、`bug`、`enhancement`），与 `src/protocol/labels.ts` 的 `TRACKER_LABELS` 一致。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（single-context）：仓库根 `GLOSSARY.zh-CN.md`（中文代理用这份；英文写作规范版是 `GLOSSARY.md`）+ `docs/adr/`；`docs/adr/` 还不存在，按需生长。见 `docs/agents/domain.md`。
