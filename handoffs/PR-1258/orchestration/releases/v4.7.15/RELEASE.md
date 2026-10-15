# Orch v4.7.15 — idle delivery release

Build: coordination.10-idle-delivery. This is a complete package, not a loose patch.

## Changes

- A GitHub event is durably joined to its native CLI PM delivery. The board separates queued, invoked, returned response and recipient receipt/result. Last event queued is never labelled a wake.
- The PM delivery error is the immediate blocker, ahead of an empty Current PR selection. Coordinator host, install root, build, PID and boot identity are exposed.
- Control issues #1593 and #1258 are excluded from PR review enumeration, including stale registry/cache inputs. Their comments remain monitored. This removes the erroneous GraphQL pullRequest lookup and preserves the rotating review budget for actual PRs.
- Read-only Codex transport interruptions receive at most three attempts, retaining the exact event and persisted deadline. Exhaustion fails that packet visibly but does not disable later independent packets. Authentication, configuration, cleanup and uncertain side-effect/publication journals remain holds. No host action or uncertain publication is retried.
- Identity-only bootstrap explicitly supports an installed non-git app directory while retaining a read-only sandbox and a no-tools identity contract. Ordinary repository reasoning does not disable its git check and no longer silently falls back to the app when its configured repository is missing.
- Verified v4.7.14 migration state is preferred over older journals during upgrade. Existing migration checks preserve packet artifacts, actor routes and queue IDs; no old installation is overwritten.

## Both Devs' feedback

App Dev continues publishing GitHub packets; no Orch installation, local listener or new account is required on that machine. The sole CLI PM on the coordinator host is the primary packet consumer and routine review driver. Browser PM has no supported inbound route and is not a prerequisite for routine PM review.

CLI Dev's blocked worker, wrong session pairing and stale listeners remain explicit operational failures, with exact delivery IDs and errors. Recovery must use the existing intended session and preserve its action ledger. An old pinned callback helper is not upgraded by a board version label: the host owner must verify the helper/adapter from the current delivery, receipt and result before claiming compatibility. The release does not fabricate an ACK from a queue timestamp or subprocess return.

## Evidence versus installed acceptance

Automated tests use temporary SQLite state, actual local fixture subprocesses and the dashboard JavaScript. They cover GitHub event → idle PM invocation → checkpoint response without UI interaction, bounded transport recovery, preserved queue deadlines, refusal on uncertainty/authentication, issue/PR separation and v4.7.14 journal migration. No real signed-in Codex account, Mac session, provider or Production operation is used by these tests.

The installed Mac acceptance must still demonstrate one real exact-head GitHub packet → intended idle CLI PM turn → matching task/head ACK → review result, then restart and sleep/rearm continuity. Native PM returned-response state is reported separately from a task-bound authenticated recipient ACK. Until that installed trace is recorded, end-to-end delivery is unproven.

## Host-owner upgrade

The user authorized updating and releasing Orch. CLI PM/host owner owns installation and verification; do not ask the user or either Dev to relay routine packets or debug the setup.

1. Verify this package manifest. Preserve the current installation and its state. Inspect its full last PM error and process/install identity with the old board API before stopping anything.
2. Wait for an idle boundary: no executing PM/Dev turn, no active task dispatch, no unresolved process cleanup. Read back uncertain external-action/publication journals before any continuation; never clear them to make an upgrade appear green.
3. Stop only the verified old foreground supervisor/server and owned idle listeners through supported controls. Do not kill unknown sessions, overwrite the old folder, reset leases or create a second worker. If the actual host identity or quiescence cannot be established, report that exact hold.
4. Extract into a new rwt-pr-handoff-v4.7.15 folder alongside the installed folder. Set RWT_MIGRATE_FROM to the verified stopped v4.7.14 .agent-work/state.db when needed; run python3 orch-setup.py. The launcher imports state using the verified migration protocol. A reachable old build is a failed upgrade check, not successful installation.
5. Run python3 orch-setup.py --check and record running version/build/host/root/PID/boot. Recover the existing intended CLI PM and stale consumers; validate callback/helper compatibility. No App Dev installation or Browser PM input workaround.
6. Exercise the real idle packet and restart/sleep cases above. Keep queue, turn, ACK and result IDs. Report what failed rather than claiming a running watcher proves delivery.

No repository merge, database application, Edge deployment, activation, provider request or live product smoke is authorized by the software update.
