# Agent-owned installation — v4.7.7 candidate

CLI PM owns staging, migration, launch, connection checks and the acceptance receipt. PO does not download a bundle, paste commands, enter recipient UUIDs or relay task text. The source is published on a dedicated GitHub handoff branch so the local coordinator can fetch it directly.

1. Fetch the published immutable source tuple into an isolated checkout. Verify PACKAGE-MANIFEST.json against every listed file before staging a new sibling installation. Retain the old folder and all private state.
2. Inspect the running board, active PM turn, writer leases, queued/sent actions and process ownership. Stage during active work; switch only at an idle, verified boundary. Do not terminate Dev validation or unrelated processes. If cleanup is denied/unverified, retain the hold and report directly in GitHub.
3. Identify the actual previous installation from the running process/launcher, not a newest-folder guess. Set RWT_MIGRATE_FROM to that state's absolute database path when multiple siblings exist. Use the retained verified migration; do not reset private state.
4. Run orch-setup.py or open Start_Orch.command. It reuses a live board, checks existing CLI logins and delegates singleton/migration handling to the launcher. Account login is a human authentication boundary; do not copy API keys or change permission modes.
5. Connect each verified existing recipient with Connect + test. Retained pairing needs no repeated session selection. Registered idle Dev workers resume automatically only if both prior processes are absent and no unresolved send exists. No new recipient/thread is invented.
6. If App Dev uses its runtime's background-task completion notification, App Dev owns the listener and automatic rearming inside that session. A detached terminal watcher cannot wake it. CLI PM arranges this directly with App Dev; PO is not the relay.

Verify both inactive Dev recipients return authenticated automatic-wake receipts and results. Exercise CI completion, review request/completion, Dev-result-to-PM delivery, board/worker restart and duplicate prevention. Confirm new packets at the tail of a long issue reach PM while historical pagination continues. Post installed version, routes, actions and real receipts directly on the control issue without credentials.

The browser conversation requires supported inbound integration of its own. Local CLI PM execution does not wake this chat. Keep GitHub fallback until installed acceptance passes. Rollback preserves and reconciles both states; never replay uncertain deliveries. ROUTE-RECOVERY.md retains the older guarded legacy-route procedure for the operator.
