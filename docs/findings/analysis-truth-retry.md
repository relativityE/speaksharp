# Analysis truth — F-06, F-13, F-14

**Status: IMPLEMENTED; exact-head CI, independent review, merge, deploy, and Production proof remain.**

Integrated with `main@a97b740b39f678e8b5e8f769725e272d59428c64` before implementation.

## Bounded findings and acceptance evidence

| Finding | Recorded failure / requirement | Implemented evidence |
|---|---|---|
| **F-06** | Production Focus Points showed false negatives. Terminal analysis must use the completed take's stop-seam result and must not manufacture `0/N` or “Not detected” when that authority is missing or belongs to another brief. | `SessionOverhaulView` now consumes `objectiveCoverage`, the result already published by finalization. The retained transcript supplies only compatible quotes/highlights. Missing, malformed, short, or label-misaligned terminal authority renders pending rows and no score. Casualties cover both a stop-seam/view disagreement and absent authority. |
| **F-13** | Missing or invalid filler evidence must not become a clarity score, recommendation, or coaching claim. A measured zero remains valid. | Eligibility now requires finite integer count evidence. Both recommendation creation and completed-session readback independently reject an `eligible=true` row whose filler evidence is null, negative, fractional, or otherwise incomplete. Casualties prove no recommendation RPC and no eligible UI result; zero remains covered by the existing positive control. |
| **F-14** | A Focus Points retry must count only the new take. The Production retry inherited prior detections when the UI transitioned directly from completed review to recording. | The monotonic live-coverage latch now resets on every entry into `during`, not only on a `before` render. The casualty drives the batched `after → during` path without an intermediate frame and proves the retry begins at `0/N`. |

## Falsification record

Each mutation was asserted to be present before running its casualty:

- bypassing the terminal stop-seam authority fails both the disagreement and missing-authority tests;
- treating `eligible=true` as sufficient fails six readback/recommendation casualties;
- restoring the before-only latch reset fails the direct retry casualty (`1/N` instead of `0/N`).

## Closure rule

Merged is not release-closed. None of these findings is release-closed until the
accepted exact head is merged by Dev, deployed, and proven on canonical Production.
