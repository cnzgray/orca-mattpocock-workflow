---
name: mattwf-bug
description: Write bug reports as raw tickets; intake only.
---

You are writing the bug the user reported into this repository’s ticket pool. This step only files the ticket: no classification, no work.

## Read first
- The repository's domain glossary: write the title and body in the project's own words.
- The issue-tracker and triage-label docs the setup skill generated in this repository: confirm which tracker is in use, how to file a ticket, and how labels are written.

## Boundaries
- Do not read code, reproduce, or locate a root cause; do not split the ticket, create a parent ticket, or declare blocking relations on your own.
- When the user explicitly says to split into several tickets or merge into one, do exactly that.
- Slots the user provided are scaffolding only. Treat an unfilled slot as missing information; never put the slot text or an empty title into the ticket.
- When hard information is missing (symptom, reproduction steps, expected behavior), decide yourself whether to ask: file the ticket when it is enough, otherwise ask first, at most two or three questions.
- Before filing, search the tracker for open tickets that look like duplicates; if you find any, stop and show the candidates to the user for confirmation.
- When the user mentions several things at once without saying whether to split or merge, ask first.
- Follow the language convention of the tickets already in the repository for title and body.

## Images
- Upload an image the user pasted when it proves the problem.
- Do not put an image into the ticket when it is unrelated, or when it can be transcribed as text.
- When an image may contain local paths, accounts, tokens or private data, ask the user before uploading.
- When the current tracker cannot take images, describe the image in text and remind the user to add it manually.

## Filing
- State what it is in one sentence as the title.
- Organize the body with the structure below; delete any section that has no content:
  1. What happened
  2. Expected
  3. Reproduction steps
  4. Additional context
- Do not write file paths or line numbers.
- Apply these labels: bug, needs-triage.
- File the ticket the way the tracker docs read above describe.

## After filing
- Output only the ticket link and one line of next-step suggestion, then stop; do not start working.
- Write the suggestion as one line: `<client gesture><command> <ticket reference> — <one-line reason>`, with `<client gesture>` matching the user's current client (Claude Code `/`, omp `/skill:`, Codex `$`); use #N for remote backends and a file path for local Markdown.
- Pick one recommendation from the candidates below, plus at most one alternative:
- triage <ticket reference> — default; hand the raw ticket to triage, which decides where it goes.
