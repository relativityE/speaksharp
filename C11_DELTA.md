# Orch v4.6.17 C11 source delta

This checkpoint adds the source repair for closure-matrix row R06. It is an incremental
source packet on top of C10 (`9a69cc3237a17b1a0f196fc8b37d361a03d25f63`); C10 history is
preserved.

## R06 disposition

Pre-invocation worktree failures now persist `bootstrap_state=required` on the assigned work
item. The phase survives process restart and is reconstructed from an existing
`preflight_recovery` row when an older database is migrated. A later task can mark bootstrap
`verified` only after its immutable queued checkout passes the repository, branch, lease,
head/tree, and owned-dirty-path checks. Changing the verified worktree or lease invalidates
the prior verification. PM prose and a task receipt alone cannot close the phase.

Source: `server.py`; regression: `Deadlock5Tests.test_bootstrap_is_a_persisted_phase_until_exact_new_checkout_is_verified`.

## Verification

- Focused bootstrap and preflight recovery regressions: passed, including legacy database migration.
- Complete Python unittest discovery: 325 passed.
- `py_compile` and `git diff --check`: passed.
- Installed-host, real external actor routing/action, and restart acceptance: **HOLD**.
- Overall orch acceptance: **not complete**. This delta does not resolve the configured wrong-session mapping or the remaining C4 matrix gates.
