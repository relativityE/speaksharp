# Active Coordination (tracked SSOT)

**Owner:** Prod Owner (relativityE)

The current active-coordination board — the working subset of `BACKLOG.md`. It is **not** a second backlog and **not** a historical ping log: the exhaustive backlog stays in `BACKLOG.md`; current ship/deployment posture stays in `RELEASE_STATUS.md`. No secrets, PII, transcripts, or audio — reference PRs and file paths only.

## Current baseline
- **Product code baseline:** `main` `5f378898` (#1357, Task 2 of the #1304 STT lane). Verified `git rev-parse origin/main` on 2026-08-27.
- **Deployed production:** `window.__APP_RELEASE__ = 5f3788984467b13a810d7ae14c9ee9bf842c90f2`, read cache-busted from `https://speaksharp-public.vercel.app/` (HTTP 200) on 2026-08-27. Production **==** `main` HEAD at that read.

> **Currency note.** This board previously named baseline `65e58a62` and current work **#1006**, a state that no longer exists — while `AGENTS.md` instructs every agent to consult it. #1006 has long been closed. That staleness is the defect this update fixes; the dates below are verified reads, not copied values.

## Current work — the MVP-blocking STT lane (#1304)

| Item | State |
|---|---|
| #1354 recorder Progress gate | **MERGED** `781e8ad6` (#1355) — write-ahead obligation; all six acceptance cases + UI |
| #1304 Task 1 — certified WER scorer | **MERGED** `574422ed` (#1356) — official normalization, 68/68 oracle vectors, Track A/B separation |
| #1304 Task 2 — authoritative benchmark specs | **MERGED** `5f378898` (#1357) — real product surface + certified scorer |
| #1304 Task 3A — decode route identity | **OPEN** #1346 (un-parked, rebased) — `resolveDecodeRoute` + `routeHash` |
| #1304 Task 3 — certified harness | **NOT STARTED** — one harness, aggregate WER = Σ(S+D+I)/Σ(refWords), 0.0936 certification gate before any corpus run |
| #1304 Task 4 — corpus | **NOT STARTED** — LibriSpeech test-clean/test-other, seeded 300-utterance subsets, sizes and checksums read at fetch time |
| Retention proof (Attempt 10) | **BLOCKED, off the critical path.** Nine browser attempts failed on instrumentation, never on product. Agreed sequence: throwaway-database contract proof first (no authorization needed, becomes a standing CI gate), production run once as the final gate. |

## Open PRs — dispositions
- **#1346** — active, Task 3A.
- **#1347** — queued behind Task 3.
- **#1328** — tracking ledger only; never an MVP blocker.
- **#1310 / #1303 / #1317 / #1319 / #1323** — HISTORICAL. Do not rebase; re-cut from current `main` when their turn comes.

## Known limitation carried into MVP
The #1354 write-ahead obligation is **client-only**. If the Progress evaluation fails, the browser obligation write also fails, and the user reloads after storage recovers, the client cannot reconstruct that obligation. Three coincident events; eliminating it needs a **server-side obligation record**, which is accepted post-MVP debt.

_This file lists only current work. Merged PRs live in git history; deployment posture lives in `RELEASE_STATUS.md`._
