# Release Status

**Status:** Authoritative (SSOT for release/deployment posture)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-18
**Last Verified:** 2026-09-18 — reconciled to `main@61597bdc`, which is `main` after PR #1494 (Home, Design Correction Brief H-1…H-5) and PR #1498 (Session, S-8…S-14), on top of PR #1490 (#1259 received-receipt gaps), PR #1467 (Focus Points detection limit), PR #1486 (#1473 automatic Practice Loop suggestions), PR #1493 (Design Correction Brief shared slot map, S-1–S-7 / F-1–F-6), PR #1487 (#1475 G12 signed-out homepage) and PR #1492 (#1294 checkout email sourcing) merged. Open PRs, open issues, the Production migration ledger and the deployed release were re-read at the same time.
**Applies To:** Current production deployment + release tracks for the SpeakSharp beta.
**Class:** Runtime fact.
**Authority:** The only source for changing release/deployment status, baselines, run IDs, blockers, and go/no-go.
**Not Authoritative For:** stable product contracts (→ `PRODUCT_REQUIREMENTS.md`), architecture (→ `ARCHITECTURE.md`), STT contracts (→ `STT.md`), or documentation structure (→ `README.md`).
**Supersedes:** any conflicting current-status claim in `product_release/archive/`, dated evidence, work items, or older root-file text.
**Evidence Sources:** GitHub `main`; Production `window.__APP_RELEASE__`; read-only Migrations Preflight run `35341531149`; merge receipts for PRs #1467, #1486, #1487, #1490, #1492 and #1493; issues #1258, #1263, #1304, #1390, #1471–#1476 and #1495.

> **`baseline` and `deployed-release` CONVERGE, and that is a read, not an inference.** Both are `61597bdcd7a6bd587b3579c4deb6462ef0a98adf`. The deployed release was read directly from `window.__APP_RELEASE__` on the canonical Production app `https://speaksharp-public.vercel.app` at **2026-09-18T23:03:00Z**, by a read-only page load with no interaction and no sign-in. It equals `main`'s tip because the #1498 deploy had propagated by then — **not** because a merge was taken as evidence of a deployment. The criterion below is unchanged and still governs: the deployed release is a read, never inferred from a merge or a moving `main` pointer, so the next time `main` advances these two values diverge again until a new read is taken. The previous entries (`86f7b8e9d654523457da8b2640aa419152adceb0`, read 2026-09-18T11:57:15Z; `ef871fd1`, read 14:45:07Z after #1494) are superseded by this read.

<!-- CURRENCY-BLOCK
# Machine-readable state parsed by tests/config/documentationContract.test.ts.
baseline: 61597bdcd7a6bd587b3579c4deb6462ef0a98adf
deployed-release: 61597bdcd7a6bd587b3579c4deb6462ef0a98adf
verified-on: 2026-09-18
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
lane-1475: merged
lane-1467: merged
lane-1493: merged
lane-design-brief: open
lane-test-identity-roles: open
lane-canary-rotation: open
lane-practice-loop: merged
lane-moonshine: returned
-->

## Disposition

**HOLD — implementation and comparable model evidence are incomplete; Production RWT remains paused.**

