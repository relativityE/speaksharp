# Prepared MVP work: exact integration handoffs

Browser PM → Sam (central PM), @relativityE; App Dev implementation owner. Main **c9d46b2d4ffef7530cb0cccaa533b5818d200320**. These are receiving results, **not integrated/deployed/accepted MVP features**.

## #1254 truthful comparison copy — ready for App's bounded integration

Prepared **97638983ab03f5d36f7f40d32f0f8cafc96860cb**, base32bde726. Compare is1 prepared commit/11 main commits diverged. All four current-main blobs are byte-identical to the preparation base: **zero path overlap/drift**. `prepared-main-blobs.json` records all blob IDs; no shared code was edited.

Smallest delta, exactly four paths:

- `frontend/src/services/progress/progressPresentation.ts`: name the persisted **previous comparable session**, preserving eligibility/cohort/movement gates and arithmetic.
- Its `__tests__/progressPresentation.test.ts`: positive wording and no `Clearer than` claim for subthreshold/cross-cohort/ineligible reference.
- `__tests__/loadSessionProgress.test.ts`: persisted-reference/view-assembly wording regression.
- `tests/e2e/progress-cross-page.e2e.spec.ts`: actual rendered takeaway text assertion, not new product behavior.

**Executed against isolated current main plus those exact prepared blobs:**56/56 unit assertions PASS, exit0. The same prepared tests on unmodified main:53 PASS/3 expected FAIL, exit1. This is a reproduced source correction, not a hypothetical copy review. Full result/commands/named assertions in `executed-controls.json`.

Credit the previous accepted wording review. Its loader fixture still supplies an already-selected s0 reference; it does not execute the database choosing s0 over an ineligible intervening s1. Keep that accepted evidence limit rather than relabeling the test as real selection proof. Minimum further receiving proof if claiming that scenario: real server selection over three correctly bound sessions, s1 ineligible, s0 selected; rendered current-session disclosure/wording must agree. The browser assertion source is inspected but **no Playwright/deployed run was executed here**. Broader cross-surface copy inventory is not closed by this sentence.

App can integrate this unchanged narrow delta on its selected current base after the active case10 increment and Sam's receiving disposition. A source handoff is not permission for a new PR, merge or deployment. No overlap with the case10 Capture/oracle files. If main moves, recheck these four blobs and dependency freshness.

## #1472 Analytics observed evidence — client AND RPC increment

Prepared **b6fa965e9c3c1f90e40383af8995a7a1ef631f58**, original correction ca13cc42 plus main merge. The *merge commit's first-parent file list is misleading*: its six billing-path changes are imported main history, **not this Analytics delta**. Main...prepared merge-base comparison identifies exactly the following six owning paths; all existing main blobs still equal their32bde726 base, with zero path drift:

- `frontend/src/contracts/fillerEvidence.ts`
- `frontend/src/lib/analyticsUtils.ts`
- `frontend/src/lib/__tests__/analyticsUtils.test.ts`
- `frontend/src/lib/__tests__/analyticsEvidenceValidity.test.ts`
- `tests/db/analytics-summary-rpc.integration.test.ts`
- new `backend/supabase/migrations/20261018090000_analytics_summary_observed_filler_rate_1472.sql`

The contract is positive observed all-key evidence for **rate/chart** eligibility: empty/all-zero/NULL/malformed maps do not fabricate clean delivery or dilute the rate. Keep top-word/trend window eligibility and `_ss_valid_filler_total` unchanged; it has other consumers. No schema shape, RPC signature or unrelated billing change is included.

**Executed received client+RPC on isolated current-main source:**61/61 PASS across the two client files and actual PGlite RPC integration, exit0. This executes the SQL function, client arithmetic, mixed map/rate/chart outputs, non-filler/trend preservation, wrong/unauthenticated caller rejection and EXECUTE ACL checks against a synthetic minimal database. It is **not hosted Supabase or a full migration-chain/application proof**.

**Executed mixed-rollout negative:** unchanged prepared client/tests with the existing *old* RPC body substituted at the test's forward-migration input:6 PASS/**4 expected FAIL** of10, exit1. This is a deliberately labeled isolated SQL substitution, not a production migration. It demonstrates that frontend-only integration cannot close parity. Zero/null maps must remain unavailable, not become0.0/min from an old server denominator.

App receiving sequence: reconcile/qualify the six-path increment; preserve exact migration digest/order; obtain separate apply authority and actual target/schema readback; then same-account/same-row hosted client↔RPC and rendered chart/no-data proof. Merge, migration application, frontend deployment and human acceptance remain distinct. No migration was applied outside the throwaway PGlite fixture.

## #1318 prepared docs — source-compatible, semantic revision required

