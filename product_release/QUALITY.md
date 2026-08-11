**Status:** Authoritative (SSOT for quality evidence taxonomy, engineering test protocol, general SLOs, and the RC test inventory)
**Owner:** Engineering / Quality (relativityE)
**Last Reviewed:** 2026-07-30
**Last Verified:** 2026-07-30 — consolidated from approved interim sources (`SOFTWARE_QUALITY.operational.md`, `QUALITY_METRICS.md`, general parts of `SERVICE_LEVELS.operational.md`, `RC_TEST_INVENTORY.md`, and the engineering parts of `INTERNAL_TEST_PROTOCOL.md` / `MANUAL_HARDWARE_VALIDATION.md`). No volatile run IDs, SHAs, or current pass/fail posture are carried here — those live only in `RELEASE_STATUS.md`.
**Applies To:** The SpeakSharp beta platform — how software quality is measured, what evidence closes it, and which tests count for a controlled tester release.
**Class:** Procedure / SLO.
**Authority:** The source for the evidence chain, quality evidence sources & targets, general (non-STT) service-level objectives, the RC test inventory and gate map, engineering acceptance criteria, the manual hardware-validation protocol, and interpretation/closure rules.
**Not Authoritative For:** current release/go-no-go posture, run IDs & SHAs (→ `RELEASE_STATUS.md`); the gate *definitions* and release workflow (→ `RELEASE_PROCESS.md`); STT-specific baselines, accuracy, latency & STT SLOs (→ `STT.md`); env/secrets/security controls (→ `OPERATIONS_AND_SECURITY.md`); tester-facing copy (→ `TESTER_GUIDE.md`); internal tester administration & run logs (→ `TESTER_OPERATIONS.md`); dated proof artifacts (→ `EVIDENCE_INDEX.md`); tier/entitlement mechanics (→ `ENTITLEMENTS_AND_BILLING.md`).
**Supersedes:** `SOFTWARE_QUALITY.operational.md`, `QUALITY_METRICS.md`, the general (non-STT) content of `SERVICE_LEVELS.operational.md`, and `RC_TEST_INVENTORY.md` (interim sources; archived at documentation closeout per `DOC_MIGRATION_LEDGER.md`).
**Evidence Sources:** `DOC_MIGRATION_LEDGER.md` §3.E extraction mapping; the CI workflows and `frontend/`/`backend/`/`tests/` paths cited inline; CI-generated evidence under `product_release/evidence/` (indexed by `EVIDENCE_INDEX.md`).

# SpeakSharp Quality (v1)

Canonical statement of how SpeakSharp measures software quality: the evidence chain that turns tests into release confidence, the sources and targets of that evidence, the general service-level objectives, the release-candidate (RC) test inventory and gate map, the engineering acceptance criteria and manual hardware-validation protocol, and the rules for interpreting and closing evidence.

This is a **documentation** artifact. It defines how quality is judged; it does not change any application code, test, CI workflow, threshold, or product behavior. It is a *stable interpretation* document, not a dynamic metrics dump — current run artifacts and pass/fail posture live in CI artifacts and in `RELEASE_STATUS.md`.

**Precedence reminder (from `README.md` §1).** Tests and CI are **Level-6 evidence** — they sit *below* runtime truth (L2) and the Level-1/3/4 obligations. A green suite never overrides a user-trust, data-integrity, or security reality; a high quality score never overrides a red or stale release gate.

---

## 1. Scope & boundaries

This document owns the **quality-evidence taxonomy**, the **general SLOs**, the **engineering test protocol / RC test inventory**, and **interpretation & closure rules**. It deliberately routes:

- Gate *definitions*, the release workflow, freshness rules, and recovery → `RELEASE_PROCESS.md` (this doc references gates but does not define them).
- STT accuracy/latency baselines and STT-specific SLOs → `STT.md`.
- Environment variables, secrets, and security controls → `OPERATIONS_AND_SECURITY.md`.
- Open coverage gaps and waste candidates → `ROADMAP.md`.
- Dated proof artifacts (quality digests, hardware logs) → `EVIDENCE_INDEX.md`.

---

## 2. Evidence chain

Quality evidence flows one direction; each layer is subordinate to the one above it:

```text
tests produce facts
scripts summarize facts
workflows run them authoritatively
artifacts preserve evidence
docs interpret the evidence
```

**GitHub Actions is authoritative for release evidence** because it provides controlled runners, repository secrets, stable run IDs, and uploaded artifacts. Local runs are useful for debugging and fast feedback, but local-only output does not close release evidence unless a release document explicitly says so.

