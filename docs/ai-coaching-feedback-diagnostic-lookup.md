# AI coaching → Share Feedback diagnostic lookup

This contract links a feedback row to one coaching request without storing a session UUID, transcript,
generated phrase, provider error body, or credential in telemetry.

## Correlation

1. `get-ai-suggestions` accepts a client-generated UUIDv4 `diagnostic_request_id` and a distinct
   `diagnostic_attempt_id` for each network invocation. If the client cannot generate one, the server
   creates its own IDs and returns them in `diagnostics`.
2. The client keeps a short-lived, tab-local mapping from the exact saved session UUID to the request
   UUID. It never falls back to the active/current session for a different selection.
3. Share Feedback stores the opaque request UUID in the existing JSON metadata field
   `coaching_diagnostic_ref` only when the selected session has that exact mapping. “No session” and
   an older session without a mapping omit it. This is metadata-only; no schema migration is needed.
4. `feedback_submit` carries the same UUID on attempted, storage-success, and storage-failure events.
   The UUID is a governed UUID field; report prose and session identifiers are rejected by the event
   allowlist.

## Investigation

- Start with the feedback row’s `metadata.coaching_diagnostic_ref`. This is the request UUID to search.
- Inspect the Edge function’s `AI_COACHING_DIAGNOSTIC` structured log records for that `request_id`.
  Each server record has its own `attempt_id`, phase, closed outcome/reason/status, provider status,
  configured and provider-reported model, fresh/cache source, retry counts, provider/total duration,
  prompt digest, product, session-presence boolean, and client release SHA.
- Compare those server records with received `ai_coaching_diagnostic` telemetry for the same request
  UUID. Client-only transport failures can have no Edge record; their client event remains marked as
  a network failure rather than inventing a server result.
- A cache response may report its original model only when the server-owned authority receipt matches
  the same session/user and current saved-value digest. Otherwise observed model stays null.

Exact transcript and suggestions are intentionally absent from logs and telemetry. The separate RWT
collector may retain exact input and output only in a restricted synthetic-only artifact after it
validates fixture, release, run-owned account/session, server authority receipt, and rendered/saved
equality. That artifact is not a Share Feedback attachment or a public RWT receipt.
