English | [简体中文](README.zh-CN.md)

# protocol

Message types and constants exchanged by the worker and the panel.

- Types and constants only; no logic.
- `i18n.ts` is the message catalog shared by the panel and worker (`zh-CN` / `en`, keys one-to-one).
  Language resolution and interpolation live in `src/panel/i18n.ts`.
- No dependency on any other directory (a convention, not a tool-enforced rule).
- The panel may talk to the worker only through the types defined here; it must not import `core`,
  `adapters` or `worker` directly.

RPC methods (the panel calls `orca.plugin.request(method, params)`; the worker answers with a
same-named handler):

- `snapshot.get` / `snapshot.refresh` / `snapshot.resolveBlockers`: list snapshots and blocker
  completion.
- `snapshot.loadMore`: fetches the next slice by the snapshot cursor and appends it to the loaded
  list; the parameter is `{ workspaceRoot }`. Backends that fetch everything at once return the
  current snapshot unchanged.
- `snapshot.cache`: reads or clears the local snapshot store (cache is keyed by repository; multiple
  worktrees of one repository share it).
- `env.check`: environment check.
- `ticket.get`: reads one ticket detail; the parameter is `{ workspaceRoot, ref, number }`.
- `ticket.update`: submits one change patch; parameters are the detail parameters plus `patch`, and
  success returns `{ applied: true }`.
- `ticket.options`: reads repository labels and assignable users; the parameter is `{ workspaceRoot }`
  and the result is `TicketOptions`.
- `ticket.delete`: permanently deletes one ticket; parameters are the detail parameters plus
  `confirm: 'delete'`, and success returns `{ deleted: true }`.
- `ticket.worktree`: creates an Orca-managed worktree for a remote ticket; the parameter is
  `{ workspaceRoot, ref, number }` and the result carries the worktree id, absolute path, branch
  name, display name, ticket link and `created` (false when a workspace already exists on the same
  branch). The link comes from the backend detail; when Orca does not recognize it, the link is not
  attached and only goes into the comment, while the panel still shows the original link.
- `avatar.read`: reads an http(s) avatar URL supplied by a backend into `data:image/…`. The panel
  frame's CSP allows only `data:` images, so remote URLs are blocked by the host; the worker proxies
  the download, accepting only `image/*` with a 1 MiB cap.

The worker resolves `workspaceRoot` itself: the panel never sends a path. When the worker cannot
claim a workspace it pushes candidates once through the `workspace.candidates` event (with the owning
focus-context key, so the panel can tell whether a pick is still valid). After the user picks, the
panel sends the candidate's `path` on later requests, and the worker stores it in the current focus
context; subsequent requests and refresh commands that omit `workspaceRoot` reuse it.

`workspaceRoot` is the command execution location (git / gh / glab / tea all run under it). The host
turns it into the **repository scope** for cache identity (the repository's main worktree root):
multiple worktrees of one repository share one snapshot-store entry, one in-memory snapshot, one
incremental chain and one backend probe. Local Markdown is the exception: its "repository" is the
current workspace's `.scratch/`, so its cache is isolated per workspace. The protocol shape does not
change; the panel still sends only `workspaceRoot`.

Detail-related error codes are `ticket-not-found` (the number does not exist or was deleted) and
`capability-unsupported` (the current backend does not provide the requested detail, completion
candidates, write / delete capability or remote link). Worktree has two more error codes:
`orca-missing` (the Orca CLI cannot be found; an environment problem) and `worktree-create-failed`
(creation failed; the message carries CLI diagnostics, and Orca rejecting the ticket link is
translated into a Chinese explanation). Deleting without permission returns `fetch-failed` with the
required role in the message. The UI maps error codes to one set of copy.

Creators, comment authors and assignees in details are `TicketAuthor` (login / display name / avatar
URL), the same shape as the list snapshot's creator; local Markdown has null creators and comment
authors and an empty assignee array.

## Snapshot payload

`snapshot.get`, `snapshot.refresh`, `snapshot.loadMore` and `snapshot.resolveBlockers` all return the
same `WorkspaceSnapshot`:

- Ticket level: verdict (`status`, `category`), close time (`closedAt`, only when available),
  blocking references (`blockedBy`, only when available; GitHub list queries have no dependency
  edges), assignee logins (`assignees`, an empty array when unassigned) and the parent reference
  (`parent`, only when available; a cross-repository parent is `owner/name#number`, a GitLab epic is
  `&iid`).
- Snapshot level: repository identity, backend, instance host, fetch time, loaded and total counts,
  whether blockers are final, the signed-in user (`viewer`, null when it cannot be identified; the
  people filter relies on it to know who "me" is), and the hierarchy capability source (`hierarchy`:
  `native` / `convention` / `none`). With `none` the panel disables the tree layout and explains why,
  while the flat layout works as usual; parent-child relations take no part in verdicts, statistics
  or metrics.
- Paging: `hasMore` is true when the backend still has unloaded tickets, and the UI exposes "Load
  more" accordingly. Cursors stay inside the host (the snapshot-store entry's `nextCursor`) and are
  never exposed to the panel; backends that fetch everything at once always return `hasMore: false`.
- Metrics level: `metrics`, with the three pressure dimensions (`PressureDimension` /
  `PressureTier`), key numbers, sample coverage (`coverage`) and the attention list (`attention`).
  `MetricValue` uses `value: null` + `gap` for metrics a backend cannot provide; when a dimension has
  insufficient data, `PressureDimensionReport.tier` is `null`, and the overall tier merges only the
  dimensions that can be classified.

The host computes metrics once when the list arrives and recomputes them after blocker completion;
the UI only renders them and never reclassifies. Thresholds and classification rules live in core.

`snapshot-test-support.ts` is only a test fixture (an all-zero metrics payload) and is never imported
by production code. It sits with the message types so host and client tests share the same defaults.
