# Current status note — 2026-10-09

The earlier `328 tests passed` statement below belongs to its frozen pre-budget source revision. It is not the test count for the current budget-enforcement candidate. The default-schema successor `f99b6934eaf0b19962e1d1daa0118e4075cd92e2` reported 330 tests; the immediately preceding C12 source reported 326. Those are revision-specific totals, not conflicting results for one checkout.

Current candidate `e07e7661aefbea6541ca61c646c31aeb96ad8360` (tree `7311d85452fd0d25063b77b8d399d52310caae52`, parent `f99b6934eaf0b19962e1d1daa0118e4075cd92e2`) passed `python3 -B -m unittest discover -q`: **338 tests**. The five named loopback/HTTP tests also passed individually in the development environment. This run did not hold the shared host interlock and is not the host/live acceptance run. The earlier receipt reports the five as passing in aggregate on its 328-test revision, but does not retain individual host-run output; individual host-run results therefore remain unverified. See `CLOSURE_STATUS_2026-10-09.md` for the five per-test current-source results and remaining gates.

# Historical working-source receipt — 4.6.17 successor (2026-10-08)

At the time of this historical receipt, the source checkout was `/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp-cli-orch-successor-6060194201`, branch `fix/rwt-orch-successor-6060194201`. Its immutable `v4.6.17` packet at docs-branch commit `ee9412d08270d141a4aea0c2063714842d26b317` was an earlier incomplete snapshot; the accompanying packet manifest binds that frozen source SHA, tree, parent, and per-file hashes. No PR had been opened at that checkpoint.

**Source changes:** task deliveries now bind a configured Codex actor and exact session UUID, freeze the candidate/task identity, and require authenticated, idempotent receipt then result callbacks. Remote app-server routes can use `wss://` with a named token environment variable. Missing or changed routes fail closed. CI watcher snapshots durably enqueue one PM follow-up for an open Ready PR only after the newest exact-head CI run has successful full-lane `full-evidence` and engineering `report` jobs. A failed overall workflow caused by downstream exact-head review/merge qualification does not block review start. Newest run is selected by creation time; attempt numbers are compared only within the same run ID. The local worker claims that task and still requires source-authored `refresh_reviews` authorization. The guarded journal performs the lifecycle transition once; exact-head review results wake PM for disposition, and Security remains separately pending rather than inferred. The guarded executor now includes the combined Rev 2 branch as one exact source-authorized branch exception; arbitrary feature branches remain outside scope. An idle CLI process no longer hides an explicitly persisted task blocker; a later board update can clear it. Repeating an identical blocker checkpoint preserves its original age; a changed blocker starts a new clock and clearing it removes that clock. Edited existing control comments now wake PM, and old comment IDs edited recently survive the bounded cache. The review candidate registry rotates across all active candidates without a permanently truncated low-number slice. Earlier repairs for held-ask release evidence, aggregate request budgeting, locked restart recovery, frozen worktree ownership, and staged SQLite/WAL migration remain in this checkout.

**Latest source repair — stale bootstrap checkout identity:** the previous resolver trusted a persisted bootstrap receipt when the same assigned worktree path later pointed at a different HEAD or tree. `resolve_dev_target` now compares the current stable checkout snapshot with the verified tuple, clears stale receipt fields atomically, and fails closed until a fresh exact checkout verification occurs. RED was reproduced against the previous resolver: both new HEAD-drift and tree-drift tests returned `ok=True`. GREEN: `test_same_path_head_drift_clears_stale_bootstrap_receipt_and_fails_closed` and `test_same_path_tree_drift_clears_stale_bootstrap_receipt_and_fails_closed` pass and assert the stale receipt was cleared. The existing exact-checkout bootstrap and legacy migration regressions also pass.

**Verification:** `python3 -B -m unittest discover -q` — **328 tests passed in 90.539s**, including all five loopback/HTTP tests. The first sandboxed run could not bind loopback sockets; the same suite was rerun with approved host execution and passed. The four focused bootstrap tests, Python compilation, and `git diff --check` passed. These are source regressions, not live multi-agent delivery evidence.

