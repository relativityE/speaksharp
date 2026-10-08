# C5 Package 2b source packet

Frozen app source commit: `734dc15e0bdaed1b929f4af4d8772d23fd47e035` (tree `b88799be487e18633d192c845314099870246e8d`), based on Package 2a commit `2392ffaf340194b2fccca37832ca1ae26a4a905e`. `MANIFEST.json` binds each included source and evidence file by SHA-256.

## Implemented in this increment

- Exact affirmative source authorization for each bounded PM action.
- Per-PR/branch mutation serialization, retained through uncertain outcomes.
- Exclusive state-directory ownership before startup migration and recovery.
- Frozen task checkout identity, HEAD/tree, lease generation, and explicitly owned dirty-file fingerprint at enqueue; dispatch revalidates that tuple.
- Typed readback for uncertain Ready, Draft, full-CI, and failed-job actions; transient refresh reads preserve lifecycle phase.

## Verification and limits

- 121 selected offline tests passed. A focused 25-test subset passed after the final snapshot stability change.
- Excluded pending host lease and any required fresh bind permission: `test_deadlock5.Deadlock5Tests.test_retry_api_cannot_requeue_dev_after_preflight_block`, `test_package2a.LoopbackControlTests.test_loopback_refuses_foreign_simple_post_and_accepts_the_page_token`, and `test_regressions.RegressionTests.test_http_dispatch_worktree_and_conflict_endpoints`.
- No full suite, live worker delivery, external notification/receipt, installed-board restart, live GitHub lifecycle, or installed acceptance is claimed.
- Packages 3 and 4 remain unfinished. External notification transport and real per-actor receipt/action proof remain open. This packet does not claim all PM findings R01–R42/F01–F16 are fixed.
- No app installation, restart, PR creation, merge, deployment, migration, or Production action occurred. Independent PM source review is pending.
