# DEADLOCK-5 candidate verification — 2026-10-07

## Bootstrap and patch identity

- Pristine source: `rwt-pr-handoff-v4.6.16-deadlock.4.zip`.
- Required source SHA-256 verified: `c543cdf93bacbc45e0bacd0ef1743f42fecb5f3533537e3562e202a89edaec4b`.
- Immutable captured patch applied: `deadlock.5.patch.diff`, SHA-256 `0447adcccc5bbf4346b06ce51568ddd88ff67cdc59fd9ba073716606c1339e83`.
- New isolated source path: `fresh-source/rwt-pr-handoff-v4.6.16/` within the DEADLOCK-5 task worktree.

## Current candidate status

- Source changes and regression cases cover durable independent asks, aged scheduling, held-task isolation, retry-endpoint bypass, preflight/invoked failure recovery, handoff-depth recovery, exact review/comment/requested-reviewer signals, and `refresh_reviews` from typed route through guarded executor.
- `refresh_reviews` cases include exact-head existing-review observe-only behavior, no mutation on head drift, already-Draft partial-transition resume, post-transition readback, pending-review signaling, and route/executor journal deduplication. Unsupported action names produce an explicit recoverable blocker.
- Tests for the current candidate: **HOLD — not run**. The shared host test lease is unavailable. The prior isolated snapshot passed 200 tests and 56 focused tests before these additional changes; those results do not qualify this candidate.
- Static validation completed: Python AST parsing for seven changed runtime/regression modules, JSON parse for the route schema, `node --check` for `test_ui.js`, and `bash -n` for the launcher all passed. No application test suite was run. No live app installation or restart was performed.

The packet is DRAFT / NOT ACCEPTED. No merge, deployment, Production action, or live board mutation is authorized.