---

## 3. Quality evidence sources

| Evidence type | Source | Current use |
|---|---|---|
| Unit correctness | Vitest unit/component tests inside CI | Required baseline correctness. |
| Browser flow correctness | Playwright E2E tests inside CI | Required baseline UX/runtime correctness. |
| Live deployed behavior | Live Playwright workflows | Release-time evidence for deployed boundaries. |
| Production smoke | Production smoke workflow (`canary.yml`) | Required quick proof after `main` deploys. |
| Backend stress | `stress-endurance.yml` / `test:stress:backend` | Advisory unless backend durability is a release risk. |
| Browser endurance | `stress-endurance.yml` / `test:endurance:browser` | Advisory unless browser stability is a release risk. |
| API stack health | Ops-health workflow and hosted ops status view | Operational go/no-go snapshot (see `OPERATIONS_AND_SECURITY.md`). |
| Security/dependency posture | Edge tests, SAST, SCA, audit gates | Release-gate evidence where explicitly named (see `RELEASE_PROCESS.md`). |
| Software quality | Coverage, Lighthouse, bundle metrics, flaky count | Advisory quality and risk-trend evidence. |

### Generated evidence files

CI writes these generated files when quality-evidence generation is enabled. They are **generated artifacts, not source-of-truth product requirements**, are ignored locally to prevent noisy commits, and are uploaded with the CI metrics artifacts so each run has stable evidence tied to a commit and run ID. They are indexed by `EVIDENCE_INDEX.md`.

| File (CI-generated artifact; not committed) | Purpose |
|---|---|
| `product_release/evidence/software-quality.latest.json` | Machine-readable quality evidence: test counts, coverage, Lighthouse, bundle/runtime metrics, GitHub run metadata. |
| `product_release/evidence/software-quality-summary.latest.md` | Human-readable summary of the same evidence. |
| `product_release/evidence/service-levels.latest.json` | Machine-readable SLO/SLC evidence. |
| `product_release/evidence/service-levels-summary.latest.md` | Target-vs-measured service-level summary. |

---

## 4. Quality targets (release floors)

Use these targets unless a release owner explicitly overrides them in `RELEASE_PROCESS.md` gate definitions or `RELEASE_STATUS.md`. **Release floor** is the enforced/blocking bar; **industry target** is the aspirational bar (advisory unless promoted).

| Area | Release floor | Industry target | Interpretation |
|---|---:|---:|---|
| Unit tests | 0 unexpected failures | 100% pass for non-skipped tests | Required. Any failure in `CI - Test Audit` returns the gate to red. |
| Browser E2E | 0 unexpected failures | 100% pass for non-skipped tests | Required. Flakes are named concerns, not silent green. |
| Skipped / disabled release-path tests | 0 | 0 | Any skipped startup, auth, session, save, analytics, STT, billing, quota, or PDF test needs explicit review. |
| Statements coverage | 75% enforced CI floor | 80% | Floor raised 60→75 in `frontend/vitest.config.mjs` to lock in current actuals and catch regressions. |
| Branch coverage | 75% enforced CI floor | 80% | Prioritize STT, session lifecycle, quota/billing, PDF, analytics truth, and failure handling before vanity coverage. |
| Function coverage | 75% enforced CI floor | 80% | Same interpretation as coverage above. |
| Line coverage | 75% enforced CI floor | 80% | Same interpretation as coverage above. |
| Lighthouse performance | 90 | 90+ | Advisory unless UX or load-time regressions affect tester launch. |
| Lighthouse accessibility | 90 | 90+ | Required when a flow is being claimed accessible; otherwise advisory. |
| Lighthouse best practices | 90 | 90+ | Advisory unless it indicates a security/runtime issue. |
| Lighthouse SEO | 90 | 90+ | Advisory for controlled soft release. |
| Code bloat index | < 20% | < 20% | Advisory unless load time becomes a tester issue. |
| Total CI runtime | ≤ 15 minutes | ≤ 15 minutes | Keeps release evidence fast enough for practical iteration; material increases need explanation. |
| Initial chunk size | ≤ 500 KB | ≤ 500 KB | Industry-informed web-app budget for the main boot path; material jumps need reviewer explanation. |
| Total source size | ≤ 60 MB | ≤ 60 MB | Internal bloat guard for maintained source and assets, excluding dependency caches. |
| Total project size | ≤ 4 GB | ≤ 4 GB | Workspace hygiene guard for stale outputs, generated artifacts, and accidental cache bloat. |
| Backend auth / usage-Edge / session-save RPC p95 | < 2000 ms | < 1000 ms | Backend stress evidence; state exact concurrency tested. |
| Backend stress failure rate | 0% | 0% | At the tested concurrency; do not generalize beyond it. |
| Browser endurance heap growth | ≤ 50 MB (when memory API available) | ≤ 50 MB | Plus no functional endurance failure. |

