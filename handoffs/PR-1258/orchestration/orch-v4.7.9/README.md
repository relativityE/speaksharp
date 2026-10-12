# RWT Orch v4.7.9 — coordination.3

One installer: Install_Orch.command. It installs and starts the persistent Mac service and browser;
no second orch-setup command or manually launched listener is required for already registered,
verified idle workers. Existing gh/Codex sign-in is required.

Fixes from the observed failure sequences:
- continuation #1593 is now the default and actual PM publication destination;
- guarded action provenance recognizes verified #1258/#1593 sources;
- new RWT PRs are discovered even when absent from the old board registry;
- rejected ownership checkpoints receive one durable read-only recovery with route/journal context;
- unsent awareness events coalesce, while sent/uncertain actions remain immutable;
- old outbox publications are read back at their original issue, without blindly posting them again;
- one installation manages startup, verified idle migration, login and restart.

These are source/test fixes. Installed-Mac wake and restart proof remains required. Browser-only chats
without a wake hook are explicitly unsupported for automatic wake; GitHub posting is not delivery.
No merge/deployment/Production authority is created by event notifications or installation.

coordination.3 adds startup readiness: stale generic PM errors no longer stop new event pickup; fresh verified login clears stale auth-required status. Dev preflight errors may reconcile but receive no WRITE authority until the assignment is verified. Operator pauses, cleanup uncertainty and invoked Dev uncertainty remain enforced.

First launch publishes one durable ALL AGENTS version/launcher notice to the control issue and queues version-specific recipient handshakes. Restart does not duplicate the post or invent ACKs. PM notification publication failures are task holds, not coordinator-wide errors. Healthy CLI PM is shown as available/receiving events, with task holds displayed separately. Existing native browser-chat wake limits are unchanged.
