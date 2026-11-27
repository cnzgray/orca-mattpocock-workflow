English | [简体中文](README.zh-CN.md)

# orca-mattpocock-workflow

An Orca plugin that runs the [mattpocock/skills](https://github.com/mattpocock/skills) workflow as a
ticket panel in the right sidebar.

Ticket triage rules, triage labels, prompt gestures and workflow help all live in this repository.
The interaction is designed around the capabilities Orca plugins actually expose.

## Views

- **List**: reads the tickets of the current workspace, classifies them as "ready / blocked / other
  open / closed", and supports status filters and multi-key sorting. Below the toolbar are two people
  toggles, "Assigned to me" and "Created by me", which combine with the status filter (both on means
  the union). The list switches between a **flat** layout (default) and a **tree** layout: the tree
  layout indents child tickets under their parent, and a parent row can collapse its whole subtree and
  shows its visible child count. When a parent is filtered out or not loaded yet, the child moves to
  the top level and shows a parent-reference badge. The tree layout uses native sub-issues on GitHub,
  work-item hierarchy on GitLab, the `Parent:` line in local Markdown, and the first-line `Part of
  #number` convention in Gitea (parsed from the list response without extra requests). Every ticket
  gets skill-action badges; "Copy prompt" puts gestures such as `/implement #40` on the clipboard.
  Clicking a ticket number copies that ticket's page URL on the code-hosting service (local Markdown
  has no remote link, so its number stays plain text); clicking the title still opens the detail. A
  remote ticket that can be started also gets a "Create worktree" action that creates an
  Orca-managed worktree in one click. The toolbar's "Row details" icon opens four row-display
  toggles — author, created time, updated time, assignees — with author and created time on by
  default. Assignees are plain remote logins (at most two, then `+N`). The time area no longer
  depends on the author, so local Markdown rows now show "Created X" by default; turn off "Created
  time" per repository to restore the old rows.
- **Overview**: pressure at a glance (size / blocking / staleness), key numbers, status and category
  composition, and the tickets to look at first.
- **Detail**: timeline, fields and native blocking relations for one ticket. The header can refresh
  manually: it re-reads the ticket and syncs the list snapshot without going back to the list. When
  blocked, the "Blocked N" badge expands into blocker rows with ref, title and state; opening one
  shows that ticket, and Back first returns to the blocked ticket before returning to the list.
  Backends without dependency edges keep the badge read-only.
- **Environment check**: checks the main directory, backend selection, Orca CLI, CLI install and
  login, repository reachability, workspace initialization, the local ticket directory and the skills
  the panel uses. Every failure comes with an executable remedy.
- **Workflow help**: intake and triage state machines, feature chain, bug chain, interview vs. diagram,
  and the review / PR flow after implementation.

## Capability boundaries and tradeoffs

Orca defines what a plugin may do. These are the choices this plugin makes inside those boundaries:

| Capability | What this plugin does | Why |
|---|---|---|
| Put a prompt into the current session | **Copy the prompt** | Orca plugins cannot write a session draft; the user pastes it |
| Put a prompt into a new session | Not provided | Orca's `agent.launch` starts terminal agents, which is not a session draft |
| Register runtime skills `/mattwf-feature`, `/mattwf-bug` | Skill files ship with the plugin and the environment check installs them | Orca plugins cannot contribute skills (`contributes.skills` is reserved) |
| Plugin-private HTTP routes | In-process panel ↔ worker bridge (`orca.plugin.request`) | The panel and worker belong to the same plugin; use the bridge directly |
| Cache directory under the host data root | `~/.orca-mattpocock-workflow/cache/` | Orca has no matching data root |
| Browser `localStorage` for view preferences | `orca.storage` | Plugin-private storage; filters, sorting, people toggles and row-display toggles are kept per repository |
| Host `subprocess` service | `node:child_process` inside the worker | The worker is a separate Node process |

