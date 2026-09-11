# Release Status

**Status:** Authoritative (SSOT for release/deployment posture)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-08-29
**Last Verified:** 2026-09-04 (production `window.__APP_RELEASE__` READ from `https://speaksharp-public.vercel.app/` = `c4665156212dd03cd6d7b91c49bed90dea868b5a`; `origin/main` verified by `git ls-remote` at the same time. Production **==** `main` HEAD at this read. The deployed SHA is READ, never inferred from auto-deploy.)

> **Currency correction (second).** #1358 corrected a 34-day drift; one day later this file was stale again — it named `5f378898` as both `main` and the deployed release, called #1304 Task 3 and Task 4 "not started" after both had merged, and still named the retention production proof as *the* release blocker after the stopping rule fired and that campaign moved off the critical path. A stale SSOT is worse than an absent one: `AGENTS.md` sends every agent here first, so wrong values here become wrong work. The values below are verified reads taken on 2026-08-28, not copied forward. The currency guard in `tests/config/documentationContract.test.ts` now fails when these task states contradict merged/open PR reality.
**Applies To:** Current production deployment + release tracks for the SpeakSharp beta.
**Class:** Runtime fact.
**Authority:** The only source for changing release/deployment status, baselines, run IDs, blockers, and go/no-go.
**Not Authoritative For:** stable product contracts (→ `PRODUCT_REQUIREMENTS.md`), architecture (→ `ARCHITECTURE.md`), STT contracts (→ `STT.md`); documentation structure (→ `README.md`).
**Supersedes:** any conflicting current-status claim in `product_release/archive/` or older files.
**Evidence Sources:** GitHub `origin/main`; the production deployment's `window.__APP_RELEASE__`; the required release workflows defined in `RELEASE_PROCESS.md`.

<!-- CURRENCY-BLOCK
# Machine-readable state, parsed by the #1258 currency guard in tests/config/documentationContract.test.ts.
#
# The guard used to pattern-match PROSE and immediately produced two false positives against this very
# file: the paragraph EXPLAINING that Task 4 had been wrongly marked "NOT STARTED" contains both words,
# and the sentence saying retention is NO LONGER the release blocker contains "release blocker" and
# "retention". A guard that cannot tell a description of a defect from the defect is not a guard.
#
# So state lives here, in fixed fields, and prose stays prose.
baseline: 55912522ebf4aa11672cdc42413e557b408f3f25
deployed-release: c4665156212dd03cd6d7b91c49bed90dea868b5a
verified-on: 2026-09-05
release-blocker: production-journey-recovery
retention-campaign: off-critical-path
task-1304-1: merged
task-1304-2: merged
task-1304-3a: merged
task-1304-3b: merged
task-1304-3c: merged
task-1304-4: merged
task-1360-recovery-copy: merged
lane-stage-b: off-critical-path
lane-telemetry: returned
lane-retention-copy: open
lane-billing: off-critical-path
lane-1258-journey: returned
-->

## Disposition

**HOLD — the real Production journeys failed and are not ready for another PO test.**