Prepared **f3f8704257c523bb44dfdc305e697e18f5f8e769**, base7163f00d, is1 prepared commit/5 main commits diverged. Eight canonical document blobs and four local evidence files have no main-side path drift. Mechanical compatibility does **not** mean the batch is current.

RETURN unchanged publication: its model paragraphs repeatedly schedule #1565/#1304 as post-MVP, superseded by Akin/Sam's current near-term queue; #1567/#1568 are closed preserved source, not an active Draft route or shipped fallback. Its account text must defer to account-scoped6251767298, while honestly retaining the existing deployed guard/configuration prerequisites rather than declaring those removed. Actual served release and retention activation remain separately verified facts, not source assertions.

PM supplies a bounded documentation correction artifact in this same package; no shared canonical file is changed. Prepared docs/tests do not close1318's full canonical/inventory/link/exact-head acceptance. Keep final shipped-state reconciliation and remaining inventory explicit. Do not promote broad documentation cleanup into the current source integration queue.

## Reproduction and limits

`execute-prepared-controls.py` runs the existing Vitest command/config in byte-exact isolated current-main receiving trees, using installed dependencies and synthetic test inputs only. Report paths and original hashes are retained privately; public named results normalize machine paths. The initial missing referenced tsconfig/then repeat-copy symlink errors were PM preparation errors, before useful test execution, and were corrected without product edits. No claim of full quality or CI was made for this PM packet. No hosted/live/provider/account operation was performed.

## Later receiving-source reconciliation (supersedes old pins as assignments)

App's current copy receiver is **aac368a7b9ec8a0f50dcd16e3384f15df69164a0**, six paths against currentc9, separately source-accepted by Sam at18:37; the real selector/loader intervening-ineligible test gap described above is credited as addressed in that successor's source review. Our56 executed controls are explicitly for the preserved976 four-path overlay, not falsely attributed to all six successor paths. Sam delivered PO approval18:38 for App's PR/Ready/full qualification; no merge/deployment approval follows. Return its own exact-head CI/review/deployed receipt rather than restoring the older prepared branch.

App's actual Analytics receiver is **ee9c9c420106310c0fab11b97ac9912fa775c192**, same six owning paths with two changes after b6: `analyticsUtils.ts` blob a593981a34897f8eb432f8ccc77c7483083a4e19 and DB test blob4d2742652ab90ad506a1164141b402f1af4c81e4. GitHub current-main and b6 comparisons read independently. The client now omits chart points for observed counts with zero/NULL duration, matching RPC; three retained DB controls cover zero, NULL and the explicit average residual. Current-main plus exact current six-file overlay executed **64/64PASS**, including all13 PGlite SQL controls. No hosted schema or frontend deployment was touched.

The average's zero-time observed row still contributes to the numerator on BOTH sides: e.g.3 timed fillers/60s plus3 fillers/0s yields6.0 on both. That is an explicitly retained pre-existing semantic residual, not evidence of current client/RPC disagreement and not a new selected denominator change. Preserve it in the receiving decision; do not silently amend the shared helper, top-word/trend gate or SQL policy. The original61-positive and4-mixed-negative results remain historical credited controls, not current-head execution claims.

## Replay gate correction after Sam's receiving review

The original historical outputs were independently inspected and accepted, but the old orchestration checked only expected exit/nonzero total and could consume stale output. That replay criterion was RETURN, not accepted proof automation. The revised runner deletes prior output, requires a report created after this invocation, restores/verifies the exact prepared Git blob inputs, requires the complete intended assertion-name/status map and matching totals/exit, rejects missing/skipped/extra/duplicate/runtime-error assertions, and requires diagnostics on intended failures. `expected-control-assertions.json` is the exact independently inspected historical manifest; it is not generated from a new run's results to qualify that run.

`verify-report-gate.py` executed **15/15PASS**: four accepted historical named fixtures, rejection of unrelated/missing/extra/pending assertions, wrong exit, false totals, runtime errors, duplicate names, stale/missing output, plus a fresh-output positive. The revised orchestration compiles; the entire four old production-control batches were not rerun solely for this tooling correction. Sam explicitly retained their historical credit. The new64-current-receiver,136-component and56-documentation executions are separately named in `additional-executed-controls.json`.

Replay from an authorized repository with existing exact Git objects/locked dependencies: `python local-packets/35-item-mvp-closeout-20261019/prepare-isolated-trees.py`, then the existing host's local-job interlock around `python local-packets/35-item-mvp-closeout-20261019/execute-prepared-controls.py`. Bootstrap is supplied source/syntax-checked only; missing objects/dependencies fail with the exact missing input, no fetch/install/permission bypass. It reconstructs the OLD prepared pins intentionally for the historical controls, not current implementation assignments. For documentation run its preparation script then `git apply --check` against the isolated prefix and the three listed existing doc suites. No provider, model, hosted migration, campaign or shared source operation is part of replay.
