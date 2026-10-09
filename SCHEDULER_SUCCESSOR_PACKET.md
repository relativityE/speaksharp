# Orch scheduler successor — local review packet

## Candidate

- Branch: `fix/orch-api-budget-rolling-window-20261009`
- Source commit: `d97e0494daf1edf541f530dbaa42fbc631ef23fc`
- Source tree: `d031d1779c00ad3a5f40cef399fccedb1a9077af`
- Parent: `c63c7d79fa335ddf3e63a1f41a01abf727e4f8f9`
- Files: `server.py`, `test_poll_budget.py`
- Board version: 4.6.17
- Publication: local commit only; not pushed, installed, or restarted.

## Change and evidence

The single `github_watcher` now services the ask and handoff watchdogs on a five-second local deadline, independently of GitHub reads and the 15-minute reconciliation cadence. These watchdogs use the local journal and do not spend GitHub requests. Remote reads still use the one shared watcher, the existing budget/cache/cursors, and a retry gate that honors both the retry delay and GitHub rate-limit backoff.

The watcher consumes the in-memory wake before checking the durable webhook inbox. A delivery already present is recovered from SQLite; a delivery arriving during a remote read remains pending and causes another worker pass. Failed remote reads retain inbox rows and do not cause a rapid repeated read.

New regressions:

- `test_local_ask_recovery_runs_during_remote_failure_without_an_extra_sweep`: an ask becomes overdue while a GitHub read is failing; the local watchdog queues one recovery, the webhook remains durable, and no second remote read occurs during backoff.
- `test_webhook_arriving_during_read_drives_a_second_worker_pass`: a delivery arriving during a successful read remains pending and is reconciled on the next pass.

Verification on this source tree:

- `python3 -B -m unittest test_poll_budget test_deadlock5 -q` — 136 passed.
- `python3 -B -m unittest discover -q` — 350 passed.
- `git diff --check` — passed.

The reused candidate evidence is in `F11_R30_ROLLBACK_PACKET.md`, `GITHUB_EVENT_WAKE_PACKET.md`, and `CLOSURE_STATUS_2026-10-09.md`. These are source/offline results, not live delivery or installed acceptance.

## Remaining closeout

The installed board is still reported as v4.6.16 with Dev routed to an auxiliary Claude session. No intended Codex Dev receipt/result, supported HTTPS callback, configured signed GitHub webhook, shared-host lease, five-test host result, or restart/rollback acceptance is evidenced. The source candidate has not been independently reviewed as a whole.

Smallest route/config action: the CLI PM/local host operator must verify the intended Codex writer's actual session UUID, set only `cli_dev` in `RWT_AGENT_ROUTES_JSON` to `provider: codex_app_server` with that UUID, preserve other actor routes, and configure a recipient-reachable HTTPS `RWT_AGENT_CALLBACK_URL`. For event wakes, configure `RWT_GITHUB_WEBHOOK_SECRET` and a trusted HTTPS path to `/api/github-webhook`; retain the 900-second reconciliation sweep. Do not route through the auxiliary Claude session.

Next owners:

- Browser PM: independently review this exact successor.
- CLI PM: name the actual local host operator and bind the shared-host lease to the successor tuple.
- Local host operator: run the five candidate-bound tests listed in comment 6083047710, then capture one real task-specific receipt/result and the restart recovery evidence.

## Installation and recovery proposal

After independent source review and host/live acceptance, preserve the existing v4.6.16 folder, database, `.agent-work`, credentials, uploads, and route configuration. Use the existing 4.6.17 launcher/migration flow, which stages and verifies the state backup and does not overwrite the v4.6.16 database. Verify `/api/live` reports 4.6.17 and the intended actor/session before sending work. For rollback, stop 4.6.17 and restart the preserved prior folder; changes made only under 4.6.17 are not copied back automatically, so retain its database and reconcile any new task/result before discarding it. No installation or restart is included in this packet.
