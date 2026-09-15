# Release Status

**Status:** Authoritative (SSOT for release/deployment posture)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-15
**Last Verified:** 2026-09-15 — GitHub `main`, the #1468 post-merge deployment receipt, open PRs, exact-head #1469 checks, the 29-issue backlog, and current RWT evidence were reconciled.
**Applies To:** Current production deployment + release tracks for the SpeakSharp beta.
**Class:** Runtime fact.
**Authority:** The only source for changing release/deployment status, baselines, run IDs, blockers, and go/no-go.
**Not Authoritative For:** stable product contracts (→ `PRODUCT_REQUIREMENTS.md`), architecture (→ `ARCHITECTURE.md`), STT contracts (→ `STT.md`), or documentation structure (→ `README.md`).
**Supersedes:** any conflicting current-status claim in `product_release/archive/`, dated evidence, work items, or older root-file text.
**Evidence Sources:** GitHub `main`; Production `window.__APP_RELEASE__`; PR #1468 closure receipt; PR #1469 exact-head checks; issues #1263, #1390, #1399, and #1471–#1476.

<!-- CURRENCY-BLOCK
# Machine-readable state parsed by tests/config/documentationContract.test.ts.
baseline: 8e638c844d101312b507e84fd9559467f6eb0c82
deployed-release: 8e638c844d101312b507e84fd9559467f6eb0c82
verified-on: 2026-09-15
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
lane-telemetry: open
lane-retention-copy: open
lane-billing: off-critical-path
lane-1258-journey: returned
lane-1469: open
lane-practice-loop: open
lane-moonshine: returned
-->

## Disposition

**HOLD — implementation and comparable model evidence are incomplete; Production RWT remains paused.**