**Still open:** the board has no verified production route configuration for all participating actors. Acceptance requires exact live Codex session identities, reachable remote endpoints and callback address where needed, and task-specific actor receipt/action/recovery evidence—especially the missed #1570 CI→review transition on the installed board. Independent Browser PM qualification and installed restart/rollback acceptance also remain pending. The existing install authorization is conditional on complete closure and independent qualification; this candidate does not yet meet that condition. No install/restart, PR, merge, deployment, or Production action has been performed.

The prior C5/package receipts below are historical and their test counts and claims do not describe this current working tree.

# Historical C5 Packages 3 + 4 — working checkpoint (2026-10-08)

## Earlier v4.6.17 snapshot — historical and superseded for status

**Checkout:** `fix/rwt-orch-successor-6060194201`, based on source commit `f1df24d3ed87f8eb9235e283b3449d2789ffd9db` (tree `79b722398e026fb56d6a16d2286ee4f160ed0563`). The `cc12ad4` source snapshot was published in the immutable handoff at docs-branch commit `ee9412d08270d141a4aea0c2063714842d26b317`; it was not independently reviewed or accepted.

**RED/GREEN:** six new focused tests pass: `test_readonly_checkpoint_routes_to_waiting_owned_task_with_frozen_target`, `test_readonly_delivery_rejects_wrong_owner_or_stale_target`, `test_same_task_action_dedupes_enqueue_claim_and_restart`, `test_distinct_authorized_followups_survive_while_recipient_is_busy`, `test_duplicate_write_assignment_action_dedupes_across_pm_turns`, and `test_readonly_receipt_start_result_are_distinct_and_use_plan_mode`. Initial RED was observed for the first waiting-task cases before implementation; GREEN was observed after the dispatch/claim implementation. `git diff --check` passed at this checkpoint.

**Offline verification:** 280 tests passed across all 12 Python test modules, excluding exactly the five host/loopback tests listed below and `test_event_delivery.EventDeliveryTests.test_missing_board_patch_does_not_swallow_valid_reply`, which invokes the live GitHub CLI. Dashboard smoke passed with the v4.6.17 fixture. Python byte-compilation, route-schema JSON parsing, `bash -n start-rwt-handoff.sh`, and `git diff --check` passed.

**SHA-256 manifest for the frozen source tree** (the Git tree hash covers every tracked file, including this receipt):

| File | SHA-256 |
|---|---|
| `README.md` | `d8330bbb84998ce113d962cc2a02c3f5cf1c2650a9e429efe2b51be9364ef7c8` |
| `pm-route.schema.json` | `836feb8067ee9323c66aaef20a6ec02e03288441a873ed40b58b6006ddd49d39` |
| `server.py` | `9e812e9d0bcdb982f2474eff68c04c1e230074fb124115e1ef3380c2e974e801` |
| `start-rwt-handoff.sh` | `b15752b1edc50943b64095b735552708510136108f0b2ff48dc4d6e2b84a6c56` |
| `static/index.html` | `67745ecc6967fe6fc95f8b2aebd7d71db89a0e0b0e651a5a6cc082fa88701ae1` |
| `test_deadlock5.py` | `a413c06e9deee81da2907e14cf07ee1742a901c7d0b0a1aa2c8e1b738432f2aa` |
| `test_regressions.py` | `387a5086eee66be975caf7dc6fffce790249fecc7b09e9608daf90febd411918` |
| `test_ui.js` | `b811d56b2305c9d069369224964759e81066a8ee13d8e091e9ed73faa9e32875` |

**Still HOLD / unverified:** the five host/loopback tests remain unexecuted pending the candidate-bound shared host lease and any required bind permission: `test_deadlock5.Deadlock5Tests.test_retry_api_cannot_requeue_dev_after_preflight_block`; `test_handoffs.HandoffTests.test_pm_http_delivery_includes_readable_files_and_manifest`; `test_handoffs.HandoffTests.test_github_only_reports_local_paths_without_claiming_remote_attachments`; `test_regressions.RegressionTests.test_http_dispatch_worktree_and_conflict_endpoints`; and `test_package2a.LoopbackControlTests.test_loopback_refuses_foreign_simple_post_and_accepts_the_page_token`. The excluded GitHub-dependent test was not run. Browser PM independent review, installed acceptance, and live task-specific receipt/action are also pending. External notification transport remains unsupported. All R01–R42/F01–F16 closure and post-C4 findings remain open until each gets a source/evidence disposition; no install or restart is authorized here.

