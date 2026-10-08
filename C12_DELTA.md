# Orch v4.6.17 C12 source delta

This checkpoint adds a fail-closed guard for the wrong-session route documented in the
current coordination findings. C10 and C11 history remain intact.

`configured_actor_route()` now compares the configured `cli_dev` app-server session with
the locally registered Dev worker. If the same session is registered to a non-Codex
provider (the auxiliary Claude worker), the route is rejected before task snapshot,
review-handoff dispatch, task dispatch, or transport-status reporting. The task remains
visible with an unconfigured target; no message is sent to the wrong session. The host must
still configure the actual Codex writer session and prove receipt/action after installation.

Regression: `Deadlock5Tests.test_cli_dev_route_rejects_auxiliary_claude_session_before_delivery_snapshot`.
It verifies both the persisted delivery target remains blank and the transport is never
called for the mismatched session.

## Verification and limits

- Complete Python unittest discovery: **326 passed**.
- `py_compile` and `git diff --check`: passed.
- Real route configuration, external receipt/action, Security reviewer routing, host tests,
  installed restart and rollback: **HOLD**.
- This is a source packet only; it does not authorize installation, restart, PR creation,
  merge, deployment, or Production action.
