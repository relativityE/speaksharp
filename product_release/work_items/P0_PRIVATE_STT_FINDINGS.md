<!-- pm-currentization:2026-09-04 -->
> [!CAUTION]
> **Reviewed 4 Sep 2026 — superseded work packet.** This file is preserved for provenance and must not be executed as current product/release authority. Preview/internal-build model selection, PostHog-flag targeting, two-transcript retention, and prior closure claims are superseded by the canonical root documents and issues #1259/#1258/#1390/#1404/#1407/#1386/#1263/#1304. Use canonical Production only; do not infer that historical PASS evidence qualifies the current product.
<!-- /pm-currentization:2026-09-04 -->

# P0 — Close all findings from the latest deployed Private-STT test

## Status and authority

This is the single implementation PR for the latest Private-STT real-device findings.

The captured human run used a stale pre-cutover browser bundle. It is valid evidence of the stale-tab hazard and legacy-RPC behavior, but it is **not** qualification evidence for the current deployed bundle. No finding is marked fixed until the exact-release automated and human acceptance gates below pass.

Product Owner retention decision:

- Transcript is visible during recording.
- The two newest completed session transcripts are retained for authenticated review and PDF.
- Completing a third session removes transcript text from the oldest retained session while its metrics, progress evidence, provenance, and next action remain.
- Raw audio/model output and transcript text never enter ordinary logs, diagnostics, telemetry, errors, or CI evidence.
- Controlled STT benchmark artifacts may retain reference and recognized text for WER.

This decision supersedes the metrics-only-everywhere language currently present in #1306 and parts of main.

## Verified current findings

1. A long-open browser ran stale code after the deployment.
2. The old evidence harness used invalid state/DOM/metric selectors and could produce structurally void verdicts.
3. Stage A added a strict transcript-free completion overload but intentionally left the legacy transcript-bearing overload in migrations. Production availability/grants still require a read-only `pg_proc` readback.
4. Current source contradicts itself: Analytics promises newest-two transcript retention while the session type and PDF generator implement metrics-only review.
5. Current Session UI derives finalized filler total and filler breakdown from independent sources, allowing contradictions such as `0 fillers` with `so ×1`.
6. The human sessions were below Comparable Progress eligibility, so they could not prove baseline or improvement behavior.
7. Five retired GitHub credential identifiers (the ambiguous canary password, two Basic test credentials, and two Basic Stripe price identifiers) had no active consumers. The canary identifier was already absent; Dev reports the four Basic identifiers were deleted under PO authorization. Exact names are assembled at runtime by `scripts/retired-secret-names.mjs` so the tracked tree retains a literal-zero contract. Current identities use FREE/PRO and CANARY_TRIAL/CANARY_PAID names.
8. Dev reports an uncommitted local Phase-A cleanup with zero retired literals, self-verifying names-only inventory, and 1202 passing tests. This PR must incorporate and independently verify that diff; the claim is not GitHub evidence until committed here.

## Required implementation order

### Priority 1 — land the already-completed hygiene work

- Bring Dev's uncommitted retired-name cleanup onto this branch.
- Preserve historical meaning with visible redaction rather than silent provenance rewriting.
- Keep the forbidden-name guard self-hosting by assembling retired names from fragments.
- Add a repository-wide zero-literal test with no silent active-source exemptions.
- Document the current email-as-Variable/password-as-Secret split.
- Under the Product Owner's authorization, delete the four retired repository secrets and attach before/after names-only inventories. Never print values.

Gate: focused tests and independent diff review. Do not claim the GitHub deletion from code evidence alone.

### Priority 2 — repair the Private-STT proof boundary

- Commit and review `scripts/private-cdp-cutover-proof.mjs`.
- Connect over CDP port 9222.
- Require exact deployed `__APP_RELEASE__`; stale or unknown bundle exits `STALE_BUNDLE` with code 3 before recording.
- Use current controller signals and DOM/testids.
- Capture sanitized session create/PATCH and Progress/RPC status, PostgreSQL code, and bounded message classification.
- Assert Private provenance and zero Cloud transcription traffic.
- Keep diagnostic JSONL content-free while retaining reference and recognized transcript only in the controlled WER artifact.
- Add a product pre-recording release-freshness check; block Start and prompt reload on mismatch, but never interrupt an active recording.

Gate: fixtures prove stale release, missing selectors, missing terminal state, and missing recognized text cannot yield PASS.

### Priority 3 — reconcile the retention and database contract

- Update #1306/#1254/#1257 authority and refreeze #1310 before enforcement work.
- Define one server-authoritative atomic completion transaction containing:
  - retained transcript;
  - duration/word count/WPM/clarity/pause metrics;
  - measured filler map where `{}` is zero and `NULL` is unavailable;
  - provenance;
  - exactly one structured next action.
- Enforce newest-two transcript eviction at the trusted boundary.
- Preserve metrics and Progress evidence after transcript expiry.
- Preserve idempotency; mismatched retry fails closed.
- Use additive rollout sequencing until the current client is qualified.
- Read production RPC signatures/grants before claiming the legacy overload is callable.

Gate: DB integration proves atomic rollback, concurrency safety, newest-two retention, cross-user isolation, and content-free observability.

### Priority 4 — correct the customer journey

- Use one finalized filler snapshot so headline equals the sum of rendered approved filler entries.
- Clear Finalizing UI when the controller reaches READY.
- Clear save-candidate/draft state after successful persistence.
- Every completed session has exactly one valid next action; an integrity-error panel cannot count as one.
- Analytics exact-session review shows transcript only while retained.
- PDF includes the retained transcript.
- Recent Sessions has one **Open** control; **Download PDF** is inside the opened report.
- Comparable Progress distinguishes:
  1. ineligible current session with deterministic reason;
  2. first eligible session establishing baseline;
  3. eligible same-cohort comparison.
- Never promise an improvement percentage for an ineligible run.

Gate: unit/integration/E2E/a11y regressions for every screenshot finding.

### Priority 5 — close the bypass and deletion path

- After the replacement client and RPC qualify, remove/revoke legacy completion overloads that bypass required metrics, next action, idempotency, or retention.
- Revise #1310 to delete retained transcripts, metrics/history, telemetry mappings, and Auth access under its service-only/tombstone/retry contract.
- Require real hosted Auth evidence; PGlite-only proof is insufficient.

Gate: product roles cannot execute the legacy path; existing tokens lose access immediately during deletion; retries are idempotent and content-free.

### Priority 6 — exact deployed requalification

Run three same-cohort Private sessions on a freshly verified release. Each must be at least 35 seconds and 90 words.

1. Session 1 establishes the baseline.
2. Session 2 produces comparable progress.
3. Session 3 proves newest-two retention.

Capture:

- exact deployed SHA and canonical host;
- WER/accuracy/filler recall;
- audio sample rate/RMS/peak/segments;
- RTF, decode and stop-to-final timings;
- Private provenance and zero Cloud requests;
- sanitized save/RPC responses;
- consistent filler headline/chips;
- exactly one next action;
- sessions 2 and 3 transcript review/PDF;
- session 1 transcript expired while its metrics still inform Progress;
- hard-reload behavior, one Open flow, and in-view PDF download;
- no prior working transcript leaking into a new session.

## Merge acceptance

- All implementation priorities above are complete in this PR.
- Retired secret configuration mutation is evidenced separately from code.
- Exact-head CI, DB, security/privacy, E2E, and free/no-Cloud STT gates are green.
- Deployed three-session human qualification passes.
- No migration, deployment, destructive cleanup, or merge is implied by review approval; each remains separately authorized.