Exact current measured values live in the latest CI `software-quality.latest.json` / `service-levels.latest.json` artifacts, not here.

---

## 5. Service levels (general, non-STT SLOs)

> Internal target and evidence document, **not** an external customer contract. Do not publish SLA language until SpeakSharp intentionally accepts external obligations. STT-specific SLOs (Private/Cloud WER, finalize latency) live in `STT.md`.

### Definitions

| Term | Meaning for SpeakSharp |
|---|---|
| SLO | Service Level Objective. Internal target (e.g. "95% of auth requests complete under 2 s"). |
| SLA | Service Level Agreement. External, often contractual promise. SpeakSharp avoids external SLA language for controlled soft release. |
| SLC | Service Level Commitment. A controlled promise shown publicly only when supported by evidence. |
| Stress test | Increases concurrency/load to find bottlenecks, failure limits, p95 latency, and locking/contention. |
| Soak / endurance test | Runs a realistic scenario for a sustained period to catch memory leaks, stale sessions, resource exhaustion, long-tail bugs. |

### Soft-release targets

| Claim | Target | Classification | Current evidence | Gap / next evidence |
|---|---:|---|---|---|
| Primary recording-path availability | 99.5% internal target | SLO, aspirational | Canary, RC gates, live STT paths | Not uptime monitoring; controlled-test evidence only. |
| Auth p95 latency | < 2 s floor; < 1 s industry target | SLO | Backend stress measures p50/p95 auth latency | Needs fresh GitHub artifact from `service-level-evidence.yml` / `stress-endurance.yml`. |
| Usage-limit Edge Function p95 | < 2 s floor; < 1 s target | SLO | `check-usage-limit` tests + backend stress path | Needs fresh GitHub stress artifact. |
| Session-save RPC p95 | < 2 s floor; < 1 s target | SLO | RPC used by backend stress path | Needs fresh GitHub stress artifact with p50/p95 and counts. |
| Stress failure rate | 0% floor and target | SLO | Stress script checks auth, usage-Edge, session RPC success counts | State exact concurrency tested; do not generalize. |
| Browser endurance | ≤ 50 MB max JS-heap growth (when memory API available) + no functional failure | SLO | Browser endurance path (Native mode) emits memory-growth evidence when exposed | Needs fresh artifact with duration/memory growth or explicit memory-unavailable note. |
| PDF export durability | 99.9% aspirational from valid state | SLC candidate | PDF unit/e2e/live artifact evidence | Too aggressive for external claim until repeated export evidence exists. |
| Session restoration | 95% aspirational | SLC candidate | Product intent exists | Evidence weak; needs targeted restoration proof before public claim. |

> STT WER targets (Private < 10%, Cloud < 8% on controlled fixtures) are **quality targets tied to controlled fixtures only, not generic SLAs** — the canonical statement lives in `STT.md`.

### Industry reality check (context — flagged as unverified comparison, not a measured SLO)

Availability 99.9% is common for mature paid SaaS; 99.5% is realistic for early controlled release → use 99.5% internal target only, promise no credits. Auth/API p95 < 1–2 s is reasonable → track p50/p95 via backend stress. Export durability 99.9%+ needs repeated evidence + monitoring → keep aspirational. Browser endurance durations vary by risk → shorter CI endurance regularly, longer before broad launch or after recording-path changes. STT accuracy varies by hardware/accent/environment/model/browser → tie WER to controlled fixtures only.

### Evidence mapping

| Question | Evidence source |
|---|---|
| Can real Supabase auth/users survive concurrent traffic? | `stress-endurance.yml` backend stress, auth phase. |
| Can `check-usage-limit` respond under load? | `stress-endurance.yml` backend stress, usage-edge phase. |
| Can `create_session_and_update_usage` handle concurrent writes/locking? | `stress-endurance.yml` backend stress, session-rpc phase. |
| Can the browser run an extended Native flow without UI/state/memory problems? | `stress-endurance.yml` browser endurance. |
| Are core workflows correct in normal CI? | `CI - Test Audit`. |
| Are deployed boundaries healthy? | Production smoke/canary, live release matrix, ops-health status. |

