English | [简体中文](README.zh-CN.md)

# panel

The MattWorkflow panel in Orca's right sidebar (`ui: "html"`, a React app running in its own frame).

## Structure

- `main.tsx`: entry point. Mounts React, subscribes to host events (`workspace.candidates` /
  `snapshot.refreshed` / `workspace.changed`), and renders the candidate list when no workspace can
  be claimed. It asks the worker's `workspace.current` once at startup and again after
  `workspace.changed`; the worker decides the current path and candidates. Failures are not retried
  automatically; a request is repeated only when the focus context changes or the user refreshes.
- `workspace-picker.tsx`: the candidate picker at the top of the panel. Each row shows project, name,
  branch and path, and "Use" selects it; multiple workspaces on one branch are distinguished by these
  fields.
- `transport.ts`: the only channel between the panel and the worker. Method names and input/output
  shapes follow `src/protocol/tracker.ts`; the transport is `orca.plugin.request`, plus the two extra
  handlers `skills.install` and `workspace.current`.
- `clipboard.ts`: the two-level clipboard write path (Clipboard API → hidden textarea +
  `execCommand('copy')`), shared by prompt, command and ticket-link copies.
- `worktree-action.tsx`: the "Create worktree" entry on ticket list rows and the detail header, plus
  inline creation results. Availability comes from the verdict already in the snapshot; local
  Markdown and unresolved workspaces get no entry.
- `injection.ts` + `prompt-copy.tsx`: the prompt outlet. Orca has no "fill the session input" or
  "open a new session" API, so the panel only copies prompts to the clipboard. `clipboard.ts` tries
  the Clipboard API first; when the panel iframe lacks the `clipboard-write` permission policy the
  call is rejected and it falls back to a hidden textarea + `execCommand('copy')`. Only when both
  paths fail does it show a read-only, fully selected text box for the user to press ⌘C.
- `view-preference.ts`: remembers filters, sorting, the two people toggles (assigned to me / created by
  me) and the layout (flat / tree) per repository in Orca's plugin-private storage (one JSON map, at
  most 50 entries; multiple worktrees of the same repository share one). Old saves without people or
  layout fields, invalid fields or unavailable storage fall back to toggles off and the flat layout.
- `ticket-view.ts`: the list's presentation logic. Status filter → people filter → sort is composed
  once here, and people counts are computed here too; the UI only renders the result and never
  re-derives verdicts.
- `tickets-view.tsx`: the list view. The people-filter row under the status segments renders only
  when the snapshot carries a signed-in user; the two pill toggles show counts, "Clear" appears when
  either toggle is on, and the row ends with `@login`.
- `ticket-tree.ts`: pure functions for list layout. Turns the filtered, sorted visible tickets into
  render rows: in the tree layout it gives depth, whether the row has children, expand state, whether
  the parent is outside the list and the descendant count; cycles and self-references fall back to
  top-level rows and no ticket is lost. `ancestorRefs` / `expandAncestors` expand the ancestor chain
  when locating a ticket from the overview.
- `layout-toggle.tsx` / `hierarchy-text.ts` / `hierarchy-notice.tsx`: the layout toggle, the
  hierarchy-source explanation, the reason the tree layout is disabled when the capability is none,
  and coverage and degradation notices. The layout toggle is an icon segment (flat / tree) on the right
  of the "Loaded" row and does not take up the filter toolbar; the icon buttons' accessible names state
  both the action and the source. The hierarchy capability only affects layout and takes no part in
  verdicts or statistics.
- `ticket-list.tsx`: list rows. The tree layout adds the collapse button, indentation, child count and
  parent-reference badge; the flat layout shows no hierarchy decoration. Collapse state lives for the
  session, is cleared when switching workspaces, and survives refreshes, filtering and sorting.
- `capabilities.ts`: panel-side capability diagnostics (panel bridge, clipboard, worker
  reachability), merged for display with the worker-side capabilities in the environment check.
- `i18n.ts`: UI language. Resolves the `language` setting (`auto` / `zh-CN` / `en`) and the host's
  BCP-47 locale, and provides interpolation, React context and `<html lang>` synchronization. Message
  catalogs live in `src/protocol/i18n.ts`. React components read copy only through `useMessages()`;
  non-React modules use `activeTranslate()`.
- `task-panel.tsx`: the panel shell that switches between list, overview, environment check and
  workflow help.
- `theme.css`: maps the host-injected `--orca-*` tokens to the panel's own `--mwf-*` variables; light
  and dark follow the host.
- `markdown-body.tsx`: a small built-in Markdown renderer. Ticket bodies are untrusted input, so raw
  HTML is never parsed and links allow only http(s) and mailto. GitLab details inline uploaded
  attachments as `data:image/` rasters; the renderer draws such data URLs as `img` only when the detail
  explicitly enables it, and image syntax from other backends stays as "`!` + link".
- `avatar-display.ts` + `avatar-source.ts` + `user-avatar.tsx`: avatars shared by the list, detail
  timeline and assignees. The panel frame's CSP does not allow remote images (`img-src data:`), so
  `user-avatar.tsx` renders only the data URL proxied by the worker; `avatar-source.ts` deduplicates
  concurrent requests and asks the worker without keeping image bytes. A missing URL or a failed load
  falls back to a login-initial color block, with the color determined only by the login. URL
  allowlisting, accessible text and color rules live in `avatar-display.ts` and are unit-testable
  without a child process or the DOM.

## Constraints

- The panel depends only on types and constants from `src/protocol`; it never imports `src/core` or
  `src/adapters`.
- Method names and parameter shapes in the protocol are fixed; the panel calls worker handlers by
  name.
