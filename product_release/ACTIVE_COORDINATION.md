# Active Coordination (tracked SSOT)

**Owner:** relativityE · **Last updated:** 2026-07-15

This is the **tracked, reviewable** active-coordination board — the current working subset of
`BACKLOG.md` (active items + the next self-assigned pull-forward task). It replaces the former
untracked `/private/tmp/ACTIVE_COORDINATION.md`, which was not reviewable in the repository.

Rules:
- This file is the **only** current active-coordination source. It must not become a second
  full backlog or a historical ping log — the exhaustive backlog stays in `BACKLOG.md`, and
  current ship status/go-no-go stays in `RELEASE_STATUS.md`.
- Pull the highest-priority incomplete `BACKLOG.md` item here when starting it; move it back to
  `BACKLOG.md` (marked done, with evidence) when complete.
- No secrets, PII, transcripts, or audio. Reference issues/PRs and file paths only.

## Current active items

| Item | Owner | State | Notes |
|---|---|---|---|
| PR #986 — product_release doc sync | relativityE | In review | Corrected head; all required CI green. Do not merge without owner sign-off. |
| PR #981 — Wave-1 Pro availability | relativityE | In review (stacked on #986) | Rebase onto main after #986 merges. |
| Attribution history sanitation | relativityE | Done (executed 2026-07-15) | main `84f720d2`; crosswalk in `attribution-sanitation-crosswalk.md`. |

Held (owner decision, not started): controlled-beta invites, rc4, paid cutover.