This is a local, unreviewed source checkpoint layered on Package 2b source commit `734dc15e0bdaed1b929f4af4d8772d23fd47e035` (tree `b88799be487e18633d192c845314099870246e8d`). It is not installed, accepted, or a complete repair of C4. The next immutable packet must record the final source commit/tree and per-file hashes.

**Offline verification on the current working tree:** 275 tests passed across the 12 listed Python test modules. Five socket/loopback tests were excluded under the existing shared host lease and bind-permission HOLD. Node dashboard smoke passed; `bash -n start-rwt-handoff.sh`, JSON parsing of `pm-route.schema.json`, and `git diff --check` passed. The Node smoke ran with CommonJS evaluation because the parent checkout declares ES modules. No network service, live board, live GitHub mutation, external-agent delivery, installation, migration, restart, merge, deployment, or Production operation was exercised.

**Implemented in this local checkpoint:**

- Package 3 / F05, F11: bounded packet/file/manifest sizes and verification time; transient GitHub read failures remain errors rather than being treated as missing data; durable rate-limit backoff is shared by GitHub read adapters; comment reads use bounded incremental pages and preserve the cursor on incomplete reads. The exact-head qualifier defers during shared backoff and records a returned rate-limit response. Exact-commit packet reads are journaled; transient failures retry after backoff; terminal outcomes route one deduplicated task to local CLI PM, and startup/poll recovery closes a crash gap between recording the result and queuing that task.
- Package 3 / F06: exact PR/head/base review qualification is checked before attribution; stale reviews remain stale; active non-selected PRs are monitored; Code review, Security review, and PM acceptance are represented separately and Security/PM acceptance are never inferred.
- Package 4 / F14: dashboard exposes dispatch holds, blockers, affected review state, and distinct qualification status; explicit Current PR selection is retained and is not silently replaced by train order.
- Package 4 / F16: migration stages and verifies the database (including WAL), uploads and handoffs; attachment paths are rebased; target promotion is database-last and source files remain available. Ambiguous sibling state requires explicit `RWT_MIGRATE_FROM`.
- Package 2 / F07: a persistent per-repository host `flock` prevents multiple app directories/ports for the same repository from concurrently owning the worker, in addition to the state-directory lock.

**Still open / HOLD:**

- F05 remains partial: the local exact-commit retry/task path does not provide a separately authorized fallback reviewer outside CLI PM or prove that a Browser PM/App Dev recipient can read the packet.
- F13 and the PM’s hard notification gate: there is no supported external wake adapter for Browser PM/App Dev in this app. GitHub publication is not delivery. No real per-actor task-specific receipt/action proof exists. This is a blocker, not a completed capability.
- F15 loopback/host tests: five tests remain unexecuted pending the exact candidate-bound host lease and any tool-required bind permission.
- Independent PM source review, installed-board acceptance, and the complete C4 finding-by-finding closure map remain pending. This checkpoint does not claim all R01–R42 or F01–F16 fixed.
- Product journey closure R42 remains separate from app code repair.

No application installation or restart was performed. No live migration, PR lifecycle action, merge, deployment, or Production action was performed.

# deadlock.5 verification — 2026-10-07 (candidate 4: resume-claim race; includes candidate 3)

## C5 Package 1 + Package 2a draft checkpoint — 2026-10-08

This is an isolated source/evidence packet, not an accepted or installed build. Nested app lineage: c4 baseline `19899f4` → Package 1 `c6dbb9526726c23b59c92ff625b42129569e408b` → Package 2a checkpoint `e594548990efa97a26138d83380af612d26337af`; the packet manifest records the new frozen snapshot commit and tree.

