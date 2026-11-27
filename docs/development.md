English | [简体中文](development.zh-CN.md)

# Development

Load this repository as an Orca development plugin with the Orca CLI and iterate live. Run every
command from the repository root.

## Setup

```bash
pnpm install      # runs one build automatically
pnpm typecheck
pnpm test
pnpm build        # artifacts: dist/worker/main.mjs, dist/panel/panel.{html,js,css}
```

The manifest (`orca-plugin.json`) points at artifacts under `dist/`; four of those files are
committed and source maps are not. **After changing `src/`, run `pnpm build` first, otherwise the
worker still runs the old code** — this is the easiest trap: `orca plugin dev reload` restarts the
worker, not the build.

The Orca CLI and the desktop app must be the same version (`orca --version` has the same origin as
the in-app version). A local install puts the CLI at
`/Applications/Orca.app/Contents/Resources/bin/orca`.

## Loading and approval

```bash
orca plugin validate .          # offline manifest validation; never runs plugin code; exit 0/1/2/3
orca plugin dev load .          # load as a development plugin
```

The plugin runs code and asks for workspace read/write access, so the first load is blocked and the
command prints the grant list and a fingerprint:

```
local.mattpocock-workflow 0.1.0 needs approval before it can run.
Approving MattWorkflow (…) grants:
- Runs its own code in a separate Node.js process …
Fingerprint: ap1-014bde73684c890b2bbec2b2ac55dd75
Next step: To approve, run: orca plugin dev load . --approve ap1-014bde73684c890b2bbec2b2ac55dd75
```

Rerun the command with the `--approve` flag it printed:

```bash
orca plugin dev load . --approve ap1-014bde73684c890b2bbec2b2ac55dd75
```

Exit codes: `0` success, `1` error, `2` invalid plugin, `3` approval required (or stale
fingerprint). The fingerprint is bound to this plugin, version, file set and access combination.
Later code edits do not ask again; new permissions or changed commands do.

After approval the plugin key is `local.mattpocock-workflow`; the commands below use it.

## Daily loop

```bash
orca plugin dev watch .          # load + stream logs and reloads; Ctrl-C exits
```

`watch` is the most useful command while developing: it loads the folder, prints every panel and
worker log line, reloads after each file change, and reports status changes (errored / invalid carry
the error). `Ctrl-C` unloads the development folder (if it was already loaded, it stays loaded). Add
`--check` to run `orca plugin check` after every load and reload; add
`--shot <directory> --shot-panel tickets` to save one panel PNG after every reload.

When you do not want to keep a watcher running, reload manually:

```bash
pnpm build                     # build first
orca plugin dev reload .      # then reload (also catches missed file changes)
```

Changing a command or shortcut requires a new approval; `reload` prints the new fingerprint.

## Looking at the panel

```bash
orca plugin open local.mattpocock-workflow --panel tickets   # open in the right sidebar
orca plugin shot local.mattpocock-workflow --panel tickets --out shots/tickets.png
orca plugin dev inspect local.mattpocock-workflow            # panel DevTools (desktop app only)
orca plugin logs local.mattpocock-workflow                  # recent worker log lines
orca plugin list --json                                      # status of every plugin; dev folders have isDev
```

The panel runs in an iframe with no network permission (`img-src data:`): remote avatar URLs cannot
be handed to `<img>` directly. A log line such as
`blocked img-src https://avatars.githubusercontent.com` means some code bypassed the worker proxy.
Avatars always go through `avatar.read`: the worker downloads the image, turns it into a data URL,
and the panel renders that.

## Language

The globe icon in the panel's top-right opens a single-choice menu that writes the `language` plugin
setting (`auto` / `zh-CN` / `en`) and takes effect immediately. The entry is an icon rather than a
native dropdown so it always takes one glyph of width and never competes with the view tabs in a
narrow sidebar. `auto` follows Orca's UI locale (`orca.locale`); `zh*` resolves to
Chinese, `en*` to English, and everything else to Chinese. The same setting is available in Orca's
Settings → Plugins; the panel subscribes to setting changes, so no reload is needed.

Messages are maintained only in the two catalogs in `src/protocol/i18n.ts`; a Chinese literal under
`src/panel/*` is caught by `src/panel/i18n-guard.test.ts`. Skill bodies always use the `zh-CN`
catalog; content under `skills/` does not follow the UI language.

## Calling the worker

Panel requests go through `orca.plugin.request(name, input)` and land in the worker handler
registered with `orca.panels.handle(name, …)`. The CLI can bypass the panel:

