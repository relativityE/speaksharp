# Release Status

**Status:** Authoritative — current release/deployment posture  
**Owner:** Product Owner (relativityE)  
**Last Reviewed:** 2026-09-04  
**Last Verified:** 2026-09-04 — Production release identity read and reconciled with accepted `main` before the human session.  
**Applies To:** Current SpeakSharp MVP recovery and Production requalification.  
**Class:** Runtime and release fact.
**Authority:** This is the only source for changing release posture, blockers, current execution, and GO/HOLD. Stable contracts live in the other canonical documents.
**Not Authoritative For:** stable product behavior (→ `PRODUCT_REQUIREMENTS.md`); system boundaries (→ `ARCHITECTURE.md`); implementation detail or test design (→ source and `QUALITY.md`).
**Supersedes:** conflicting current-status claims in older root documents or historical evidence.
**Evidence Sources:** GitHub `main` and issue/PR state; Production `window.__APP_RELEASE__`; the 4 Sep Production human-test record; exact-head CI and independent review receipts.

<!-- CURRENCY-BLOCK
baseline: c4665156212dd03cd6d7b91c49bed90dea868b5a
deployed-release: c4665156212dd03cd6d7b91c49bed90dea868b5a
verified-on: 2026-09-04
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

The canonical URL is https://speaksharp-public.vercel.app. Production and accepted `main` were verified at `c4665156212dd03cd6d7b91c49bed90dea868b5a` for the 4 Sep test.

The accepted fixes are not yet shipped. Green automated tests and prior exact-head CI do not override the human result.

The repository currency guard verifies committed-file consistency and ancestry only; it cannot read a moving GitHub branch or Production deployment. Those two facts must be re-read externally and recorded here.

**No Product Owner merge authorization is currently holding up a completed PR.** The blocker is implementation and independent review. When a PR becomes complete and safe, PM must say explicitly if PO authorization is the only remaining step.

## What is merged

| Item | Status |
|---|---|
| #1414 / #1390 Preview mechanics | Merged historically. The custom Preview workflow is not the active test path and must not be dispatched. No revert is authorized merely to remove dormant code. |
| #1413 / #1403 human observer proof | Merged historically. It did not provide complete event-level evidence for the 4 Sep session; reopened #1259 supersedes it as the observer contract. |
| Combined-main CI | `33865704786` completed successfully at `c4665156`: 18 substantive jobs succeeded; only `draft-checks` skipped as expected for dispatch. |

| Current identity | Verified value |
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