**Package 1 evidence:** the full 242-test run passed and Node UI smoke passed, but that run included loopback tests without the required local host lease. Treat the suite result as development-only, not candidate qualification. The focused F12 retry regression `test_deadlock5.Deadlock5Tests.test_retry_api_cannot_requeue_dev_after_preflight_block` passed once on exact Package 1 commit `c6dbb9526726c23b59c92ff625b42129569e408b` under the shared local lease (1 test, 0.588 s, 2026-10-08 00:40:14Z). It checks that an invoked Dev retry fails closed with HTTP 409 while a failed PM delivery remains retryable.

**Package 2a offline evidence:** on the frozen source files listed below, all eight tests in `test_package2a.RouteContractTests` and `test_package2a.ControlBoundaryTests` passed at 2026-10-08 01:52Z. UI smoke passed from a disposable `/private/tmp` copy because the SpeakSharp checkout declares ES modules and the smoke file is CommonJS. `git diff --check` passed.

| File | SHA-256 used for the offline checks |
|---|---|
| `server.py` | `409ead266a85c86af4b71af1f16c44d84f68614970da8c0c12e98cd119d0491a` |
| `test_package2a.py` | `f4a12498e1f5d7d11df5325dd2fbd9b0086944a706fbca5b96b23a86e40c6038` |
| `static/index.html` | `bd78b236c81ad64ecaa8744698efd29240fed00adb16abc6acbd95c8e29be221` |
| `test_ui.js` | `c5c153830523e6df5f31237dbd5dfd0f7a9f17f63fc8b4ff81a4d8a7669f7e7b` |

**F15 loopback verification: HOLD, unexecuted.** Awaiting the exact candidate-bound shared host lease and any tool-required bind permission. The requested set is five tests: `test_deadlock5.Deadlock5Tests.test_retry_api_cannot_requeue_dev_after_preflight_block`; `test_handoffs.HandoffTests.test_pm_http_delivery_includes_readable_files_and_manifest`; `test_handoffs.HandoffTests.test_github_only_reports_local_paths_without_claiming_remote_attachments`; `test_regressions.RegressionTests.test_http_dispatch_worktree_and_conflict_endpoints`; and `test_package2a.LoopbackControlTests.test_loopback_refuses_foreign_simple_post_and_accepts_the_page_token`. No loopback result is claimed for Package 2a.

**Still open:** Package 2b (F07–F09), Package 3 (F05, F06, F11, F13), Package 4 (F14, F16), independent source review, all-agent external notification/receipt/action proof, and the separate product closure items in R42. Missing external transport remains an explicit blocker. This packet does not claim all R01–R42/F01–F16 fixed.

Python regression suite: **237 passed** (196 from the first deadlock.5 checkpoint, 30 in candidate 2, 9 in candidate 3 and 2 in candidate 4, all in `test_deadlock5.py`). Node UI smoke: **passed**. Run on the CLI Dev Mac under the shared `host-interlock` lease, which was claimed fresh for this candidate. The run used a scratch copy of this bundle with loopback-only ephemeral ports, a temporary state DB per test and a fake GitHub adapter. No live board, installed app, GitHub write or PR lifecycle was touched.

Candidate 3 adds:
- refresh deduplication across distinct authorized sources, with provenance kept;
- restart after the Ready write landed but before the journal commit;
- an unsupported action or a disabled executor holding a dependent Dev handoff, including the active-assignment none→dev correction;
- independent Dev work proceeding despite a blocked action;
- `dispatched` requiring a handoff from the same turn;
- an end-to-end run with no PO relay: ask → refresh → exact-head review → PM handoff (ask dispatched) → Dev invoked (handoff received) → Dev receipt (handoff acknowledged, ask closed);
- a stalled handoff getting one recovery, then a blocker;
- exact-commit remote packet readback with hash verification, refusing branch refs and paths outside the PR.

Candidate 4 adds a deterministic regression where a second database connection claims the unconfirmed row between the request's read and its claim (the loser makes no GitHub write), and a two-thread race on one unconfirmed candidate (exactly one resume, one Ready write). RED: reverting only the claim check fails the interleaving test.