```bash
orca plugin dev request . snapshot.get --data '{}' --json
orca plugin dev request . workspace.current --data '{}' --json
```

Names come from `RPC_METHODS` in `src/protocol/tracker.ts`, plus three panel-only handlers:
`workspace.current`, `workspace.open` and `skills.install`. `--data` is the input JSON; when omitted
the handler receives `null`. `--panel` sets the calling panel id (default `orca-cli`);
`--timeout-ms` bounds the wait.

An installed (non-development) plugin refuses these calls; to use `dev request`, load the folder as
a development plugin.

After adding or renaming a handler under `src/`, run `pnpm build` before
`orca plugin dev reload`: the worker registers handlers only on restart, otherwise you get
`unknown_method: no panel handler named …`. If the same error survives `reload`, the host reused the
old worker: `orca plugin dev unload . && orca plugin dev load .` forces a new one.

## Emitting events

The worker and the panel both subscribe to `workspace.changed`; emit one manually:

```bash
orca plugin dev emit . workspace.changed --data '{"context":{"branch":"main","displayName":"demo","terminals":[]}}' --json
```

The payload is validated against the host schema and rejected when invalid. The
`workspace.changed` payload is
`{ context: { workspaceId?, branch, displayName, terminals: [{ id, title? }] } }`; `branch` and
`displayName` are required and `workspaceId` is optional. The `delivered` field in the output says
whether the worker and how many open panels received it.

## Types

```bash
orca plugin types .             # writes .orca/types/orca/*.d.ts and tsconfig.json
```

`.orca/` is in `.gitignore`, and `orca plugin dev load` refreshes it automatically for TypeScript
plugins. This repository does not point `tsconfig.json` at those types: `src/worker/orca-types.ts`
is a small hand-written interface set that covers only the host APIs it uses, which is a smaller
surface to maintain than following the full typings.

## Installing as a regular local plugin

A dev plugin is only good for edit-and-look; to keep it resident in Orca like a normal plugin, use a
folder install:

```bash
pnpm build                     # dist/ holds the artifacts the manifest points to
pnpm run pack:plugin           # produces .orca/plugin-package (a copy of the runtime files)
orca plugin dev unload .       # unload the dev plugin with the same key first, or the keys collide
orca plugin install .orca/plugin-package
```

The first install prints the grant list and a fingerprint; rerun the `--approve` command it gives.
Once installed, the key is `local.mattpocock-workflow`, its source is the `.orca/plugin-package`
folder, and `orca plugin list` no longer marks it `isDev`.

Do not run `orca plugin install .` directly: a folder install copies the whole directory,
skipping only the root `.git`, and pnpm's symlinks in `node_modules` make the install fail
(`symlink not allowed in plugin content`). `.orca/plugin-package` contains only `orca-plugin.json`,
`README.md`, `dist/` and `skills/`, and the directory is already in `.gitignore`.

Daily updates:

```bash
pnpm build && pnpm run pack:plugin
orca plugin update local.mattpocock-workflow
```

A folder-install update copies the directory again; new permissions, commands, panels or a version
change may require re-approval, and the command prints the new fingerprint. Plugin-private data lives
under `~/Library/Application Support/orca/plugins-data/`, keyed by plugin key.

## Cleanup

```bash
orca plugin dev unload .        # remove the development folder
```

Unloading needs no approval; an installed plugin with the same key comes back and asks for approval
again according to its own permissions.

## Branches and merging

`main` is trunk. Fork a short-lived `<bugfix|feat>/<ticket>[-<slug>]` branch and land it linearly:

```bash
git switch main && git pull --ff-only
git switch bugfix/12-gitlab
git rebase main
git switch main && git merge --ff-only bugfix/12-gitlab
git branch -d bugfix/12-gitlab
```

