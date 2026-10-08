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
