# Release Status

**Status:** Authoritative (SSOT for release/deployment posture)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-23
**Last Verified:** 2026-09-23 — GitHub `main@1319e8b5803bf535b947f7587d215f3a4f118044` (`git ls-remote`), six open PRs and 34 open issues verified. The latest documented Production browser read is from 2026-09-22; Production was **not** re-read for this update. The migration ledger was **not** re-read after 2026-09-18.
**Applies To:** Current production deployment + release tracks for the SpeakSharp beta.
**Class:** Runtime fact.
**Authority:** The only source for changing release/deployment status, baselines, run IDs, blockers, and go/no-go.
**Not Authoritative For:** stable product contracts (→ `PRODUCT_REQUIREMENTS.md`), architecture (→ `ARCHITECTURE.md`), STT contracts (→ `STT.md`), or documentation structure (→ `README.md`).
**Supersedes:** any conflicting current-status claim in `product_release/archive/`, dated evidence, work items, or older root-file text.
**Evidence Sources:** GitHub `main`; Production `window.__APP_RELEASE__`; read-only Migrations Preflight run `35341531149`; merge receipts for PRs #1467, #1486, #1487, #1490, #1492, #1493, #1494, #1498, #1502–#1512; read-only identity inventory run `35467307725` (#1500); issues #1258, #1263, #1304, #1390, #1471–#1476 and #1495.