| Identity | Value | How to verify |
|---|---|---|
| **Repository `main` (moving branch pointer)** | `55912522ebf4aa11672cdc42413e557b408f3f25` (#1419 attempt ownership; #1416 and #1420 merged the same day) at 2026-09-05 | **Moving** — verify the live pointer directly (`git rev-parse origin/main`); do not treat this SHA as fixed. |
| **Last product-behavior release** | `0e2fffd1` (#1366, #1360) — truthful recovery copy. It changes `SessionPage` and `UnresolvedRecoveryBanner`, both shipped, so it IS a product-behavior release. The prior one was `781e8ad6` (#1355). | Apply the criterion below; do not eyeball the PR title. |
| **Later test/evidence commits (NOT product-behavior deployments)** | `574422ed` (#1356 scorer), `5f378898` (#1357 specs), `7db695f4` (#1346 3A), `20f3ce85` (#1362 3B), `d702d8c5`/`2f1152c0` (#1363/#1364 corpus), `069dc9e2` (#1359 retention contract) — all under `tests/**` or `scripts/**` | These change **no** deployed product behavior. |
| **Deployed product release (verified)** | `window.__APP_RELEASE__ = c4665156212dd03cd6d7b91c49bed90dea868b5a`, read from `https://speaksharp-public.vercel.app/` on **2026-09-04**. Production == `main` HEAD at this read, but that is **not** guaranteed by auto-deploy alone: a Vercel "Ignored Build Step" can leave production behind `main`, so the deployed SHA must be **read**, not inferred. | Re-read `window.__APP_RELEASE__` from the deployed page with a cache-busting query and `Cache-Control: no-cache`, then update the value + date here. |

The accepted fixes are not yet shipped. Green automated tests and prior exact-head CI do not override the human result.

The repository currency guard verifies committed-file consistency and ancestry only; it cannot read a moving GitHub branch or Production deployment. Those two facts must be re-read externally and recorded here.

**No Product Owner merge authorization is currently holding up a completed PR.** The blocker is implementation and independent review. When a PR becomes complete and safe, PM must say explicitly if PO authorization is the only remaining step.

## What is merged

| Item | Status |
|---|---|
| #1414 / #1390 Preview mechanics | Merged historically. The custom Preview workflow is not the active test path and must not be dispatched. No revert is authorized merely to remove dormant code. |
| #1413 / #1403 human observer proof | Merged historically. It did not provide complete event-level evidence for the 4 Sep session; reopened #1259 supersedes it as the observer contract. |
| Combined-main CI | `33865704786` completed successfully at `c4665156`: 18 substantive jobs succeeded; only `draft-checks` skipped as expected for dispatch. |

## Current merged product posture
- **`/practice` default entry (#1022):** authenticated home is `/practice` (#1025 hotfix; #1026 canary asserts it); Guided is surfaced-but-unavailable; the rollout flag is retired.
- **Stale-chunk P0 hardened (#1027):** `preloadError` recovery + stable content-hash asset names + SPA 404 fallback; release identity moved to `window.__APP_RELEASE__` (above).
- **Private-first UX (through #1007/#1008, still current):** Private = Recommended/main; Browser (method name, carrying a secondary "Quick preview" descriptor badge; #1041) = the free convenience path; Cloud = paid-Pro-only and unavailable to Free testers during the no-billing beta (existing paid-Pro accounts retain access). One authoritative post-save `StatusNotificationBar`; completion toast / "Next: Analytics" overlay deleted.
- **STT mode labels (SHIPPED — #1041 / PR #1060, main `8aae87b8`):** the user-facing **transcription-method name is "Browser"**, with **"Quick preview"** retained as a **secondary descriptor badge** on the Browser option. Approved description: *"Uses your browser's speech recognition. Availability and accuracy vary by browser. Chrome recommended."* Accessibility: accessible name = "Browser"; the "Quick preview" descriptor + description are exposed as the option's accessible description. The internal engine token / telemetry / DB value remains **`native`**, unchanged. (Supersedes the earlier **"Quick Preview (Browser)"** primary-label proposal, which is retired.)
- **Issue-report hygiene (#1024):** raw `appRuntimeConfig.url` no longer persisted in report metadata.
- **`get_analytics_summary` authorization P0 (#1096 — APPLIED TO PRODUCTION 2026-07-29):** migration `20260729120000_secure_get_analytics_summary_authz.sql` merged to `main` (`b9ac4ca`) and applied to the production DB (project `yxlapjuovrsvjswkwnrk`) via the sanctioned `deploy-supabase-migrations.yml` run [`30496437018`](https://github.com/relativityE/speaksharp/actions/runs/30496437018).
  - **Applied and recorded:** `db push` dry-ran (scope = only this migration), then `Applying migration 20260729120000_secure_get_analytics_summary_authz.sql... ✅ Migrations applied successfully` — so `db push` both **applied and recorded** `20260729120000` in the remote migration history. (The workflow's `migration repair` step in the same run concerned an **older** migration, `20260116000000`, not this one.)
  - **Production-proven:** the workflow completed successfully; an unauthenticated probe (`anon` publishable key, no user JWT) of `get_analytics_summary(<nil-uuid>)` changed from **HTTP 200 with a payload** (pre-fix) to **HTTP 401 `42501 permission denied for function`** (post-fix); the deployed frontend release identity **remained `b9ac4ca`** (read from prod `window.__APP_RELEASE__`) — this is a DB-only change. No customer data accessed (the nil UUID owns no rows).
  - **Exact-artifact evidence (byte-identical migration on PostgreSQL 15/16/17 in CI + local 17.10):** null-safe fail-closed guard `auth.uid() IS NULL OR p_user_id IS NULL OR p_user_id <> auth.uid()`; ACL = `REVOKE EXECUTE FROM PUBLIC`/`anon`, `GRANT` to `authenticated` + `service_role`; `service_role` retains its grant yet a keyless call is guard-rejected; `SET search_path = public, pg_temp` (pg_temp explicit and last).
  - **Rollback constraint:** any rollback MUST retain the PUBLIC/anon revokes, the null-safe guard, and the safe `search_path = public, pg_temp`. **Never restore the vulnerable prior function body verbatim** — reverting only the evidence-validity aggregate, not the authorization controls.
- Billing closed, exact-origin CORS hardened, v4 off (as above).

## Beta posture
- **Controlled, invite-only, no-billing beta.** No Cloud for Free testers; v4 off. (No hard-coded tester count here — reconcile any count to the authoritative invitation roster before publishing it.)
- **Tester invitations are gated on the read-only tester-evidence audit (#1030 `workflow_dispatch`).** The audit is HELD pending a Product Owner correction to the `AUDIT_EXCLUDED_EMAILS_JSON` exclusion manifest (a `synthetic` category data issue); it fails closed and publishes no totals until corrected.

## Current open work

The MVP-blocking lane is **#1304 (STT down-select)**. See `ROADMAP.md` for the working sequence; this section carries only release posture.

- **Merged and deployed (2026-08-28):** #1360 truthful recovery copy (`0e2fffd1`, #1366) — the last **product-behavior** change.
- **Merged test/evidence since (no runtime change):** #1304 Task 3A decode-route identity (`7db695f4`, #1346); Task 3B scoring seam (`20f3ce85`, #1362); Task 4 frozen corpus, acquired and bound to its artifacts (`d702d8c5` #1363, `2f1152c0` #1364); the shipped newest-two retention contract executed against real migrations (`069dc9e2`, #1359).
- **Merged since:** #1304 Task 3C certified harness (`054745d7`, #1365) and the inference-runtime pinning that followed it (`0e2fffd1`, #1368). Both are test/evidence infrastructure and change no deployed product behaviour.
- **Open:** the frozen selection benchmark is RUNNING on `main@0e2fffd1`: **600 utterances / 10,894 normalized words**. It is not a 600-word test. No model has been selected and no ranking exists.
- **RETENTION IS NO LONGER THE RELEASE BLOCKER.** Ten browser production-proof attempts failed, every one on the test harness and never on the product; the stopping rule fired and that campaign is **off the MVP critical path**. What replaced it: #1359 executed the shipped newest-two retention contract against the real migrations in-process (PGlite) — the first time that contract has been checked anywhere. A production run remains a future, separately authorized gate, not a blocker on this release.
- **Acquisition telemetry: `unobservable` is accepted for Stage 1, and conditional after it.** Model
  download and cache behaviour are measured at the browser's own fetch boundary. v2 (self-hosted) and
  Moonshine (its own shipped pin file) are fully observable. v4 reports an honest `unobservable` cache
  result because its asset pins are test material that is not shipped, and inventing URLs to fill the
  gap would be a guess presented as a measurement. PM disposition: that is acceptable during the Stage-1
  internal comparison and NOT sufficient for whichever candidate is ultimately selected for production.
  If Stage 1 selects v4, its cache-versus-network acquisition and download duration become a **pre-MVP
  blocker**; if v4 is not selected and remains internal-only, the limitation may remain documented. The
  selected model must report candidate/model identity, total setup time, cache result, and either
  download duration or a directly measured no-download outcome.

- **THE RELEASE BLOCKER IS NOW MODEL SELECTION.** No Private STT model has been chosen. Shipping `v2 base.en` remains the default by absence of qualifying evidence, not by measurement.
- **Accepted post-MVP debt:** the #1354 write-ahead obligation is client-only. If the Progress evaluation fails, the browser obligation write also fails, and the user reloads after storage recovers, the client cannot reconstruct that obligation. Eliminating it requires a server-side obligation record.
- **#1006 is CLOSED** (draft, not activated) — long since not current work; retained here only because earlier revisions of this file presented it as the open item.

## The STT chain — what has to happen before a model is chosen

This is the current release-critical sequence. Each step's evidence gates the next; nothing below is a
plan, it is what the open PR is executing.

1. **#1365's three evidence-authority fixes.** One certified execution path (both lanes through
   `runArm`, with the expected-id list supplied by the SET rather than derived from the clips that were
   decoded); pinned, offline, self-hosted model assets with their digests on every row; and Harvard-10
   reclassified as a **smoke** set that can never be selection evidence.
2. **ORT Web int8/q8 requalification — DONE.** `v4` int8 and q8 were **not rejected candidates**. They load
   under `onnxruntime-node@1.24.3` and fail under the browser's
   `onnxruntime-web@1.26.0-dev.20260416` with `TransposeDQWeightsForMatMulNBits — Missing required
   scale`. That is Microsoft's documented Whisper regression
   ([onnxruntime#28306](https://github.com/microsoft/onnxruntime/issues/28306), fixed by
   [#28326](https://github.com/microsoft/onnxruntime/pull/28326) on 2026-05-12). Our browser build was
   cut on **2026-04-16**, before the fix. Pinned to stable `1.27.0` for the HuggingFace tree only —
   `@xenova/transformers` keeps its own nested `1.14.0`, and different candidates may legitimately ship
   different inference libraries. Both now load and score; they are one arm, not two, because their
   decoder graphs are byte-identical (`dd4761a3…`) under two dtype names.
3. **The unseen 459-word preflight — DONE.** Named for what the deterministic selection produced, not
   the 425-word planning target. It earned its cost immediately: the frozen corpus is FLAC and the
   audio loader only read WAV, so **no corpus clip had ever been decoded** and the 600 would have
   failed at the starting line.
4. **The frozen 600-clip benchmark — RUNNING** on `main@0e2fffd1`, 600 clips / 10,894 normalized words.
5. **A primary/fallback recommendation** on the full evidence set — see below for what "full" means.

### WER alone cannot choose a model

Each serious candidate needs the same evidence: accuracy on the unseen 425 and the frozen 600;
reliability (every clip finishes — no crash, hang, empty return, or silent omission); speed (cold load,
warm transcription, stop-to-final, p50/p95, real-time factor); download size; memory headroom on target
devices; browser support proven on real Chrome/WASM and real-hardware WebGPU with no silent fallback;
short and >30s behaviour (truncation, repetition, hallucination, lost endings); offline/privacy (all
files pinned and self-hosted, remote loading disabled); **failover** — a forced primary failure must be
completed by the fallback without losing the recording; and the product journey end to end under the
chosen model identity.

A fallback is not "second-lowest WER". It must be dependable across MORE devices and must fail
DIFFERENTLY from the primary.

Track-B human disfluency/filler validation runs **last**, on the two finalists only.

## Private STT finalization — accepted planning budget (not a measured p95)
The **≈90 seconds** of post-stop processing quoted for a full five-minute single Private (v2 / whisper-base.en) recording is an **accepted planning budget / risk allowance** for the controlled beta — **not** an observed production performance fact and **not** a measured p95. It is surfaced to the user as honest "Finalizing…" progress. The earlier `<30s` requirement is obsolete/withdrawn. A measured percentile would need a dedicated instrumentation run (STT evidence lane); faster finalization is a post-limitation improvement lane, not a blocker.

## STT availability

> **Corrected 2026-08-27.** This section previously published a three-tier table — Browser "all tiers (default preview)", Private, and Cloud (AssemblyAI) "Paid Pro only … Strongest STT path". **Two of those three engines no longer exist.** `TranscriptionMode` is `'private' | 'mock'`; `frontend/src/services/transcription/engines/` contains only `MockEngine`, `PrivateSTT`, `TransformersJSEngine` and `TransformersJSV4Engine`; `modes/` contains only `PrivateWhisper.ts`. No Cloud/AssemblyAI engine and no Web Speech engine is constructible. The table below is what the code admits, verified 2026-08-27.

| Path | Availability | Notes |
|---|---|---|
| **Private v2 (`whisper-base.en`, on-device)** | The **only** user-facing transcription path, all tiers | Local; one-time model download on first use. There is no engine selector — the product is Private-only (#1184/#1229). |
| **Private v4 (WebGPU)** | Present in code, **hard OFF** | `VITE_PRIVATE_STT_V4_DISABLED` is authoritative; PostHog flags are secondary and cannot override it. Not in the release path. |
| **Mock** | Tests only | Never user-reachable. |
| ~~Browser (Web Speech)~~ | **REMOVED** | Not a `TranscriptionMode`; no engine. A vestigial `allowNative` field remains on `TranscriptionPolicy`, and `frontend/src/e2e/signalContract.ts` still names `modes/NativeBrowser.ts`, **a file that does not exist**. |
| ~~Cloud (AssemblyAI)~~ | **REMOVED** | Not a `TranscriptionMode`; no engine. Orphaned constants remain in `frontend/src/config.ts` (`ASSEMBLYAI_TOKEN_ENDPOINT`, packet-size limits) and provider-family strings in `sttIdentity.ts`. Cleanup is tracked as **#1323** (post-MVP remnants) and is not shipped; these are known cleanup, not capability. |

### Criterion: what counts as a product-behavior release

A commit changes product behavior **iff it modifies a file that reaches the shipped bundle**. Concretely:

- under `frontend/src/`, **and**
- **not** in a `__tests__/` directory, and not a `*.test.*` / `*.spec.*` file, and
- not under `frontend/src/e2e/` (harness-only contracts).

Everything else — `tests/**`, `scripts/**`, `backend/supabase/migrations/**` (a migration is a *database* change, tracked separately), docs — deploys without changing runtime behavior.

> **Worked example, because "touches `frontend/src`" is NOT the criterion.** `5f378898` (#1357) modifies exactly one file under `frontend/src/`: `components/session/__tests__/benchmarkHarnessSurface.test.tsx`. It is a test file, so it does not reach the bundle and #1357 is not a product-behavior release. A future reader applying "touches `frontend/src`" mechanically would get the opposite answer — which is why the rule is stated rather than implied.

**No claim is made here about relative engine accuracy, in either direction.** Vendor figures are reference-only and must not be compared against our own corpus results — differing corpora and decode paths make such a comparison an artifact rather than a measurement. The #1304 lane exists to produce a defensible ranking; until it does, there is none.

## Release-track posture

| Track | Status |
|---|---|
| Repository `main` | `c4665156212dd03cd6d7b91c49bed90dea868b5a`, read from GitHub on 2026-09-04 |
| Production | `window.__APP_RELEASE__ = c4665156212dd03cd6d7b91c49bed90dea868b5a`, read from the canonical Production app on 2026-09-04 |

## What the Production test established

Only `v2:base.en` was runnable. Open Mic and Focus Points both failed.

| Finding | Production evidence |
|---|---|
| Cold mic intent did not auto-start after model preparation | User experienced it; runtime/PostHog showed long READY→RECORDING gaps. |
| Model initialized repeatedly | PostHog and runtime timeline showed multiple setup cycles per journey. |
| Stop control and waveform were not the accepted interaction | User-visible; source confirms black Stop and old waveform geometry. |
| Provisional transcript churn was distracting | User-visible; content-safe stability telemetry was absent. |
| Finalized transcript disappeared after save/teardown | Runtime observer saw non-empty final text become empty; reproduced in both products. |
| Focus Points reported false negatives and miscounted retry | Final transcript contained covered material while UI reported 1/4; evaluator receipts were absent. |
| Practice Loop was missing | Neither required result appeared: one “What went well” suggestion and one “What to improve” suggestion; request-vs-render telemetry was absent. |
| Cross-product navigation was a dead end | No direct Products → Open Mic / Focus Points path. |
| Share feedback could not be sent | PO entered Title twice; state disappeared and Send remained disabled. No successful submission occurred. |
| Retention copy advertises an implementation count | Current newest-two behavior remains unchanged; customer-facing copy must describe availability and expiry without promising a numeric count. |
| Filler/clarity claim was untrustworthy | PostHog saved filler count 0 with high clarity after spoken fillers were stripped upstream. |
| Model comparison could not run | Production had no controlled access to v4 or Moonshine. |

## Current execution

- **#1259** reached remote head `604a89ae7b13f633fb71be0bb7b20f6d867b0c68` with exact-head CI `33912405700` dispatched. Independent PM review returned that head: journey/attempt authority, URL privacy, transcript digest privacy, several event families, stage truth, mic-summary lifecycle, and public-bundle test-account configuration remain blockers. It is not accepted or merge-authorized; real Production PostHog readback remains required after correction.
- **#1415** owns cold one-click start, real waveform/red Stop, provisional stability, and retained completed transcript.
- **#1407** owns the complete truthful Focus Points setup/evaluation/retry journey.
- **#1386** owns the visible and measurable Practice Loop.
- **#1404** owns Products navigation and the exact approved Share feedback redesign.
- **#1117** is closed not planned; its single-transcript proposal is superseded. **#1416** owns the non-numeric retention-copy reconciliation while current newest-two behavior remains unchanged.
- **#1417** owns truthful filler/clarity coaching at the real STT boundary.
- **#1263 / #1304 / #1390** own all-three candidate access and real Production downselection.
- **#1258** remains the final deployed two-product qualification.

## Testing posture

Human testing is paused. Dev must first:

1. complete and independently review the grouped fixes;
2. deploy them to the canonical Production URL under separate PO authorization;
3. prove #1259 event-level readback end to end;
4. run both corpora against each requested/observed candidate;
5. report user-visible results and PostHog receipts.

The PO then repeats the same Production journeys. Missing event families, unavailable candidates, false coaching claims, or unreadable saved work are HOLD.

Model qualification must preserve the earlier runtime lesson: v4 int8/q8 failures on the pre-fix `onnxruntime-web` build were an ONNX Runtime defect tracked by upstream #28306/#28326, not a candidate verdict. The 459-word preflight protected the 600-utterance run from an audio-decoder failure. A fallback is not "second-lowest WER"; it must be dependable across more devices and fail differently from the primary.

## Non-active paths

- No Preview, local/internal build, test branch, `VITE_INTERNAL_BUILD`, `VERCEL_ORG_ID`, or alternate URL is required or approved for the downselection.
- No unrelated dashboard, deployment system, speculative feature, or broad refactor belongs in the recovery work.
- Billing and broad tester activity remain behind the product recovery and final #1258 decision.
