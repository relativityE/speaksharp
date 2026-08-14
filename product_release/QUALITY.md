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
| Browser endurance | ≤ 50 MB max JS-heap growth (when memory API available) + no functional failure | SLO | Private browser journey emits memory-growth evidence when exposed | Needs fresh artifact with duration/memory growth or explicit memory-unavailable note. |
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
| Can the browser run an extended Private flow without UI/state/memory problems? | `stress-endurance.yml` browser endurance. |
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

**Private engineering signals** (`privateTelemetry.ts`, allowlisted): `private_setup_started` → `private_setup_succeeded` / `private_setup_failed`, plus bounded `private_error` and `report_issue_submitted`. Recording completion remains represented by the content-free Practice/session funnel rather than sample-specific lifecycle events.

**Launch SLOs & alert thresholds** (internal launch-health signals on the sanitized baseline; distinct from the reliability SLOs above and from STT WER/latency in `STT.md`; alerts page on two consecutive breached windows):

| Signal | SLO target | Alert threshold |
|---|---|---|
| Practice-start → save conversion | ≥ 70% of `session_started` reach `session_saved` | < 55% |
| Private setup success | ≥ 95% of `_setup_started` reach `_setup_succeeded` | < 90% |
| Private start/save success | ≥ 98% of entitled recording starts reach `session_saved` | < 95% |
| Private error rate | ≤ 2% of Private sessions emit `private_error` | > 5% |
| Funnel-entry health | `practice_entry_viewed` non-zero per active day | zero for a full active day |

**Content-free contract (privacy).** Redaction is layered, and each channel re-projects at its actual send boundary: (1) emitter allowlists (`practiceTelemetry.ts`, `privateTelemetry.ts`) project payloads to enumerated non-PII primitives; transcript, audio, email, free-form title/agenda, and arbitrary fields are dropped; (2) Private events are re-projected through `sanitizePrivateTelemetryProps` immediately before `posthog.capture`, while general events are redacted again by `AnalyticsBuffer`. A caller cannot smuggle non-allowlisted content by assembling props outside the emitter.

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

STT correctness has two release layers because they catch different failure classes. **Fake-device corpus** (Chrome fake media device plus checked-in WAV fixtures) is deterministic code-correctness proof for chunking, buffering, RMS gates, worker messages, WER, transcript output, and filler analytics. **Real-mic corpus** plays controlled speech through a real supported device and proves permission, hardware input, Private runtime behavior, transcript, save/History, and analytics. The fake-device layer is not a shortcut around real-device testing. Detailed accuracy, journey, filler-value, and provenance rules live in `RELEASE_PROCESS.md` and `STT.md`.

### RC-counted ledgers

The named browser/live/canary files and unit/component files that currently close RC gates are enumerated in `RELEASE_PROCESS.md` (Gate 1–5 required evidence) and in the RC-counted ledgers migrated from `RC_TEST_INVENTORY.md`. Files outside those ledgers may still run in CI but do not close an RC gate unless promoted with a contract source and counted claim. **UX review screenshots** (`test-results/mode-selector/*`, `test-results/post-save-consolidation/*`, uploaded as `ux-review-screenshots-shard-*`, `retention-days: 1`) are short-lived layout/PR review aids — **never** cite them as STT accuracy or transcript-fidelity proof; the counted signal is the spec assertions.

### Gate coverage map (summary)

- **Gate 1 (Product truth):** `CI - Test Audit`; Private-only product-contract guard; exact public-copy contracts; active-trial and paid-continuation journeys; Open Mic/Focus Points isolation; analytics truth; Progress chronology; Private setup/finalize/save; first-time tester; and tester instructions.
- **Gate 2 (SAST / code review):** `pnpm quality`; secret scan; production hardening; Edge tests; entitlement/webhook/CORS tests; environment/lifecycle tests; race/zombie protection; and filler-regex safety.
- **Gate 3 (DAST / running app):** `pnpm rc:dast:local` / `:live`; Private-only entitlement and provider-token denial; Stripe checkout/webhook readiness; exact expiry and retained-permission proofs; live persistence; migration preflight/apply verification; and canary.
- **Gate 4 (SCA / dependency review):** `node scripts/sca-osv-gate.mjs` (`osv-scanner` over the root `pnpm-lock.yaml`, failing on any distinct un-ignored CRITICAL) + Actions/runtime warning review. A critical runtime exploit with a safe fix blocks release; non-critical advisories/deprecations are P2 unless they break CI/deploy or expose secrets. (The current SCA suppression — and the historical migration off the retired pnpm-audit endpoint — are documented in `OPERATIONS_AND_SECURITY.md`.)
- **Gate 5 (UX smoke):** `pnpm rc:ux:smoke`; error states; user-facing regressions; tester instructions; Private setup/record/finalize states; mobile/desktop session layout; Focus Points isolation; and canary.

### Where workflows fit

`ci.yml` = Gate 1 baseline plus partial Gate 2/5 and Lighthouse advisory. `canary.yml` = deployed Gate 1/5 smoke and must prove primary active-trial plus secondary paid-continuation before GO. Database/migration workflows count only for the exact separately authorized migration and deployed verification. `rc-gates.yml` is the umbrella release gate. `observability-api-smoke.yml` is counted for launch-readiness only with a sanitized baseline. `private-model-smoke.yml` is an advisory dormant-v4 regression guard and never activates v4. Benchmarks and stress/endurance remain advisory unless explicitly promoted for the current risk. Test-account setup is utility, never proof by itself.

