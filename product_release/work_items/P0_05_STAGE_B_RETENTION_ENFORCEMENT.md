# P0-05 — Stage-B enforcement and account deletion

## Outcome
Only the canonical newest-two completion path can complete sessions, and account deletion removes authentication access, retained transcripts, metrics, mappings, and retry state according to the refrozen contract.

## Required implementation
- Read back production `pg_proc` signatures and grants without content.
- Remove/revoke every legacy completion overload that can bypass required metrics, next action, idempotency, or retention enforcement.
- Do not merely preserve the prior transcript-free RPC: align Stage B with the Product Owner's newest-two retention decision.
- Implement the refrozen #1310 service-only deletion coordinator, immediate pre-issued-token denial/tombstone gate, purge-surviving retry state, public-data purge, retained-transcript purge, and telemetry-mapping interface.
- Maintain content-free operator status codes and idempotent retry.

## Acceptance evidence
- Legacy overload is absent or non-executable to product roles.
- Canonical completion succeeds; bypass calls fail closed.
- Existing-token read/write/RPC attempts fail immediately after deletion begins.
- Cross-user isolation, idempotency, partial-failure resume, and operator retry proven.
- Account deletion removes both retained transcripts and all derived user metrics/history as approved; no transcript enters evidence.
- Real hosted Auth proof required; PGlite-only evidence is insufficient.
- Exact-head security/privacy/DB/CI gates green.

## Gates
#1310 must be revised and explicitly refrozen before implementation. Migration, merge, deployment, production execution, and destructive cleanup remain separately authorized.
