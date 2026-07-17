# Active Coordination (tracked SSOT)

**Owner:** Prod Owner (relativityE) · **Last updated:** 2026-07-17

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

**No active release PRs.** All release-track PRs are merged and their branches deleted; `main` is at `df909805` and tagged `v0.9.0-rc4`.

| Item | Owner | State | Notes |
|---|---|---|---|
| PR #986 — product_release doc sync | Prod Owner | Merged | On `main`. |
| PR #981 — Wave-1 Pro availability | Prod Owner | Merged | On `main` (`7c5da5e9`). |
| PR #988 — permanent OSV SCA Gate 4 | Prod Owner | Merged | `sca-osv` now a required context. |
| PR #989 — pin `pdfjs-dist` (live PDF assertion) | Prod Owner | Merged | On `main` (`847ed735`). |
| PR #990 — ops-health GitHub resilience | Prod Owner | Merged | On `main` (`df909805`). |
| Attribution history sanitation | Prod Owner | Done (2026-07-15) | crosswalk in `attribution-sanitation-crosswalk.md`. |

Release posture: **`v0.9.0-rc4` cut; first controlled tester batch (3–5) authorized.** Held (Prod Owner decision): expansion beyond the first batch, paid cutover, v4 activation. Current ship status/go-no-go lives in `RELEASE_STATUS.md`.