### Script inventory (buckets)

Scripts are maintained only when invoked by package scripts, workflows, or documented release/operator procedures. Buckets: **Gate runners / CI orchestration** (test-audit, run-ci, aggregators, reporters, verify-*); **Gate 2 security / hardening** (secret scan, production hardening, secret-digest, eslint-disable, environment, and package-manager checks); **Gate 3 / live utilities** (test-account setup, canary, soak, observability, Stripe price audit); **build / local serving**; **Private STT/model/audio benchmark utilities** (advisory unless an STT SLO changes); and **developer recovery / impact tooling**. Destructive recovery requires explicit approval and never counts as release evidence.

### Confidence tiers

**Highest signal:** active-trial and paid-continuation Private journeys; exact-expiry/retained-permission tests; user-facing regressions; analytics truth; Edge access-control/entitlement/CORS/webhook tests; Private setup/finalize/save; first-time tester; and deployed canary smoke. **Important but not sufficient alone:** component/unit tests, Lighthouse, and aggregate coverage. **Advisory by default:** diagnostic dumps, benchmark probes, WER baselines, and soak runs unless explicitly promoted for the release risk.

### Release posture (engineering, non-volatile)

Changing posture—signoff SHA, payment/activation state, deployed identities, and gate colors—lives only in `RELEASE_STATUS.md`. Every merge to `main` resets the signoff clock. Commercial qualification requires the complete identity/price contract in `ENTITLEMENTS_AND_BILLING.md`; neither a profile status nor green CI is sufficient.

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
| STT proof | Active-trial and paid-continuation Private evidence labeled by account class, device/runtime/model, deployed SHA, transcript/save/reopen result, and content-safe artifact. |

---

## 8. Engineering acceptance criteria & manual hardware validation

These are the **engineering** acceptance definitions and the manual hardware **protocol**. The tester-facing walkthrough lives in `TESTER_GUIDE.md`; the operator **run** procedures and dated hardware run logs live in `TESTER_OPERATIONS.md` and `EVIDENCE_INDEX.md`.

### What a "successful session" means (acceptance criteria)

- **Save/history/detail:** after stopping, the session must persist to History and re-open to the saved analytics/session detail. A transcript without persisted history is **not** a successful session.
- **Custom words:** an added custom word said during recording must show the expected analytics count after save.
- **PDF export:** the exported file must contain session metadata, transcript, Private attribution, and the analytics summary with consistent SpeakSharp branding.
- **Private recording fidelity:** check the persisted History transcript, not only the live draft. The opening clause is preserved in immediate-speech cases; no repeated verbatim loop or hallucinated prefix appears; trailing words survive; History/detail matches the saved record; finalization shows honest progress; and stop-to-final latency is recorded for representative durations up to the 10-minute technical cap. An observed duration is not a percentile; see `STT.md`.

### Session UI truth (what the deployed session screen shows)

The session has no customer engine selector. Private is the sole recording path and carries the accurate “Stays local” privacy signal. The setup/status UI is one coherent surface; internal model/provider/debug terms do not appear as customer choices. On mobile, the shell stacks in mic → transcript → Progress → coaching order with no horizontal overflow. Post-save uses one consolidated status surface with persistent review action and no completion toast or duplicate overlay. Focus Points state never survives into a fresh Open Mic take.

### Data provenance / observability truth

**Supabase is authoritative** for saved sessions and submitted issue reports — verify persistence there, not in analytics. **PostHog is observability only**; a missing PostHog event does **not** imply data loss — confirm the Supabase row before concluding a session did not save. **Sentry** carries failures and sanitized alerts only — no transcript/audio/raw model output. **Report Issue** is the feedback channel but does **not** yet generate a real-time owner notification (that path is DRAFT #1006, not deployed). Keep provenance terms separate: distinguish automated / seed / owner / tester accounts; do not call active accounts "testers" without correlating them to an authoritative invitation roster.

### Device-support wording

Describe only the browsers/devices qualified for the current Private runtime. Never offer a browser-vendor speech engine as a fallback. When a device is unsupported, show an accurate Private setup/failure message and route the gap to qualification rather than silently switching producers.

### Manual hardware-validation protocol

CI does not validate real microphone hardware; this protocol is run on real devices, real browser permissions, and a real authenticated user before launch (execution and dated logs → `TESTER_OPERATIONS.md` / `EVIDENCE_INDEX.md`):

- **Desktop Chrome:** grant/deny mic; Private cold/warm setup; immediate and delayed speech; stop/finalize/save/reopen; refresh/recovery; and 1024/1280/1440px layout.
- **Desktop Safari and Firefox:** exercise the documented Private support path; if unsupported, prove accurate failure messaging and no alternate producer.
- **iPhone Safari:** authenticate, grant/deny mic, exercise Private where supported, verify background recovery, and validate 320/375/390px layout without overflow.
- **Bluetooth / external mic:** built-in/external start, disconnect during recording, and recoverable error behavior.
- **Stress / degraded:** rapid start/stop ×10, backgrounded active tab, model/network setup interruption, hardware mute, and representative long recording within the 10-minute cap.
- **On any failure:** capture content-safe screen/trace/log evidence and exact hardware. Fake-audio CI is readiness and code-correctness evidence, not real-microphone qualification.