"Create worktree" only goes through Orca's own CLI (`orca worktree create`), never a bare
`git worktree`. The branch name is derived from the ticket with the repository convention
(`feat/4-…` / `bugfix/1-…`), the ticket link is attached to the new worktree, and Orca switches to
the new workspace afterwards. If a workspace already exists on the same branch, the existing result
is returned and nothing is created twice. Self-hosted Gitea / GitHub `/issues/<n>` URLs have no
provider route Orca recognizes, so the plugin omits `--reference` and puts the ticket link into
`--comment`; the worktree is still created. `/pull/<n>`, `/pulls/<n>` and GitLab's
`/-/issues|merge_requests/<n>` stay attached.

Triage semantics are one set: ready / blocked / closed, triage labels (`needs-triage`, `wontfix`,
`ready-for-human` …), `Blocked by:` parsing and GitLab native blocking merged into the same model.

## How the workspace is resolved

Orca's right sidebar is global, so the panel has no "current session workspace" to read. The worker
tries, in order:

1. The workspace the user explicitly picked in the panel's candidate list. The pick is stored in the
   current focus context and in plugin-private storage, so it survives worker restarts and panel
   reloads; only a change of focus context invalidates it.
2. An exact match between the focused workspace's display name and the workspace name (ignoring case
   and surrounding whitespace), then a fallback to the repository name. Blank display names do not
   participate, and a display name equal to the branch name is not treated as a unique clue:
   unnamed workspaces fall back to their branch name, and `main` is shared by many workspaces.
3. A duplicate display name is narrowed by branch.
4. If names still collide, the working directory in the terminal title is read (`~/path/to/repo`
   works too); a unique hit wins.
5. If the workspace is still unknown, the panel lists candidates (project · name · branch · path,
   each with a "Use" action) and the user picks one. The same candidate list is pushed once; failures
   are not retried periodically, only when the focus context changes or the user refreshes.

The worker-side `workspace.readContext` carries a workspace id (the same id as `workspace.list`).
With an id, the worker claims the workspace by id and identifies the "current context" by id, so two
repositories' `main` branches never mix. Older hosts that do not provide an id fall back to the rules
above using display name + branch; in that case two workspaces with the same name and branch cannot be
distinguished, and an explicit pick is remembered at that granularity.

## Ticket backends

The backend is selected from the `origin` remote. All four share one set of triage rules and prompts:

- `github.com` → GitHub (`gh`)
- `gitlab.com`, or a self-hosted instance where `glab` is logged in → GitLab (`glab`), nested groups
  supported
- A self-hosted Gitea instance where `tea` is logged in → Gitea (`tea`)
- Everything else → local Markdown (`.scratch/<feature>/issues/*.md`)

Remote backends include each ticket's assignee logins and the signed-in user in the list snapshot:
GitHub fetches `viewer.login` and `assignees[].login` in the same GraphQL query; GitLab / Gitea list
responses already carry assignees, plus one separate identity lookup. Local Markdown has no creators
or assignees, so the people-filter row is not shown.

The local snapshot store (`~/.orca-mattpocock-workflow/cache/`) keeps one directory per cache key:
each write stores the signed-in user and each ticket's assignees, committing in the order
"ticket files → change log → meta". Its format version is now 4; entries of older versions are
treated as no cache, so the first open after upgrading does one full refetch. When the identity
lookup fails transiently, the last known identity for the same repository is kept, so one hiccup
does not make the people-filter row disappear.

Remote backends also include each ticket's page URL in the list snapshot: GitHub takes the GraphQL
`url`, GitLab takes `web_url`, and Gitea takes `html_url`. The backend supplies it verbatim so the
panel never assembles addresses itself (self-hosted instances under a subpath stay correct). Clicking
a ticket number in the list copies that URL; clicking the title still opens the detail. Local Markdown
has no remote link, so its number stays plain text and behaves as before. Old cached tickets without
the link field are treated as having no link and fill in after a refresh.

