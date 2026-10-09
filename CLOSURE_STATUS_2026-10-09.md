# Orch closure status — 2026-10-09

## Candidate and test-count reconciliation

| Source revision | Evidence | Interpretation |
|---|---|---|
| C12 predecessor | 326 tests reported | Older source revision. |
| `caa74e11278306780f180c50605f99f8ae3aa119` | 328 tests reported | R3 overlay probe revision; not the default-schema successor. |
| `f99b6934eaf0b19962e1d1daa0118e4075cd92e2` | 330 tests reported; PM independently ran 7 focused schema tests, but did not rerun the full suite | Default-schema successor and R4 probe target. |
| `e07e7661aefbea6541ca61c646c31aeb96ad8360` | 338 tests pass in `python3 -B -m unittest discover -q`; 32 focused budget tests pass | Current API-budget candidate. Five socket/HTTP tests pass individually below in the development environment. These are not candidate-bound shared-host acceptance. |

The historical 328-test receipt says all five loopback/HTTP tests passed in an approved host run as part of the suite, but it has no per-test host output and predates `f99b6934` and `e07e766`. The five individual results below are from the current development run; they do not establish the required shared-host or installed acceptance.

| Required host test | Current `e07e766` development result | Host/installed result |
|---|---|---|
| `test_deadlock5.Deadlock5Tests.test_retry_api_cannot_requeue_dev_after_preflight_block` | PASS | Not individually evidenced under the shared host interlock. |
| `test_handoffs.HandoffTests.test_pm_http_delivery_includes_readable_files_and_manifest` | PASS | Not individually evidenced under the shared host interlock. |
| `test_handoffs.HandoffTests.test_github_only_reports_local_paths_without_claiming_remote_attachments` | PASS | Not individually evidenced under the shared host interlock. |
| `test_regressions.RegressionTests.test_http_dispatch_worktree_and_conflict_endpoints` | PASS | Not individually evidenced under the shared host interlock. |
| `test_package2a.LoopbackControlTests.test_loopback_refuses_foreign_simple_post_and_accepts_the_page_token` | PASS | Not individually evidenced under the shared host interlock. |

## R4 default-schema live task record

Evidence is from the preserved read-only SQLite state at `/private/tmp/orch-c12-r4-evidence/state.db`; bearer credentials are omitted.

- Frozen target: `fix/orch-c12-pm-schema-compat-20261008`, worktree `/private/tmp/orch-c12-pm-schema-fix`, HEAD `f99b6934eaf0b19962e1d1daa0118e4075cd92e2`, tree `fc3e95ad42d748ae6d9bea7cbe57791e1933d3c1`.
- Action: `orch-c12-default-schema-probe-20261008-r4`; recipient actor `cli_dev`; transport `codex_app_server`; configured session `01a0f83f-a51b-76e3-ae4f-e45aec3c6980`.
- First dispatch attempt (queue 5) was rejected at `2026-10-08T21:17:02.818541Z`: “PM routed to Dev but no single active CLI Dev task is assigned.” It dispatched nothing.
- After PM assigned the task, delivery was accepted at `2026-10-08T21:17:03.657702Z` and queued to the specified session. The task row started at `21:17:03.542370Z` (board clock), authenticated receipt recorded at `21:19:01.047857Z`, and result at `21:19:08.476163Z`.
- Result was `TASK-RESULT` from `AGENT:cli_dev`: read-only checkpoint reported the exact branch, HEAD and tree above. PM’s subsequent board response states the worktree was clean and no files or external state changed. Result digest: `229847f31bb3b71cac6d160cc6a005da07769d63f5e97362e0915ca4e151e015`.
- This proves one task-specific local Codex delivery, receipt, and result on the `f99b6934` probe. It does not prove other actor routes, unattended recovery after restart, missed/offline recipient recovery, or the installed successor.

## Current source work and remaining acceptance

Current API-budget source candidate: `e07e7661aefbea6541ca61c646c31aeb96ad8360`; tree `7311d85452fd0d25063b77b8d399d52310caae52`; parent `f99b6934eaf0b19962e1d1daa0118e4075cd92e2`. The fix meters qualifier child-process requests against the shared SQLite budget, meters paginated GitHub REST reads, and makes generic fan-out reads fail closed. Full development suite: 338 passed; focused budget suite: 32 passed. R30 remains partial pending independent source review and installed cross-watcher aggregate-budget evidence.

The complete row-by-row source disposition remains in `C4_CLOSURE_MATRIX.md`. Source tests do not close these outstanding gates:

- Independent Browser PM review of the exact current candidate and complete R01–R42/F01–F16 matrix.
- Shared-host execution of the five named tests under the candidate-bound host interlock.
- Host operator’s route inventory for every participating actor, reachable callback, durable receipt/action and busy/offline/crash/uncertain-delivery recovery.
- Installed build identity/digest, preserved state/artifact continuity, unattended CI→review→qualification transition, restart and rollback.
- Product journeys in R42, which are separate from application-source acceptance.

No installation, restart, migration, PR, merge, deployment, or Production action is claimed by this status packet.
