# F11/R30 legacy clock-rollback repair

## Scope

Correct the legacy fixed-window migration in `_request_budget_timestamps`. Legacy records contain only a minute index and usage count. If the persisted index is ahead of the current clock window, retain the full configured budget as consumed. This fails closed until time catches up and avoids granting a fresh budget after clock rollback.

The version-2 timestamp log remains unchanged: exact timestamps in the future are retained, and entries older than the rolling interval expire normally. Prior-bucket legacy migration remains conservative.

## RED/GREEN evidence

- RED on the starting candidate: `test_legacy_future_window_fails_closed_after_clock_rollback` failed because the old code discarded the future legacy bucket and accepted another reservation.
- GREEN on the successor: `python3 -B -m unittest test_poll_budget -v` — 39 tests passed.
- Full suite: `python3 -B -m unittest discover -q` — 344 tests passed.
- Added regressions cover future legacy state after rollback, normal legacy expiry, prior-bucket migration, v2 future timestamps after rollback, and normal v2 expiry.
- Full-suite result is recorded in the task handoff after completion.

## Boundaries

This is source-level regression evidence only. Orch route/callback acceptance, shared-host tests, installed delivery, restart recovery, and rollback acceptance remain open. No installation or Production action is part of this packet.
