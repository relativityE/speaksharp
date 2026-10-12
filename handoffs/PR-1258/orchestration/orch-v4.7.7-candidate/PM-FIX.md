# Orch v4.7.1 — notifications.1

Separate test candidate based on the uploaded v4.6.17 deadlock.5-pmfix.1 bundle. The v4.6.16 installation is untouched. This local patch is not an upstream Git commit or a live installation.

## Priorities 1–3

1. Delivery/recovery: known-unsent publication denied by the shared budget/backoff is persisted as deferred, then resumed locally without rerunning the PM model. A POST that may have reached GitHub remains uncertain and is recovered by its unique marker, never blindly repeated. After confirmed publication and owed effects complete, its publication blocker clears without clearing another blocker or the pause flag. Large comment backlogs progress in bounded, durably committed batches rather than starving newer directives forever.
2. GitHub limits/chatter: retain the shared rolling request budget and persisted rate-limit backoff. Local deferred recovery observes pause, active-turn, authentication, backoff and budget controls. It does not require another full remote snapshot. Affected PR checks and conversation summaries share the existing metadata read; no extra request is added for them. Automatic PM comments do not wake PM again.
3. CI/review follow-through: changes in checks on affected PRs, including a PR other than the selected one, can wake PM. Security-only conversation changes and edited review summaries can wake PM. Repeated unchanged observations produce no new wake. These are wake signals, not qualification or merge evidence.

Existing authenticated recipient receipt/result stages and missed-receipt watchdogs remain required. Published GitHub comments, queued transport, or started processes do not establish recipient acknowledgment. The patch cannot fabricate an external Codex session or make an unreachable callback reachable. Installed two-Dev delivery acceptance remains open. Priorities 4–5 are included: task prerequisites gate activation/dispatch, and checkpoint age is separate from process activity. The original compact UI and 160px pending-work scroller are retained.

## Install for controlled testing

1. Pause CLI PM. Capture active Dev leases and uncertain deliveries; do not stop or duplicate an active writer merely to install the board.
2. Preserve the old folder and its entire .agent-work directory. Extract this ZIP beside it; do not overwrite .16 or another installation.
3. Stop the old board and verify only one board writer will use the migrated state. Retain the old folder/database for rollback.
4. Launch from the new folder with the explicit prior database and repository paths:

```bash
RWT_MIGRATE_FROM="/absolute/path/to/old-board/.agent-work/state.db" \
SPEAKSHARP_REPO="/absolute/path/to/speaksharp" ./start-rwt-handoff.sh
```

5. Confirm server/dashboard identity 4.7.1 (notifications.1), retained pause/leases/outbox and verified intended-recipient routes. Inspect recovery before resuming CLI PM. Do not replay delivery #849.
6. Execute TESTING.md's delivery, restart, budget and follow-through checklist. Keep manual backup until both Devs pass.

This package adds no merge, deployment, model, migration or Production-run authority. It does not cancel or repair a frozen ChatGPT browser conversation.

## Notification repair in notifications.1

Persistent local recipient pairing replaces the requirement to recreate environment routes on every launch. Explicit Codex session inventory uses read-only app-server methods. App Dev gets a durable local inbox with a single agent-side background-task listener; CLI Dev keeps the supported existing-session queue. Both use the same frozen action/session receipt and result contract. Result callbacks enqueue PM follow-through, and actor checkpoints update from authenticated pickup/results. The Advanced panel shows the actual delivery stage and automatic-wake proof. See README.md for one-time pairing/listener setup and TESTING.md for acceptance.

The runtime must support background-task completion waking its existing session. This is the mechanism App Dev reported using successfully with its GitHub watcher; the new listener replaces remote polling with local Orch polling. This package does not invent a Claude push API or configure the remote Browser PM chat. Installed CLI/App Dev wake, configured routes, host permissions and GitHub request measurements are still unverified.

## Notification recovery in v4.7.1

After 15 minutes without an authenticated recipient receipt, including blocked or missing routes, Orch queues one task-specific CLI PM request to publish a role-addressed fallback reminder on #1258. It preserves the original action and writer lease; it does not blindly resend uncertain transport. PM must perform and verify the cross-post. App inbox listener exit is marked waiting_for_rearm; a stale heartbeat prompts PM to chase rearming. The recipient still rearms its background task after pickup or session restart. Private pairing and pending inbox are migrated into the new version folder. Installed automatic Dev wake remains an acceptance requirement.
