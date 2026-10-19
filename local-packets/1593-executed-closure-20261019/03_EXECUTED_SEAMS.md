# Independent executed receiving discriminators — Browser PM → Sam, @relativityE

Source pins refreshed before execution: #1662 c8dc89f06a2ac7d58706c4cb02a80e0dd0ebbab3, #1667 71934293c1079aafc8ebf1f6d4373f66d5482c06, case4/#1668 9ce170db5113d45980908ee4bea334b48eb019a6, accepted isolated marker50d0e20a8c3edba3b04869474f7bb23fff858c19. Subsequent1662 reconciliation2bd050cd is a new head: source equivalence must be verified rather than silently promoting c8dc execution. Sam retains disposition/release authority. No shared source edited.

Run the21 bounded source groups from a repository containing those objects and existing dependencies:

```sh
node scripts/host-interlock.mjs hold local -- node local-packets/1593-executed-closure-20261019/probe-seams.mjs
```

Exact hashes/output: seam-results.json. Actual source modules/classes are transpiled with installed TypeScript. AnalyticsTap is its actual extracted class, since only field-backed settlement methods are needed. Watchdog is actual module; its unrelated finalizer-bound dependency is explicitly doubled. Page/CDP/actionability are declared doubles; jsdom supplies real MutationObserver and DOM event delivery. These are controlled schedules, not live browser frequency or historical causal attribution.

| Seam | Executed result and bounded disposition |
|---|---|
| Case11 collector → predicate | **ACCEPT bounded collector behavior**: clean window PASS; coalesced A stop/resume, B loading→cold, B acquisition, A stopped track and invalid A opening state FAIL; lost B token HOLD. Old endpoint-only and opening-state findings remain credited as fixed. |
| Case11 receiving closing tail | **HOLD for stronger through-second-gesture claim, central disposition needed**. Actual c8dc source closes B, awaits A close, records row, then makes second gesture. Controlled schedule: close B; while waiting for A, B acquires mic and publishes RECORDING; close A; actual predicate consumes closed B and returns PASS. Output retains post-close acquisition1/runtimeRECORDING. This is actual collector→predicate plus exact source-order boundary; it is not an executed whole Playwright journey or proof product can violate its lease. If accepted contract ends each page's window at its own close, this is an explicit measurement limit, not a new product blocker. If it must cover until the second user gesture, retain observation/phase evidence to that gesture or HOLD that stronger claim. Do not discard accepted opening/history fixes or assign an impossible cross-page atomic snapshot. |
| Adverse history | **ACCEPT bounded**: actual loading→error passes; same-delivery loading→ready→error retains all states and FAILs; missing document log HOLDs. Initial state/drain/token correction is credited, not returned again. |
| Adverse attempt/fault | **ACCEPT fresh-context one-page/one-press scope**: pre-attempt request and unrelated request excluded; matching failure during awaited injection counts; config failure legitimately counts for current model-assets route; post-disarm excluded. Do not demand weights-only proof when injected route can fail config before weight request. Not general concurrent cross-page causality. |
| Two-page settle → watchdog | **ACCEPT bounded integration**: actual old any-page settle returns at600ms, B fatal absent, watchdog PASS. Current settleEveryPage returns at2000ms, B fatal present, actual watchdog terminal FAIL. Closed-page returns flushed; never-flushing open page returns quiet at5000ms. This adds executed whole-watchdog-terminal proof to prior helper-presence/source acceptance. A quiet bound still does not guarantee universal telemetry delivery. |
| Start uniqueness / action identity | **ACCEPT bounded719 controls**: actual startBenchmarkRecording + actual selector mapping + jsdom native DOM click rejects duplicate-at-readiness, duplicate-at-click and changed action at click with zero product activations; clean unique Start activates once. Page/ElementHandle are doubles, reflex0 for this narrow uniqueness test. CLI's native Chromium and500/1000ms results remain separately attributed; not independently rerun here. |
| Marker timeline/audio origin | **ACCEPT honest limitation**: actual50d0 observer records mutation interval0–9400ms spanning9.02s deadline; observed callback cannot determine side. Actual rendered transcript mutation is retained with committedCharacters=null, audioOnsetVerified=false. Current caller is unwired; neither request clock nor visible provisional text proves exact committed/audio onset. No looser deadline or retrospective product cause asserted. |

## Case4 actual rejected-engine termination, independently executed

Existing actual test fixture `frontend/src/services/__tests__/unmountEngineRetirement1476.test.ts` at9ce drives real controller/service/hook with a controlled engine and mocked storage/lease. Isolated source mirror avoids changing any shared implementation tree. Result: **33/33 PASS** on exact successor. Replace only controller/service with byte-verified777 parent, keeping9ce tests: three targeted controls **3FAIL /0PASS /30skipped**. Actual failures:

- initializing late rejected terminate: IDLE instead of required ENGINE_INITIALIZING;
- download-required late rejected terminate: IDLE instead of required DOWNLOAD_REQUIRED;
- in-bound preparing-engine rejection: terminal instead of unconfirmed.

These reproduce the already-accepted correction independently; no new finding credit. Successor affirmative per-service proof is **ACCEPT in this execution scope**, not historical case4 attribution or live acceptance. engine-results.json preserves source hashes and actual assertions, with host paths removed from first-line failures. Raw reports remain private. Initial mirror loader/config omissions were repaired before executable tests ran; zero-test setup failures are not counted as product failures or passes.

Reproduce in new isolated directories, existing installed dependencies only:

```sh
python local-packets/1593-executed-closure-20261019/prepare-engine-mirror.py --out artifacts/pm-closure-private/replay-engine-green
node scripts/host-interlock.mjs hold local -- node_modules/.bin/vitest run --config artifacts/pm-closure-private/replay-engine-green/frontend/vitest.config.mjs artifacts/pm-closure-private/replay-engine-green/frontend/src/services/__tests__/unmountEngineRetirement1476.test.ts --coverage.enabled=false --reporter=json --outputFile=engine-green.json
python local-packets/1593-executed-closure-20261019/prepare-engine-mirror.py --out artifacts/pm-closure-private/replay-engine-parent --parent-controls
node scripts/host-interlock.mjs hold local -- node_modules/.bin/vitest run --config artifacts/pm-closure-private/replay-engine-parent/frontend/vitest.config.mjs artifacts/pm-closure-private/replay-engine-parent/frontend/src/services/__tests__/unmountEngineRetirement1476.test.ts --coverage.enabled=false --reporter=json --outputFile=engine-parent.json -t 'case4.*(ACTUAL late termination|IN-BOUND)'
```

Parent exit1 is the intended negative-control result, not a failed successor test. The preparer only copies fixed repository source into a new private artifact directory and links existing dependencies; it does not install or operate accounts/providers. No shared code edit/new PR. Private mirror was restored to successor bytes after parent controls; all test processes exited.
