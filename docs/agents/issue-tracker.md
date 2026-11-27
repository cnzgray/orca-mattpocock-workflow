# Ticket backend: GitHub

This repository's issues and specs both live in GitHub Issues: `cnzgray/orca-mattpocock-workflow` (private).
Every operation goes through the `gh` CLI; inside a clone, `gh` infers the repository automatically.

## Conventions

- **Create a ticket**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read a ticket**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List tickets**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`, adding `--label` and `--state` filters as needed.
- **Make one ticket a sub-issue of another**: `gh issue create --parent <parent> ...`, or afterwards `gh issue edit <parent> --add-sub-issue <child>` (`gh` 2.94+). On older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`, where `<child-db-id>` is the child's **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`), not `#number` and not `node_id`. Without sub-issue support, write `Part of #<parent>` at the top of the child's body.
- **Blocking**: use GitHub's native issue dependency; it is the only canonical representation the UI shows. To add an edge: `gh issue create --blocked-by <n>,<n> ...`, or `gh issue edit <child> --add-blocked-by <blocker>` (`gh` 2.94+). On older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's database id. When native dependencies are unavailable, fall back to writing `Blocked by: #<n>, #<n>` at the top of the child's body. A ticket unlocks only when **every** blocker is closed.
- **Count open blockers**: `gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by` (counts unclosed ones only; `0` means work can start). `gh issue view <n> --json blockedBy` also lists closed ones, so filter them yourself: `--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Add / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: state the reason with `gh issue comment <number> --body "..."` first, then `gh issue close <number>`. Running `gh issue close --comment` on an already-closed ticket **drops** the comment yet still exits 0, so always use two steps.

The repository is inferred from `git remote -v`; inside a clone `gh` does it automatically.

Only create tickets in the user's own repositories. **Never** create tickets in `mattpocock/skills` (the upstream of these skills) unless the user owns it. `gh` may default to another repository, so before the session's first `gh issue create`, confirm the target is `cnzgray/orca-mattpocock-workflow` with `gh repo view --json nameWithOwner`; if it differs, ask the user.

## Publishing to the ticket backend

When publishing a spec, pick the target ticket first: if the user gave a ticket number or URL, or the conversation already points at a ticket, update it in place with `gh issue edit <number> --body-file <path>` instead of opening another. When publishing tickets, create one issue per ticket by default, unless one already exists.

With no target clue, search the open issues for a match first, and ask the user before creating anything. Never open a second ticket for the same spec.

## Reading the current ticket

Use **Read a ticket** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one issue; its **child tickets** are child issues.

- **Map**: a single issue labeled `wayfinder:map`, its body holding Notes / Decisions-so-far / Fog. `gh issue create --label wayfinder:map`.
- **Child tickets**: attach them as GitHub sub-issues of the map (see **Make one ticket a sub-issue of another**). Without sub-issue support, add the children to a task list in the map body and write `Part of #<map>` at the top of each child body. Labels are `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the developer driving it.
- **Blocking**: see **Blocking**.
- **Frontier query**: list every open child of the map (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop those with open blockers (see **Count open blockers**, or a `Blocked by` line naming an open ticket) and those already assigned; take the first in map order.
- **Claim**: `gh issue edit <n> --add-assignee @me`; this is the session's first write.
- **Close out**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (summary + link) to the map's Decisions-so-far.

## Constraints specific to this repository

Label strings are a product contract: `TRACKER_LABELS` in `src/protocol/labels.ts` holds the seven names the host and the panel read. Renaming a label means changing that file, `docs/agents/triage-labels.md` and the labels on GitHub together; miss one and the panel's verdicts drift.
