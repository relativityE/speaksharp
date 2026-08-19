# P0-03 — Atomic completion and newest-two transcript retention

## Product contract
- Transcript is visible during recording.
- The two newest completed session transcripts are retained for authenticated review and PDF.
- Completing a third session removes transcript text from the oldest retained session while its metrics, progress eligibility, comparison references, provenance, and next action remain.
- Raw audio, model output, diagnostics, logs, telemetry, errors, and ordinary CI artifacts never retain transcript content.
- Controlled STT benchmark artifacts may retain reference and recognized text for WER.

## Required implementation
- Replace the contradictory metrics-only/newest-two authorities in #1306/#1254/#1257 and refreeze #1310 before enforcement work.
- Define one server-authoritative atomic completion transaction containing transcript, metrics, measured filler map, provenance, and exactly one structured next action.
- Enforce newest-two transcript eviction in the same trusted boundary or an equivalently proven serialized transaction.
- Preserve idempotency; mismatched retries fail closed.
- Keep additive rollout compatibility until the frontend cutover is qualified.
- Prove RLS/cross-user isolation and content-free observability.

## Acceptance evidence
- DB integration: completed session cannot exist without required metrics and one next action.
- Sessions 1 and 2 retain transcript; session 3 completion purges only session 1 transcript.
- Session 1 metrics still drive Progress.
- Rollback on any atomic-write failure leaves no partial completed row.
- Concurrent completions cannot retain more than two transcripts.
- Unauthorized callers cannot read another user's retained transcript.
- Production schema/RPC preflight is names/counts/signatures only; never print transcript content.
- Exact-head DB, privacy, security, unit, and E2E gates green.

## Deployment gates
Migration apply, frontend merge/deploy, legacy-overload removal, and any production cleanup are separate Product Owner decisions.
