# Executive Summary: Sharding Unit Coverage for CI Speed — archived issue record

## Goal
The goal of this issue (#1130) is to optimize unit test execution runtime in CI by sharding it into multiple concurrent executions, while maintaining 100% test relevance and avoiding silent regressions on Product Value. The current single execution job `unit-coverage` runs sequentially, taking nearly 11 minutes and gating downstream PR feedback.

## Implementation Details

### What I did and why it works:
1. **Parallel Execution via Sharding**: The `ci.yml` matrix job `unit-shard` which previously executed zero tests and acted as a compatibility mirror has been updated. The compatibility mirror `unit-shard` is now converted to be the **real sharding step**. We rely on the `pnpm ci:unit:shard ${{ matrix.shard }} 4` command to use native `vitest run --shard` functionality.
2. **Dedicated Coverage Uploads**: The modified `scripts/test-audit.sh` outputs code coverage JSON directly to an `artifacts/coverage/shard-$N` path and produces the `unit-metrics.json` file. Each shard uploads this cleanly to standard GitHub Artifacts using `actions/upload-artifact@v6`.
3. **Artifact Merging via Istanbul**: Added a `scripts/merge-coverage.mjs` node script to process JSONs. Because Vitest v8 coverage uses Istanbul format internally for its final output (`coverage-final.json`), we use `@bcoe/v8-coverage` and `istanbul-lib-coverage` and related utilities to successfully reconstruct a unified coverage map from across the shards. This generates standard `.html`, `.xml`, and `coverage-summary.json` equivalents.
4. **Resilient Metrics Merging**: Tests can fail, but CI still needs the test counts from the other passing tests on different shards. The `merge-coverage.mjs` script also elegantly coalesces all standard test execution metrics inside `unit-metrics.json` into a single file at the root.
5. **No Broken Gating**: Added an intermediate wait job in `ci.yml` (`unit-coverage-merge`) which pulls in all shard outputs, executes the merge script, and exposes the exact `artifacts/coverage` folder expected by the original, heavy downstream full-evidence job. By strictly matching file structure names originally expected by downstream jq aggregations inside `scripts/run-metrics.sh`, we've preserved compatibility without altering the heavy pipeline DAG structure.

### Open Questions / Risks addressed:
* **Coverage Threshold Verification**: Because vitest evaluates defined thresholds at the end of every individual shard (which naturally fails because each shard only executes 25% of the tests), `vitest.config.mjs` was modified to conditionally unset `thresholds` based on `process.env.CI_SHARD_MODE`. `test-audit.sh` sets `CI_SHARD_MODE=true`. Then, `merge-coverage.mjs` explicitly verifies the total coverage against the exact thresholds to ensure the gate holds strong after aggregation.
* **Failing on CI failures vs. Merging**: The intermediate `unit-coverage-merge` step explicitly sets a strict fail-closed exit boundary if any unit-shard matrix failed upstream. Downstream reports appropriately respect this, avoiding silent greens.
* **Artifact Directory Flattening**: GitHub Actions strips directories using `actions/upload-artifact`. I addressed this by uploading the *parent* directory `artifacts/coverage` in `unit-shard` and handling the internal `shard-N` paths appropriately.

By executing this approach, the runtime of the dominant 10m40s `unit-coverage` bottleneck will be divided roughly by 4, improving PR cycle times directly.
