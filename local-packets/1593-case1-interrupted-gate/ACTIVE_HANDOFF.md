# CLI case 1 interrupted-repeat gate handoff

Checkpoint: 2026-10-19 13:59 UTC. CLI Dev, Lane B; Sam owns coordination/release.

Branch: `cli-dev/1593-interrupted-repeat-gate-20261019`.
Worktree: `/private/tmp/speaksharp-cli-case1-gate-20261019`.
Base: `83029ebb67216b2690eeff59e4ec1730d5f6ffe8`.
This handoff is committed with the completed source/test. No local task process
remains running. `pnpm quality` completed exit 0 at 13:40 UTC.

## Assignment and ownership

Sam queued this after case 7. App's initial 13:24 clearance was withdrawn because
older branch `fix/1593-saved-review-subject` at `0b664af2` also changed the gate.
Sam selected freeze-and-handoff at 13:28:55 (message 1792416535.838839); App
explicitly froze/preserved the old branch and transferred these paths at 13:33
(1792416805.701439). CLI personally acknowledged the corrected boundary at 13:34.
The functional edits and baseline/GREEN preceded Sam's 13:28:55 decision;
publication remained withheld. No old-branch change was imported or discarded.
The corrected two-path lease is:
- `frontend/src/services/telemetry/completenessGate.ts`
- `frontend/src/services/telemetry/__tests__/stageAwareRequiredFamilies1532.test.ts`
- this local evidence packet only

Extension: App all-branch clearance at 13:53 (1792417967.354129), Sam's approval at
13:54 (1792418074.962129), and CLI's personal ACK (1792418143.965589) add
`tests/unit/rwtReadbackBinding1532.test.ts` for the directly affected J2 contract.

Case 7 is already published/frozen for review in PR #1665 at exact head
`7e920bd69354048e96e470c6e469d21ffc2d1c3a`, separate clean worktree
`/private/tmp/speaksharp-cli-case7-integration-20261019`; no takeover or edits.
App retains shared spec/helper/collector wiring and all product fixes.

## Root cause and bounded implementation

`session_interrupted_repeat` requires positive lifecycle/transition/attribution
evidence and deliberately omits `practice_loop`. The global recording-family
gate nevertheless re-added it for every recording declaration, so a valid
observed supersession could never qualify without an unrelated completed loop.

Change only `requiredFamiliesForStages`: for a declaration that includes the
interrupted stage, consists entirely of known stages, and has no stage whose
own requirements include `practice_loop`, remove that one generic family.
Every other recording and identity family remains required. Full after-review,
unknown/empty and default callers retain their original spine. Stage invariants,
attempt-scoped singleton delivery and received readback invocation are unchanged.

## Executed evidence

- Baseline unchanged source: 4 FAIL / 24 PASS in the expanded stage-aware suite.
  The received supersession fixture passed lifecycle and attempt-scoped delivery;
  completeness alone HOLDed on missing `practice_loop`. `baseline-red.json`.
- Corrected source: 122/122 PASS across stage-aware, interrupted-repeat,
  qualification-stage, attribution-receipt and completeness suites.
  `focused-green.json`.
- New integration controls retain missing identity/attribution/lifecycle HOLD,
  absent or foreign-origin end HOLD, stale render into B FAIL, duplicate and
  wrong-attempt singleton HOLD, and strict mixed full-review/unknown declarations.
- Required full `pnpm quality` passed: product contract, full lint,
  frontend/live/evidence TypeScript, eslint-disable guard. `git diff --check` passed.

## Returned J2 test contract, corrected

Codex P1 r4314564418 found an existing consumer test still demanding the old full
spine. Reproduced 1 FAIL /32 PASS (`j2-contract-red.json`). That assertion now
retains every recording family except the intended interrupted practice-loop
prerequisite; adding full after-review or an unknown stage still requires the
entire original spine. All existing missing/duplicate per-attempt receipt and
workflow binding assertions are retained.

The historical During + interrupted-repeat + Practice-again tuple now executes
through actual completeness, stage and attempt-scoped delivery gates, including
missing model/arrival HOLD and wrong-route FAIL. Corrected combined suites and
the repository path guard: 160/160 PASS (`j2-contract-green.json`). Source gate
logic is unchanged. Prior full-quality provenance is retained; fresh exact-head
CI is required for this test-only successor.

Published JSON evidence uses portable path aliases, with numeric timings/counts,
assertions and failure text outside path fragments preserved. Raw byte originals
are retained privately outside Git. `normalization.json` holds raw/normalized
hashes; the unmodified no-local-machine-paths guard is included in verification.

This corrects a readback gate, not the historical missing saved pair's cause.
Expiry/persistence attribution, two-pair completeness, useful coaching, physical
observations and final-release live acceptance remain separate. No live query,
provider request, production write, merge or deployment was executed by this task.

Next: publish the exact source/PR handoff to Sam for disposition and fresh
exact-head CI/review. Case7's corrected source was accepted by Sam at 13:39; its
exact head remains frozen in qualification, not a competing implementation.
The 13:36 checkpoint was delivered on time. Cleanup requested by the user then
removed only verified inactive CLI worktrees/build outputs; this active tree,
source, evidence and dependencies were preserved. Next active evidence update
by 2026-10-19 13:46 UTC, earlier for the source handoff.
An ended turn is not an unattended worker; publish an explicit stopped handoff
if execution must end.
