**Status:** Authoritative (SSOT for unfinished and deferred product/release work)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-08
**Last Verified:** 2026-09-08 — reconciled to the 19-finding burn-down, newest-one retention correction, and repeated real-world journey qualification posture.
**Applies To:** MVP sequencing and explicitly deferred SpeakSharp work.
**Class:** Open gap / risk.
**Authority:** The source for Now / Next / Later / Declined work and implementation order.
**Not Authoritative For:** deployed posture and GO/HOLD (→ `RELEASE_STATUS.md`); product guarantees (→ `PRODUCT_REQUIREMENTS.md`); technical contracts (→ owning canonical document); dated evidence (→ `EVIDENCE_INDEX.md`).
**Supersedes:** `ACTIVE_COORDINATION.md`, `BACKLOG.md`, and `ROADMAP.operational.md`.
**Evidence Sources:** GitHub issue/PR state; `RELEASE_STATUS.md`; current code and tests; dated audits indexed by `EVIDENCE_INDEX.md`.

# SpeakSharp Roadmap

> **Baseline `55912522ebf4aa11672cdc42413e557b408f3f25`** (`main`, 2026-09-05, #1419). The deployed
> release is recorded separately in `RELEASE_STATUS.md` and is a READ of production, never inferred
> from this pointer — `main` moving is not a deploy.

This file contains unfinished work only. Completion belongs in git history and dated evidence; current deployment facts belong in `RELEASE_STATUS.md`.

<!-- CURRENCY-BLOCK
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

## Now — methodical MVP recovery

One active implementation PR at a time unless the PO changes concurrency. A broad issue may use sequential reviewable increments; do not create one PR per finding or absorb unrelated work.

| Order | Outcome | Authority | Closure |
|---|---|---|---|
| 1 | Complete Production journey observability | #1259 | Every confirmed finding maps to an authority event, positive/negative control, privacy classification, and real PostHog receipt. One governed boundary; full journey correlation. |
| 2 | Make one-click recording and during/after session truthful | #1415 | Explicit cold intent auto-starts once; real mic waveform; red Stop; bounded provisional churn; completed transcript remains readable after teardown/reopen. |
| 3 | Make Focus Points and Practice Loop truthful | #1407 + #1386 | Setup promise matches action; all input preserved; honest coverage; exactly one What went well + one What to improve output; linked retry evidence. |
| 4 | Remove cross-page friction and replace Share feedback | #1404 | Products menu reaches Open Mic/Focus Points directly; exact accepted feedback spec; failure preserves draft; storage and acknowledgement proven. |
| 5 | Enforce newest-one transcript retention everywhere | Retention correction + #1259 | Only the newest eligible transcript remains available; every older transcript expires; history, metrics, and Practice Loop history remain; expired Open/PDF actions are unavailable; disclosure says only the most recent saved transcript is kept; telemetry reports `newest_one_v1`. |
| 6 | Expose all registered candidates for controlled Production comparison | #1263 + #1304 + #1390 | v2/v4/Moonshine switch between settled takes on canonical Production; full teardown; requested==observed; PO selects and then lock/retest. |
| 7 | Final deployed qualification | #1258 | Dev passes both complete products first; PO repeats; every step reconstructible; explicit GO/HOLD. |

Documentation-only currentization under #1318 may proceed independently because it does not touch Dev’s product branch.

### STT evidence that remains binding

- Browser v4/Moonshine qualification uses the corrected stable `onnxruntime-web` line. Earlier int8/q8 failures were the upstream QDQ regression tracked by ONNX Runtime #28306/#28326, not model rejection.
- The deterministic preflight contained 459 normalized words and exposed an audio-decoder gap before the 600-utterance corpus. The selection run is 600 utterances, not 600 words.
- A fallback is chosen for wider device dependability and failure diversity, not merely second-best WER.

## Verified shipped-source mismatch map

| Surface | Current mismatch on `main@c4665156` | Owner |
|---|---|---|
| `MicCard.tsx` + recording controller | preparation does not preserve explicit start intent through READY | #1415 / #1259 |
| `RecorderBar.tsx`, `Waveform.tsx`, `SessionOverhaulView.tsx` | black Stop; old flex/bottom-aligned waveform; accepted real-signal presentation unshipped | #1415 |
| `SessionPage.tsx` | completed transcript disappears at teardown despite successful save | #1415 |
| `ObjectiveSetupForm.tsx` | redundant explanation; navigation CTA says Start speaking | #1407 |
| `FocusPointsRail.tsx` | confident “Didn’t come up” copy; retry count uses all rows | #1407 |
| `AISuggestions.tsx`, `faqSections.ts` | old labels; missing visible 1+1 Practice Loop | #1386 |
| `IssueReportDialog.tsx` | old long form, hidden validation, lost Title state, audio-note field | #1404 |
| `AnalyticsDashboard.tsx` | customer copy exposes an implementation count instead of availability/expiry | #1416 |
| `Navigation.tsx` | no direct Products → Open Mic / Focus Points route | #1404 |
| candidate authority / `SessionFocusPoints.tsx` | no controlled Production access to all three candidates | #1263/#1304/#1390 |
| analytics emitters/buffer | incomplete correlation and missing user-journey receipts | #1259 |

## Fixed decisions — do not reopen during implementation

- Canonical Production URL only; no Preview/internal/local comparison.
- No `VITE_INTERNAL_BUILD` requirement or new deployment/config barrier.
- Three candidates are operator-controlled between takes, not ordinary customer UI.
- Navigation alone does not start recording; explicit mic intent does and survives preparation.
- Real microphone data only; no generated waveform fallback.
- Session labels are **What went well** and **What to improve**.
- Share feedback exact Design-agent specification is #1404.
- Newest-one transcript retention is mandatory; `newest_two_v1` behavior, tests, telemetry, and active requirements must be replaced before release.
- Telemetry covers every finding but never replaces the product fix.
- Out-of-scope work requires PO approval.

## Next — product evidence and bounded corrections

| Work | Current fact | Required outcome |
|---|---|---|
| **Financial-planning hypotheses** | The 2026-09-05 workbook models 500 new trials/month, 2% conversion, six-month paid lifetime, 10 coaching calls per active trial or paid user, and a 3:1 CAC ceiling. These are unvalidated planning assumptions—not retained evidence, revenue proof, release status, or billing authorization. | Validate volume, conversion, retention, usage, willingness to pay, CAC and revenue with observed product/business data before promoting any forecast conclusion. The transient calculation package remains scoped to PR #1420 under `product_release/work_items/financial-analysis/`. |
| **Strategy/value validation** | No repository evidence proves that privacy-constrained professionals exist at scale or will pay. | User research or reachable interest capture with a defined sample and decision rule. Backend-only `guided-waitlist` does not count until a frontend entry exists. |
| **Recommendation outcome qualification** | Recommendation → explicit acceptance → next-session directional outcome is implemented. | Measure acceptance, comparable repeat, directional movement and retention without claiming causality. This is #1259/product analysis, not a new persistence feature. |
| **Universal-score residue** | Live score card is orphaned, but legacy score/shadow machinery and a user-facing 0–100 Clarity presentation remain. | Code-derived consumer inventory, explicit keep/remove dispositions, no universal-grade wording, tests against live rendered surfaces. |
| **Unsupported decode options** | Debug allow-list has accepted runtime-inert options. | One versioned capability authority; unsupported options fail before measurement with no row; supported options proven unchanged through the worker. |
| **Guided/Pro interest entry** | Edge Function and migration exist; frontend caller does not. | Reachable, truthful CTA while payments are closed, content-free analytics, no `checkout_started`, explicit replacement behavior when payments activate. |
| **Account-deletion FK integrity** | `session_delivery_measurements.session_id` cascades on session deletion, while its independent `user_id` reference has no `ON DELETE` action. Correct account erasure therefore depends on application ordering that the schema does not enforce; unfinished rows also have no defined reaper. | Choose and encode one deletion authority; exercise the real migrations in tests; prove account deletion cannot be blocked and cannot leave orphaned `in_progress` rows; define bounded cleanup ownership. Do not apply a production migration without separate authorization. |
| **Retention-policy single authority** | The historical newest-two migration, coordinator, preflight, mutation, and policy marker encode the superseded policy in multiple authorities. A partial newest-one correction can silently no-op or fail closed. | Add one forward-only `newest_one_v1` correction that repoints every live caller and proof surface together; prove selection, mutation, coordinator, preflight, writer enforcement, idempotency, concurrency, and per-user isolation. Historical applied migrations remain immutable provenance, never current authority. |

## Later / held

Billing activation, broad tester invitations, enterprise/team features, dashboard expansion, unrelated telemetry cleanup, and noncritical refactors wait behind #1258 unless the PO explicitly changes priority.

## Stop conditions

Stop and return the active work if it adds a build/URL/environment, changes approved UX, captures content, cannot prove the real authority path, makes a user-facing claim without evidence, or requires new PO scope. Green tests do not cure those failures.