| Identity | Current value | Evidence boundary |
|---|---|---|
| **Repository `main` (moving branch pointer)** | `61597bdcd7a6bd587b3579c4deb6462ef0a98adf` (after #1498), read 2026-09-18 | Re-read GitHub before every exact-pair decision. |
| **Deployed product release (last READ)** | `window.__APP_RELEASE__ = 61597bdcd7a6bd587b3579c4deb6462ef0a98adf`, read from the canonical Production app `https://speaksharp-public.vercel.app` at 2026-09-18T23:03:00Z | **A literal read, by read-only page load with no interaction or sign-in.** It currently equals the baseline because the #1498 deploy had propagated when the read was taken; that equality is the observed result, not the method. This value must be re-read before any RWT, deployment or go/no-go claim, and it goes stale the moment `main` advances — a merge is never evidence that it deployed. |
| **Next release-candidate line** | `v0.9.0-rc` | The version step reflects the significance of the current product/release-control update. This is the release line, not an exact tag name or tag authorization. Before tagging, inventory the existing `v0.9.0-rc*` tags, select the next unused monotonically increasing identifier, align `package.json`, and qualify that exact integrated `main` under explicit Product Owner authorization. |
| **Open merge candidates** | PR #1502 (Share feedback retheme, G8), PR #1503 (Focus Points set-up retheme, G7), PR #1504 (FAQ currentization), the #1498 P2 follow-up, PR #1488 (canary exact deployed-take evidence; merge-queue pilot) | Each needs exact-head CI including browser shards, cleared automatic review, PM acceptance and an exact PO head/base authorization. **Automatic Code Review is currently blocked by a Codex usage limit** (Security completed); no merge is authorized until it clears. |
| **Closed unmerged (superseded)** | PR #1497 (allowlist the newest-one retention migration for exact apply) | Closed 2026-09-18 by PO direction: the read-only ledger shows `20260908120000_transcript_retention_newest_one.sql` already **applied** on 2026-09-12 (see *Database migration state* below). Its one durable finding, that the exact-apply gate excludes only later allowlist entries rather than every unselected pending migration, is recorded on the PR for extraction into its own PR. |
| **Test identity redesign** | Issue #1495 | Rewritten as separate auth, full-product, paid and trial identity roles. The consumer inventory precedes any design; no identity, credential or Variable/Secret change is authorized by this document. |
| **Documentation currency** | This currentization (issue #1318) | Restores the baseline to `main@61597bdc`. The currency guard reads committed files and ancestry only. |

The repository currency guard verifies committed-file consistency and ancestry only; it **cannot read a moving GitHub branch or Production deployment**. Those facts must be re-read externally at every decision point.

## Confirmed merged foundation

- #1416 shipped the approved Share feedback form, direct Products navigation, corrected Focus Points wording, and the red Stop control.
- #1463 shipped bounded same-tab progress-debt retry and Start release.
- #1465 replaced invasive model-comparison observation with a disconnected pre-take control.
- #1466 shipped the bounded post-save Practice Loop placement/reveal and truthful rendered telemetry. It did **not** ship the full G10 redesign or restore suggestion generation.
- #1467 explains the Focus Points detection limit on the completed verdict.
- #1486 restored automatic Practice Loop suggestions (issue #1473 stays open until its Production journey is verified).
- #1490 made #1259 fail closed on received-receipt gaps.
- #1493 shipped the Design Correction Brief shared slot map for both products (S-1–S-7, F-1–F-6).
- #1487 shipped the G12 signed-out homepage on the shared theme authority (issue #1475 stays open until PO verification).
- #1492 completed the #1294 email sourcing split for the checkout test identity.
- #1494 shipped the Home redesign (Design Correction Brief H-1…H-5): resume band, peer cards, coaching gated on the persisted Progress verdict.
- #1498 shipped the Session redesign (S-8…S-14): recorder collapse, hairline waveform, THIS RUN rail, run shape without transport, capped transcript, never-dead-end review. Three advisory P2s follow in their own PR.
- #1468 shipped a read-only test-user verification action. Its authorized run reported that the configured Free and Pro reviewer identities were absent from Production auth; it made no account, profile, secret, entitlement, or Production data change.

## Release-blocking closure work

1. **Close current PRs serially.** Merged 2026-09-16…18: #1477, #1486, #1467, #1487, #1490, #1493, #1492, #1494 and #1498. Open now: PR #1502, #1503, #1504, the #1498 P2 follow-up, #1499 (this document) and PR #1488. Each restacks and requalifies on the exact head after every `main` advance.
2. **Progress integrity:** #1471 must treat empty `{}` as unobservable unless completeness is affirmative; #1476 must prevent cross-tab queue loss.
3. **Practice Loop availability:** PR #1486 restored automatic generation; #1473 remains open for Production journey verification and owns automatic 1+1 review generation, structured cause handling, and truthful retry. The observed Production failure reached a `42501` profile-read denial before the quota path; a quota-exhaustion explanation is refuted for those requests.
4. **Filler truth:** #1472 owns persisted `complete | unobservable | no_speech` semantics across Session, Analytics, PDF, Progress, recovery, and telemetry.
5. **Moonshine deferral:** #1263 has local fixes for slow acquisition and failed-switch retry, but the real ~95-second probe reproduced an unsanitized repeated 25-word span in all three runs, plus abrupt-stop tail loss and an 18-word live rewrite. Moonshine is therefore **deferred until after RWT or MVP and is not a prerequisite for the current RWT**: it does not gate a stop, qualification, or release. The integrity findings stand and are the reason for the deferral; never deduplicate or sanitize model output to manufacture a pass.
6. **Comparable v4-over-v2 validation:** the approved TARGET is **v4 as the customer primary on WebGPU-capable devices** (it has the maintained model-release pipeline) with **v2 as the pre-Start fallback, locked for the take**. **Production remains v2-only for ordinary customers today**: v4 is registered `activationReady: false`, so the **configured/default** path in a public build cannot select it. That restriction is about the default path only. A separately authorized, one-use signed Production comparison can still install the runtime v4 override — `installRuntimeCandidateSwitch()` accepts an internal build **or** a consumed `consumeModelComparisonAuthorization()`, and `effectiveCandidate()` then returns the override without the activation check, deliberately, because the comparison must run candidates before one can be approved. That path **collects evidence and does not promote v4 as the customer default**. Nothing here is a statement about what ordinary customers receive. #1304/#1390 must supply like-for-like **v2 and v4** rows on the same corpus, canonical model identity, word-count authority, filler-completeness state, WER, latency, stability, and requested/observed release identity. That evidence confirms the standing choice; it is **not** a three-model down-selection, and Moonshine rows are not required for it. During internal comparison, v4 may report an honest `unobservable` cache result while its asset pins are unshipped test material. Because v4 is the provisional primary, measurable cache-versus-network acquisition plus download duration or a directly measured no-download outcome is a **pre-MVP blocker**. The primary must report candidate/model identity, total setup time, cache result, and download/no-download evidence.
7. **Product presentation:** #1474 owns the complete G10 during/after Practice Loop hierarchy and theme; the Design Correction Brief continues it in PR #1493, PR #1494 (Home) and PR #1498 (Session), all merged; modal retheme G7/G8 and the FAQ are open. #1475 (PR #1487 merged, pending PO verification) owns the approved G12 landing page and the exact “30 days free, no card. Then $10/month. Cancel any time.” offer.
8. **Final evidence:** #1259 and #1382/#1383/#1384 own received-event reliability, clean baseline, SLOs, dashboard/alert, and cleanup proof. #1258 remains the final deployed two-product, real-device PO GO/HOLD.

Other pre-GO owners remain active where their condition is reached: #1254 final copy scan, #1261 hosted read-only SECURITY DEFINER classification, #1313/#1315/#1385 CI truth, #1360 abandonment return, #1407 Focus Points truth, and #1452 before newest-one retention activation.

## Database migration state (last READ)

Read-only Migrations Preflight run `35341531149` (2026-09-18, success) read the Production ledger and dry-ran the queue without applying anything:

- **Applied**, among others: `20260812041500` (the current `check_usage_limit` definition; nothing later on `main` redefines it), `20260903140000`, `20260904150000` and **`20260908120000_transcript_retention_newest_one.sql`**.
- **Pending**: `20260910193000_ai_suggestion_authority_receipt.sql` and `20260914214307_objective_eligibility_reads_attribution_authority.sql` (#1469).
- The three September migrations above were applied together on **2026-09-12** by the whole-queue `supabase db push` in "Deploy Supabase" run `34691493637`, not by the exact-allowlist workflow. The migration installs newest-one retention **inert** (`transcript_retention_activation.activated_at` is created NULL, and every save's convergence returns `deferred / retention_not_activated`). No repository path calls the activation RPC. Whether it was activated manually after 2026-09-12 is **unverified**: the read-only `transcript-retention-preflight` run `35348438630` stopped before connecting because its `PREFLIGHT_READONLY_DB_URL` secret is not provisioned. **Installation alone changed behaviour:** it replaced the unconditional newest-two expiry, so no transcript expiry has run on save since 2026-09-12. #1452 stays open. PM and the Product Owner must disposition both facts (evidence on #1452 and PR #1497, which was closed unmerged as superseded). This document records the reads and authorizes nothing.
- The ledger proves which migrations ran, not the function bodies. Byte-level confirmation of a deployed definition needs a catalog read.

## RWT status

The prior RWT is **incomplete**:

- Stop B is partial; the authorized v4 observation is descriptive, and is not yet the comparable row that validates v4 against v2.
- The official v2 Stop B cell did not run.
- Stop A and RWT-02/03/04 did not run.
- Stop C still needs #1469, #1467, #1473, a deployed exact release, and working managed test identities.
- Stop D does not depend on Moonshine, which is deferred until after RWT or MVP. Its long-form integrity findings are the reason for that deferral, not a gate on this RWT.
- v4 stands as the approved primary and v2 as the fallback, as a TARGET rather than a deployed state. That standing choice is confirmed — not reopened — once v2 and v4 satisfy one comparable evidence contract; Moonshine is not part of that contract. The four-cell comparison supplies the pre-promotion evidence, #1263 implements the selector, and until that promotion merges and deploys, Production serves v2 only.
- A fallback is not "second-lowest WER"; it must be dependable across more devices and fail differently from the primary.

No Production RWT, migration, Edge/config change, credential/account repair, payment activation, deployment, or merge is authorized by this document.

## Accepted limitations and retained debt

- The ≈90-second post-Stop finalization figure for a full five-minute Private v2 recording is a conservative planning allowance, not a measured Production p95 and not a requirement to wait 90 seconds. The UI must show honest Finalizing progress; comparable RWT rows must record observed stop-to-final latency. The former <30-second requirement remains withdrawn.
- #1354's write-ahead obligation is still client-only: if Progress evaluation and the browser obligation write fail together and the user reloads after storage recovers, the obligation cannot be reconstructed without a server-side record. #1471/#1476 may reduce adjacent failure modes but do not close this retained debt unless their exact evidence proves reconstruction.

## External Admin/Ops dependencies

- Repair or recreate the missing managed reviewer identities only through the approved credential path and only under exact-action Product Owner authorization.
- Read the Production grant matrix and sanitized Edge failure code for #1473. Do not infer a grant from browser symptoms, and do not expose credentials or row content.
- Repair the canary trial fixture: current failures stop at test-user provisioning before any product journey executes.
- Test identities are being redesigned under #1495 (auth, full-product, paid and trial roles). The Free test identity was recreated under exact PO authorization; any further identity creation, including a standing run-scoped capability, needs its own exact authorization.

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
2. **A migration changes Production product behaviour only when it is separately applied, never when its file merges.** `backend/supabase/migrations/**` is a *database* change tracked separately. Merging the file and applying it to Production are two events, and only the second alters behaviour. #1469's migration (`20260914214307`) merged on `734d045a` and was still unapplied at the 2026-09-18 ledger read; that is the current live example.
3. **Tests, evidence, canonical documents and non-runtime scripts never become product behaviour by PR title.** A PR titled `fix(...)` that touches only `tests/**` deploys nothing. The classification follows the files, not the subject line.
4. **Deployment verification follows the actual affected runtime surface, never title inference.** A frontend change is verified by reading `window.__APP_RELEASE__` on the canonical Production app; an Edge change is verified against that function; a migration is verified by its applied state. Choosing the check from the PR title rather than the changed files is how an unverified deployment gets recorded as verified.

**Deployed release identity is READ, never inferred.** The Production release is read from `window.__APP_RELEASE__` on the canonical Production app. It is never inferred from a merge, a deployment trigger, or a moving `main` pointer — those establish that a deployment was *attempted*, not which build is serving users.

**No claim is made here about relative engine accuracy, in either direction.** Vendor figures are reference-only and must not be compared against our own corpus results — differing corpora and decode paths make such a comparison an artifact rather than a measurement. The #1304 lane exists to produce a defensible ranking; until it does, there is none.

## Non-active paths

No Preview, local/internal build, test branch, `VITE_INTERNAL_BUILD`, `VERCEL_ORG_ID`, or alternate URL is approved for Product Owner model downselection. Billing activation, broad tester invitations, and unrelated post-MVP debt remain behind the final #1258 decision.