### Release-gate fit

Do not add redundant SLA-specific tests by default; prefer making existing tests produce better-structured evidence. CI correctness = required baseline; production smoke = required after `main` deploy; ops health = required operational snapshot before a release decision; backend stress + browser endurance + benchmarks/WER = advisory unless the relevant durability/stability/STT dimension is the current release concern.

### Evidence artifact expectations

Stress/endurance artifacts should include: concurrency tested; success/failure counts per phase; p50/p95 latency per phase; throughput; browser memory growth where available; run ID, timestamp, commit SHA, actor; a release-evidence verdict (`pass` / `fail` / `invalid`); `countsAsReleaseEvidence`; `criticalFailures[]`; `ignoredRequestFailures[]`; `invalidEvidenceReasons[]`. Missing fields → useful for debugging, not for service-level claims.

**Request-failure classification.** `pass` = functional journey + memory + backend stress + required artifacts passed (known read-only teardown aborts may be recorded under `ignoredRequestFailures[]`). `fail` = a product/system target failed (auth, recording start, token issuance, quota, save/write path, unexpected 4xx/5xx, memory target, backend target, artifact parseability). `invalid` = environment/tooling prevented trustworthy measurement (EPERM bind, missing secrets, sandbox launch failure) — cannot close an RC gate. A read-only request abort may be ignored **only** when all hold: `errorText` is `net::ERR_ABORTED`; method is GET/HEAD; endpoint is allowlisted read/poll; phase is navigation/teardown or the functional journey already passed; no dependent assertion failed; and it is not auth/token/checkout/STT-critical/session-save/other write path.

### Launch telemetry — Practice Loop funnel & Private signals (#1259)

Launch decisions use clean, privacy-safe product signals, never stale test traffic or speech content. The funnel is measured with existing content-free events (mechanism counters/enums only) emitted through `AnalyticsBuffer`, never PostHog directly.

**Practice Loop funnel:** `practice_entry_viewed` → `practice_mode_selected` (`quick`/`objective`) → `freeform_practice_started` / `session_started` → `session_saved` (the finalize/save success signal). There is no dedicated `session_save_failed` event today; save failure is the `session_started`-without-`session_saved` drop-off (surfaced to the user as an actionable retry). A content-free `session_save_failed` (bounded `error_code`) is a recommended follow-on if a direct save-failure SLO is required.

**Private setup/start/finalize signals** (`privateSampleTelemetry.ts`, allowlisted): setup `private_sample_setup_started` → `_setup_succeeded` / `_setup_failed`; start `private_sample_recording_started` → `_first_transcript_seen` / `private_sample_error`; finalize `private_sample_recording_stopped` → `_saved`.

**Launch SLOs & alert thresholds** (internal launch-health signals on the sanitized baseline; distinct from the reliability SLOs above and from STT WER/latency in `STT.md`; alerts page on two consecutive breached windows):

| Signal | SLO target | Alert threshold |
|---|---|---|
| Practice-start → save conversion | ≥ 70% of `session_started` reach `session_saved` | < 55% |
| Private setup success | ≥ 95% of `_setup_started` reach `_setup_succeeded` | < 90% |
| Private start success | ≥ 98% of recording setups reach `_first_transcript_seen` | < 95% |
| Private error rate | ≤ 2% of Private sessions emit `private_sample_error` | > 5% |
| Funnel-entry health | `practice_entry_viewed` non-zero per active day | zero for a full active day |

**Content-free contract (privacy).** Redaction is layered, and each channel re-projects at the send boundary **on the path it actually uses**: (1) emitter allowlists (`practiceTelemetry.ts`, `privateSampleTelemetry.ts`) project every payload down to enumerated non-PII primitives — transcript, audio, email, free-form title/agenda, and raw identifiers are dropped before send; (2) the **second** projection lives on each event's real send path. Private lifecycle events capture directly to PostHog from `emitPrivateSample` (they do NOT route through `AnalyticsBuffer`), so their second projection is a **dedicated Private send boundary** that re-runs `sanitizePrivateSampleProps` immediately before `posthog.capture` — a Private event therefore can never carry a non-allowlisted field even if a caller assembled props outside the emitter. General events routed through `AnalyticsBuffer` have any `transcript`/`audio`/`wav`/`blob`/`base64`-shaped value redacted at that send boundary, and any `private_*` event that does pass through the buffer is likewise re-projected through the Private allowlist there.

