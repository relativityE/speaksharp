**Status:** Authoritative (SSOT for release-gate definitions, release workflow, freshness rules, and recovery)
**Owner:** Engineering / Quality (relativityE)
**Last Reviewed:** 2026-08-11
**Last Verified:** 2026-08-11 — the Private-only launch support, rollback, and GO/HOLD procedure was reconciled to current repository authority and exercised source-only in `evidence/ISSUE_1267_PRIVATE_LAUNCH_REHEARSAL.md`; gate/workflow definitions remain consolidated from the cited sources. No current run IDs, SHAs, deployment baselines, or queue state are carried here — those live only in `RELEASE_STATUS.md`.
**Applies To:** The SpeakSharp controlled-tester release process — the five RC gates, evidence freshness, the release workflow & commands, and emergency recovery/rollback.
**Class:** Acceptance criterion / procedure.
**Authority:** The source for the definition of each RC gate (what "green" means), the gate evidence rules, evidence freshness & same-SHA rules, the release workflow/commands and observability readback, and the forward-fix/rollback/recovery playbook.
**Not Authoritative For:** current ship posture, blockers, run IDs & SHAs (→ `RELEASE_STATUS.md`); the test inventory that maps files into these gates, the quality targets & SLOs (→ `QUALITY.md`); STT accuracy/latency baselines & named STT proof detail (→ `STT.md`); env/secrets/security controls & SCA exceptions (→ `OPERATIONS_AND_SECURITY.md`); tier/entitlement mechanics (→ `ENTITLEMENTS_AND_BILLING.md`).
**Supersedes:** `RC_GATES.md`, `RELEASE_RECOVERY.md`, and the release-workflow material of `RC_TEST_INVENTORY.md` (interim sources; archived at documentation closeout per `DOC_MIGRATION_LEDGER.md`).
**Evidence Sources:** `DOC_MIGRATION_LEDGER.md` §3.F extraction mapping; the `.github/workflows/*` and `backend/supabase/*` paths cited inline; the release-identity mechanism (#1027); `tests/release/private-launch-playbook-contract.test.ts`; `evidence/ISSUE_1267_PRIVATE_LAUNCH_REHEARSAL.md`.

# SpeakSharp Release Process (v1)

Canonical statement of how a SpeakSharp build is judged release-ready and how the team recovers when a release goes wrong: the five release-candidate (RC) gates and what makes each one green, the rules that keep gate evidence honest and fresh, the workflows and commands that run them, and the forward-fix / rollback / data-integrity recovery playbook.

This is a **documentation** artifact — gate *definitions*, not release *status*. Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`. This is a controlled tester-release process, **not** an enterprise certification audit: a gate is green only when it has a named test, workflow, artifact, or manual checklist with recorded evidence.

**Precedence reminder (from `README.md` §1).** Any violation of **Level 1 (User Trust)** or **Level 3 (Data Integrity)** is an **automatic NO-GO**. Level-7 (architecture-intent) divergences are "polish" unless they cascade into Levels 1–4. Recovery must never trade a Security Invariant (L4) for Survivability (L5), and must respect Data Integrity (L3).

---

## 1. Scope & boundaries

This document owns the **gate definitions**, the **release workflow**, **freshness rules**, and **recovery**. It routes: which specific test files close each gate and the quality targets/SLOs → `QUALITY.md`; STT accuracy/latency baselines and the STT sub-gate thresholds → `STT.md`; environment/secret/security controls and the SCA-exception detail → `OPERATIONS_AND_SECURITY.md`; changing run IDs/SHAs/posture → `RELEASE_STATUS.md`.

---

## 2. Gate evidence rules

RC gates are **contract gates, not coverage gates**. A counted test must prove an independent requirement, not preserve the current implementation.

- **Contract-first test rule.** Before a test enters an RC-counted path, its contract source must be clear: mathematical definition; state-machine contract; message protocol; security/product rule; or human-journey requirement. A test whose expected value was copied from current implementation output is **suspect** and must not be used as RC evidence until reviewed. (The contract-source taxonomy lives in `QUALITY.md`.)
- **Artifact freshness rule.** An artifact is **stale** if any file in that gate item's dependency surface changed after the artifact was captured. A stale artifact does not count as green; the gate item must be rerun or intentionally downgraded with matching product copy and release notes. Examples of dependency surfaces: Native Chrome mic proof ← Native strategy / `NativeBrowser.ts` / STT constants / recording UI/copy / fallback logic; STT corpus accuracy proof ← the Private/Cloud/Native engine files, audio utilities, `sttConstants.ts`, `wer.ts`, harness scripts, and any file under `tests/fixtures/stt-isomorphic/`.
- **Private saved-transcript fidelity (Gate 1 STT, #891/#892).** Real-mic engine liveness + metadata are **not** sufficient. On the **persisted** transcript (saved DB row / History detail — not the live draft) require: opening anchor present after *every* onset class including the immediate-start case; coverage threshold across expected phrases; no ≥5-word verbatim loop, but the saved transcript is flagged, **never mutated** (`detectRepetitionRisk` records metadata only, #903); History/detail matches end-to-end and the finalize state shows the dimmed draft + honest progress (#905/#906); long leading silence yields no hallucinated prefix; real-mic proof after any Private capture/buffer/trim change (fake-device does not substitute). **stop-to-final latency is an accepted RC limitation, surfaced as honest "Finalizing…" progress; the earlier `<30 s` requirement is withdrawn — do not gate on it.** The ≈90 s figure for a 5-minute Private v2 recording is the **earlier pre-multi-thread planning budget**, explicitly **not** a measured p95; a single **n=1 MT-WASM observation** (2026-07-29) finalized a 5-minute recording in **≈39.1 s** — an observation, **not** a p50/p95/SLO/SLA. Neither is a service-level commitment; the canonical finalize-latency contract and evidence live in `STT.md`. This is **not** a blocking gate for controlled beta. **Private v4 activation is OFF for this release** (default `private_v2:whisper-base.en`; `private_stt_v4_*` flags default off; `VITE_PRIVATE_STT_V4_DISABLED='true'` is the build-time hard kill).
- **Ship-signal rule.** RC gate status is the ship/no-ship signal. Quality score, coverage, Lighthouse, benchmarks, backend stress, and browser endurance are advisory unless explicitly named as a blocking gate item. A high quality score cannot override a red or stale RC gate item.
- **Same-SHA release-candidate rule.** Any commit considered a release candidate must pass full CI, production canary, and Service-Level Evidence on the **same commit SHA** before it can be called release-ready. CI optimizations may reduce wasted runs while iterating but do not lower the final bar. A Vercel canary must test the deployed production URL because users receive Vercel's deployed artifact, not CI's internal build artifact. **Caveat — the canary does NOT currently assert the deployed frontend SHA.** `tests/canary/smoke.canary.spec.ts` exercises the production URL but never reads `window.__APP_RELEASE__`, so when Vercel lags or ignores a build the canary can silently pass/fail against a **stale** artifact — a run associated with a commit does not prove that commit is what production served. Treat canary green as "the production URL is functional," **not** "this exact SHA is live"; independently asserting the deployed release SHA (read `window.__APP_RELEASE__`, compare to the merge SHA) is an OPEN improvement → `ROADMAP.md`. Until then, gate release-readiness on a canary run confirmed to post-date the Vercel deployment.
- **Raw-artifact source rule.** When generated summaries disagree with raw CI/browser artifacts, the raw artifact wins until the aggregator is fixed and rerun on the same commit.
- **Pro test-account rule.** Gate 3 Cloud/Pro evidence requires a known-good Pro cloud-entitled account provisioned by the maintained Test-User-Admin workflow (or an equivalent documented operator procedure), with the current credential secret owner/update path recorded before an RC run. A stale, trial-only, expired, or visually-Pro-but-not-cloud-entitled account does not count as Cloud evidence.

---

## 3. The five RC gates

The everyday CI workflow (`.github/workflows/ci.yml`) is intentionally **not** the full release-certification suite. RC gates are release-time controls. Run the automated suite with `pnpm run audit` or the manually dispatched `Release Candidate Gates` workflow; run one gate with `pnpm rc:gate:1:product` / `:2:sast` / `:3:dast` / `:4:sca` / `:5:ux`. Gate 1 includes external workflow and manual evidence recorded in the release matrix (not all launched by `pnpm run audit`). Do not add these full gates to the push/PR CI path unless a gate graduates into everyday correctness.

Glossary: **SAST** = static application security testing (lint/typecheck, secret scanning, production hardening, entitlement/quota unit tests, Edge Function tests). **DAST** = dynamic application security testing (running-app checks against the deployed app, local mocked Playwright flows and live deployed flows). **SCA** = software composition analysis (dependency & runtime supply-chain review; distinct critical advisories via `node scripts/sca-osv-gate.mjs` — `osv-scanner` over `pnpm-lock.yaml` — plus runtime warning review).

| RC gate | Name | Blocks tester release? | Maintained regression evidence |
|---|---|---|---|
| Gate 1 | Product truth | Yes | `pnpm rc:gate:1:product`, `CI - Test Audit`, `Live Release Matrix`, `Pro STT Artifact Matrix`, deploy/canary workflows, Native Chrome mic proof |
| Gate 2 | SAST / code review | Yes if P0 found | `pnpm rc:gate:2:sast`, `pnpm quality`, `pnpm test:edge`, entitlement/token/quota unit tests, env/test-mode tests, frontend secret scan, production hardening check |
| Gate 3 | DAST / running app | Yes if P0 found | `pnpm rc:gate:3:dast`, live Playwright against production URLs and Supabase Edge Functions |
| Gate 4 | SCA / dependency review | Yes only for critical exploitable risk | `node scripts/sca-osv-gate.mjs` (`osv-scanner` over `pnpm-lock.yaml`) + GitHub Actions/runtime warning review |
| Gate 5 | UX smoke | Yes if onboarding/core flow is unusable | Canary, primary/user-feature/error-state E2E, Native browser-dependent manual wording check |

### Gate 1 — Product truth

Prove the product's business promises are true: tier access, STT mode behavior, transcript capture, save/history/detail, analytics, exports, tester instructions. Required regression evidence: legacy-trial/stale-profile does not grant Pro (`live-release-matrix.yml` entitlement/sample suites, `subscriptionTiers.test.ts`, `useSessionLifecycle.test.tsx`); Free access sanity (`user-features.e2e.spec.ts` + sample entitlement proof); Pro Cloud artifact path (`pro-stt-artifact-matrix.yml` / `.live.spec.ts`); Pro Private artifact/cache path (`live-release-matrix.yml` `suite=private-cache`, `private-cache.live.spec.ts`); account-wide active-recording mutex (`account-wide-recording-mutex.live.spec.ts`); Native Chrome mic (`scripts/manual-native-chrome-proof.mjs`); STT corpus accuracy (deterministic fake-device + real-mic `pnpm rc:stt:corpus`); filler value corpus (`conv_01.wav`, `conv_02.wav` + truth lists); CI/deploy/canary green on the latest release commit; session save/history/analytics retrieval; custom-filler save/retrieval.

**STT corpus gate policy.** Two complementary layers: **code correctness** (Chrome fake media device + checked-in WAV fixtures — RC-counted for engines proven to receive the intended fixture audio) and **product readiness** (real mic with `afplay` + controlled physical setup — RC-counted release-time evidence for Native, Private, Cloud). A green fake-device run does not substitute for a real-mic pass. Sub-gates: **STT-A Accuracy** (ten canonical Harvard WAV/truth fixtures → per-engine WER table, transcript, first-text timing, error scan, artifact path; thresholds set after a calibration run, then release floors until stale); **STT-B Browser Journey** (record → transcript → stop/save → history/detail → analytics without fatal console/page/network errors); **STT-C Filler Value** (`conv_01.wav`, `conv_02.wav` + explicit truth → expected filler counts + actionable guidance). Native Chrome is launch-critical for onboarding and must have real-mic artifact evidence with recognizable transcript, no repetition loop, no unrecovered `onerror`, and a completed save/history/analytics journey.

**Native `continuous=true` regression note (2026-05-25).** A change on that date moved Chrome/Edge Native Web Speech from `continuous=true` to `continuous=false` after final-result dedup already existed; A/B artifacts showed `continuous=false` produced zero `onresult` events, VAD truncation drops, and no saved transcript, while `continuous=true` completed save/history/analytics. Chrome/Edge Native must **not** revert to `continuous=false` without a fresh real-mic A/B proving transcript, save/history/analytics, and no duplicate loop. Required duplicate-loop coverage: say a phrase twice in one continuous session (transcript contains it exactly twice, not four times), and across a recognition restart (exactly twice across the result-index reset). Real-mic corpus command:

```bash
BASE_URL=http://127.0.0.1:4173 STT_MODES=native,private,cloud STT_FIXTURES=h1_1,h1_2 pnpm rc:stt:corpus
```

(writes a JSON artifact under `/private/tmp` unless `STT_CORPUS_OUT` is set; a full STT-A calibration uses `STT_FIXTURES=h1_1..h1_10`).

### Gate 2 — SAST / code review

Prove code-level controls are fail-closed and secrets/test branches do not leak into production. OWASP-aligned regression evidence: Free / Private-sample Cloud-token denial (`assemblyai-token/index.test.ts`, `cloud-token-gates.live.spec.ts` → 403 before provider token mint); quota fail-open prevention (`check-usage-limit/index.test.ts`); auth/session failure → structured denial; test/E2E mode leakage (`env.test.ts`, CI production build validation); test-aware production-branch activation (`scripts/rc-production-hardening.mjs` → `ENV.isE2E` compile-time disabled in prod); secrets server-side only (`validate-env.mjs`, Edge tests → no provider secret required as `VITE_*`); Stripe open-redirect/origin spoofing (`stripe-security.canary.spec.ts`); Stripe webhook replay/idempotency (`stripe-webhook/adversarial.test.ts`); custom-word regex abuse (`fillerWordUtils.test.ts`); CORS misconfiguration (`_shared/cors.test.ts`); refresh/concurrency during recording (race/zombie tests + `useSessionLifecycle.test.tsx`); denied mic permission (`useSpeechRecognition/integration.test.tsx`, `NativeBrowser.test.ts`, manual hardware checklist). Gate command set:

```bash
pnpm quality
pnpm rc:sast:secrets
node scripts/rc-production-hardening.mjs
pnpm test:edge
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/config/__tests__/env.test.ts \
  frontend/src/constants/__tests__/subscriptionTiers.test.ts \
  frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx \
  frontend/src/services/transcription/__tests__/TranscriptionPolicy.test.ts \
  frontend/src/services/transcription/__tests__/TranscriptionService.race.test.ts \
  frontend/src/services/transcription/__tests__/TranscriptionService.zombie.test.ts \
  frontend/src/utils/__tests__/fillerWordUtils.test.ts \
  frontend/src/hooks/useSpeechRecognition/__tests__/integration.test.tsx
```

### Gate 3 — DAST / running app

Prove the deployed/running app behaves correctly against real Edge Functions, auth, Stripe, Cloud token gates, and live persistence. Required live evidence: legacy-trial downgrade trap (effective tier `free`, mode Browser unless sample/paid entitlement); invalid auth → 401, no token; Cloud token denied for Free/sample (403) / over-quota (429); **exact-origin CORS** (`cors-exact-origin.live.spec.ts`, in `pnpm rc:dast:live`) — against the deployed edge functions the approved origin is echoed exactly, hostile lookalikes/wrong-protocol/unapproved-port/localhost-lookalike get **403 with NO `Access-Control-Allow-Origin`**; non-skipping / fail-closed (missing `SUPABASE_URL` throws); Private-sample reuse denied after one sample; Cloud Pro artifact path (transcript → save → history/detail → AI → PDF text); Stripe checkout/webhook readiness in test mode without production-charge assumptions; Stripe webhook replay skips mutation via idempotent RPC; custom-filler live persistence; account-wide recording mutex; denied mic permission (manual + integration test); refresh during recording (saved analytics/history survive); canary user path. Gate command set:

```bash
pnpm rc:dast:local
pnpm rc:dast:live
```

### Gate 4 — SCA / dependency review

Prove no known critical exploitable dependency/runtime risk blocks release: `node scripts/sca-osv-gate.mjs` (`osv-scanner` over `pnpm-lock.yaml`, failing on any distinct un-ignored CRITICAL). Release rule: a critical runtime exploit with an available safe fix blocks tester release; non-critical advisories and GitHub Actions runtime deprecation warnings are P2 unless they break CI/deploy or expose secrets; do not churn dependency majors during the final release window unless it is a real P0/P1. The current documented SCA suppression (GHSA-5xrq, Vitest UI) and the history of migrating this gate off the retired `pnpm audit` endpoint — with the `osv-scanner` scan proving zero distinct un-ignored criticals — are recorded in `OPERATIONS_AND_SECURITY.md`.

### Gate 5 — UX smoke

Prove a normal human tester can understand the path, start recording, see meaningful states, recover from common failures, and understand output. Required evidence: reachable session entry + recording CTA (canary + primary-journey smoke); STT mode is visible/inspectable (`user-features.e2e.spec.ts` + Native manual checklist); legacy-trial copy does not trap the user; Native support is explicitly Chrome/browser-dependent (tester instructions + manual proof; "Chrome recommended" until an Edge proof passes); errors are actionable (`error-states.e2e.spec.ts`); Private first-use setup is understandable (`private-cache.live.spec.ts`); Private-first mode selector responsive/opaque/single-surface (`mode-selector-private-first.e2e.spec.ts` across 320/375/390/1280px); post-save one-surface + persistent Analytics cue, no duplicate toast (`post-save-consolidation.e2e.spec.ts`). Manual Native/Safari/browser wording check — owner: the RC release runner; artifact: screenshot/browser trace in the RC evidence bundle; pass: Native copy is visible before/during selection, identifies Native as browser-dependent, and offers Private as fallback; fail: unsupported/weak browsers silently fail or the user only sees internal diagnostics. Automated UX smoke is green when `pnpm rc:gate:5:ux` passes; subjective copy polish stays P2 unless the smoke finds an unusable onboarding/core-flow issue. **UX review screenshots are ephemeral layout aids (`retention-days: 1`), never STT/product-truth evidence.**

### Named STT gate artifacts

The STT binary gates fold into their parent RC gates with named artifacts (current run/status posture is in `RELEASE_STATUS.md`; the stable requirements are here and in `STT.md`): Fresh-Trial Private sample recording (`/private/tmp/speaksharp-private-human-[timestamp].json` — lifecycle warmup, model setup/download state, chunk RMS/duration rows, first-partial timestamp/text, console events, save result, history/detail proof); Native Browser Chrome human-mic proof (`/private/tmp/speaksharp-native-[timestamp].json` — event order `onspeechstart → first onresult`, selected transcript on stop, save/history/detail/analytics proof, no unintended 4-word sequence appearing more than once); Cloud Pro proof (`/private/tmp/cloud-artifact-[timestamp].log` — AssemblyAI token HTTP 200, transcript/save/history/detail, AI suggestions, PDF export, Pro entitlement context); custom-word analytics proof; PDF export proof (transcript/duration/WPM/filler/custom counts match saved detail within ±15%); Session Status UX (one clear status/progress surface, Private setup/download/ready states, no duplicate/internal FSM/debug status).

---

## 4. Observability API readback

The workflow `.github/workflows/observability-api-smoke.yml` and proof script `scripts/live-observability-proof.mjs` prove the observability providers are reachable and correctly credentialed. Required GitHub repository **secret names** (values live only in the secret stores; scopes catalogued in `OPERATIONS_AND_SECURITY.md`): `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `POSTHOG_PROJECT_API_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, optional `POSTHOG_API_HOST` / `POSTHOG_INGEST_HOST`, and `OBSERVABILITY_SMOKE_SECRET`. Required Supabase Edge Function secret names: `SENTRY_DSN` and `OBSERVABILITY_SMOKE_SECRET` (must match the GitHub repository secret). The Sentry token must read project events; the PostHog personal token must run project queries; the `observability-smoke` function must be deployed. Green evidence:

```text
LIVE_OBSERVABILITY_API_EVIDENCE {
  frontendSentry.apiConfirmed: true,
  edgeSentry.apiConfirmed: true,
  posthog.apiConfirmed: true
}
```

Current run IDs and pass/fail live only in `RELEASE_STATUS.md`.

---

## 5. Release workflows & commands

| Workflow | Trigger | RC role | Keep? |
|---|---|---|---|
| `ci.yml` / CI - Test Audit | Push, PR, manual | Everyday correctness: prepare, unit shards, unit coverage, Edge tests, build, health, E2E shards, Lighthouse advisory, report. | Required baseline. |
| `deploy-supabase-edge-release.yml` → reusable `deploy-supabase-migrations.yml` | Push to `main` **only when Edge source/config paths change** | Deploys the complete reviewed Edge Function list after validating the push diff. A frontend- or docs-only merge does not trigger this caller. | Yes. |
| `deploy-supabase-migrations.yml` | Manual or reusable call | Separately confirmed migrations/secrets operations; migration apply remains forward-only and requires the confirmation input. | Yes. |
| `canary.yml` | Push, manual, schedule | Production smoke against the deployed URL. | Yes. |
| `rc-gates.yml` | Manual | Runs the five explicit RC gates. | Yes. |
| `live-release-matrix.yml` | Manual | Live product-truth matrix (custom words, Native preflight, Cloud gates/artifacts, Private cache, first-time tester, Stripe readiness). | Release-time. |
| `pro-stt-artifact-matrix.yml` | Manual | Pro STT artifact path. | Release-time / STT changes. |
| `observability-api-smoke.yml` | Manual | Sentry/PostHog API readback. | Release-time / advisory by launch scope. |
| `private-model-smoke.yml` | Manual + weekly | Dormant Private-v4 dependency + deterministic-inference regression guard. NOT a release proof; does not activate v4. | Advisory, non-blocking. |
| `benchmarks.yml` | Schedule/manual | STT ceiling benchmarks. | Advisory; required only for engine/model/perf-SLA changes. |
| `stress-endurance.yml` | Schedule/manual | Backend stress / browser endurance. | Advisory unless investigating stability. |
| `setup-test-users.yml` | Manual | Test-user provisioning. | Utility, not a gate. |

The test files that each gate/workflow enforces (RC-counted ledgers) and the script inventory live in `QUALITY.md`. Deployment mechanics: a qualifying Edge-path push to `main` invokes `deploy-supabase-edge-release.yml`, which calls the reusable workflow and deploys every function in its reviewed list; disclose that full Edge deployment when the PR changes any trigger path. Backend migrations are **forward-only** through the separately dispatched `deploy-supabase-migrations.yml` operation (runs the documented history reconciliation, `supabase db push --dry-run`, then apply; pinned Supabase CLI v2.101.0). **No down-migrations exist** — consistent with the Forward-Fix doctrine. Canary provisions a single reused canary user and runs `pnpm test:deploy:prod` against the public site (fail-closed, `CANARY_MAX=1`). The deployed release identity is `window.__APP_RELEASE__` (injected from `VERCEL_GIT_COMMIT_SHA`; the `__BUILD_ID__` JS define was removed in #1027 so the volatile SHA never rotates chunk hashes) — verification detail is in `OPERATIONS_AND_SECURITY.md`.

---

## 6. Evidence freshness & Same-SHA rules

Each release gate is green only when its definition of green is backed by a **named artifact a reviewer can inspect without relying on operator memory**. The active artifact is always the latest complete passing run; if a newer run fails any required criterion, the parent gate returns to red until a later complete run passes every criterion. Every artifact update must record `Last updated by: [initials] [date] [artifact path]`. Combined with the same-SHA rule (§2), the practical release rule is: the latest evidence for each blocking gate must be green on the same commit SHA, and **every merge to `main` resets the signoff clock** (final-SHA freshness).

---

## 7. Private-only launch support, GO/HOLD, and recovery

> Stable operator procedure, not release status. Current posture, release-window names, run IDs,
> intended SHA, deployed SHA, and the final GO/HOLD decision live only in `RELEASE_STATUS.md` and
> the release-window record. Nothing in this section authorizes a merge, deploy, migration,
> configuration change, data write, tester invitation, or production rollback.

### 7.1 Non-negotiable operating rules

1. **Private is the only customer transcription path.** Browser, Native, Cloud, Guided, and a
   Private sample are not recovery paths. Do not expose, enable, recommend, or silently select a
   retired engine or product mode to contain an incident. If Private cannot support a trustworthy
   take, stop the affected journey and HOLD the launch.
2. **Establish identity before diagnosis.** Read the canonical production host from
   `RELEASE_STATUS.md`; read the deployed commit from the live page's `window.__APP_RELEASE__`;
   read the intended commit from GitHub `main`. Unknown or unequal identities mean HOLD. A merge,
   successful Vercel job, or green historical run is not deployed-SHA proof.
3. **Preserve user work and privacy.** Never ask for, copy, log, or attach speech audio or transcript
   text during ordinary triage. Never discard a recovery draft or saved session to make an error
   disappear. A suspected wrong-account read, speech-content leak, or save loss is S1 until disproved.
4. **Forward-fix migrations.** Production migrations are forward-only. Never treat `migration
   repair`, a down migration, a restored old function body, or an ad-hoc data edit as routine
   rollback. A corrective migration and any production application each require separate Product
   Owner authorization and their own dry-run, rollback/containment note, and exact-scope evidence.
5. **Every production mutation is separately authorized.** This includes frontend or Edge rollback,
   config/flag changes, secret changes, scaling, connection termination, data repair, refund, and
   retention cleanup. Diagnosis and read-only verification do not authorize the write.

### 7.2 Release authority and ownership

The release-window record must name a primary, backup, acknowledgement channel, and handoff time for
every row before GO. One person may fill multiple roles, but no role may be implicit.

| Role | Owns | May decide without additional authorization |
|---|---|---|
| Product Owner | final GO/HOLD; each production mutation; customer promise changes | HOLD, or authorize one precisely scoped action |
| Release commander | cadence, decision log, exact-SHA ledger, handoffs | HOLD and convene owners; never infer GO |
| Engineering owner | code diagnosis; forward-fix or rollback proposal; verification plan | read-only diagnosis and source changes |
| Operations/Security owner | Vercel/Supabase/config/runtime readback; security containment advice | read-only inspection and recommendation |
| Support/Privacy owner | sanitized Report Issue queue; affected-user communications; privacy escalation | redact/restrict an incident record; escalate to S1 |
| Quality/device owner | exact-head gates; real-device before/during/after checks; regression reproduction | return evidence or recommend HOLD |

### 7.3 Severity and stop-launch thresholds

| Severity | Definition | Initial acknowledgement | Required launch action |
|---|---|---:|---|
| **S1** | Trust, privacy, authorization, or data-integrity risk; cross-account data; speech-content exposure; confirmed save loss; paid path reachable | 5 minutes | Immediate HOLD; contain read-only while the Product Owner selects any mutation |
| **S2** | Core Private Practice Loop broadly unavailable or materially wrong: auth, setup, record, finalize, save, History/Progress/PDF, or supported mobile layout | 15 minutes | HOLD the affected cohort; no workaround through a retired product path |
| **S3** | Narrow degradation with a safe, Private-only workaround and no trust/data risk | 1 business hour | Record owner and deadline; GO only if the Product Owner explicitly accepts the residual risk |
| **S4** | Cosmetic or low-impact defect outside the core journey | Triage in release window | Queue a forward fix; does not independently force HOLD |

HOLD immediately when any of these is true:

- intended `main` SHA, deployed `window.__APP_RELEASE__`, or the SHA covered by terminal gate evidence
  is missing or unequal;
- any S1 exists, or any S2 affects the launch cohort;
- Browser, Native, Cloud, Guided, paid checkout, a paid upgrade, or a Private-sample promise is
  customer-visible or reachable;
- Private setup/record/finalize/save cannot complete without losing recoverable work;
- auth isolation, History ownership, Progress comparability, PDF truth, or retention behavior is
  unverified or contradicts the shipped contract;
- the session shell has horizontal overflow, hidden controls, or the wrong mic → transcript → progress
  → coaching order on a required 320/375/390px device;
- a required exact-head gate is red, skipped, absent, stale, or still running;
- a release role, backup, communication path, rollback target, or authorization owner is blank.

### 7.4 Sanitized Report Issue triage

The report row deliberately contains user-written title/description and optional transcript/audio
fields. Treat those columns as restricted content, even when the submitter opted in. Start with the
structured, content-free envelope only:

- report row id; category; severity; created timestamp;
- canonical route/page key/practice surface/issue-area slug;
- release id, runtime state, Private engine token, viewport, and Sentry event id;
- session id only inside the access-controlled source system when ownership-safe linkage is necessary.

Do not include `title`, `description`, `transcript_excerpt`, `audio_attachment_note`, raw `user_id`, raw
email, raw URL/query/fragment, or user-agent strings in tickets, chat, dashboards, screenshots, or
shared artifacts. Do not claim a report or telemetry identity is pseudonymous unless the deployed
implementation has separately proven that property. If free text must be inspected to resolve the
speaker's request, the Support/Privacy owner does so in the restricted source, records only a redacted
error category externally, and never copies speech content.

Triage sequence:

1. Pin the report to the deployed release and sanitized route. SHA mismatch → HOLD and classify as
   release identity/configuration, not a user-content problem.
2. Correlate by Sentry event id, release, route, error code/fingerprint, and bounded timestamp. Query
   Edge logs by request id/status only. Do not search providers by email, transcript, or audio.
3. If a database read is necessary, select the minimum non-content columns and keep raw identifiers
   inside the authorized query surface. Never select transcript text for ordinary support triage.
4. Choose the matching decision tree below, assign severity, and record the evidence source, owner,
   containment state, and next decision time.
5. Respond with status and a Private-only safe next step. Never ask the speaker to submit speech
   content to make diagnosis easier.

### 7.5 Private Practice Loop decision trees

Each tree is **symptom → content-free checks → safe containment → decision**.

| Surface | Content-free checks | Safe containment | GO/HOLD rule |
|---|---|---|---|
| Frontend/release identity | canonical host; live `window.__APP_RELEASE__`; intended `main`; Sentry release; asset/preload error | ask affected user to stop the take; preserve any recovery draft; propose an authorized known-good frontend rollback or forward fix | unknown/mismatched SHA, blank screen, or stale incompatible assets → HOLD |
| Authentication | provider health; response/error class; route/release; ownership-safe synthetic account proof | pause new invitations; preserve existing sessions; do not bypass auth or alter entitlement | broad sign-in failure, account enumeration, or cross-account access → HOLD (S1 for isolation risk) |
| Private setup | model asset HTTP status; setup state; device/browser class; release; no audio | show an honest unavailable/retry state; stop new takes on affected devices | no trustworthy Private path → HOLD; never offer Browser/Cloud |
| Record | permission state; recorder/runtime state; duration/heartbeat; viewport; error code | keep the recovery draft; allow a clean Private retry only after the recorder is idle | widespread start/stop failure or concurrent-capture risk → HOLD |
| Finalize | state transition timestamps; bounded processing state; error code; release | keep the local recovery draft and honest Finalizing state; do not fabricate completion | stuck or false-complete finalization for cohort → HOLD |
| Save | session id/status, save response, recovery-draft presence; never transcript text | preserve retryable work; retry the same save path without creating duplicate truth | confirmed loss, wrong-owner row, or duplicate terminal record → HOLD/S1 |
| History / Progress / PDF | owned session ids; attribution/comparability status; stored recommendation id; PDF generation status | withhold the derived claim that cannot be proven; retain the saved source session | wrong-account data → S1; invented comparison/action or materially false PDF → HOLD |
| Retention | deployed migration history; function/trigger definitions; row counts/states without content | stop cleanup and new retention mutations; preserve evidence; use only the actually deployed contract | unexpected deletion/exposure or an unverified retention promise → HOLD/S1 |
| Mobile | 320/375/390px before/during/after; horizontal overflow; focus order; mic → transcript → progress → coaching | pause affected device cohort and give status only | core control hidden, clipped, reordered, or horizontally unreachable → HOLD |

### 7.6 Containment and rollback matrix

Prefer the smallest forward fix that preserves data and product truth. Before requesting a mutation,
record: exact current identity, exact proposed target, file/config/data scope, expected automatic side
effects, verification, abort condition, and owner authorization.

| Lever | Preparation (read-only/source-only) | Authorized execution | Required readback |
|---|---|---|---|
| Frontend | resolve an immutable prior Vercel deployment already proven compatible; compare its commit and config contract | Product Owner authorizes Vercel rollback/redeployment | canonical host serves expected `window.__APP_RELEASE__`; auth and one Private setup→record→finalize→save smoke pass |
| Edge | diff every affected function and shared dependency against the proposed target; disclose that a qualifying Edge-path merge triggers the path-filtered caller and redeploys all listed functions | Product Owner authorizes the exact deploy/merge; never bypass auth/JWT/CORS to restore service | function versions/logs, denied unauthenticated requests, exact-origin CORS, and affected Private/save contract pass |
| Migration/database | produce an additive corrective migration; run dry-run and PostgreSQL-version proofs; document data scope and rollback/containment SQL | Product Owner separately authorizes application; never use migration-history repair as data rollback | production migration history, definition/ACL/search-path checks, positive/negative behavior, scoped row-integrity proof |
| Config/secret/flag | identify the authoritative storage home and exact old/new value class without printing a secret | Product Owner authorizes one named mutation; frontend build-time flags require a separately authorized deploy | runtime reports intended safe state; Private-only, billing-closed, v4-off, exact-origin behavior rechecked |
| Billing | keep enrollment and checkout closed; inspect only sanitized status/counts | no charge, refund, entitlement edit, or activation without written Product Owner authorization | endpoint remains fail-closed and no unexpected paid event exists |
| User data/retention | define the smallest ownership-safe query and reversible containment; exclude speech content | Product Owner authorizes any write or deletion | exact marked scope changed, unaffected rows unchanged, and no orphan/over-delete remains |
| Communications | prepare status, affected surface, safe next step, and next update time | Release/Support owner sends approved content-free notice | decision log links the sent notice and timestamp |

There is no routine emergency command that skips evidence or authorization. In particular, do not
deploy an improvised hard-coded Edge function, revert a migration body, terminate database sessions,
or change a production flag merely because the incident is severe. Severity shortens the decision
clock; it does not remove the safety boundary.

### 7.7 GO/HOLD checklist

The release-window record copies this checklist and records evidence links, not just checkmarks.

**Before GO**

- [ ] Canonical host, intended `main` SHA, live `window.__APP_RELEASE__`, and exact-head terminal gate
      SHA are present and equal.
- [ ] Release commander, Product Owner, Engineering, Operations/Security, Support/Privacy, and
      Quality/device primary + backup + acknowledgement channel are filled.
- [ ] Signup, Practice, Pricing, Analytics, Terms/Privacy, and tester copy agree on Private-only,
      free-beta truth; Browser/Native/Cloud/Guided/Private-sample/paid-upgrade claims are absent.
- [ ] Auth and one Private setup → record → finalize → save → History/Progress/PDF journey pass on
      the deployed release without inspecting real speech content.
- [ ] Required mobile before/during/after checks pass at 320, 375, and 390px; desktop checks pass at
      the release-required widths.
- [ ] Billing remains fail-closed; Private v4 remains off; CORS and database privileges match their
      separately reviewed security contracts.
- [ ] Actual deployed retention behavior and user-facing retention wording agree; source-only,
      unapplied migrations are not presented as production policy.
- [ ] One tabletop and one non-destructive rollback drill are recorded; proposed rollback targets,
      owners, abort conditions, and verification are explicit.
- [ ] Required telemetry/ops-health evidence is sanitized and green; no claim of pseudonymous identity
      is made without proof.

**During the window**

- [ ] Report Issue, Sentry, ops-health, Edge, auth, and save signals are checked on the release SHA at
      the agreed cadence using content-free fields.
- [ ] Each incident has severity, owner, acknowledgement, next decision time, and GO/HOLD effect.
- [ ] No production mutation or tester expansion occurs without its separately recorded authorization.

**After the observation window**

- [ ] One deployed Private Practice Loop and its owned History/Progress/PDF readback remain truthful.
- [ ] No S1/S2 is open; no release-identity, auth, retention, security, billing, or privacy anomaly is
      unexplained.
- [ ] Product Owner records GO, HOLD, or rollback as an explicit decision. Unchecked means HOLD.

### 7.8 Rehearsal and evidence

Rehearse at least: deployed-SHA mismatch, Private setup outage, save/recovery failure, wrong-account
History read, retention anomaly, mobile clipping, and an unexpected paid/retired-product surface. The
non-destructive rollback drill must resolve and inspect an immutable target, enumerate changed
frontend/Edge/migration/config surfaces, state the exact authorized command or dashboard action, and
stop before mutation. Record the drill and tabletop under `product_release/evidence/`; a source-only
exercise proves operator readiness, not that production was changed or that the release is GO.

Communication cadence for S1/S2: acknowledge internally at the severity target; publish an approved
content-free investigating notice by 15 minutes if customer impact continues; record the next update
time; at 60 minutes without safe mitigation, remain HOLD and explicitly postpone expansion. Never
promise a recovery time that the Engineering and Operations owners have not accepted.