Parent-child relations are taken according to backend capability and are used only for list layout;
they do not change verdicts, statistics or write operations:

| Backend | Source | Notes |
|---|---|---|
| GitHub | Native sub-issues | The list query also fetches parents; cross-repository parents keep `owner/name#number` and are never matched to a same-numbered ticket |
| GitLab | Work-item hierarchy | Tasks under an issue use `#iid`; epics keep only an `&iid` reference and get no epic row; if the hierarchy query fails the tree layout is disabled and a refresh retries |
| Gitea | First-line `Part of` convention | No native child tickets; `/to-tickets` puts `Part of #number` on the first non-empty line of each ticket, parsed from the list response with no extra request; malformed lines count as no parent |
| Local Markdown | `Parent:` convention | Only tickets in the same feature; see below |

Gitea reads only a standalone `Part of #<spec>` on the first non-empty line: a line elsewhere,
quote/heading prefixes or extra text, a cross-repository reference or a self-reference counts as no
parent. The task list in the spec body is not parsed, and `Blocked by:` lines stay independent, so
blocking never becomes a parent. The capability is `convention`.

The front matter of a local Markdown ticket body (before `## Comments`) supports these lines:

```
Status: ready-for-agent
Blocked by: 01, 03
Parent: 01
```

`Parent:` takes the first number and points to another ticket in the same feature directory; a
pointer to a missing ticket, to itself or across features counts as no parent. A `Parent:` inside a
comment does not change the hierarchy. Incremental refreshes also read the parent files referenced
by changed tickets, so changing only a child file never loses its parent.

## Development and publishing

Development loads the plugin through an Orca development folder; publishing distributes it as a Git
tree. Both use the same build, but the publish tree must contain the built artifacts.

### Development

Load the development plugin with the Orca CLI:

```bash
pnpm install      # builds once
pnpm typecheck
pnpm test
pnpm build        # artifacts: dist/worker/main.mjs, dist/panel/panel.{html,js,css}

orca plugin dev load .    # prints an approval fingerprint; rerun with the --approve command it prints
orca plugin dev watch .   # streams logs and reloads; --shot ./shots --shot-panel tickets saves panel shots
```

After changing `src/`, run `pnpm build` before `orca plugin dev reload`; the worker runs the
artifacts in `dist/`. If you add or rename an RPC handler and `reload` still reports
`unknown_method: no panel handler named …`, the old worker is still running: force a new one with
`orca plugin dev unload . && orca plugin dev load .`. The full development flow — approval
fingerprints, debugging worker requests, emitting events, logs and screenshots — is in
[docs/development.md](docs/development.md).

Only four files under `dist/` are committed: the worker entry, the panel page, the panel script and
the panel theme styles. Source maps are generated locally and are not committed. Cloning the
repository and running `pnpm install` builds once; you do not need to commit artifacts during
development.

To install it as a regular local plugin (instead of dev load), use a folder install:

```bash
pnpm build && pnpm run pack:plugin        # produces .orca/plugin-package
orca plugin dev unload .
orca plugin install .orca/plugin-package   # the first time, rerun with --approve <fingerprint> as prompted
```

