English | [简体中文](README.zh-CN.md)

# core

Pure business logic: the ticket model, remote parsing, backend selection, local Markdown parsing,
ticket details and change planning, metrics and pressure tiers, and the ordering and dependency rules
of the environment check.

- No IO: no file reads or writes, no network requests, no child processes;
- Production code depends only on itself; `import type` may reference pure types from `protocol`
  (for example `BackendKind`) without creating a runtime dependency (a convention, not a tool-enforced
  rule);
- Line, branch and function coverage target at least 80% (there is no CI enforcing it today).

Ticket details:

- `ticket.ts` defines the `TicketDetail` / `TicketComment` / `TicketPatch` model shared by adapters and
  the host. `parent` on `Ticket` is the parent reference, and `hierarchy` on `TrackerSnapshot` /
  `TrackerChanges` declares the hierarchy capability source (`native` / `convention` / `none`); both
  are used only for list organization and take no part in verdicts. Creators, comment authors and
  assignees in details are structured `TicketAuthor` values
  (login / display name / avatar URL); assignee patches on the write side remain login arrays.
- `author.ts` is the only entry point for remote users: `readAuthor` / `readAuthors` read fields by
  backend-specific names, treat a whole user as null when the login is empty (without dropping the
  row), and accept only absolute http(s) avatar URLs, completing instance-relative paths against the
  backend-provided base. Lists and details share these rules. `readLogins` uses the same tolerance
  but reads logins only, for the assignees in list snapshots (no display names or avatars).
- `snapshot-store.ts` is the entry model of the local snapshot store (format version 3): it keeps the
  signed-in user `viewer`, each ticket's assignee logins `assignees`, the snapshot-level `hierarchy`
  and the ticket-level `parent`. A version mismatch, a missing or mistyped field, or an invalid enum
  voids the whole entry and the host refetches everything, so an old cache without hierarchy fields
  is never taken as a complete tree.
- `ticket-detail.ts` only performs pure computation and field validation: set differences
  (`diffSets` / `resolveTargetSet` / `planSetChange` / `isEmptyDiff`) and detail-field readers shared
  by the three remote backends (`readRequiredString`, `readNameList`, `sortCommentsByTime`,
  `requireTicketNumber`, `invalidDetail`). "Assign to me" resolves the adapter's username and merges
  it into the target set as `self`.
- Completion candidates are normalized here too: `normalizeLabelColor` lowercases colors to
  `#rrggbb`, and `dedupeBy` removes duplicates by name while keeping first-seen order.
- `markdown.ts`'s `parseMarkdownDetail` splits a local ticket file into title, body and comment
  sections. `parseMarkdownTickets` also parses `Parent:` lines: it looks only before `## Comments`,
  takes the first number, and accepts only another ticket in the same feature; missing, self and
  cross-feature references count as no parent.
- `worktree.ts` derives worktree branch names, workspace names and comments (workspace name equals
  branch name), decides whether a ticket URL can be attached using Orca's URL routing table (a
  self-hosted Gitea / GitHub `/issues/<n>` is not attached and the link goes into the comment),
  builds the Orca CLI arguments, and parses its JSON output.
- `repository-scope.ts` parses `git worktree list --porcelain` and yields the repository scope (the
  main worktree root) and cache keys: managed backends group by repository, local Markdown is isolated
  by workspace.
- `orca-cli.ts` decides the Orca CLI candidate order and validates the `--version` output; on Linux a
  same-named screen reader is excluded.

## Metrics and pressure tiers (`metrics.ts`)

`computeMetrics` takes classified tickets, the snapshot time, totals, time-data availability and
thresholds, and returns metrics, three pressure dimensions and an attention list. Classification and
copy are separate: core returns tiers, triggering metrics and gap reasons (`light` / `normal` /
`tight`, `MetricGap`); Chinese copy lives in the UI's `overview-text.ts`, so changing copy never
changes the verdict.

Thresholds live in `PRESSURE_THRESHOLDS`; three rules:

| Dimension | What it looks at | Light | Tight |
| --- | --- | --- | --- |
| Size | Open backlog, net inflow over the last 30 days | backlog < 10 and net inflow ≤ 0 | backlog ≥ 30 or net inflow ≥ 6 |
| Blocking | Blocked tickets ÷ open tickets | < 15% | > 35% |
| Staleness | Stale rate, stalled tickets | stale rate < 20% and stalled ≤ 3 | stale rate > 40% or stalled ≥ 11 |

The overall tier is the heaviest of the three. **Initial calibration**: checked against this plugin's
own repository (20 tickets, 10 open, 20 opened and 10 closed in the last 30 days, net inflow +10).
A backlog of 10 was rated "normal" and net inflow +10 "tight"; the conclusion was that the first
draft was too strict for a just-created repository whose tickets all fall inside the window.
Thresholds are a first draft; later calibration only changes `PRESSURE_THRESHOLDS`, never the
classification logic or UI copy.

Data honesty: local Markdown file timestamps are not ticket timestamps (`timestamps: false`), so the
staleness dimension is marked "unavailable" (`tier: null`) and flow metrics are unavailable too. When
a backend gives no close time, closed metrics are marked `no-closed-time`; when a GitHub list query
cannot provide dependency edges, chain depth is marked `no-dependency-edges`. Unavailable metrics are
always `null` + `gap`, never 0. When the sample is truncated, closed metrics may be underestimated and
net inflow derived from closures may be overestimated; the UI labels both cases separately.

Blocking dependency edges use `Ticket.ref` instead of a bare number: a remote ref is `#15`, a local
Markdown ref is a relative path. Local numbers are unique only within one feature, so a bare number
cannot find a ticket across features and chain depth cannot be computed.
