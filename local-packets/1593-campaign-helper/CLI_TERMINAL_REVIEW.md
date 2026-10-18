# CLI terminal review: successor verification

**Latest reviewed helper: `8cec8233a9ccaa15309c3d6408e517b251ed17dc`. The two reproduced counterexamples are now rejected.**

Independent execution on the exact successor: **116/116 helper/reference tests PASS**, plus **3/3 whole-command regression controls PASS**. The control still exits0/complete PASS. A dependency-check refusal now exits1/HOLD with `dependency_identity_not_proven`; malformed authority now exits1/HOLD with `authority_missing_or_malformed`. The dependency guard runs twice (observation and final decision), so the regression expects two simulated refusals. Source and mocked I/O remain otherwise the same as the original review.

At this successor, `cli-terminal-review.test.mjs` and `cli-terminal-review.tap` contain the updated assertions/results; `cli-helper-suite.tap` preserves the116-test run. The commands below use these current files when run on this branch. To reproduce the original unsafe results instead, use the immutable [original review commit4a88409b](https://github.com/relativityE/speaksharp/commit/4a88409b484daaea8562702a45d1204e64dc77eb).

**This closes these two source-level counterexamples only. Sam's exclusion of `--final` for the existing campaign remains in force.** Case1's cost/readback stops and the campaign halt are unchanged; no retry, continuation, rerun or acceptance is authorized. The source fix is App's; this branch changes only CLI's evidence files relative to8cec8233. No deployed code or App implementation is edited here.

## Historical baseline report: c4761785

Everything below records the original baseline failure, not the successor's behavior. Original test/TAP files remain available at4a88409b above.

**Disposition: `--final` remains excluded from completion acceptance, consistent with Sam's 2026-10-18 12:47:48 decision. This review adds no gate to the separately approved per-case campaign.**

Reviewed baseline: `c476178589a25bdd5adf997a4d695c9f476cd8e3`. This branch adds only this review, a standalone characterization test and its TAP results. No helper, reference contract, evaluator, deployed source or App/PM implementation file is changed.

## Executed evidence

The existing exact-baseline suite independently passed **114/114** (44 helper +70 reference) in 12.009 seconds. Green existing tests do not cover the terminal failures below.

The new `cli-terminal-review.test.mjs` drives the actual unchanged exported `main(['--final', ...])`, rather than merely calling `finalReconciliation` with a manufactured outcome. It uses source-faithful receipts/logs and inventories, with automated evaluations precomputed by the **real maintained evaluator before mocks are installed**. All GitHub, git, served-page and downloaded-artifact ports are then intercepted locally. Unexpected child commands throw; `gh run` is permitted only for mocked download. There are no live calls, dispatches, account operations or credential reads.

Run from the repository root with the existing dependencies installed:

```sh
node --test local-packets/1593-campaign-helper/cli-terminal-review.test.mjs
```

To preserve TAP:

```sh
node --test --test-reporter=tap --test-reporter-destination=local-packets/1593-campaign-helper/cli-terminal-review.tap local-packets/1593-campaign-helper/cli-terminal-review.test.mjs
```

Final artifact run: **3/3 PASS, exit 0**. These are characterization tests: PASS for a negative means the excluded unsafe behavior was reproduced. Full assertions and output are preserved alongside this file.

| Whole-command scenario | Actual result | Meaning |
| --- | --- | --- |
| Valid authority, consistent source/config and all15 fixture receipts | exit0, `complete:true`, `outcome:PASS`, used30, no ledger/case errors | Positive control establishes the harness reaches successful final reconciliation. |
| Same evidence, but `git diff --quiet S` throws on dependency identity | The refusal occurs exactly once, yet exit0 / complete PASS / no reasons | `main()` computes an unverified observation, then its `--final` branch ignores it. |
| Same evidence, but authority budget is the string `unknown`, firstCase2, maintained-read-only permission false | exit0 / complete PASS / no reasons | Terminal reconciliation checks only `authority.verified`; malformed scope/budget is not rejected by the original authority rules. |

The first harness launch failed its positive control because its raw-content API mock matched the wrong argument shape. The mock was corrected, then all controls and negatives passed, including the final preserved run. No helper source was changed to make a probe pass. The source snapshot and published test use the same baseline functions.

## Responsible boundaries and disposition

`main()` computes `observation` including `dependencyIdentity` before the `--final` branch, but that branch calls only `finalReconciliation({authority,ledger})`. It returns before the `assess()` path that checks authority/context freshness and dependency verification. `finalReconciliation` checks only `a.verified === true` for common authority; its `used > (a.budget ?? 0)` comparison accepts a nonnumeric string through JavaScript coercion. These tests independently confirm the previously reported findings; they are not claimed as new discoveries.

Retain Sam's existing independent reconciliation against evaluator at S, original authorized scope, exact attempt ledger, budget and cleanup. Keep the per-case path and authority scope unchanged. Any future terminal repair belongs in App's bounded correction: reuse reviewed authority/context validation instead of duplicating only some checks, pass verified dependency/context into the terminal decision, and preserve per-case and case15 stop rules. An offline fixture PASS is not live campaign completion or human/device acceptance.

No speculative production change, duplicate dispatch or attempt to bypass App's reported host safety denial is part of this review. Saved `node --test`, GitHub and Slack authorizations were reused.
