# Domain docs

Before exploring this repository's code, read the domain docs by these rules.

## Read before starting

- **`GLOSSARY.zh-CN.md`** at the repository root (the Chinese glossary, used by Chinese-speaking agents; `GLOSSARY.md` is the canonical English version; single-context layout, so there is no `GLOSSARY-MAP.md`);
- The ADRs in **`docs/adr/`** that touch your area. Currently only `0001-directory-snapshot-library.md` (Chinese: `0001-directory-snapshot-library.zh-CN.md`; directory layout, commit ordering and rollback semantics). With no relevant ADR, skip quietly: do not announce the gap and do not propose writing one. ADRs grow only when genuinely needed — when a decision first gets recorded.

## File layout

This repository is single-context:

```
/
├── GLOSSARY.md            ← domain glossary (canonical English)
├── GLOSSARY.zh-CN.md      ← domain glossary (Chinese)
├── docs/README.md         ← documentation index and language policy (Chinese: README.zh-CN.md)
├── docs/adr/              ← architecture decision records, numbered from 0001-*.md
├── docs/agents/           ← agent-facing conventions (this file lives here)
├── docs/development.md    ← loading the dev plugin from the Orca CLI (canonical English)
├── docs/development.zh-CN.md ← the same flow in Chinese
├── src/                   ← adapters / core / panel / protocol / worker
└── skills/                ← pool-entry skills shipped with the plugin
```

`pnpm-workspace.yaml` is only pnpm 10's build allowlist (`allowBuilds`), not a multi-package workspace; there is no `packages/*` and no `workspaces` field, so no per-context glossary split exists.

## Use the glossary's vocabulary

When output mentions a domain concept (issue title, refactor proposal, hypothesis, test name), use the word `GLOSSARY.zh-CN.md` defines when writing Chinese, and `GLOSSARY.md` when writing English. Do not drift to synonyms the glossary explicitly avoids.

Fixed words this repository already has: **ticket** (the one word for issue/ticket), **intake** (turning a raw description into a ticket), **verdict** (the skill action derived from labels), **ready / blocked / closed** (three of the list's four groups), **prompt gesture** (a gesture like `/implement #40` written to the clipboard). They are already scattered through the README and `src/protocol`; keep using them in new docs.

A concept you need that the glossary lacks is a signal: either you are inventing language this project does not use (reconsider), or there genuinely is a gap (note it, and fill it once the gap is resolved).

## Surface ADR conflicts

When output contradicts an existing ADR, state it plainly instead of quietly overriding it:

> _Conflicts with ADR-0007 (local Markdown as the default backend), but worth reopening because…_
