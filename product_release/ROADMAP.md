**Status:** Authoritative (SSOT for unfinished and deferred product/release work)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-09-05
**Last Verified:** 2026-09-05 — financial-planning hypotheses registered; other roadmap state remains verified through its cited evidence.
**Applies To:** MVP sequencing and explicitly deferred SpeakSharp work.
**Class:** Open gap / risk.
**Authority:** The source for Now / Next / Later / Declined work and implementation order.
**Not Authoritative For:** deployed posture and GO/HOLD (→ `RELEASE_STATUS.md`); product guarantees (→ `PRODUCT_REQUIREMENTS.md`); technical contracts (→ owning canonical document); dated evidence (→ `EVIDENCE_INDEX.md`).
**Supersedes:** `ACTIVE_COORDINATION.md`, `BACKLOG.md`, and `ROADMAP.operational.md`.
**Evidence Sources:** GitHub issue/PR state; `RELEASE_STATUS.md`; current code and tests; dated audits indexed by `EVIDENCE_INDEX.md`.

# SpeakSharp Roadmap

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

## Now — methodical MVP recovery

One active implementation PR at a time unless the PO changes concurrency. A broad issue may use sequential reviewable increments; do not create one PR per finding or absorb unrelated work.

| Order | Outcome | Authority | Closure |
|---|---|---|---|
| 1 | Complete Production journey observability | #1259 | Every confirmed finding maps to an authority event, positive/negative control, privacy classification, and real PostHog receipt. One governed boundary; full journey correlation. |
| 2 | Make one-click recording and during/after session truthful | #1415 | Explicit cold intent auto-starts once; real mic waveform; red Stop; bounded provisional churn; completed transcript remains readable after teardown/reopen. |
| 3 | Make Focus Points and Practice Loop truthful | #1407 + #1386 | Setup promise matches action; all input preserved; honest coverage; exactly one What went well + one What to improve output; linked retry evidence. |
| 4 | Remove cross-page friction and replace Share feedback | #1404 | Products menu reaches Open Mic/Focus Points directly; exact accepted feedback spec; failure preserves draft; storage and acknowledgement proven. |
| 5 | Reconcile retention copy without changing retention behavior | #1416 + #1259 | Current newest-two behavior remains unchanged; customer-facing copy states availability/expiry without a numeric count; expired Open/PDF actions remain unavailable; telemetry reports the active policy truthfully. |
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
- Current newest-two transcript retention remains unchanged; customer-facing copy is non-numeric.
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
| **Retention-policy single authority** | Migration `20260803000000_transcript_retention_newest_two.sql` calls `transcript_sessions_to_expire` “THE shared” predicate, but the mutation and `has_more` check duplicate its rank/text predicate instead of calling it. The three copies can drift while tests still exercise only one. | Replace copied policy logic with one callable authority, or explicitly prove why one implementation cannot serve all scopes; test the shipped migration so changing the authority changes selection, mutation and remaining-work behavior together. |

## Later / held

Billing activation, broad tester invitations, enterprise/team features, dashboard expansion, unrelated telemetry cleanup, and noncritical refactors wait behind #1258 unless the PO explicitly changes priority.

## Stop conditions

Stop and return the active work if it adds a build/URL/environment, changes approved UX, captures content, cannot prove the real authority path, makes a user-facing claim without evidence, or requires new PO scope. Green tests do not cure those failures.
