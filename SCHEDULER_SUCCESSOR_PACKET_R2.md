# Orch scheduler successor R2

## Exact candidate

- Branch: `fix/orch-api-budget-rolling-window-20261009`
- Source commit: `6634486d224354629fe3f514d74e14b887583064`
- Source tree: `7dbd679a70b9532d0b9a899b1b9ff0ade9cdc7b6`
- Parent: `1d1a704e32bf03232d82fbef222942144066ff9e`
- Changed files: `server.py`, `test_poll_budget.py`
- Base publication `1d1a704e` remains in branch history; its “local only” statement described the time that packet was created. That packet was subsequently published and remotely verified at #1258 comment 6085030407. This R2 packet supersedes that status for the new source revision.

## Review correction

Browser PM's independent review at #1258 comment 6085259305 found two scheduler defects:

1. An expired persisted GitHub throttle was treated as work on its own, causing repeated remote reads despite a recent successful sweep.
2. A past sweep deadline remained the minimum sleep deadline while an active throttle blocked the read, causing zero-sleep loops.

The watcher now starts a remote read only for an actual event, pending inbox row, due reconciliation sweep, or owed retry, and only after the retry/API throttle expires. Its sleep deadline applies the active throttle to overdue remote work while retaining the five-second local ask/handoff recovery cadence.

## RED/GREEN evidence

New worker regressions use a fixed clock and run two watcher passes:

- `test_expired_persisted_backoff_does_not_trigger_repeated_remote_reads`: at t=1000, prior sweep t=990, saved throttle t=999; no event or due sweep produces no remote read and bounded 5-second waits.
- `test_overdue_sweep_during_active_backoff_uses_bounded_local_waits`: at t=1000, sweep t=0 and throttle t=2000; no remote read occurs before the throttle, and waits remain five seconds instead of zero.
- `test_successful_event_read_is_not_repeated_after_expired_backoff`: a durable event after an expired throttle causes exactly one successful remote read; the inbox is processed and the read is not repeated.

Previous R1 regressions remain: recovery of an overdue ask during remote failure without an extra sweep, and a webhook arriving during a read continuing into a second pass.

Verification on the source commit:

- `python3 -B -m unittest test_poll_budget -q` — 48 passed.
- `python3 -B -m unittest discover -q` — 353 passed.
- `git diff --check` — passed.

No second poller or unbudgeted GitHub request path was added.

## Remaining acceptance

This source correction is not live host acceptance. The installed board is reported as v4.6.16 with Dev routed to an auxiliary Claude session. Intended Codex-session route, recipient-reachable callback/webhook, authenticated task receipt/result, shared-host lease, candidate-bound host tests, and installed restart/rollback evidence remain separate gates. No installation or restart is authorized by this packet.