The repository root cannot be installed directly — the symlinks in `node_modules` are rejected; see
[docs/development.md](docs/development.md#installing-as-a-regular-local-plugin) for details and
updates.

### Publishing

The publish tree is the set of files in the commit a version tag points at. Orca installs only from a
Git tree: npm registry and Release attachments are not channels. Pasting an address such as
`…/releases/download/…` into `orca plugin install` does not fail; it resolves to the default branch
and installs a source tree with no artifacts.

The publish tree must satisfy:

- The four build artifacts are committed: `dist/worker/main.mjs`, `dist/panel/panel.html`,
  `dist/panel/panel.js` and `dist/panel/theme.css`; generate them with `pnpm build:release`; source
  maps are not committed;
- The repository root contains no symlinks, submodules or unknown entries (Orca's content validation
  rejects them);
- `LICENSE` and the manifest's `license` field agree;
- The manifest `version` matches the annotated `vX.Y.Z` tag;
- `main` is the default branch: versionless installs read this commit;
- The repository is public and carries the `orca-plugin` topic (the catalog condition; a private
  repository can only be installed by Git URL).

Tag the release commit with an annotated tag, then run the single gate. The check targets `HEAD`, so a
missing tag fails immediately:

```bash
git tag -a v0.6.2 -m v0.6.2
pnpm release:check
```

It exports the publish tree from the current commit, runs Orca's own offline validator, rebuilds and
compares the four artifacts, checks the version tag, license, topic and repository visibility, and
prints an entry ready to paste into a catalog file. It needs the local Orca CLI; `gh` is only used to
read the topic and visibility and degrades to a warning when unavailable.

Push the commit and tag after it passes:

```bash
git push origin HEAD v0.6.2
```

Users install a pinned version:

```bash
orca plugin install cnzgray/orca-mattpocock-workflow@v0.6.2
```

The first install requires one approval; the approval page lists capabilities and contributions.
Adding capabilities, commands, panels or event subscriptions, or raising the execution tier, triggers
a new approval. Listing status:
`https://www.onorca.dev/plugins/cnzgray/orca-mattpocock-workflow`.

## Languages

- The panel follows the `language` plugin setting (`auto` / `zh-CN` / `en`); `auto` follows Orca's
  locale. Message catalogs live in `src/protocol/i18n.ts`.
- Public documentation is maintained in English and Simplified Chinese (`*.zh-CN.md`). Agent
  operating docs (`AGENTS.md`, `CLAUDE.md`, `docs/agents/`) and skill prompts stay in Simplified
  Chinese because they configure this repository's Chinese-language agent workflow.
- Orca's manifest schema has no per-locale fields, so the manifest description and command titles are
  English; everything rendered inside the panel is localized. The documentation index and language
  policy are in [docs/README.md](docs/README.md).

## Skill command style

Copied skill gestures follow the style of the client they are pasted into. Clients disagree on the
gesture, and a wrong one means the skill never loads (skills with `disable-model-invocation` can
only be invoked explicitly by the user):

| Client      | Gesture          | Example               |
| ----------- | ---------------- | --------------------- |
| Claude Code | `/skill-name`    | `/implement #40`      |
| omp         | `/skill:skill-name` | `/skill:implement #40` |
| Codex       | `$skill-name`    | `$implement #40`      |

The style is decided in this order:

1. The `skillCommand` plugin setting (`auto` / `claude` / `omp` / `codex`), picked in Orca's
   settings. A concrete choice wins; `auto` falls through.
2. Automatic detection: the agents running in Orca's focused workspace. `omp` / `pi` count as omp,
   `codex` as codex, `claude` / `openclaude` / `opencode` / `grok` and friends as Claude Code.
   Unknown agent kinds do not vote, and two styles running at once count as ambiguous. Detection
   needs the `agent:read` capability, so the plugin asks for approval once after an update.
3. The style detected last time (kept in the plugin's private storage): used when no agent is open.
4. The default Claude Code style, matching the upstream matt skills, so existing users see no
   change.

Detection happens at copy time: start another client and the gesture follows, without reopening the
panel.

## Known limitations

- Prompts can only be copied, not written into a session: Orca plugins have no session draft API.
- The upstream matt skills (`mattpocock/skills`) hardcode `/command` gestures in their own bodies.
  The plugin only owns the gestures it produces; changing the upstream bodies is a change in that
  repository.
- Intake skills (`mattwf-feature`, `mattwf-bug`) are written into agent skill directories by the
  environment check's install action; the plugin cannot register runtime skills itself.
- Backend CLIs (`gh` / `glab` / `tea`) are invoked directly inside the worker process using the
  user's PATH, without Orca's own CLI resolution and WSL fallback.

## License

MIT