**Identity (accurate two-path reality).** The **client** identifies the person to PostHog by their Supabase **auth UUID** — a random, non-PII account identifier, never an email or name. The **server-side analytics worker** additionally uses a keyed HMAC pseudonym (`usr_v1_<HMAC(user_id)>`, `tst_v1_` for automated traffic) so no raw id appears in server-emitted events; a browser bundle cannot hold that HMAC secret, so the client does not (and cannot) reproduce the server pseudonym. No event property carries an email, name, transcript, or audio. Enforced by `tests/release/launch-telemetry-content-free.contract.test.ts` (the #1259 falsification evidence).

**Authorization-gated (NOT part of the telemetry-definition change).** These need separate Product Owner authorization and PostHog operations: purge/segment synthetic-tester & legacy-Basic production data out of the measurement baseline (a production data mutation); record the fresh post-cleanup baseline timestamp/SHA; capture PostHog dashboard/alert screenshots on sanitized data. Until that authorized cleanup runs, the baseline is contaminated by test traffic and must not back launch-readiness claims.

---

## 6. Test inventory & gate map (engineering test protocol)

The goal is not to count every test equally. It is to make clear which tests **close RC gates**, which are advisory, which are benchmark/probe-only, and where the gaps or redundant spend are. RC gates are stricter than everyday CI: everyday CI says the codebase is broadly healthy; RC gates say a controlled tester release is defensible. Gate *definitions* live in `RELEASE_PROCESS.md`; this section maps the test estate into those gates.

### Inventory by bucket

Test-file counts are regenerated from the repository (last regenerated 2026-07-20 on the private-first `main` line; re-count from the tree rather than trusting a pinned number):

| Bucket | Location (glob) | Counts toward RC gate? |
|---|---|---|
| Frontend unit/component | `frontend/src/**/*.{test,spec}.{ts,tsx}` (excl. e2e) | Yes, selectively |
| Frontend unit harness | `frontend/tests/**/*.{test,spec}.*` | Yes |
| Supabase Edge (Deno) tests | `backend/supabase/functions/**/*.test.ts` | Yes |
| E2E (mocked + diagnostics) | `tests/e2e/**/*.spec.ts` | Yes, selectively |
| Live / deployed tests | `tests/live/**/*.spec.ts` | Yes, selectively |
| DB migrations (schema surface) | `backend/supabase/migrations/*.sql` | Deploy gate (`Deploy Supabase`) |

### Per-file triage status

The inventory is complete for release-candidate purposes: every RC-counted file is named in a ledger with a contract source, and every unlisted test/spec is advisory, diagnostic, or refactor-confidence only until explicitly promoted. Workflows and maintained scripts are bucket-triaged; Edge Deno tests are gate-triaged (Gate 2/3 security/product-rule evidence); STT worker/Private-engine/ModelManager and analytics math are contract-triaged; mocked E2E/live/canary have their RC-counted files named; non-ledger frontend unit/component tests remain advisory/refactor-confidence; diagnostics/benchmarks/soak/WER-baseline are bucket-triaged advisory.

### Contract-source requirement

Every RC-counted test must identify the **independent source of truth** it enforces. Coverage from implementation-mirroring tests is not RC confidence. Contract sources: **Math** (RMS, WPM, filler count, duration); **State machine** (browser/STT/session lifecycle); **Message protocol** (workers, engines, Edge Functions); **Security/product rule** (tiering, quota, auth, CORS, Stripe); **Human journey** (UX smoke, live tester paths). Tests whose expected values were copied from current implementation output are **suspect** and must not be promoted to RC-counted evidence until reviewed against a contract source.

### How tests are decided into gates

A test folds into an RC gate when it proves one of that gate's release-blocking claims; it stays outside RC when it is diagnostic, exploratory, benchmarking-only, utility-only, or too environment-specific to run as a normal blocker. Does it prove a claim a tester/customer relies on → Gate 1 or 5. Does it prove users cannot bypass entitlement/quota/auth/CORS/Stripe/token → Gate 2 or 3. Does it need a deployed app/real secrets/live Edge behavior → Gate 3 or live matrix. Does it check known vulnerable deps / supply-chain risk → Gate 4. Does it measure a speed/quality ceiling but not pass/fail → benchmark/advisory. Is it a one-incident probe → diagnostic until it becomes a maintained regression.

### STT corpus gate layers

STT correctness has two release layers because they catch different failure classes. **Fake-device corpus** (Chrome fake media device + checked-in WAV fixtures) = deterministic code-correctness proof for chunking, buffering, RMS gates, worker messages, WER, transcript output, filler analytics — RC-counted only for engines proven to receive the intended fixture audio. **Real-mic corpus** (`pnpm rc:stt:corpus` plays fixtures through the speaker into the real mic) = product-readiness proof for mic permission, hardware input, `AudioContext`, Native Web Speech provider behavior, transcript, save/history, analytics — RC-counted release-time evidence. The fake-device layer is not a shortcut around real-mic testing. Native Chrome is launch-critical, so its real-mic corpus and journey evidence must be green for the onboarding path to close. Detailed STT sub-gates (STT-A Accuracy / STT-B Browser Journey / STT-C Filler Value) and the Native `continuous=true` regression note are specified in `RELEASE_PROCESS.md` and `STT.md`.

### RC-counted ledgers

The named browser/live/canary files and unit/component files that currently close RC gates are enumerated in `RELEASE_PROCESS.md` (Gate 1–5 required evidence) and in the RC-counted ledgers migrated from `RC_TEST_INVENTORY.md`. Files outside those ledgers may still run in CI but do not close an RC gate unless promoted with a contract source and counted claim. **UX review screenshots** (`test-results/mode-selector/*`, `test-results/post-save-consolidation/*`, uploaded as `ux-review-screenshots-shard-*`, `retention-days: 1`) are short-lived layout/PR review aids — **never** cite them as STT accuracy or transcript-fidelity proof; the counted signal is the spec assertions.

### Gate coverage map (summary)

- **Gate 1 (Product truth):** `CI - Test Audit`; primary-journey / analytics-truth / user-features / user-filler-words E2E; analytics math-integrity; Native/Private/Cloud engine contract tests; ModelManager decision table; Pro STT artifact matrix; private-cache; first-time-tester; Native Chrome mic proof; tester-instructions.
- **Gate 2 (SAST / code review):** `pnpm quality`; secret scan; production-hardening; `pnpm test:edge`; Edge token/quota/webhook/CORS tests; env/tier/lifecycle tests; race/zombie protection; filler regex safety.
- **Gate 3 (DAST / running app):** `pnpm rc:dast:local` / `:live`; live cloud-token gates; Stripe checkout/webhook readiness; live filler-word persistence; STT switching contract; deploy-supabase-migrations; canary.
- **Gate 4 (SCA / dependency review):** `node scripts/sca-osv-gate.mjs` (`osv-scanner` over the root `pnpm-lock.yaml`, failing on any distinct un-ignored CRITICAL) + Actions/runtime warning review. A critical runtime exploit with a safe fix blocks release; non-critical advisories/deprecations are P2 unless they break CI/deploy or expose secrets. (The current SCA suppression — and the historical migration off the retired pnpm-audit endpoint — are documented in `OPERATIONS_AND_SECURITY.md`.)
- **Gate 5 (UX smoke):** `pnpm rc:ux:smoke`; error-states; user-facing-regressions; tester-instructions; LiveRecordingCard state expectations; canary; manual Native/Safari/browser wording check.

### Where workflows fit

`ci.yml` = Gate 1 baseline + partial Gate 2/5 + Lighthouse advisory (counted baseline). `deploy-supabase-migrations.yml` = Gate 3 + partial Gate 4 toolchain/deploy health (counted when backend/Edge changed). `canary.yml` = Gate 1/5 production smoke (counted). `rc-gates.yml` = all gates (counted umbrella). `live-release-matrix.yml` = Gate 1/3 release-time (counted). `pro-stt-artifact-matrix.yml` = Gate 1/3 (counted release-time / STT changes). `observability-api-smoke.yml` = advisory for controlled tester release, counted for public-launch readiness. `private-model-smoke.yml` = advisory, non-blocking dormant-v4 regression guard (does not activate v4). `benchmarks.yml` / `stress-endurance.yml` = advisory unless engine/model/SLA change or stability is the concern. `setup-test-users.yml` = utility, not a gate.

### Script inventory (buckets)

Scripts are maintained only when invoked by package scripts, workflows, or documented release/operator procedures. Buckets: **Gate runners / CI orchestration** (test-audit, run-ci, aggregators, reporters, verify-*); **Gate 2 security / hardening** (rc-secret-scan, rc-production-hardening, verify-secret-digest, check-eslint-disable, validate-env, preflight, pnpm-only); **Gate 3 / live utilities** (setup-test-users, provision/trigger-canary, trigger-soak, live-observability-proof, stripe-price-audit); **build / local serving**; **STT/model/audio benchmark utilities** (advisory unless an STT SLA changes; `manual-native-chrome-proof.mjs` produces Gate 1 evidence when run for RC); **developer recovery / impact tooling** (utility only; destructive recovery scripts require explicit approval and never count as release evidence).

### Confidence tiers

**Highest signal:** primary-journey, user-facing-regressions, analytics-truth, user-features, error-states E2E; Edge access-control/quota/token/CORS/webhook tests; live cloud-token-gates; Pro STT artifact matrix; private-cache; first-time-tester; canary smoke. **Important but not sufficient alone:** frontend component tests, STT unit tests, Lighthouse, coverage (global percent matters less than critical-path coverage). **Advisory / not RC-green by default:** dump-ground diagnostics, benchmark live specs, wer-baseline, soak.

### Release posture (engineering, non-volatile)

The current release is a **controlled private beta / early-access, non-payment** line. The *changing* posture (signoff SHA, run IDs, current gate colors) lives only in `RELEASE_STATUS.md`; the freshness rule is: every merge to `main` resets the signoff clock (final-SHA freshness). Verify entitlement scope against `ENTITLEMENTS_AND_BILLING.md` — effective paid Pro requires a real `stripe_subscription_id`, not merely `subscription_status='pro'`.

### Recommended RC reporting format

Each RC gate should report: **Gate ID** (1–5); **Definition of green** (binary pass/fail); **Latest artifact** (run ID, trace/report/screenshot/log path); **Last updated by/date**; **Scope** (mocked / live / production / manual / benchmark); **Counted?** (RC-counted / advisory / diagnostic / utility). The release rule stays simple: the latest evidence for each blocking RC gate must be green; if one blocking gate is red or stale after relevant code changed, RC is not green.

---

## 7. Interpretation & closure rules

- **Raw artifacts win when summaries disagree.** Coverage JSON, Playwright reports, Vitest output, Lighthouse JSON, workflow logs, stress/endurance JSON, and browser traces are the source of truth until the aggregator is fixed and rerun on the same commit.
- **Quality score cannot override red release gates.** A high quality/coverage number does not prove STT quality, billing safety, quota enforcement, or privacy behavior.
- **Advisory metrics become blocking only when explicitly promoted** for a release in `RELEASE_PROCESS.md` gate definitions or `RELEASE_STATUS.md`.
- **Local generated output helps debugging; GitHub-generated artifacts close release evidence.**
- **Evidence closure for RC signoff** requires the simple final row:

| Gate | Required result |
|---|---|
| CI / Test Audit | Green on the latest commit SHA. |
| Production canary | Green on the latest commit SHA. |
| Supabase deploy | Green on the latest commit SHA when backend/Edge files changed. |
| Service-Level Evidence | `countsAsReleaseEvidence=true`, no critical failures, backend stress present, browser endurance present, artifacts parseable. |
| STT proof | Native/Private/Cloud evidence labeled by engine, account entitlement, browser/runtime, transcript result, and console-log artifact. |

---

## 8. Engineering acceptance criteria & manual hardware validation

These are the **engineering** acceptance definitions and the manual hardware **protocol**. The tester-facing walkthrough lives in `TESTER_GUIDE.md`; the operator **run** procedures and dated hardware run logs live in `TESTER_OPERATIONS.md` and `EVIDENCE_INDEX.md`.

### What a "successful session" means (acceptance criteria)

- **Save/history/detail:** after stopping, the session must persist to History and re-open to the saved analytics/session detail. A transcript without persisted history is **not** a successful session.
- **Custom words:** an added custom word said during recording must show the expected analytics count after save.
- **PDF export:** the exported file must contain session metadata, transcript, transcription mode, and the analytics summary (Free and Pro exports retain the large SpeakSharp watermark).
- **Private sample fidelity (added 2026-06-29, #891/#892 — check the persisted History transcript, not the live draft):** the opening clause is preserved *including the immediate-start case* (Record → wait for the green "Ready — speak now" pill → speak immediately); coverage threshold passes; no ≥5-word verbatim loop (the saved transcript is flagged, never mutated); History/detail matches end-to-end; long leading silence produces no hallucinated prefix; the finalize state shows the dimmed draft + honest progress, never the wrong rolling text as final; and stop-to-final latency is recorded (**accepted RC limitation: a full 5-min single Private v2 recording finalizes in ≈90 s post-stop, shown as honest "Finalizing…" progress — the earlier `<30 s` requirement is withdrawn**). This is a quality/latency observation, **not** a measured p95 — see `STT.md`.

### Session UI truth (what the deployed session screen shows)

Mode selector order is **Private-first** — Private → Browser → Cloud — verified current in `LiveRecordingCard.tsx` and enforced by `mode-selector-private-first.e2e.spec.ts`. The mode **tags** are: Private = "Stays local" (`stt-mode-tag-stays-local`, a privacy descriptor); Browser = "Quick preview" (`stt-mode-tag-quick-preview`); Cloud = "Pro" (`stt-mode-tag-pro`). **"Recommended" is retired from every Private surface (#1064)** — do not describe Private as "Recommended"; the accessible name stays exactly "Private"/"Browser" (the descriptor badges are `aria-hidden`). The **default selected engine is Browser** unless the server reports sample/paid entitlement. Mode help is **one surface** (a single disjoint desktop flyout when a non-overlapping placement fits, else the single "About transcription modes" panel; touch devices always get the About panel — never stacked bubbles; About panel and dropdown are mutually exclusive). Post-save is **one consolidated status bar with one Analytics action** (no completion toast / "Next: Analytics" overlay). The authoritative user-visible Session-surface contract is owned by `PRODUCT_REQUIREMENTS.md`; this subsection records only the acceptance detail the RC UX specs (`mode-selector-private-first`, `post-save-consolidation`) enforce.

### Data provenance / observability truth

**Supabase is authoritative** for saved sessions and submitted issue reports — verify persistence there, not in analytics. **PostHog is observability only**; a missing PostHog event does **not** imply data loss — confirm the Supabase row before concluding a session did not save. **Sentry** carries failures and sanitized alerts only — no transcript/audio/raw model output. **Report Issue** is the feedback channel but does **not** yet generate a real-time owner notification (that path is DRAFT #1006, not deployed). Keep provenance terms separate: distinguish automated / seed / owner / tester accounts; do not call active accounts "testers" without correlating them to an authoritative invitation roster.

### Browser-support wording

Chrome is recommended. Browser (standard) transcription uses the browser's built-in speech recognition; availability and accuracy vary by browser. Do **not** claim Edge support unless an Edge-specific proof has passed start, transcript, save, history/detail, and analytics — until then use "Chrome recommended" wording.

### Manual hardware-validation protocol

CI does not validate real microphone hardware; this protocol is run on real devices, real browser permissions, and a real authenticated user before launch (execution and dated logs → `TESTER_OPERATIONS.md` / `EVIDENCE_INDEX.md`):

- **Desktop Chrome:** grant/deny mic (verify error UX); Native STT live transcript for a clear 10–15 s sentence; record browser/version + sentence; stop returns to ready; save shows success text; history appears after reload; analytics change from baseline; refresh during recording; mode switch only via explicit user action; Private STT launch-default CPU/Transformers.js path; missing-cache setup/download/progress/ready flow; cached-model reuse on second start; separately enable the WebGPU/WhisperTurbo path and verify fast start or fast-fail to explicit recovery.
- **Desktop Safari:** grant mic; verify Web Speech support; if supported, live transcript + stop/save + history/analytics; no crash on `AudioContext` init; if unsupported/unreliable, document the limitation and verify fallback messaging.
- **Firefox:** grant mic; start/stop; verify compatibility messaging if unsupported.
- **iPhone Safari:** open app; auth works; mic prompt appears; optional Native transcript if supported; if unsupported, UX explains the limitation; background during recording → recoverable stop/pause.
- **Bluetooth / external mic:** start built-in; start external; disconnect mid-session; verify recoverable error behavior.
- **Stress / degraded:** rapid start/stop ×10 (no overlapping timers/duplicate sessions); backgrounded active tab 2 min (expected recording/timeout behavior); disable WiFi during Cloud STT (connection-loss messaging + recovery/failure path); hardware mute during recording (no crash / unrecoverable FSM).
- **On any failure:** capture screen recording, export `TranscriptionService` debug logs from console, and note specific hardware (e.g. "AirPods Pro Gen 2", "MacBook Pro M3"). Native Browser launch proof must come from real Chrome microphone behavior — GitHub Chromium fake-audio counts only as readiness/no-crash/save diagnostics because Web Speech transcript production is browser/vendor dependent.
