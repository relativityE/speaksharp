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

> **Baseline `97f1c0b5cf9fdc3c9a28ccd5a640de432c3b158c`** (`main`, 2026-09-05, #1420). The deployed
> release is recorded separately in `RELEASE_STATUS.md` and is a READ of production, never inferred
> from this pointer — `main` moving is not a deploy.

This file contains unfinished work only. Completion belongs in git history and dated evidence; current deployment facts belong in `RELEASE_STATUS.md`.

<!-- CURRENCY-BLOCK
baseline: 97f1c0b5cf9fdc3c9a28ccd5a640de432c3b158c
deployed-release: c4665156212dd03cd6d7b91c49bed90dea868b5a
verified-on: 2026-09-05
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

## Now — MVP critical path

| Order | Work | Closure evidence |
|---|---|---|
| 1 | **#1304 STT model selection — running.** Frozen selection set is **600 utterances / 10,894 normalized words**, never “600 words.” | Complete retained matrix and per-utterance artifacts; quiet performance reruns for contaminated v2 tiny/base with score-profile reconciliation; frozen policy applied; technical winner, activation readiness and failure-diverse fallback reported separately; Track B remains a finalist-only human-audio validation. |
| 2 | **Stage-B privacy successor — fresh PR; never revive #1310.** Retire callable legacy `complete_session` v1 paths while preserving the `complete_session_v2` newest-two retention contract. | Real-migration function/grant inventory; client/mocks cannot fall back; anonymous and authenticated v1 calls fail closed; v2 finalize/retain/expire remains green; each load-bearing check falsified once. No production migration application in the implementation PR. |
| 3 | **#1259 telemetry qualification.** The emitters largely exist; qualification, denominators and operator evidence are incomplete. | Content-free schema; bounded failure reasons; selected-model identity; synthetic/test traffic separated; funnel and SLO denominators defined; owner/action per alert; controlled-event dashboard proof. Production purge/dashboard mutations need separate PO authority. |
| 4 | **#1302 billing successor — fresh PR; never revive #1303.** Billing follows model selection and telemetry. | Complete test-mode checkout→webhook→entitlement→portal qualification, fail-closed dual switches, exact price/identity checks, and no claim that a live-money transaction is required or authorized. |
| 5 | **#1258 integrated Practice Loop and GO/HOLD — last.** | Exact release-build real-device journey, selected primary/fallback, save/reopen/Progress/export, telemetry and billing posture, all gate evidence current, explicit Product Owner GO/HOLD. |

Parallel work must not contend with benchmark measurement. Documentation/ticket work and remote CI may proceed while a model arm runs; local builds, browser sessions, dependency work or other CPU-heavy commands on the measurement host invalidate timing for the overlapping arm.

### STT measurement facts that must survive handoff

- The 10-clip Harvard set has 85 normalized words and is smoke evidence only. Its ceiling effects forced the deterministic 23-clip / 459-word preflight before the frozen selection run.
- Browser v4/Moonshine qualification uses stable `onnxruntime-web` 1.27.0. Earlier int8/q8 load failures on the 2026-04-16 development build were an ONNX Runtime QDQ regression, not a model rejection; the fix is tracked by upstream issue #28306 / PR #28326.
- The selection run is 600 utterances / 10,894 normalized words. Contaminated latency is unmeasured until a quiet rerun reconciles the per-utterance score profiles; it is neither fast nor slow evidence.
- The complete historical and current model matrix belongs under `product_release/evidence/stt/`, never under the disposable archive.

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

## Later

- The broader executive-rehearsal use case beyond the shipped Focus Points coverage slice. Focus Points is
  the product capability; "Executive Rehearsal" is a canonical example of using it, never a second product.
- Server-side recovery obligation to close the accepted client-only #1354 edge case.
- Real-hardware WebGPU performance; SwiftShader proves compatibility only.
- Track-B annotated disfluent-human-audio expansion beyond finalist validation.
- Paid operations, MFA/auth hardening, dependency/bundle maintenance, and long-horizon B2B/compliance packaging.
- Live meeting integrations (Zoom/Meet/Teams) only after the individual Practice Loop proves value.

## Declined / not active

- Any customer transcription engine other than Private. Private is the only customer engine; no second engine is offered, selectable, or used as a fallback.
- A universal 0–10/0–100 speaking grade.
- Accumulated minute quotas for active-trial or paid users.
- Treating test infrastructure, a model choice or filler counting as an economic moat.
- Reviving historical PRs #1303, #1310, #1317, #1319 or #1323 by rebase.
