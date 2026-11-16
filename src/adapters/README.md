English | [简体中文](README.zh-CN.md)

# adapters

Adapters for external systems, one subdirectory per backend:

- `github/`: reads issues from `github.com` repositories through `git` and `gh`.
- `gitlab/`: reads GitLab issues through `git` and `glab`. When a list carries
  `blocking_issues_count`, native blocking is considered supported directly; native blocking counts
  are read during the `resolveBlockers` completion phase. Otherwise the adapter probes once per
  instance host and, when supported, fetches blocking counts with one batch GraphQL query; on failure
  or an empty array it falls back to `Blocked by:` lines. Requires `glab` >= 1.126; earlier versions
  are untested.
- `gitea/`: reads Gitea issues and native issue dependencies through `git` and `tea` (read-only
  `tea api --include`); falls back to `Blocked by:` lines when the dependency feature is off. When
  the host selects the backend it probes `tea logins list --output json`.
- `markdown/`: reads local tickets from `.scratch/<feature>/issues/*.md` in the workspace; `env.ts`
  lets the environment check confirm that the ticket directory and files can be parsed.
- `fs/`: filesystem capabilities for the environment check (resolving the user's home directory,
  testing whether a file exists) and the local snapshot store
  (`~/.orca-mattpocock-workflow/cache`, falling back to the system temporary directory when the home
  directory is not writable).
- `env.ts` in `github/`, `gitlab/` and `gitea/`: CLI probes for the environment check (is the CLI
  installed, is it logged in, is the repository reachable). Gitea's login list and repository access
  reuse the ticket backend's calls and parsers.

Each backend's `tracker.ts` implements the list contract, `detail.ts` implements optional detail and
mutation capabilities, and `options.ts` / `delete.ts` implement completion candidates and deletion.
They share repository detection, command execution and error mapping in `shared.ts`:

| Backend | Detail body | Comments | Link URL | Label write | Assignee write | Status write | Completion candidates | Delete |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub | Yes | GraphQL (comments page by `hasNextPage`, 100 per page) | Yes | Yes | Yes | Yes | `gh label list`; `gh api .../assignees --paginate --slurp` | `gh issue delete --yes`; `viewerPermission` is `ADMIN` |
| GitLab | Yes | notes API (system notes skipped) | Yes | Yes | Yes (full replacement; prefix `!` to clear) | Yes | labels and members/all paging (only active members kept) | `glab api --method DELETE`; Owner (access_level ≥ 50) or instance admin |
| Gitea | Yes | comments API | Yes | Yes | Yes (`--set-assignees`) | Yes | labels paging (50 per page) and assignees | `tea api --method DELETE`; `permissions.admin` |
| Local Markdown | Yes (file body) | `## Comments` sections split by blank lines | No | No | No | No | No | No (never rewrites files the user wrote) |

- List pagination: GitHub fetches one page at a time (GraphQL `first` is capped at 100) and returns
  `nextCursor`; the host appends by cursor with `snapshot.loadMore`. GitLab, Gitea and local Markdown
  fetch everything at once and have no `nextCursor`. Incremental refreshes keep the appended window
  and cursor (the merged result is not trimmed); only a full refresh, or an old cache that loaded
  only part of the list without a cursor, goes back to the first page.
- People in the list: every ticket carries assignee logins (`assignees`), and the snapshot carries the
  signed-in user (`viewer`). GitHub fetches `viewer.login` and `assignees(first: 10)` in the same
  GraphQL query; GitLab / Gitea list responses already carry assignees, plus one `glab api user` /
  `tea api /user` identity lookup sent in parallel with the list. A failed identity lookup only makes
  `viewer` null and does not affect the list; local Markdown has a null `viewer` and empty assignee
  arrays. Assignees are stored as logins only; display names and avatars are not read.
- Each backend declares its hierarchy capability explicitly: GitHub fetches `parent` with the list
  query (`#number` in the same repository, `owner/name#number` across repositories); GitLab queries
  the work-item hierarchy after the list returns, in batches of 100 iids (issue / task parents stored
  as `#iid`, epics as `&iid`; a failure only downgrades the capability and does not affect the list);
  local Markdown parses `Parent:` lines within the same feature; Gitea declares none. The shared
  contract suite asserts that the declared capability and parent references agree, and a backend that
  declares none must not emit `parent`.
- Details are requested only when a detail is opened and never enter the list snapshot. Creators,
  comment authors and assignees are structured users (login / display name / avatar URL), with the
  same shape and source as the list creator: GitHub's `author.login` + `avatarUrl`, GitLab's
  `username` + `avatar_url`, Gitea's `login` + `avatar_url` (relative paths completed against the
  instance base). Local Markdown has no remote users: creator and comment authors are null and
  assignees are an empty array. GitHub details go entirely through GraphQL and fetch avatars for the
  creator, assignees and comment authors in one request; current values before a change are also read
  only once.
- Before returning a GitLab detail, uploaded attachments in the body and comments are inlined as
  `data:image/`: only relative `/uploads/<secret>/<filename>` URLs of the current project and
  same-origin absolute URLs with the same project path are recognized, and the raw bytes are fetched
  with the signed-in `glab api projects/<id>/uploads/<secret>/<filename>`. If fetching fails, the file
  is not a raster image or it exceeds the size limit, it degrades to a plain link to the original
  GitLab URL. The token stays inside the `glab` process and never enters protocol fields.
- Completion candidates lowercase label colors to `#rrggbb` and keep only the first occurrence of a
  duplicate label name or username.
- The host checks permissions again before deletion. Deletion is irreversible, and a missing number
  maps to `ticket-not-found`.
- A failed permission query is treated as "no permission" by the host; details still return normally
  and only the delete capability is set to false.
- Change patches describe target sets; adapters use core's `planSetChange` with the current values to
  produce each CLI's add/remove arguments. "Assign to me" resolves the logged-in user in the adapter
  (GitHub uses `@me`; GitLab / Gitea query `/user` first).
- Local Markdown references must be `.scratch/<feature>/issues/<name>.md`; paths outside that shape
  are refused.
- Optional fields: fill `closedAt` when a close time is available, and `blockedBy` (a reference set,
  open or closed) when blocking dependency edges are available. GitHub list queries only provide the
  number of open blockers, so a whole ticket omits `blockedBy`; local Markdown has no close time.

- Adapters may depend only on `core`; backends never depend on each other (a convention, not a
  tool-enforced rule).
- All ticket backends share one contract test suite: the same cases must pass for every backend.
  Tests never connect to a real service; they use recorded responses or in-memory fakes. Detail,
  completion-candidate and delete capabilities are part of the contract too: a backend that
  implements one provides the request and expected output, and omitting it means the capability is
  not implemented.
