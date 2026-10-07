# DEADLOCK-5 isolated repair — CLI Dev candidate `deadlock5-20261007-clidev-6ac2913a3162`

**Status: DRAFT / NOT ACCEPTED.** Published under the PO-directed override (#1258 comment 6048172525, item 3) for PM/Browser PM review of the actual bytes. Publishing it authorizes no install, restart, live-board mutation, merge, deployment or Production action.

## Provenance
- Pristine baseline: `rwt-pr-handoff-v4.6.16-deadlock.4.zip`, SHA-256 `c543cdf93bacbc45e0bacd0ef1743f42fecb5f3533537e3562e202a89edaec4b`.
- Captured patch applied first: CLI Dev's own 22:17 UTC checkpoint `deadlock4-to-deadlock5.patch.txt`, SHA-256 `6936d6cad96d59fb2f5abaaa8c4185ed80127f558aa7439e8a5e003da2fbe725`. The contested writer's diff was **not** adopted.
- Isolated tuple: branch `fix/rwt-deadlock5-isolated-6048172525`, base `18a601dcc18413744ccb50cdbf00beffb8219d75`, tree `da79db0d0b947a340dd5521343ceb1ab49bb6bb1`. The bundle is untracked there, and no product source changed.
- Not derived from sibling packet `deadlock5-20261007-c488bf92c914` on this branch. That packet records captured patch `0447adcc…`, which belongs to a different lineage. Both are preserved for PM reconciliation.

## Files
| File | Purpose |
|---|---|
| `deadlock4-to-deadlock5-c2.patch.txt` | Full UTF-8 unified diff from the pristine deadlock.4 bundle (`patch -p1` at the bundle's parent directory) |
| `checkpoint1-to-c2.patch.txt` | The increment over the captured first checkpoint: this repair only |
| `replacement-files/…/designer/5e77cf0dbf6c/README.md` | Copied whole after patching. Its diff hunk would have to quote the removed personal path, so neither patch includes it |
| `rwt-pr-handoff-v4.6.16-deadlock.5-c2.zip` | Optional complete bundle, built reproducibly (two builds were byte-identical) |
| `manifest.json` | SHA-256 for every packet file and every bundle file |

Reproduce: unzip the pristine ZIP, apply the full patch with `patch -p1`, then copy `replacement-files/.` over it. The result matches every `bundle_files_sha256` entry. Unzipping the c2 ZIP gives the same tree.

## Diagnosis (PM effectiveness, from read-only queries of the installed board's state.db)
- **Coaching-summary packet 6046183112.** It reached PM in 7 deliveries (queue 14, 15 failed; 16, 22, 33, 51, 53 responded). No PM reply cites it. A `responded` turn counted as handled, and nothing tracked the ask itself.
- **Pin watchdog.** It has one slot: one wake for 6046881204 (queue 26), then it moved to 6047604620 (queue 39). Only `COMPLETE … REQUEST push pin` packets are matched, so asks for PR 4 evidence and pause copy were never tracked.
- **PM context.** It holds only the last 12 control comments. Every id now in it is ≥ 6048309543, so older open asks drop out of the PM prompt under newer #1570 traffic.
- **#34/#36.** `run_pm` `next=dev` → `maybe_handoff` → `enqueue` created Dev rows without `resolve_dev_target`. The failure then queued no recovery.
- **`refresh_reviews`.** `pm-instructions.md` said "The only executor actions are mark_ready, open_draft_pr, rerun_failed_jobs and dispatch_full_ci", which omits it. The schema and executor already supported it, and the journal shows the PM never emitted it.

## Acceptance map (PASS = covered by an executed isolated test; HOLD = not yet proven)
| Item | State | Evidence |
|---|---|---|
| Retry API cannot requeue Dev after a pre-invocation block (before or after recovery) | PASS | `test_retry_api_cannot_requeue_dev_after_preflight_block` (loopback HTTP); guarded single UPDATE |
| One idempotent PM recovery at the handoff-depth boundary / `auto_handoff=0` | PASS | `test_recovery_survives_handoff_depth_boundary_and_auto_handoff_off` |
| Failure→recovery restart gap | PASS | `preflight_recovery_due` is written with the failure; `test_crash_between_failure_and_recovery_is_swept_once_after_restart`; history is not swept |
| Duplicate/loop prevention | PASS | `test_repeat_block_on_unchanged_tuple_is_board_blocker_not_second_wake` |
| No Dev row to an unresolvable tuple (#34/#36 path) | PASS | `test_pm_next_dev_to_unresolvable_tuple_queues_recovery_not_dev_row` |
| Lease transfer only after tuple verification; lease preserved; successful bootstrap → one Dev delivery | PASS | `test_lease_moves_only_to_a_verified_tuple…`, `test_successful_bootstrap_hands_off_to_dev_once` |
| Independent asks: multi-ask posts, noisy newer events, repeats, typed disposition only, publication required, external numbered dispositions | PASS | 6 ask tests |
| Bounded, deduplicated ask recovery → board blocker; no concurrent PM mutator | PASS | `test_watchdog_one_bounded_recovery_then_board_blocker` |
| Review handoff: exact head + disposition + instruction, task-specific receipt token | PASS | `test_cli_dev_review_handoff_requires_its_own_receipt`, `test_app_dev_handoff_is_published_and_acked_only_by_token_comment` |
| `refresh_reviews`: plan→executor, canonical dedupe, concurrency, restart/resume, partial Draft, Ready readback, stale HOLD, observed vs executed, execution ≠ review completion, completion routed once | PASS (fake adapter) | 10 tests in `test_deadlock5.py` |
| Unsupported action → named recoverable blocker | PASS | `test_unsupported_action_is_named_recoverable_blocker` |
| Per-PR share location visible to agents | PASS (local) | `test_per_pr_share_location…`; `GET /api/handoff-location` |
| Connector can read this packet and verify hashes | HOLD | Needs a Browser PM readback of this commit |
| Installed board: restart, live preflight→recovery, live receipt round-trip | HOLD | Needs separately authorized installed acceptance |
| Live `refresh_reviews` on a real PR | HOLD (by design) | Not run; the #1570 refresh is already done and was not repeated |

## Test receipt
Python suite **226 passed** (196 + 30 new). Node UI smoke **passed**. Run under the shared `host-interlock` lease from a scratch copy whose source digest matched the candidate. RED: the new file errors on the captured checkpoint. Three targeted mutants each fail their tests: the old instruction list, a removed retry guard, and recovery routed back through `maybe_handoff`.

Fixture changes to existing tests: `test_refresh_reviews.py`'s fake now clears `draft` on Ready, as GitHub does, because Ready is now read back. Two of its assertions now expect `EXECUTED`/`OBSERVED`.
