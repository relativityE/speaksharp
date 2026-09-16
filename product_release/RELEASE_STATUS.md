# Release Status

**Status:** Authoritative (SSOT for release/deployment posture)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-15
**Last Verified:** 2026-09-16 — reconciled to `main@28b66bc4`, which is `main` after PR #1469 (Focus Points attribution authority), PR #1483 (read-only canary identity inspection), PR #1481 (shared site theme authority and all-page migration) and PR #1489 (issue #1474, the G10 Practice Loop hierarchy) have all merged. Open PRs, the backlog, and current RWT evidence were re-read at the same time.
**Applies To:** Current production deployment + release tracks for the SpeakSharp beta.
**Class:** Runtime fact.
**Authority:** The only source for changing release/deployment status, baselines, run IDs, blockers, and go/no-go.
**Not Authoritative For:** stable product contracts (→ `PRODUCT_REQUIREMENTS.md`), architecture (→ `ARCHITECTURE.md`), STT contracts (→ `STT.md`), or documentation structure (→ `README.md`).
**Supersedes:** any conflicting current-status claim in `product_release/archive/`, dated evidence, work items, or older root-file text.
**Evidence Sources:** GitHub `main`; Production `window.__APP_RELEASE__`; PR #1469, PR #1483 and PR #1481 merge receipts; issues #1258, #1263, #1304, #1390, #1399, and #1471–#1476.

> **`baseline` and `deployed-release` deliberately differ, and that is not an oversight.** The baseline is `main`'s current tip, `28b66bc422ad90b2f785ae4f03f7858196fbcbe3`. The deployed release is recorded as `734d045adafcdb8cc00cf95b5b3bbc5bfa7e4dc3` because that is the **last value actually read** from `window.__APP_RELEASE__` on the canonical Production app, on 2026-09-15 after #1469. **Three** merges have landed since and it has **not** been re-read. Per the criterion below, the deployed release is a read and is never inferred from a merge or a moving `main` pointer, so this file records the last read rather than assuming the merges deployed. **The gap is now materially larger, and differently shaped.** #1483 changed only `scripts/**`, `.github/workflows/**` and tests, so no bundle file moved. #1481 and #1489 are not of that kind: #1481 migrated colour across `frontend/src/**` and #1489 restructured the completed-session surface, so bundle files certainly moved and a visible change is expected — on every surface for the first, and on the post-save review for the second. The recorded value is therefore stale by a change a user would see, and only a Production read settles what is live.

<!-- CURRENCY-BLOCK
# Machine-readable state parsed by tests/config/documentationContract.test.ts.
baseline: 28b66bc422ad90b2f785ae4f03f7858196fbcbe3
deployed-release: 734d045adafcdb8cc00cf95b5b3bbc5bfa7e4dc3
verified-on: 2026-09-16
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
lane-1469: merged
lane-1483: merged
lane-1481: merged
lane-1474: merged
lane-1475: open
lane-canary-rotation: open
lane-practice-loop: open
lane-moonshine: returned
-->

## Disposition

**HOLD — implementation and comparable model evidence are incomplete; Production RWT remains paused.**

