English | [简体中文](README.zh-CN.md)

# Documentation

## Language policy

- **Public documentation** is maintained in English and Simplified Chinese. The English file is the
  canonical path (`README.md`, `docs/development.md`, `GLOSSARY.md`, `src/*/README.md`); the Chinese
  translation sits next to it as `*.zh-CN.md`. Every pair starts with a language switcher, and a
  content change updates both files in the same pull request.
- **Agent operating docs** (`AGENTS.md`, `CLAUDE.md`, `docs/agents/*.md`) are English only, with no
  `*.zh-CN.md` twin: they configure the agent workflow and are not user documentation.
- **Skill bodies** (`skills/*/SKILL.md`) are English only: they are prompt content, not UI copy, and
  do not follow the panel language setting.
- **Panel UI** is localized at runtime through the `language` plugin setting (`auto` / `zh-CN` / `en`).
  Message catalogs live in `src/protocol/i18n.ts`; `src/panel/i18n-guard.test.ts` rejects Chinese
  literals in panel components.
- **Plugin manifest strings** (`orca-plugin.json` description and command titles) are English:
  Orca's manifest schema has no per-locale fields. Everything rendered inside the panel is localized.

## Guides

| Topic | English | 简体中文 |
| --- | --- | --- |
| Project overview and publishing | [README](../README.md) | [README](../README.zh-CN.md) |
| Development and release flow | [development.md](development.md) | [development.zh-CN.md](development.zh-CN.md) |
| Domain terms | [GLOSSARY](../GLOSSARY.md) | [GLOSSARY](../GLOSSARY.zh-CN.md) |
| Adapters | [src/adapters](../src/adapters/README.md) | [src/adapters](../src/adapters/README.zh-CN.md) |
| Core logic | [src/core](../src/core/README.md) | [src/core](../src/core/README.zh-CN.md) |
| Panel | [src/panel](../src/panel/README.md) | [src/panel](../src/panel/README.zh-CN.md) |
| Protocol | [src/protocol](../src/protocol/README.md) | [src/protocol](../src/protocol/README.zh-CN.md) |
| Snapshot library decision | [ADR 0001](adr/0001-directory-snapshot-library.md) | [ADR 0001](adr/0001-directory-snapshot-library.zh-CN.md) |
| Skills | [skills](../skills/README.md) | [skills](../skills/README.zh-CN.md) |

Agent operating docs (English only):

- [Issue tracker and spec workflow](agents/issue-tracker.md)
- [Triage labels](agents/triage-labels.md)
- [Domain docs](agents/domain.md)
