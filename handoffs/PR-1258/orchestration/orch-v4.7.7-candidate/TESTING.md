For the final v4.7.6 results and 23 new worker/event tests, see VALIDATION.md and test_worker_runtime.py. Installed Mac delivery remains a separate acceptance gate.

# v4.7.6 workers.6 test and acceptance guide

## Executed offline checks

489 Python tests passed on the isolated candidate, including deferred publication, uncertain-POST no-replay, marker recovery, unrelated-error/pause preservation, a second publication blocker, restartable 1,201-comment backlog, atomic shared request budgets, non-selected PR CI wakes and Security-summary edit wakes. Dashboard smoke, launcher shell syntax and Python compile checks passed. See VALIDATION.md.

Reproduce with a valid isolated repository checkout (never use an active Dev checkout for host-test mutations):

```bash
SPEAKSHARP_REPO="/path/to/isolated/git-checkout" python3 -B -m unittest discover -q
node test_ui.js
bash -n start-rwt-handoff.sh
python3 -B -m py_compile server.py agent_transport.py guarded_pm.py migrate_state.py
```

Do not run shared-host tests concurrently with another test owner. Passing source tests does not establish live delivery, qualification or RWT completion.

## Priority 1: no PO relay

- Verify installed version/build and exact actor/session route for CLI Dev and App Dev. Verify callback reachability from each recipient.
- Send one fresh bounded read-only task to each Dev. Require authenticated receipt and result bound to intended actor, session, action ID and token. Include the observed branch/HEAD/tree in each result. PM must consume results without PO copy-paste.
- Queue behind a busy recipient; preserve sole-writer lease. Verify deferred work starts after release rather than silently disappearing.
- Pause/resume and restart between publication, receipt and result. Verify persisted pending work resumes once. Existing uncertain writes are inspected, not retried blindly.
- Delay one receipt: show the pending stage, require the watchdog to alert PM, and confirm recovery/disposition rather than a false success. Never create a duplicate writer to chase an acknowledgment.
- On a large issue backlog, verify committed page progress and eventual arrival at the latest directive without losing earlier task asks.

## Priority 2: budgets and chatter

- Observe aggregate request counts from the host and subprocess adapters; require the configured shared rolling cap and no requests during persisted backoff.
- Deny an unsent post by budget, then release capacity: one eventual publication and one Dev route, with PM becoming available afterward.
- Simulate a timeout after POST: confirm by marker; no second POST. If no marker is found, leave the operation visibly uncertain for PM recovery.
- Repeated unchanged state and automatic PM posts must not repeatedly wake PM. Honor server backoff; no bypass through another process or restart.

## Priority 3: CI/review follow-through

- Complete CI for an affected PR other than the selected one; require PM wake and actual reconciliation.
- Complete or edit a Security-only top-level summary; require PM wake. Repeating identical state must not duplicate work.
- PM independently inspects actual exact-head Code and Security findings, threads and jobs before recovering failed checks. A wake or completed summary alone is not qualification.

## Acceptance and rollback

Record timestamps, installation/build identity, task IDs, receipt/result identities, wake/recovery facts and measured request totals. No passwords/tokens or user transcript content in evidence. Preserve prior installation/state; verify rollback without discarding new uncertain tasks or results.

Live two-Dev delivery/action, installed restart/rollback and API-limit acceptance remain OPEN. Priorities 4–5 are implemented and covered by isolated regressions. Their installed acceptance remains open. This bundle authorizes no SpeakSharp merge, deployment, migration, model activation or Production run.

## Combined build acceptance

1. Confirm 4.7.6 workers.6 in the running board. Existing state must remain intact.
2. Compare launch environment to the working prior launcher; each route must validate. A binary being present is not a recipient route.
3. For each Dev, send one stable task-bound read-only probe; require persisted delivery ID, authenticated intended actor/session receipt, and result. GitHub-watcher pickup does not pass.
4. With a task dependency unfinished, WRITE activation and dispatch must stop; an independent ready task must remain eligible. After PM records predecessor completion, a fresh explicit handoff may proceed.
5. Process activity must not reset task checkpoint age. Missing routes/stale checkpoints must stay visible. Pending work must scroll internally at 160px without moving content below.

Current live outcome: direct delivery NOT proven. App Dev read via GitHub watcher and CLI Dev manually picked up work; the installed screenshot reports no configured CLI Dev route. Visual layout on the installed build remains to be checked.

## New notification acceptance — required on the Mac

1. Pair each actual existing Dev session in Advanced; record the UUID/provider privately, never a token on GitHub. For App Dev, start the single inbox helper as a background task within that session. Do not use a standalone Terminal watcher.
2. Make each session inactive and turn off its GitHub fallback watcher for this test. Click the non-writing wake probe once per actor. The recipient must wake without PO relay, send its authenticated receipt, then a result starting `wake=automatic`. A manually activated recipient returns `wake=manual`; it does not pass.
3. Inspect the exact action under `transport.agent_routes.<actor>.last_delivery`. Require receipt_at, result_at and live_delivery_proven=true for both actors. The App route must also show listener_recent=true after its helper is rearmed. Queue acceptance or listening alone does not pass.
4. Restart the board between delivery and receipt, then between receipt and result. The same action must remain durable without a second queue call or writer. Reject wrong actor/session/token, premature result and conflicting duplicate evidence. An exact duplicate callback is idempotent.
5. Run one actual bounded review handoff per Dev. Confirm pickup, source result returned to the PM queue, and PM independently reconciles it; no PO copying. Verify a delayed notification warns at 60 seconds and escalates once at 5 minutes, without redelivery.
6. Confirm pairing survives restart, no session is shared by two actors, environment overrides cannot silently change persisted pairing, and active delivery targets cannot be redirected. Retain backup coordination until both live probes and actual handoffs pass.

The included loopback listener and receipt fixtures are executable integration tests, but their synthetic sessions are not the live Devs. No claim of Mac runtime wake success is made by passing them.

## Notification recovery in v4.7.1

After 15 minutes without an authenticated recipient receipt, including blocked or missing routes, Orch queues one task-specific CLI PM request to publish a role-addressed fallback reminder on #1258. It preserves the original action and writer lease; it does not blindly resend uncertain transport. PM must perform and verify the cross-post. App inbox listener exit is marked waiting_for_rearm; a stale heartbeat prompts PM to chase rearming. The recipient still rearms its background task after pickup or session restart. Private pairing and pending inbox are migrated into the new version folder. Installed automatic Dev wake remains an acceptance requirement.

## workers.6 acceptance additions

1. With GitHub raw-watch disabled and PM paused, deliver an actual task result: it must be durable/queued exactly once and execute on resume. Receipt is pickup; result still needs PM disposition.
2. Rearm App Dev before its callback: the same presented probe must not wake repeatedly; a new task must remain deliverable. Send the authentic callback and verify pending receipt clears.
3. CLI Dev must be loaded in its actual existing server. Test idle input and active exact-turn steering without another process/session. Missing/unloaded endpoint must fail visibly. A lost reply stays uncertain and is not resent.
4. Ready with only Draft CI: confirm one missing-full-CI PM wake; the guarded authorized full dispatch must have a real run ID. Do not count a green Draft report as qualification.
5. Post an actual Dev review packet on its PR and #1258, then verify review→paired Dev directive→receipt→result→PM follow-up. Cloud issue-only events are not immediate PR-webhook triggers.
6. One-time runtime callback approval may still be necessary. A denied callback is BLOCKED, never receipt/result PASS.
