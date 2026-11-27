# Triage labels

Triage speaks in **roles**; this table maps each role to the label string actually used in this repository's ticket backend. Two kinds of role must both be covered: five **state roles** (where a ticket sits in the triage state machine) and two **class roles** (every triaged ticket carries exactly one).

| Canonical role   | Label in this repository | Meaning                                      |
| ---------------- | ------------------------ | -------------------------------------------- |
| `needs-triage`   | `needs-triage`           | A maintainer must assess and classify it      |
| `needs-info`     | `needs-info`             | Waiting for the reporter to supply details    |
| `ready-for-agent`| `ready-for-agent`        | Spec is complete; hand it straight to an agent |
| `ready-for-human`| `ready-for-human`        | Needs a human implementation                  |
| `wontfix`        | `wontfix`                | Decided against                               |

| Canonical role | Label in this repository | Meaning                                      |
| -------------- | ------------------------ | -------------------------------------------- |
| `bug`          | `bug`                    | Class role; every triaged ticket has exactly one |
| `enhancement`  | `enhancement`            | Class role; every triaged ticket has exactly one |

When a role is mentioned (for example "apply the triage label that makes it agent-ready"), take the matching label string from the table; do not invent a name.

## Consistency with code

These strings are a product contract, not incidental documentation:

- `TRACKER_LABELS` in `src/protocol/labels.ts` holds the same names, and both host and panel judge by it;
- The same labels must exist on GitHub; `to-tickets` publishing calls `--add-label` directly.

All three (this table, `labels.ts`, GitHub labels) must change together. Then run `pnpm typecheck && pnpm test`: the verdict cases in `src/core` and `src/adapters/*` expose anything missed.

This repository keeps the default names, so the "Label in this repository" column needs no override value yet; if a backend later adopts an existing scheme such as `bug:triage`, change only the middle column — no other document needs to move.