A merge commit (`git merge --no-ff`, or GitHub's "Create a merge commit") is not used: it splits
`main` into two lines, so `git log --oneline`, `git bisect` and commit counts stop matching the
release sequence. The local configuration sets `merge.ff=only` and `pull.rebase=true`; PRs are
squash- or rebase-merged on GitHub.

## Publishing

Loading a development folder is not a distribution format. Publishing goes through a Git tree: the
catalog and `orca plugin install` see the files in the commit a version tag points at, so build
artifacts must be committed. npm registry and Release attachments are not Orca plugin channels;
pasting `…/releases/download/…` into the install command silently resolves to the default branch and
installs a source tree with no artifacts.

### Release flow

1. Build and confirm the tests pass:

   ```bash
   pnpm typecheck && pnpm test && pnpm build:release
   ```

2. Commit the source and the four artifacts (source maps are excluded by `.gitignore`):

   ```text
   dist/worker/main.mjs
   dist/panel/panel.html
   dist/panel/panel.js
   dist/panel/theme.css
   ```

   Set the manifest `version` to this release (`X.Y.Z`) and confirm `LICENSE` matches the `license`
   field.

3. Tag the release commit with an annotated tag:

   ```bash
   git tag -a vX.Y.Z -m vX.Y.Z
   ```

4. Run the single release gate:

   ```bash
   pnpm release:check
   ```

   The check targets HEAD: uncommitted changes are not included, and a missing version tag fails
   immediately. It exports the publish tree from HEAD, runs `orca plugin validate` offline, rebuilds
   and compares the four artifacts in the tree, checks the version tag, license and topic, and prints
   an entry ready to paste into a catalog file. It needs the local Orca CLI; `gh` is only used to read
   the topic and visibility.

5. Push the commit and tag after it passes:

   ```bash
   git push origin HEAD vX.Y.Z
   ```

6. Add the topic after the repository is public:

   ```bash
   gh repo edit cnzgray/orca-mattpocock-workflow --add-topic orca-plugin
   ```

7. Check the listing status at
   `https://www.onorca.dev/plugins/cnzgray/orca-mattpocock-workflow`. Listings usually appear within
   an hour; the status page states the exact reason when a plugin is not listed. The community
   catalog is generated automatically by machine checks; the official catalog needs manual review by
   the Orca team and this repository does not submit to it.

Users install a pinned version:

```bash
orca plugin install cnzgray/orca-mattpocock-workflow@vX.Y.Z
```

### Publish-tree rules

- Only the four build artifacts are committed; source maps are not.
- The repository root must not contain symlinks, submodules or unknown entries (Orca's content
  validation rejects them).
- `LICENSE` and the manifest `license` agree; `manifestVersion` is 2; `version` is `X.Y.Z`.
- The tag is annotated and points at HEAD.
- `main` is the default branch: versionless installs read the same commit; pinned installs use the tag.
- The repository is public and carries the `orca-plugin` topic; a private repository can only be
  installed by Git URL and is never listed.

This repository is public (since `v0.1.0`), so the community catalog lists it automatically under the
conditions above.

### Common rejection reasons

| Symptom | Cause | Fix |
|---|---|---|
| `worker entry dist/worker/main.mjs: ENOENT` | Build artifacts are not committed | Commit the four `dist/` files |
| `plugin Git trees cannot contain symlinks, submodules or unknown entries` | The repository root has a symlink or submodule | Replace it with a real file or remove it |
| Manifest is not v2 | Outdated `manifestVersion` | Migrate to the current manifest format |
| No detectable license | Missing `LICENSE`, missing manifest `license`, or unrecognized content | Add an MIT `LICENSE` and the `license` field |
| Not listed in the catalog | No `vX.Y.Z` tag, private repository, fork/archive, missing topic, owner impersonates a reserved name | Fix the matching condition |
| Install gets a source tree with no artifacts | A Release attachment URL was used | Use `owner/repo@vX.Y.Z` |
| `approval_required` | New capabilities, commands, panels or event subscriptions, or a higher execution tier | Approve again as prompted |
| Binary file rejected | TTF/OTF fonts are not allowed; images and WOFF/WOFF2 are | Remove the disallowed font files |

### Release-notes template

Name the new capabilities, commands, panels and event subscriptions in the release notes so users
know what they will be asked to approve:

```markdown
## vX.Y.Z

New capabilities: …
New commands: …
New panels: …
New event subscriptions: …

Fixes / changes:
- …

Install: orca plugin install cnzgray/orca-mattpocock-workflow@vX.Y.Z
```

### Updates and approval

- The first install of a `trusted-worker` plugin must be approved; the approval page lists
  capabilities and contributions.
- An update that adds capabilities, raises the execution tier, adds commands / panels / shortcuts /
  event subscriptions, or changes the repository triggers a new approval. Updates that do not change
  requirements keep the existing approval.
- Auto-update is on by default: community-catalog plugins are auto-installed after 12 hours; official
  catalog plugins install immediately.

## Related docs

- `docs/agents/issue-tracker.md` — ticket backends and the `gh` / `glab` / `tea` conventions.
- `docs/agents/triage-labels.md` — the seven triage labels.
- `src/protocol/README.md` — request names and return shapes between the panel and the worker.
