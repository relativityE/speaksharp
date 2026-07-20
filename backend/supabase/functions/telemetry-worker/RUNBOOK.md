# telemetry-worker — decisions, provenance model, and activation runbook

Durable operating doc for the P0 telemetry-delivery foundation. Covers the review dispositions that are
policy/sequencing rather than code: legacy-property recreation (#5), double-count prevention (#6),
provenance operating model (#9), and the activation sequence (#14).

## Configuration (fail-closed)

The worker returns `503 config_missing` BEFORE any reconcile/claim if any required value is absent.
Wired GitHub → Supabase by the deploy workflow (never pasted by the owner):

| Supabase secret | Source (GitHub) | Purpose |
|---|---|---|
| `TELEMETRY_WORKER_SECRET` | `TELEMETRY_WORKER_SECRET` | request gate (same value the cron sends) |
| `POSTHOG_PROJECT_KEY` | `POSTHOG_PROJECT_API_KEY` | ingest key |
| `POSTHOG_HOST` | `POSTHOG_INGEST_HOST` | ingest host (`/capture/`) |
| `TELEMETRY_WORKER_RELEASE_SHA` | `github.sha` | server-verified SHA on sent rows |
| `SENTRY_DSN` | `vars.SENTRY_DSN` | failure-alert route |
| `POSTHOG_PROJECT_KEY` | `vars.POSTHOG_PROJECT_API_KEY` | ingest key (see below) |
| `POSTHOG_HOST` | `vars.POSTHOG_INGEST_HOST` | ingest host (HTTPS on posthog.com) |

GitHub config convention: non-secret config is a repository **variable** (`vars.*`); only true secrets
use `secrets.*`. `POSTHOG_PERSONAL_API_KEY` is **never** synced to Supabase/the worker — readback-only,
stays in CI (used by the capture-contract proof).

**Kill switch / overlap gate:** `TELEMETRY_WORKER_ENABLED` must be exactly `'true'` for the worker to
drain; otherwise it returns `not_runnable` WITHOUT claiming. It stays unset until the cutover so normal
draining cannot accidentally consume real records while client emitters are still authoritative.

Tunables (all clamped): `TELEMETRY_WORKER_BATCH` (default 25, clamped to fit the deadline),
`TELEMETRY_WORKER_CONCURRENCY` (5), `TELEMETRY_RECONCILE_WINDOW_SECONDS` (3600),
`TELEMETRY_EVENT_TIMEOUT_MS` (10000), `TELEMETRY_WORKER_DEADLINE_MS` (90000). Worst-case wall-clock is
`ceil(batch/concurrency)*eventTimeout`, kept ≤ deadline by a batch clamp (so 50×10s>90s can't happen).
`POSTHOG_HOST` is validated as HTTPS on an approved `posthog.com` host.

**Result semantics:** the worker returns `result ∈ {success, partial_retry, hard_failure,
not_runnable}`. Green only when no hard condition (infra/dead-letter/lease-lost/time-budget) occurred;
a retryable delivery failure alone is `partial_retry` (self-heals). The cron fails red on
`hard_failure`/`not_runnable`.

## Owner-alert delivery (server-authoritative)

The owner alert for an issue report is **enqueued at the DB persistence boundary** (a trigger on
`user_issue_reports` insert → a `report_alert_deliveries` row), not by the browser. `report-issue-alert`
delivers under a lease with a **deterministic Sentry `event_id` = report_id hex** (so a retry after a
lost DB mark cannot duplicate the owner alert). `reconcile_report_alerts()` repairs any report missing a
row; the `report-alert-drain-cron` (secret-gated `x-alert-worker-secret`) reconciles + drains so a
crashed/never-fired browser wake-hint can't strand a report. Alert secrets reuse `TELEMETRY_WORKER_SECRET`
plus `REPORT_ALERT_WORKER_URL`.

## Retrieval surfaces (do not conflate)

- **Owner self-retrieval:** authenticated user reads THEIR OWN report via the `user_issue_reports` RLS
  `SELECT` policy (`auth.uid() = user_id`); `issueReportService.submit` returns `{ id }` as the receipt.
- **Operator retrieval:** `operator_get_report(report_id)` — service-role-only RPC returning the FULL
  report for authorized triage. Prose must never be written to Actions logs/artifacts/PostHog/Sentry.
  The preserved report **a77b73de** is the first acceptance case after deployment.

## Provenance operational wiring (#4)

Tooling: `scripts/observability-provenance.mjs register|expire|candidates` (service-role; `register`/
`expire` accept `--email` and resolve the user_id via the admin API) and the reusable composite action
`.github/actions/register-provenance` (register-before-write + `if: always()` expire).

**Anti-race:** the registry PK is `user_id`, so concurrent runs sharing one account would overwrite each
other's `test_run_id`. Mechanism: a GitHub `concurrency` group keyed to the shared account serializes
those runs (added to `rc-gates.yml` as `provenance-shared-pro-account`; do NOT `cancel-in-progress`).
Prefer a UNIQUE ephemeral account per run where possible (no contention at all).

**Data-producing workflow inventory** (each registers `automated_test` before its first product write
and expires after, via the composite action; those on the shared PRO_TEST account join the serialization
group):

| Workflow | Account | data_origin | test_suite |
|---|---|---|---|
| `rc-gates.yml` (gate-3 DAST) | shared PRO_TEST | automated_test | rc_gate_3_dast |
| `pro-stt-artifact-matrix.yml` | shared PRO_TEST | automated_test | pro_stt_artifact_matrix |
| `live-release-matrix.yml` | shared PRO_TEST | automated_test | live_release_matrix |
| `v4-app-path-proof.yml` | shared PRO_TEST | automated_test | v4_app_path_proof |
| `v4-auto-fallback-proof.yml` | shared PRO_TEST | automated_test | v4_auto_fallback_proof |
| `v4-benchmark-gpu.yml` | shared PRO_TEST | automated_test | v4_benchmark_gpu |
| `benchmarks.yml` | shared PRO_TEST | automated_test | benchmarks |
| `setup-test-users.yml` | creates accounts | automated_test | setup_test_users |

Reference wiring (add to each job that writes sessions/reports, before the first write):
```yaml
    - uses: ./.github/actions/register-provenance
      with:
        email: ${{ secrets.PRO_TEST_EMAIL }}
        test_suite: <suite from the table>
        supabase_url: ${{ vars.SUPABASE_URL || secrets.SUPABASE_URL }}
        service_role_key: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
    # ... the data-producing steps ...
    - if: always()
      uses: ./.github/actions/register-provenance
      with: { mode: expire, email: ${{ secrets.PRO_TEST_EMAIL }}, test_suite: <suite>,
              supabase_url: ${{ vars.SUPABASE_URL || secrets.SUPABASE_URL }},
              service_role_key: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }} }
```

**Historical classification correlation** (before any production reconciliation, one-time, service-role):
register/correlate the KNOWN accounts so history is classifiable — Prod Owner testing →
`owner_manual_test`; invited Wave-1 accounts → `beta_tester` (cohort `wave1`); automation accounts →
`automated_test`; everything unresolved stays `legacy_unclassified` (never auto-promoted). Then run
`observability-provenance.mjs candidates --since <invitation-boundary>` and return the sanitized counts
by classification (candidate_count + unclassified_count per event type) BEFORE writing/delivering any
backfill.

## #5 — Legacy event properties: recreatable vs not

Payloads are rebuilt server-side from the AUTHORITATIVE source row under a strict allowlist. What the
worker sends and where each field comes from:

**`session_saved`** (from `public.sessions`):

| Event property | Source | Recreatable? |
|---|---|---|
| `mode` | `sessions.engine` | yes |
| `duration_seconds` | `sessions.duration` | yes |
| `word_count` | `sessions.total_words` | yes |
| `wpm` | `sessions.wpm` | yes |
| `clarity_score` | `sessions.clarity_score` | yes |
| `accuracy` | `sessions.accuracy` | yes (bonus; not in legacy event) |
| `filler_count` | derived = sum of `sessions.filler_words` jsonb map | yes (derived) |
| `is_new_streak_day`, `streak_count` | — | **NO** — client-only, not persisted |
| `session_coaching_*` | — | **NO** — client experiment context, not persisted |

**`report_issue_submitted`** (from `public.user_issue_reports`):

| Event property | Source | Recreatable? |
|---|---|---|
| `issue_category` | `user_issue_reports.category` | yes |
| `issue_severity` | `user_issue_reports.severity` | yes |
| `session_id` | `user_issue_reports.session_id` | yes |
| `route` | `metadata.route` | yes |
| `mode` | `metadata.sttMode` | yes |
| release context | `client_release_sha_untrusted` (from `metadata.appRuntimeConfig.release`) | yes (labeled untrusted) |
| `engine_variant` | — | **NO** — client breadcrumb only, not persisted |

**Never emitted** (excluded by the allowlist): `transcript`, `title`, `description`, `ground_truth`,
`custom_words`, `ai_suggestions`, `pause_metrics`, `page_url`, `userAgent`, `transcript_excerpt`,
`audio_attachment_note`, email/name. The non-recreatable client-only fields are intentionally dropped:
the server cannot fabricate them, and the incident's priority is reliable delivery of the persisted
signal, not lossless reproduction of ephemeral client context.

## #6 — Double-count prevention (client vs server)

Today there is exactly ONE producer: the client (`session_saved` via AnalyticsBuffer;
`report_issue_submitted` via `emitPrivateSample`), and neither sets `$insert_id`. The server worker is
**fail-closed and OFF** (cron carries no `schedule:` trigger; secrets ungated until activation), so it
emits nothing yet — **double-counting is impossible until the worker is enabled.**

**Decision: the outbox becomes the SOLE authority for `session_saved` and `report_issue_submitted`.**
Overlap-safe cutover order (do NOT enable normal outbox delivery while client emitters can still send
the same critical events):

- **A.** Merge/deploy schema + worker with the cron OFF and `TELEMETRY_WORKER_ENABLED` unset (normal
  draining disabled — the worker returns `not_runnable`, cannot claim real records).
- **B.** Run the protected proof against a specifically identified `automated_test` record ONLY. The
  proof path is `scripts/telemetry-capture-contract-proof.mjs`, which sends DIRECTLY to `/capture/` and
  never claims from the outbox — so it is structurally unable to consume a real tester's pending record.
- **C.** Deploy removal of the client-authoritative `session_saved` + `report_issue_submitted` delivery
  (delete the `analyticsBuffer.push('session_saved', …)` call and the
  `emitPrivateSample(REPORT_ISSUE_SUBMITTED …)` call). After this the server is the only producer.
- **D.** Enable normal worker draining (`TELEMETRY_WORKER_ENABLED=true`) + the cron.
- **E.** Reconcile the approved invitation window (`reconcile_telemetry_outbox('2026-07-18T17:43:56Z')`).
- **F.** Verify no duplicates and no missing source rows.

Because client capture is removed (C) BEFORE normal draining is enabled (D), the two producers never run
simultaneously. Until activation, the worker is `not_runnable`, so there is exactly one producer and no
double-count. (If a future design keeps client capture, it MUST set the identical
`<event_type>:<record_id>` `$insert_id` so PostHog dedupes — but the chosen path is server-sole-authority.)

## #9 — Provenance operating model (automated workflows)

Provenance is server-assigned and never client-chosen. Automated workflows that WRITE sessions/reports
must make their rows classifiable:

1. **Register before writing.** Call `register_observability_actor(user_id, 'automated_test', cohort,
   test_run_id, test_suite, ttl)` (service-role) BEFORE creating any session/report, so the enqueue
   trigger stamps the run's provenance. Call `expire_observability_actor(user_id)` in cleanup.
2. **Prefer a UNIQUE ephemeral account per run.** The registry PK is `user_id` — a unique account per
   run gets its own registry row with no contention.
3. **Shared account ⇒ serialize.** If a shared account (e.g. `PRO_TEST_EMAIL`) is unavoidable, the
   data-producing workflows for that account MUST run in a GitHub `concurrency` group so only one run's
   `test_run_id` is active at a time. Two concurrent runs on one shared account would overwrite each
   other's `test_run_id` (last-writer-wins) — that is a correctness bug, not a style preference.
4. **Expire afterward.** Always expire (or TTL-bound) the registration so a stale row can't misclassify
   later real data.
5. **Unregistered data stays `legacy_unclassified`** — never auto-promoted to `production_user`.

Proof that new automated rows/events/alerts carry `data_origin=automated_test`, `cohort_id`,
`test_run_id`, `test_suite`, `release_sha`/`server_verified_release_sha`, and `environment`: the
behavioral harness (F4/F5/F7) proves the outbox stamps all four provenance fields from a registration;
the capture-contract proof (`scripts/telemetry-capture-contract-proof.mjs`) proves the PostHog event
carries them; the worker's Sentry alert `extra` echoes the counts (provenance is in the event, not the
alert). Full end-to-end proof with a live registered run is activation step 5–7.

## #14 — Activation sequence (owner/ops-run; NOT part of merging this PR)

The worker is fail-closed; nothing below runs by merging. `TELEMETRY_WORKER_ENABLED` stays unset, so
normal draining is `not_runnable`; a synthetic proof uses PROOF-ONLY mode (secret + explicit record,
`data_origin=automated_test` only) which never touches a real record. Do NOT merge/deploy until review
clears the PR. Then, in order (overlap-safe — enabling is LAST):

- **A.** Deploy migrations/functions with BOTH schedules OFF and normal draining disabled
  (`TELEMETRY_WORKER_ENABLED` unset). Confirm GitHub `vars`/`secrets` wiring (`operation=secrets`)
  without printing values.
- **B.** Wire and verify workflow provenance (the 8 data-producing workflows register/expire via
  `.github/actions/register-provenance`; enforced by `tests/deps/provenance-workflow-wiring.test.js`).
- **C.** Register a synthetic `automated_test` actor and create ONE synthetic source row.
- **D.** Run the END-TO-END PROOF-ONLY worker workflow (`telemetry-proof-worker.yml` →
  `scripts/telemetry-proof-worker-e2e.mjs`): proof mode delivers exactly that row
  (`x-telemetry-proof-record`/`-event`; `claim_telemetry_proof_row` refuses anything not
  `automated_test`, so no real tester record is touched).
- **E.** Verify the WORKER-specific PostHog readback (by `session_saved:<record_id>`) + Sentry
  notification routing. Prove report receipt + protected operator retrieval (`operator_get_report`) +
  owner notification — report **a77b73de** is the first acceptance case.
- **F.** Deploy removal of client-authoritative `session_saved` + `report_issue_submitted` emission.
- **G.** Run candidate classification counts (`reconcile_telemetry_candidates('2026-07-18T17:43:56Z')` +
  `observability-provenance.mjs candidates`) and classify the known owner/tester/automation accounts
  (owner→`owner_manual_test`, invited→`beta_tester`/`wave1`, automation→`automated_test`, rest stays
  `legacy_unclassified`). Return the sanitized counts by classification. Do NOT deliver historical yet.
- **H.** ONLY after classification approval, enable normal worker draining
  (`TELEMETRY_WORKER_ENABLED=true`).
- **I.** Reconcile + drain the EXPLICITLY APPROVED invitation window:
  `reconcile_telemetry_outbox('2026-07-18T17:43:56Z')`.
- **J.** Verify no missing/duplicate events (`operator_telemetry_delivery_status`:
  pending/failed/sending/dead_letter/discarded); THEN add the `schedule:` triggers to
  `telemetry-worker-cron` + `report-alert-drain-cron`, run the full RC/CI/security/ops battery, and
  close the incident.

Older-than-boundary history is reconciled ONLY via an explicit, separately-approved one-time
`reconcile_telemetry_outbox(<older-since>)` — never automatically, to avoid replaying pre-invitation
data into PostHog.
