# Issue #1265 — Comparable Progress definition matrix

**Scope:** source contract and review evidence for the #1265 implementation. Canonical release-document
reconciliation remains owned by #1257 / PR #1272 and must run after product heads settle.

| Signal | Source and persistence | Eligibility / comparison rule | Customer presentation |
| --- | --- | --- | --- |
| Clear-delivery evidence (`clarity_raw`) | Server-authored `session_progress_evaluations.clarity_raw`, stored unrounded under `clarity_v1` | A completed session must be at least 30 seconds, contain at least 75 words and a transcript, carry available clarity evidence, have verified attribution, and match the exact engine/version/model/formula cohort | Never shown as an absolute or universal score |
| Near-term movement | Current unrounded `clarity_raw` relative to the server-selected `previous_comparable_session_id` | Both persisted evaluations must be eligible, unique, chronological, and in the same cohort; a missing/ambiguous reference fails closed | Signed relative percentage, rounded only for display and labelled “vs your previous comparable session”; supporting evidence only |
| First-session context | Current unrounded `clarity_raw` relative to the server-selected `baseline_session_id` | Same validation as near-term movement; a retained previous reference cannot substitute for a missing baseline | Signed relative percentage labelled “vs your first comparable session”; quiet supporting context |
| One next action | Server-persisted `progress_recommendations` row: `shown_text`, metric, direction, value, units, and formula version | A missing or malformed row is unavailable; the client may reconcile once, then must read back the complete authoritative row | “Practice this next” is the only primary action and survives hard reload unchanged |
| Current-session observation | Deterministic `buildTakeaways` result over the current persisted evaluation and validated previous evaluation | Uses only eligible comparable evidence; otherwise emits a neutral measured fact | Secondary observation; never another action or praise/grade |
| PDF Progress | The same `loadSessionProgress` read model used by saved review | Export adds comparable Progress only for an eligible complete view; load failure does not block the base report | Repeats the persisted next action, previous comparison, and first-session context without recomputation |
| Open Mic live shell | No aggregate calculation | Comparable Progress is evaluated only after the take is saved | Neutral explanation with no number before authoritative saved readback |
| Focus Points coverage | Brief keywords matched in the Focus Points session shell | Scoped to the active brief; never enters Open Mic delivery comparisons | Separate coverage rail and delivery strip; not described as Progress |

## Fail-closed states

- The first eligible cohort session establishes context without inventing a zero or change.
- Short, low-word-count, missing-transcript, missing-evidence, and unverified sessions do not influence Progress.
- A cohort change, missing baseline, non-chronological reference, duplicate reference, or undefined percentage denominator displays no percentage.
- Regression uses neutral “declined” wording; movement smaller than the three-point internal materiality policy displays “No meaningful change yet.”
- A hard reload reuses the stored recommendation copy and structured target rather than recomputing a possibly different action.

## Executable proof

- `frontend/src/services/progress/__tests__/progressPresentation.test.ts`
- `frontend/src/services/progress/__tests__/loadSessionProgress.test.ts`
- `frontend/src/components/progress/__tests__/ProgressPanel.test.tsx`
- `frontend/src/components/session/__tests__/SessionOverhaulView.test.tsx`
- `frontend/src/lib/__tests__/pdfGenerator.test.ts`
