# Release Status

**Status:** Authoritative — current release/deployment posture  
**Owner:** Product Owner (relativityE)  
**Last Reviewed:** 2026-09-04  
**Last Verified:** 2026-09-04 — Production release identity read and reconciled with accepted `main` before the human session.  
**Applies To:** Current SpeakSharp MVP recovery and Production requalification.  
**Authority:** This is the only source for changing release posture, blockers, current execution, and GO/HOLD. Stable contracts live in the other canonical documents.

<!-- CURRENCY-BLOCK
baseline: c4665156212dd03cd6d7b91c49bed90dea868b5a
deployed-release: c4665156212dd03cd6d7b91c49bed90dea868b5a
verified-on: 2026-09-04
release-blocker: production-journey-recovery
retention-campaign: newest-one-approved-pending-implementation
task-1304-1: merged
task-1304-2: merged
task-1304-3a: merged
task-1304-3b: merged
task-1304-3c: merged
task-1304-4: merged
task-1360-recovery-copy: merged
lane-stage-b: superseded-by-production-biopsy
lane-telemetry: in-progress
lane-billing: held-behind-product-recovery
lane-1258-journey: failed-retest-pending
-->

## Disposition

**HOLD — the real Production journeys failed and are not ready for another PO test.**

The canonical URL is https://speaksharp-public.vercel.app. Production and accepted `main` were verified at `c4665156212dd03cd6d7b91c49bed90dea868b5a` for the 4 Sep test.

The accepted fixes are not yet shipped. Green automated tests and prior exact-head CI do not override the human result.

**No Product Owner merge authorization is currently holding up a completed PR.** The blocker is implementation and independent review. When a PR becomes complete and safe, PM must say explicitly if PO authorization is the only remaining step.

## What is merged

| Item | Status |
|---|---|
| #1414 / #1390 Preview mechanics | Merged historically. The custom Preview workflow is not the active test path and must not be dispatched. No revert is authorized merely to remove dormant code. |
| #1413 / #1403 human observer proof | Merged historically. It did not provide complete event-level evidence for the 4 Sep session; reopened #1259 supersedes it as the observer contract. |
| Combined-main CI | `33865704786` completed successfully at `c4665156`: 18 substantive jobs succeeded; only `draft-checks` skipped as expected for dispatch. |

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
| Practice Loop was missing | No two “What went well” / two “What to improve” result appeared; request-vs-render telemetry was absent. |
| Cross-product navigation was a dead end | No direct Products → Open Mic / Focus Points path. |
| Share feedback could not be sent | PO entered Title twice; state disappeared and Send remained disabled. No successful submission occurred. |
| Retention/copy still says two transcripts | Current code and Production retain/display two; approved requirement is newest one. |
| Filler/clarity claim was untrustworthy | PostHog saved filler count 0 with high clarity after spoken fillers were stripped upstream. |
| Model comparison could not run | Production had no controlled access to v4 or Moonshine. |

## Current execution

- **#1259** is reopened and active on remote head `92f0a02c198e5f4fc80d9e1a0d734ec31df30c6b`; exact-head CI `33902441631` is queued. Commits 1–5 of the 13-part implementation are present: correlation identity, observer integrity, retirement of the extra capture boundary, recording intent/stage latency, and transcript authority. This is a checkpoint under review, not an accepted or merge-authorized head; commits 6–13 and real Production PostHog readback remain required.
- **#1415** owns cold one-click start, real waveform/red Stop, provisional stability, and retained completed transcript.
- **#1407** owns the complete truthful Focus Points setup/evaluation/retry journey.
- **#1386** owns the visible and measurable Practice Loop.
- **#1404** owns Products navigation and the exact approved Share feedback redesign.
- **#1117** is reopened for newest-one retention and all matching UI/action copy.
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

## Non-active paths

- No Preview, local/internal build, test branch, `VITE_INTERNAL_BUILD`, `VERCEL_ORG_ID`, or alternate URL is required or approved for the downselection.
- No unrelated dashboard, deployment system, speculative feature, or broad refactor belongs in the recovery work.
- Billing and broad tester activity remain behind the product recovery and final #1258 decision.
