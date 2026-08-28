# Active Coordination (tracked SSOT)

**Owner:** Prod Owner (relativityE)

The current active-coordination board — the working subset of `BACKLOG.md`. It is **not** a second backlog and **not** a historical ping log: the exhaustive backlog stays in `BACKLOG.md`; current ship/deployment posture stays in `RELEASE_STATUS.md`. No secrets, PII, transcripts, or audio — reference PRs and file paths only.

<!-- CURRENCY-BLOCK
# Machine-readable state, parsed by the #1258 currency guard in tests/config/documentationContract.test.ts.
#
# The guard used to pattern-match PROSE and immediately produced two false positives against this very
# file: the paragraph EXPLAINING that Task 4 had been wrongly marked "NOT STARTED" contains both words,
# and the sentence saying retention is NO LONGER the release blocker contains "release blocker" and
# "retention". A guard that cannot tell a description of a defect from the defect is not a guard.
#
# So state lives here, in fixed fields, and prose stays prose.
baseline: 2d6398d603ce06221c888e7473c3cabe2725e168
deployed-release: 2d6398d603ce06221c888e7473c3cabe2725e168
verified-on: 2026-08-28
release-blocker: model-selection
retention-campaign: off-critical-path
task-1304-1: merged
task-1304-2: merged
task-1304-3a: merged
task-1304-3b: merged
task-1304-3c: open
task-1304-4: merged
task-1360-recovery-copy: merged
lane-stage-b: not-started
lane-telemetry: not-started
lane-billing: not-started
lane-1258-journey: not-started
-->

## Current baseline
- **Product code baseline:** `main` `2d6398d6` (#1366, #1360 truthful recovery copy). Verified `git rev-parse origin/main` on 2026-08-28.
- **Deployed production:** `window.__APP_RELEASE__ = 2d6398d603ce06221c888e7473c3cabe2725e168`, read cache-busted from `https://speaksharp-public.vercel.app/` (HTTP 200) on 2026-08-28. Production **==** `main` HEAD at that read.

> **Currency note (second correction).** #1358 fixed a five-week drift and this board was stale again within a day: it named `5f378898`, called #1304 Task 3 and Task 4 "NOT STARTED" after both had merged, and listed the retention Attempt 10 campaign as active. `AGENTS.md` sends every agent here first, so a stale board becomes wrong work. The states below are verified reads, not copied values.

## Current work — the MVP-blocking STT lane (#1304)

| Item | State |
|---|---|
| #1304 Task 1 — certified WER scorer | **MERGED** `574422ed` (#1356) — official normalization, 68/68 oracle vectors, Track A/B separation |
| #1304 Task 2 — authoritative benchmark specs | **MERGED** `5f378898` (#1357) |
| #1304 Task 3A — decode route identity | **MERGED** `7db695f4` (#1346) — `resolveDecodeRoute` + `routeHash` |
| #1304 Task 3B — scoring seam | **MERGED** `20f3ce85` (#1362) — strict corpus invalidation, type-separated paths |
| #1304 Task 4 — frozen corpus | **MERGED** `d702d8c5` (#1363) + `2f1152c0` (#1364) — LibriSpeech pinned publisher-MD5→SHA-256, 300+300 manifest, per-clip audio digests, 37.87s long-form fixture |
| #1304 Task 3C — certified harness | **OPEN #1365**, RETURNED. Certification gates + browser lane with counted backend evidence; closing three evidence-authority defects |
| #1360 recovery copy | **MERGED** `2d6398d6` (#1366) — truthful copy; no transcript promise the draft cannot keep |
| Retention production proof | **OFF THE CRITICAL PATH.** Ten browser attempts failed on instrumentation, never on the product; the stopping rule fired. #1359 executed the shipped newest-two contract against real migrations instead. A production run is a future, separately authorized gate. |

## The STT sequence now executing

1. #1365's three fixes — one certified execution path; pinned/offline assets with digests on every row; Harvard-10 reclassified as a **smoke** set that cannot be selection evidence.
2. **ORT Web int8/q8 requalification.** v4 int8/q8 are **not rejected**: they load under `onnxruntime-node@1.24.3` and fail under `onnxruntime-web@1.26.0-dev.20260416` with `TransposeDQWeightsForMatMulNBits — Missing required scale`. That is Microsoft's Whisper regression ([#28306](https://github.com/microsoft/onnxruntime/issues/28306), fixed by [#28326](https://github.com/microsoft/onnxruntime/pull/28326) on 2026-05-12); our browser build predates the fix by four weeks.
3. Unseen **425-word preflight** over frozen-corpus clips.
4. **Frozen 600-clip benchmark**, automatically if the preflight is clean.
5. Primary/fallback recommendation on accuracy + reliability + speed + size + memory + browser coverage + long/short behaviour + offline/privacy + **forced-failover** + product journey. A fallback must be dependable across MORE devices and fail DIFFERENTLY from the primary — not merely second-best WER.
6. Track-B human disfluency validation, **last**, on the two finalists only.

## Parallel MVP lanes — none may wait on the STT runs

| Lane | State |
|---|---|
| Recovery copy | **DONE** — #1366 merged |
| Stage-B privacy successor | **NOT STARTED** — fresh cut from current `main`; historical #1310 is do-not-rebase |
| Telemetry qualification | **NOT STARTED** — telemetry is implemented; what is missing is qualification: prove no transcript/audio/email/raw-user-id in events, define the launch funnel and failure measures, name alert owners and actions, attach the selected model identity, and verify deployed dashboards with controlled events |
| Billing qualification | **NOT STARTED** — fresh cut; historical #1303 is do-not-rebase |
| #1258 integrated journey + GO/HOLD | **NOT STARTED** — runs last, on the exact release build |

## Open PRs — dispositions
- **#1365** — active, Task 3C.
- **#1361** — DO NOT MERGE; #1360 diagnosis only.
- **#1328** — tracking ledger; never an MVP blocker.
- **#1303 / #1310 / #1317 / #1319 / #1323** — HISTORICAL. Do not rebase; re-cut from current `main` when their turn comes.

## Known limitation carried into MVP
The #1354 write-ahead obligation is **client-only**. If the Progress evaluation fails, the browser obligation write also fails, and the user reloads after storage recovers, the client cannot reconstruct that obligation. Three coincident events; eliminating it needs a **server-side obligation record**, which is accepted post-MVP debt.

_This file lists only current work. Merged PRs live in git history; deployment posture lives in `RELEASE_STATUS.md`._
