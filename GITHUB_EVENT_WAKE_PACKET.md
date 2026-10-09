# GitHub event wake and reconciliation cadence

## Source behavior

- `POST /api/github-webhook` accepts an allowlisted GitHub event only when the request has a valid `X-Hub-Signature-256`, delivery ID, JSON body, and configured `RWT_GITHUB_WEBHOOK_SECRET`.
- The inbox stores the delivery ID, event type and payload digest, not the raw payload. Identical retries are deduplicated; reuse of an ID for different content is rejected.
- An accepted new delivery wakes the existing `github_watcher()` thread. The event is only a wake signal: authoritative GitHub state is re-read through the existing shared request budget, cache and staged cursors before work is queued.
- Inbox entries become processed in the same database transaction as a successful snapshot/cursor commit. Read failures leave them pending for bounded retry; startup reconciliation preserves pending inbox rows.
- In webhook mode, one watcher runs a full reconciliation immediately at startup, on event wake, and every `RWT_GITHUB_RECONCILIATION_INTERVAL_SECONDS` (default 900). It uses the same request budget, cursors and coalesced queue. No second poller was added.
- Without `RWT_GITHUB_WEBHOOK_SECRET`, the board retains its configured polling fallback. The HTTP board binds to loopback; external GitHub delivery requires a separately configured trusted HTTPS proxy or tunnel.

## Verification

Focused tests cover signature validation, missing-secret and invalid-event rejection, duplicate and conflicting delivery IDs, durable pending state across startup reconciliation, webhook-triggered wake, late-arriving inbox rows, and the bounded 15-minute schedule. `python3 -B -m unittest test_poll_budget -q` passes **43 tests**; `python3 -B -m unittest discover -q` passes **348 tests** on this source tree; `git diff --check` passes.

## Acceptance boundary

These are source-level checks. External webhook reachability, actual event delivery, correct-agent receipt/action, shared-host execution, and installed restart/rollback acceptance remain unverified. An absent tunnel or secret must remain a visible transport blocker.