> **Repository and last-observed deployment differ.** GitHub `main@1319e8b5803bf535b947f7587d215f3a4f118044` was read 2026-09-23. A fresh signed-out Production browser read [on #1522](https://github.com/relativityE/speaksharp/issues/1522#issuecomment-5786356653) reported `window.__APP_RELEASE__ = be64b300a2a964501544f4f6421b9b5504f95a74` at approximately 2026-09-22T23:50Z. That is the **last documented observation, not a current Production verification**. Read Production again before RWT or GO/HOLD; never infer deployment from `main` or a successful deploy status.

<!-- CURRENCY-BLOCK
# Machine-readable state parsed by tests/config/documentationContract.test.ts.
baseline: 1319e8b5803bf535b947f7587d215f3a4f118044
deployed-release: be64b300a2a964501544f4f6421b9b5504f95a74
verified-on: 2026-09-23
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
| **Repository `main` (moving branch pointer)** | `1319e8b5803bf535b947f7587d215f3a4f118044`, read 2026-09-23 by `git ls-remote`. | Re-read GitHub before every exact-pair decision. |
| **Deployed product release (last READ)** | `window.__APP_RELEASE__ = be64b300a2a964501544f4f6421b9b5504f95a74`, reported in a signed-out Production read at approximately 2026-09-22T23:50Z ([receipt](https://github.com/relativityE/speaksharp/issues/1522#issuecomment-5786356653)). | Last observation, **not** independently re-read in this currentization. Re-read before RWT or go/no-go; `main` is newer and does not prove what Production currently serves. |
| **Next release-candidate line** | `v0.9.0-rc` | The version step reflects the significance of the current product/release-control update. This is the release line, not an exact tag name or tag authorization. Before tagging, inventory the existing `v0.9.0-rc*` tags, select the next unused monotonically increasing identifier, align `package.json`, and qualify that exact integrated `main` under explicit Product Owner authorization. |
| **Open PR inventory** | #1525 (Draft, RWT front), #1521 (Ready, follows #1525), #1488 (Ready but unmergeable), #1523 (Ready, telemetry preparation), #1517 (Draft, parked), #1526 (Draft, CI follow-up): **six open** at 2026-09-23 GitHub read. | None is authorized to merge; see ROADMAP for ordering. Exact-head review, required CI, PM acceptance and PO head/base authorization remain separate. |
| **Closed unmerged (superseded)** | PR #1497 (allowlist the newest-one retention migration for exact apply) | Closed 2026-09-18 by PO direction: the read-only ledger shows `20260908120000_transcript_retention_newest_one.sql` already **applied** on 2026-09-12 (see *Database migration state* below). Its one durable finding, that the exact-apply gate excludes only later allowlist entries rather than every unselected pending migration, is recorded on the PR for extraction into its own PR. |
| **Test identity redesign** | Issue #1495 | Rewritten as separate auth, full-product, paid and trial identity roles. The consumer inventory precedes any design; no identity, credential or Variable/Secret change is authorized by this document. |
| **Documentation currency** | #1318; this checkpoint records GitHub `main@1319e8b58`, last documented Production read and all open PR/issue IDs. | Currency guard checks committed files and ancestry, not a live Production deployment or migration ledger. |

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
- #1502 shipped the Share feedback retheme (G8): white surface, one selection colour, a neutral disabled Send, and the spec §7 provenance line.
- #1498 shipped the Session redesign (S-8…S-14): recorder collapse, hairline waveform, THIS RUN rail, run shape without transport, capped transcript, never-dead-end review. Three advisory P2s follow in their own PR.
- #1505 shipped the three #1498 P2 follow-ups (gated returned mic, fillers mapped to their peak bucket, review heading restored).
- #1503 shipped the Focus Points set-up retheme (G7): yellow primary, neutral disabled state.
- #1504 currentized every FAQ answer to the shipped contracts with contract tests; #1507 corrected its first-session answer to quote the Progress panel's real text (`Baseline established`), bound to the source string.
- #1508 made Sign Out land on the anonymous landing `/` from every protected page (it had raced to an empty `/auth`); PO-verified on Production.
- #1506 shipped the Session `before` state (G16): the `Clarity vs last session` card with honest no-number bodies (the numeric body is a follow-up), tracked-filler card, mic status beside the button (wrapping below it on phones).
- #1512 removed the duplicate tracked-word list from the filler popover: #1506 had listed each custom word twice in one popover, which also turned `user-filler-words.e2e` red on `main@289da05a` (deterministic, not flaky — it failed wherever that spec was sharded).
- #1511 shipped #1501 piece 1: the CI lane now runs for merge-queue candidates (`merge_group`). **No repository setting was changed.** Piece 2 — making `report` a required status check and then enabling the queue on `main` — is unstarted and needs separate PO authorization; `main` currently requires zero status checks (`strict: true`, `checks: []`, read 2026-09-20), so enabling the queue first would merge candidates with no CI gate.
- #1509 shipped G17 landing terms: the commercial terms stated twice (the hero line “Free for 30 days, $10/month after.” and the pricing block), no “no card”, no terms in the closing band (superseding #1470's closing-band copy, PO + PM accepted), a plain forward-looking line in place of the dead Pro control, one trial-CTA label (“Start your session”), and equal plain card borders and neutral list marks.
- #1510 removed the checked-in fallback credential from the private-longform live spec (#1500); the PO deleted the affected Production test identity, and #1500 is closed.
- #1468 shipped a read-only test-user verification action. Its authorized run reported that the configured Free and Pro reviewer identities were absent from Production auth; it made no account, profile, secret, entitlement, or Production data change.

## Release-blocking closure work

1. **RWT PR closure order:** #1525 Draft head 039043877 has four unresolved P1 threads requiring a real multi-device correction. Its migration is unapplied. After exact-head reviews, CI, PM acceptance and the PO's separate merge/apply decisions, restack #1521 and qualify its NULL-clarity correction; that migration also needs its own apply decision. #1488 remains open but currently unmergeable and must be restacked before canary qualification. #1523, #1517 and #1526 are tracked separately in ROADMAP; they are not an excuse to interrupt #1525.
2. **Progress integrity:** #1471 must treat empty `{}` as unobservable unless completeness is affirmative; #1476 must prevent cross-tab queue loss.
3. **Practice Loop availability:** #1486 merged, but #1473 still needs unique grant and failure-aware client/retry code not on current main; the old local head 72e694c2 has no remote branch/PR. It also needs an unattended authenticated deployed 1+1 result, truthful failure/retry and received telemetry. See #1473's 2026-09-23 PM sweep. Do not close on #1486 alone.
4. **Filler truth:** #1472 owns persisted `complete | unobservable | no_speech` semantics across Session, Analytics, PDF, Progress, recovery, and telemetry.
5. **Moonshine qualification boundary:** the old Moonshine revision repeated a 25-word span on a long real take, lost tail speech and rewrote live text. The PO chose only newer quantized_26_08_21 for forward evaluation, but the installed 0.1.5 npm WASM rejects its split frontend and new long-audio behavior is unmeasured. This model does not delay #1525/#1521, and cannot be promoted as a fallback merely because the download is smaller. Never mask its raw output to manufacture a pass.
6. **Conditional v4 default:** the PO's current target is v4:base:q4 on pinned Transformers.js 4.3.0, including non-WebGPU browser WASM. At main@1319e8b58 the config still selects v2:base.en and package.json still declares ^4.2.0. Historical 23/23 and 600/600 WASM results belong to base-int8; base-q4 WASM decoding on the current runtime, paired 4.2.0/4.3.0 quality and full load → record → Stop → save → reopen are NOT MEASURED. Keep the active-default guard and HOLD activation until these pass. #1304 and #1390 share one pinned evidence matrix across Open Mic and Focus Points with requested/observed engine and release identity; #1462 supplies a repeatable Track B/long-form harness and #1263 the runtime path. Distil q4 is a WebGPU comparison candidate, no longer the PO's default choice; v2 is being phased out rather than silently substituted. Production candidate selection was not independently re-read in this currentization.
7. **Product presentation:** #1474's G10 hierarchy has merged increments, but its remaining design and complete journey acceptance are open. #1475's disabled-payments two-chip variant was reported on deployed #1524 at be64b300; keep #1475 open for its remaining variant/deployed acceptance. #1515 has one false-adjacency Progress sentence and belongs in #1254's final copy pass. A merged landing or Session PR alone does not close those issue outcomes.
8. **Final evidence:** #1259 and #1382/#1383/#1384 own received-event reliability, clean baseline, SLOs, dashboard/alert, and cleanup proof. #1258 remains the final deployed two-product, real-device PO GO/HOLD.

Other pre-GO owners remain active where their condition is reached: #1254 final copy scan, #1261 hosted read-only SECURITY DEFINER classification, #1385 CI qualification, #1360 abandonment return, #1407 Focus Points truth, and #1495 managed identity/Gate 3 proof. #1313/#1315 require a specific release-critical false verdict to become pre-GO blockers; #1452 is closed as not planned.

## Database migration state (last READ)

Read-only Migrations Preflight run `35341531149` (2026-09-18, success) read the Production ledger and dry-ran the queue without applying anything:

- **Applied**, among others: `20260812041500` (the current `check_usage_limit` definition; nothing later on `main` redefines it), `20260903140000`, `20260904150000` and **`20260908120000_transcript_retention_newest_one.sql`**.
- **Pending**: `20260910193000_ai_suggestion_authority_receipt.sql` and `20260914214307_objective_eligibility_reads_attribution_authority.sql` (#1469).
- The three September migrations above were applied together on **2026-09-12** by the whole-queue `supabase db push` in run `34691493637`. The migration installed newest-one retention **inert** at that time and replaced unconditional newest-two expiry. Whether it was activated later is **unverified**: the read-only retention preflight stopped before connecting because its DB URL secret was unavailable. #1452 has since been **closed as not planned**; do not cite it as an open activation gate. Any fresh activation requires a current read and its own exact PO authorization. This paragraph records the September ledger only; it does not claim the current Production ledger or function body.
- The ledger proves which migrations ran, not the function bodies. Byte-level confirmation of a deployed definition needs a catalog read.

## RWT status

The prior RWT is **incomplete**:

- Stop B is partial; the authorized v4 observation is descriptive, and is not yet the comparable row that validates v4 against v2.
- The official v2 Stop B cell did not run.
- Stop A and RWT-02/03/04 did not run.
- Stop C still needs #1469, #1467, #1473, a deployed exact release, and working managed test identities.
- Stop D does not depend on Moonshine, which is deferred until after RWT or MVP. Its long-form integrity findings are the reason for that deferral, not a gate on this RWT.
- v4:base:q4 on Transformers.js 4.3.0 is the PO's **conditional** default target, including browser WASM. At the verified main baseline, the customer config still selects v2:base.en; the deployed selector has not been re-read for this update. Base-q4 WASM/quality/4.3.0 proof remains HOLD; the older distil-q4 target is superseded. Moonshine quantized_26_08_21 remains unqualified and outside the immediate RWT merger sequence.
- A fallback is not "second-lowest WER"; it must be dependable across more devices and fail differently from the primary.

No Production RWT, migration, Edge/config change, credential/account repair, payment activation, deployment, or merge is authorized by this document.

## Accepted limitations and retained debt

- The ≈90-second post-Stop finalization figure for a full five-minute Private v2 recording is a conservative planning allowance, not a measured Production p95 and not a requirement to wait 90 seconds. The UI must show honest Finalizing progress; comparable RWT rows must record observed stop-to-final latency. The former <30-second requirement remains withdrawn.
- #1354's write-ahead obligation is still client-only at this main baseline: if Progress evaluation and the browser obligation write fail together and the user reloads after storage recovers, the obligation cannot be reconstructed without a server-side record. #1525 proposes that server-owned obligation, but is not merged or applied; its exact deployed behavior must be verified before closing the debt.

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
