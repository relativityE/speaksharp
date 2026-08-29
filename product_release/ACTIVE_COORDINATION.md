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
baseline: 0e2fffd16224063e18b40174d92393632f1c1e47
deployed-release: 0e2fffd16224063e18b40174d92393632f1c1e47
verified-on: 2026-08-29
release-blocker: model-selection
retention-campaign: off-critical-path
task-1304-1: merged
task-1304-2: merged
task-1304-3a: merged
task-1304-3b: merged
task-1304-3c: merged
task-1304-4: merged
task-1360-recovery-copy: merged
lane-stage-b: not-started
lane-telemetry: not-started
lane-billing: not-started
lane-1258-journey: not-started
-->

## Current baseline
- **Product code baseline:** `main` `0e2fffd1` (#1366, #1360 truthful recovery copy). Verified `git rev-parse origin/main` on 2026-08-28.
- **Deployed production:** `window.__APP_RELEASE__ = 0e2fffd16224063e18b40174d92393632f1c1e47`, read cache-busted from `https://speaksharp-public.vercel.app/` (HTTP 200) on 2026-08-28. Production **==** `main` HEAD at that read.

> **Currency note (second correction).** #1358 fixed a five-week drift and this board was stale again within a day: it named `5f378898`, called #1304 Task 3 and Task 4 "NOT STARTED" after both had merged, and listed the retention Attempt 10 campaign as active. `AGENTS.md` sends every agent here first, so a stale board becomes wrong work. The states below are verified reads, not copied values.

## Current work — the MVP-blocking STT lane (#1304)

| Item | State |
|---|---|
| #1304 Task 1 — certified WER scorer | **MERGED** `574422ed` (#1356) — official normalization, 68/68 oracle vectors, Track A/B separation |
| #1304 Task 2 — authoritative benchmark specs | **MERGED** `5f378898` (#1357) |
| #1304 Task 3A — decode route identity | **MERGED** `7db695f4` (#1346) — `resolveDecodeRoute` + `routeHash` |
| #1304 Task 3B — scoring seam | **MERGED** `20f3ce85` (#1362) — strict corpus invalidation, type-separated paths |
| #1304 Task 4 — frozen corpus | **MERGED** `d702d8c5` (#1363) + `2f1152c0` (#1364) — LibriSpeech pinned publisher-MD5→SHA-256, 300+300 manifest, per-clip audio digests, 37.87s long-form fixture |
| #1304 Task 3C — certified harness | **MERGED** `054745d7` (#1365) — certification gates, browser lane with counted backend evidence, immutable selection policy |
| #1304 — inference runtimes pinned | **MERGED** `0e2fffd1` (#1368) — both browser runtimes were fetching their WASM from jsDelivr, so offline enforcement refused every affected arm; they are now served through a verifying endpoint and bound into the certificate fingerprint |
| #1304 — frozen 600 benchmark | **RUNNING** on `main@0e2fffd1`. 600 clips / 10,894 normalized words. No ranking exists yet. |
| #1360 recovery copy | **MERGED** `0e2fffd1` (#1366) — truthful copy; no transcript promise the draft cannot keep |
| Retention production proof | **OFF THE CRITICAL PATH.** Ten browser attempts failed on instrumentation, never on the product; the stopping rule fired. #1359 executed the shipped newest-two contract against real migrations instead. A production run is a future, separately authorized gate. |

## The STT sequence now executing

1. **DONE** — #1365's three fixes: one certified execution path; pinned/offline assets with digests on every row; Harvard-10 reclassified as a **smoke** set that cannot be selection evidence.
2. **DONE** — ORT Web int8/q8 requalification. v4 int8/q8 are **not rejected**: they load under `onnxruntime-node@1.24.3` and fail under `onnxruntime-web@1.26.0-dev.20260416` with `TransposeDQWeightsForMatMulNBits — Missing required scale`. That is Microsoft's Whisper regression ([#28306](https://github.com/microsoft/onnxruntime/issues/28306), fixed by [#28326](https://github.com/microsoft/onnxruntime/pull/28326) on 2026-05-12); our browser build predates the fix by four weeks.
3. **DONE** — the unseen preflight, called the **459-word** preflight because that is what the deterministic selection produced; 425 was the planning target and a rounded label invites the assumption that the set was trimmed to hit it.
4. **RUNNING** — the frozen 600-clip benchmark on `main@0e2fffd1`.
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

---

## #1367 documentation reconciliation (2026-08-29)

Complete non-archive Markdown reconciliation committed: [`DOCUMENTATION_RECONCILIATION_LEDGER.md`](./DOCUMENTATION_RECONCILIATION_LEDGER.md) — every tracked file classified, zero unclassified,
enforced by `tests/config/documentationLedger.test.ts`.

Two items need Product Owner action and are recorded rather than decided here:

- **GAP-1** — canonical #3 `ROADMAP.md` is absent, and #1272 (its stated deferral) **closed without producing
  it**. Live successor: **#1257**. The ledger registers it as the single permitted exception so no further
  canonical drift can pass silently.
- **GAP-2** — 34 live documents declare no owner. Owner assignment is a PO decision.