| Identity | Current value | Evidence boundary |
|---|---|---|
| **Repository `main` (moving branch pointer)** | `8e638c844d101312b507e84fd9559467f6eb0c82` (#1468), read 2026-09-15 | Re-read GitHub before every exact-pair decision. |
| **Deployed product release (verified)** | `window.__APP_RELEASE__ = 8e638c844d101312b507e84fd9559467f6eb0c82`, reported from the canonical Production app after #1468 | A deployment receipt is point-in-time evidence; re-read before any RWT. |
| **Next release-candidate line** | `v0.9.0-rc` | The version step reflects the significance of the current product/release-control update. This is the release line, not an exact tag name or tag authorization. Before tagging, inventory the existing `v0.9.0-rc*` tags, select the next unused monotonically increasing identifier, align `package.json`, and qualify that exact integrated `main` under explicit Product Owner authorization. |
| **Next merge candidate** | PR #1469, head `33ced29f4352b8f65244c3b34771fcf1d8140435` into base `8e638c844d101312b507e84fd9559467f6eb0c82` | Exact-head CI and automatic reviews were running at this review; no PM acceptance or PO merge authorization is implied. |
| **Next product lane** | PR #1467 after #1469 | Restack and exact-head evidence are required after `main` moves. |
| **Queued gate/docs implementation** | PR #1477 | Frozen behind #1469 because it changes review-qualification code. After #1469 closes, restack/currentize once and repeat exact-head reviews and CI. |

The repository currency guard verifies committed-file consistency and ancestry only; it **cannot read a moving GitHub branch or Production deployment**. Those facts must be re-read externally at every decision point.

## Confirmed merged foundation

- #1416 shipped the approved Share feedback form, direct Products navigation, corrected Focus Points wording, and the red Stop control.
- #1463 shipped bounded same-tab progress-debt retry and Start release.
- #1465 replaced invasive model-comparison observation with a disconnected pre-take control.
- #1466 shipped the bounded post-save Practice Loop placement/reveal and truthful rendered telemetry. It did **not** ship the full G10 redesign or restore suggestion generation.
- #1468 shipped a read-only test-user verification action. Its authorized run reported that the configured Free and Pro reviewer identities were absent from Production auth; it made no account, profile, secret, entitlement, or Production data change.

## Release-blocking closure work

1. **Close current PRs serially:** qualify/accept/authorize #1469, then restack and close #1467.
2. **Progress integrity:** #1471 must treat empty `{}` as unobservable unless completeness is affirmative; #1476 must prevent cross-tab queue loss.
3. **Practice Loop availability:** #1473 owns automatic 1+1 review generation, structured cause handling, and truthful retry. The observed Production failure reached a `42501` profile-read denial before the quota path; a quota-exhaustion explanation is refuted for those requests.
4. **Filler truth:** #1472 owns persisted `complete | unobservable | no_speech` semantics across Session, Analytics, PDF, Progress, recovery, and telemetry.
5. **Moonshine readiness:** #1263 has local fixes for slow acquisition and failed-switch retry, but the real ~95-second probe reproduced an unsanitized repeated 25-word span in all three runs, plus abrupt-stop tail loss and an 18-word live rewrite. Moonshine remains a P1 RWT blocker; do not deduplicate or sanitize model output to manufacture a pass.
6. **Comparable downselection:** #1304/#1390 require like-for-like v2, v4, and Moonshine rows with the same corpus, canonical model identity, word-count authority, filler-completeness state, WER, latency, stability, and requested/observed release identity. During internal comparison, v4 may report an honest `unobservable` cache result while its asset pins are unshipped test material. If v4 is selected, measurable cache-versus-network acquisition plus download duration or a directly measured no-download outcome becomes a **pre-MVP blocker**. The selected model must report candidate/model identity, total setup time, cache result, and download/no-download evidence.
7. **Product presentation:** #1474 owns the complete G10 during/after Practice Loop hierarchy and theme. #1475 owns the approved G12 landing page and the exact “30 days free, no card. Then $10/month. Cancel any time.” offer.
8. **Final evidence:** #1259 and #1382/#1383/#1384 own received-event reliability, clean baseline, SLOs, dashboard/alert, and cleanup proof. #1258 remains the final deployed two-product, real-device PO GO/HOLD.

Other pre-GO owners remain active where their condition is reached: #1254 final copy scan, #1261 hosted read-only SECURITY DEFINER classification, #1313/#1315/#1385 CI truth, #1360 abandonment return, #1407 Focus Points truth, and #1452 before newest-one retention activation.

## RWT status

The prior RWT is **incomplete**:

- Stop B is partial; the authorized v4 observation is descriptive, not a downselection row.
- The official v2 Stop B cell did not run.
- Stop A and RWT-02/03/04 did not run.
- Stop C still needs #1469, #1467, #1473, a deployed exact release, and working managed test identities.
- Stop D cannot begin while Moonshine fails long-form integrity.
- No model may be selected until v2, v4, and Moonshine satisfy one comparable evidence contract.
- A fallback is not "second-lowest WER"; it must be dependable across more devices and fail differently from the primary.

No Production RWT, migration, Edge/config change, credential/account repair, payment activation, deployment, or merge is authorized by this document.

## Accepted limitations and retained debt

- The ≈90-second post-Stop finalization figure for a full five-minute Private v2 recording is a conservative planning allowance, not a measured Production p95 and not a requirement to wait 90 seconds. The UI must show honest Finalizing progress; comparable RWT rows must record observed stop-to-final latency. The former <30-second requirement remains withdrawn.
- #1354's write-ahead obligation is still client-only: if Progress evaluation and the browser obligation write fail together and the user reloads after storage recovers, the obligation cannot be reconstructed without a server-side record. #1471/#1476 may reduce adjacent failure modes but do not close this retained debt unless their exact evidence proves reconstruction.

## External Admin/Ops dependencies

- Repair or recreate the missing managed reviewer identities only through the approved credential path and only under exact-action Product Owner authorization.
- Read the Production grant matrix and sanitized Edge failure code for #1473. Do not infer a grant from browser symptoms, and do not expose credentials or row content.
- Repair the canary trial fixture: current failures stop at test-user provisioning before any product journey executes.

## Non-active paths

No Preview, local/internal build, test branch, `VITE_INTERNAL_BUILD`, `VERCEL_ORG_ID`, or alternate URL is approved for Product Owner model downselection. Billing activation, broad tester invitations, and unrelated post-MVP debt remain behind the final #1258 decision.