| Identity | Current value | Evidence boundary |
|---|---|---|
| **Repository `main` (moving branch pointer)** | `28b66bc422ad90b2f785ae4f03f7858196fbcbe3` (after #1489 / issue #1474), read 2026-09-16 | Re-read GitHub before every exact-pair decision. |
| **Deployed product release (last READ, not current)** | `window.__APP_RELEASE__ = 734d045adafcdb8cc00cf95b5b3bbc5bfa7e4dc3`, read from the canonical Production app on 2026-09-15 after #1469 | **Stale by two merges and deliberately not updated by inference.** #1483 and then #1481 have merged; Production has not been re-read. #1483 touched only `scripts/**`, `.github/workflows/**` and tests, so no bundle file moved. #1481 migrated colour across `frontend/src/**`, so bundles moved and a visible change on every surface is expected — an expectation, not a read. Re-read before any RWT, deployment or go/no-go claim. |
| **Next release-candidate line** | `v0.9.0-rc` | The version step reflects the significance of the current product/release-control update. This is the release line, not an exact tag name or tag authorization. Before tagging, inventory the existing `v0.9.0-rc*` tags, select the next unused monotonically increasing identifier, align `package.json`, and qualify that exact integrated `main` under explicit Product Owner authorization. |
| **Next merge candidate** | PR #1487 (issue #1475), head `797e2ea39fdf17d8f17c02cc55f734bdf0f5a0b5` into base `28b66bc422ad90b2f785ae4f03f7858196fbcbe3` | Restacked once onto current `main` and frozen. This head also folds in the filler-series token migration, so the reviews on its predecessor do not qualify it. No PM acceptance or PO merge authorization is implied. |
| **Next product lane** | PR #1467 | Its token dependency is discharged: `brand-neutral-secondary` existed only on #1481's branch and is now on `main`. Restack and exact-head evidence are still required after `main` moves. |
| **Queued gate/docs implementation** | PR #1477 | **Frozen behind the active product PR, which is PR #1487.** #1469, #1483 and #1481 having merged does not discharge the freeze — it serialises this lane behind whichever product PR holds the merge token, so it does not become the next merge candidate by predecessors closing. Restacked and currentized once onto `28b66bc4`; exact-head reviews and CI follow. Its gate change stays limited to the 14 canonical `product_release/*.md` paths — PNG and test-only qualification are explicitly out of scope and tracked as a P2 on #1399. |

The repository currency guard verifies committed-file consistency and ancestry only; it **cannot read a moving GitHub branch or Production deployment**. Those facts must be re-read externally at every decision point.

## Confirmed merged foundation

- #1416 shipped the approved Share feedback form, direct Products navigation, corrected Focus Points wording, and the red Stop control.
- #1463 shipped bounded same-tab progress-debt retry and Start release.
- #1465 replaced invasive model-comparison observation with a disconnected pre-take control.
- #1466 shipped the bounded post-save Practice Loop placement/reveal and truthful rendered telemetry. It did **not** ship the full G10 redesign or restore suggestion generation.
- #1468 shipped a read-only test-user verification action. Its authorized run reported that the configured Free and Pro reviewer identities were absent from Production auth; it made no account, profile, secret, entitlement, or Production data change.

## Release-blocking closure work

1. **Close current PRs serially:** #1469, #1483, #1481 and #1489 (issue #1474) are merged; #1489 landed as `28b66bc422ad90b2f785ae4f03f7858196fbcbe3`. PR #1487 (issue #1475) is open at head `797e2ea39fdf17d8f17c02cc55f734bdf0f5a0b5`, awaiting exact-head reviews, then PM acceptance and an exact Product Owner head/base authorization; then restack and close #1467.
2. **Progress integrity:** #1471 must treat empty `{}` as unobservable unless completeness is affirmative; #1476 must prevent cross-tab queue loss.
3. **Practice Loop availability:** #1473 owns automatic 1+1 review generation, structured cause handling, and truthful retry. The observed Production failure reached a `42501` profile-read denial before the quota path; a quota-exhaustion explanation is refuted for those requests.
4. **Filler truth:** #1472 owns persisted `complete | unobservable | no_speech` semantics across Session, Analytics, PDF, Progress, recovery, and telemetry.
5. **Moonshine deferral:** #1263 has local fixes for slow acquisition and failed-switch retry, but the real ~95-second probe reproduced an unsanitized repeated 25-word span in all three runs, plus abrupt-stop tail loss and an 18-word live rewrite. Moonshine is therefore **deferred until after RWT or MVP and is not a prerequisite for the current RWT**: it does not gate a stop, qualification, or release. The integrity findings stand and are the reason for the deferral; never deduplicate or sanitize model output to manufacture a pass.
6. **Comparable v4-over-v2 validation:** the current decision is **v4 provisional primary** (it has the maintained model-release pipeline) with **v2 as fallback**. #1304/#1390 must supply like-for-like **v2 and v4** rows on the same corpus, canonical model identity, word-count authority, filler-completeness state, WER, latency, stability, and requested/observed release identity. That evidence confirms the standing choice; it is **not** a three-model down-selection, and Moonshine rows are not required for it. During internal comparison, v4 may report an honest `unobservable` cache result while its asset pins are unshipped test material. Because v4 is the provisional primary, measurable cache-versus-network acquisition plus download duration or a directly measured no-download outcome is a **pre-MVP blocker**. The primary must report candidate/model identity, total setup time, cache result, and download/no-download evidence.
7. **Product presentation:** #1474 owns the complete G10 during/after Practice Loop hierarchy and theme. #1475 owns the approved G12 landing page and the exact “30 days free, no card. Then $10/month. Cancel any time.” offer.
8. **Final evidence:** #1259 and #1382/#1383/#1384 own received-event reliability, clean baseline, SLOs, dashboard/alert, and cleanup proof. #1258 remains the final deployed two-product, real-device PO GO/HOLD.

Other pre-GO owners remain active where their condition is reached: #1254 final copy scan, #1261 hosted read-only SECURITY DEFINER classification, #1313/#1315/#1385 CI truth, #1360 abandonment return, #1407 Focus Points truth, and #1452 before newest-one retention activation.

## RWT status

The prior RWT is **incomplete**:

- Stop B is partial; the authorized v4 observation is descriptive, and is not yet the comparable row that validates v4 against v2.
- The official v2 Stop B cell did not run.
- Stop A and RWT-02/03/04 did not run.
- Stop C still needs #1469, #1467, #1473, a deployed exact release, and working managed test identities.
- Stop D does not depend on Moonshine, which is deferred until after RWT or MVP. Its long-form integrity findings are the reason for that deferral, not a gate on this RWT.
- v4 stands as the provisional primary and v2 as the fallback. That standing choice is confirmed — not reopened — once v2 and v4 satisfy one comparable evidence contract; Moonshine is not part of that contract.
- A fallback is not "second-lowest WER"; it must be dependable across more devices and fail differently from the primary.

No Production RWT, migration, Edge/config change, credential/account repair, payment activation, deployment, or merge is authorized by this document.

## Accepted limitations and retained debt

- The ≈90-second post-Stop finalization figure for a full five-minute Private v2 recording is a conservative planning allowance, not a measured Production p95 and not a requirement to wait 90 seconds. The UI must show honest Finalizing progress; comparable RWT rows must record observed stop-to-final latency. The former <30-second requirement remains withdrawn.
- #1354's write-ahead obligation is still client-only: if Progress evaluation and the browser obligation write fail together and the user reloads after storage recovers, the obligation cannot be reconstructed without a server-side record. #1471/#1476 may reduce adjacent failure modes but do not close this retained debt unless their exact evidence proves reconstruction.

## External Admin/Ops dependencies

- Repair or recreate the missing managed reviewer identities only through the approved credential path and only under exact-action Product Owner authorization.
- Read the Production grant matrix and sanitized Edge failure code for #1473. Do not infer a grant from browser symptoms, and do not expose credentials or row content.
- Repair the canary trial fixture: current failures stop at test-user provisioning before any product journey executes.

## Criterion: what counts as a product-behavior release

This section was removed by an earlier revision of this currentization and is restored, because without it the release-track posture below has no stated rule and a later reader must guess.

A commit changes product behavior **iff it modifies a file that reaches the shipped bundle or a deployed Edge function**. Concretely:

- under `frontend/src/`, **and**
- **not** in a `__tests__/` directory, and not a `*.test.*` / `*.spec.*` file, and
- not under `frontend/src/e2e/` (harness-only contracts);
- **or** under `backend/supabase/functions/`, excluding that tree's own `*.test.ts` files.

Everything else — `tests/**`, `scripts/**`, docs — deploys without changing runtime behavior.

> **Worked example, because "touches `frontend/src`" is NOT the criterion.** `5f378898` (#1357) modifies exactly one file under `frontend/src/`: `components/session/__tests__/benchmarkHarnessSurface.test.tsx`. It is a test file, so it does not reach the bundle and #1357 is not a product-behavior release. A future reader applying "touches `frontend/src`" mechanically would get the opposite answer — which is why the rule is stated rather than implied.

Four distinctions the rule depends on, stated so they cannot be collapsed:

1. **Deployed frontend runtime *or* Edge-function behaviour counts.** The original rule named only the frontend bundle. An Edge function is deployed product surface, so a change there is product behaviour even though no bundle file moved.
2. **A migration changes Production product behaviour only when it is separately applied, never when its file merges.** `backend/supabase/migrations/**` is a *database* change tracked separately. Merging the file and applying it to Production are two events, and only the second alters behaviour. #1469's migration merged on `734d045a` and remains unapplied; that is the current live example.
3. **Tests, evidence, canonical documents and non-runtime scripts never become product behaviour by PR title.** A PR titled `fix(...)` that touches only `tests/**` deploys nothing. The classification follows the files, not the subject line.
4. **Deployment verification follows the actual affected runtime surface, never title inference.** A frontend change is verified by reading `window.__APP_RELEASE__` on the canonical Production app; an Edge change is verified against that function; a migration is verified by its applied state. Choosing the check from the PR title rather than the changed files is how an unverified deployment gets recorded as verified.

**Deployed release identity is READ, never inferred.** The Production release is read from `window.__APP_RELEASE__` on the canonical Production app. It is never inferred from a merge, a deployment trigger, or a moving `main` pointer — those establish that a deployment was *attempted*, not which build is serving users.

**No claim is made here about relative engine accuracy, in either direction.** Vendor figures are reference-only and must not be compared against our own corpus results — differing corpora and decode paths make such a comparison an artifact rather than a measurement. The #1304 lane exists to produce a defensible ranking; until it does, there is none.

## Non-active paths

No Preview, local/internal build, test branch, `VITE_INTERNAL_BUILD`, `VERCEL_ORG_ID`, or alternate URL is approved for Product Owner model downselection. Billing activation, broad tester invitations, and unrelated post-MVP debt remain behind the final #1258 decision.