RED: mutants that remove the active-assignment hold or put the source id back into the refresh key fail 2 and 3 tests respectively. Candidate 2's three mutants are retained.

A live read-only demonstration of `verify_remote_packet` on published commit `6f765c602c934d8b22a69d9acf95c60807770230` verified all five files of the candidate 2 packet. It reported 0 mismatched and 0 missing.

Not verified here: installed-board restart, a live worker wake-up, a live GitHub refresh, and external Browser PM/App Dev receipts in practice. These need separately authorized installed acceptance. This release adds no merge, deployment, migration or Production-run authority.

## Package 2b — local development checkpoint (2026-10-08)

This is the Package 2b source checkpoint, based on Package 2a snapshot `2392ffaf340194b2fccca37832ca1ae26a4a905e` / tree `8f797d0aa17128ef9e65fd35a306e0f4bb03e211`. It remains independently unreviewed, uninstalled, and unaccepted; the outer packet manifest records the frozen source commit and tree.

**Implemented in this local checkpoint:** exact affirmative source authorization for each bounded PM action; per-PR/branch mutation serialization that retains the lease while an outcome is unconfirmed; exclusive state-directory startup lock before DB migration/recovery; enqueue-time task tuple snapshot (checkout path, origin/common-dir, branch, HEAD/tree, lease generation and owned-dirty fingerprint); dispatch-time tuple revalidation; typed readback for uncertain Ready, Draft, full-CI and failed-job actions; transient refresh reads preserve the journal phase and resume without a second Draft transition.

**Verification:** 121 selected tests passed across `test_deadlock5`, `test_package2a`, `test_regressions`, `test_event_delivery`, `test_comms` (loaded by `test_event_delivery`) and `test_refresh_reviews`. Three socket-bound tests were explicitly excluded: `test_deadlock5.Deadlock5Tests.test_retry_api_cannot_requeue_dev_after_preflight_block`, `test_package2a.LoopbackControlTests.test_loopback_refuses_foreign_simple_post_and_accepts_the_page_token`, and `test_regressions.RegressionTests.test_http_dispatch_worktree_and_conflict_endpoints`. An additional 25-test focused subset passed after the final snapshot-stability edit. This is a focused offline regression result, not the full 242-test suite or live acceptance. `git diff --check`, Python byte-compilation and JSON schema parsing passed before that final edit; all changed modules were imported/executed by the tests afterward.

| File | SHA-256 at this checkpoint |
|---|---|
| `server.py` | `efd1ba7a3e5b36b4f20af736d22a2134a3bf2554f71125a5908335131cc59f7f` |
| `guarded_pm.py` | `d8fbf6d3a73318365dda64a33873d44635a198847c9568e9bcb228e9feda31ef` |
| `pm-instructions.md` | `94eef421df66ea66d5209a6a0de158f1abcd96f9adc0d4da2218c5fb4664e363` |
| `pm-route.schema.json` | `5e28dc323f65c25618d83de86e6355c3689c13bfcac58e318a76bc2142bafab1` |
| `test_deadlock5.py` | `92fdafe27122473609b4ab0d91bbfb4ed90b57dd6ae0d126c096ba6158ee1d65` |
| `test_refresh_reviews.py` | `4d52de5a4763690903d0eaa7b2d84e323c1c2a36dceacafa172a1bac8c7e6f09` |
| `test_regressions.py` | `1ded5bd1e00bbddeeb094ca74ed097e0b1e2f042fa5812c8c319bbb9ffbf15c5` |
| `README.md` | `631e96de499ccfb49e9c6a6d1526a8d98d1657ee9e9a751512789540ca3524f1` |

**Still open:** loopback tests and their exact candidate-bound host lease/tool permission; independent source review; Package 3 (F05/F06/F11/F13), Package 4 (F14/F16), supported external notifications and real per-actor receipt/action evidence; installed-board acceptance; product closure R42. No merge, deployment, migration, installation or Production action was performed.
