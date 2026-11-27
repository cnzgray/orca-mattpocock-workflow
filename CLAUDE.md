# orca-mattpocock-workflow

## Issue tracker, triage labels and domain docs

### Issue tracker

Issues and specs live in GitHub Issues on `cnzgray/orca-mattpocock-workflow` (private repository); every operation goes through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The seven role labels keep their default names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, `bug`, `enhancement`), matching `TRACKER_LABELS` in `src/protocol/labels.ts`. See `docs/agents/triage-labels.md`.

### Domain docs

Single context: `GLOSSARY.zh-CN.md` at the repository root (the Chinese glossary for Chinese-speaking agents; `GLOSSARY.md` is the English style-guide version) plus `docs/adr/` for decision records. See `docs/agents/domain.md`.

## Branch model

Single trunk (trunk-based): `main` is the only long-lived branch — no `develop`, `release/*`, or `staging`. Development branches, including Orca worktree branches named `<bugfix|feat>/<ticket>[-<slug>]`, fork from `main`, stay short-lived, and are deleted once merged; merges into `main` are linear — rebase the branch and fast-forward, or squash the PR, never `--no-ff`; `pr/*` branches exist only to receive external PRs. Releases ride annotated `vX.Y.Z` tags on `main`, never release branches. See the release process in `docs/development.md`.
