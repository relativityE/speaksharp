**Status:** Authoritative (SSOT for release-gate definitions, release workflow, freshness rules, and recovery)
**Owner:** Engineering / Quality (relativityE)
**Last Reviewed:** 2026-07-30
**Last Verified:** 2026-07-30 — consolidated from approved interim sources (`RC_GATES.md`, `RELEASE_RECOVERY.md`, and the release-workflow material in `RC_TEST_INVENTORY.md`) and cross-checked against the cited `.github/workflows` and `backend/` paths. No current run IDs, SHAs, deployment baselines, or queue state are carried here — those live only in `RELEASE_STATUS.md`.
**Applies To:** The SpeakSharp controlled-tester release process — the five RC gates, evidence freshness, the release workflow & commands, and emergency recovery/rollback.
**Class:** Acceptance criterion / procedure.
**Authority:** The source for the definition of each RC gate (what "green" means), the gate evidence rules, evidence freshness & same-SHA rules, the release workflow/commands and observability readback, and the forward-fix/rollback/recovery playbook.
**Not Authoritative For:** current ship posture, blockers, run IDs & SHAs (→ `RELEASE_STATUS.md`); the test inventory that maps files into these gates, the quality targets & SLOs (→ `QUALITY.md`); STT accuracy/latency baselines & named STT proof detail (→ `STT.md`); env/secrets/security controls & SCA exceptions (→ `OPERATIONS_AND_SECURITY.md`); tier/entitlement mechanics (→ `ENTITLEMENTS_AND_BILLING.md`).
**Supersedes:** `RC_GATES.md`, `RELEASE_RECOVERY.md`, and the release-workflow material of `RC_TEST_INVENTORY.md` (interim sources; archived at documentation closeout per `DOC_MIGRATION_LEDGER.md`).
**Evidence Sources:** `DOC_MIGRATION_LEDGER.md` §3.F extraction mapping; the `.github/workflows/*` and `backend/supabase/*` paths cited inline; the release-identity mechanism (#1027).

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
- **Private saved-transcript fidelity (Gate 1 STT, #891/#892).** Real-mic engine liveness + metadata are **not** sufficient. On the **persisted** transcript (saved DB row / History detail — not the live draft) require: opening anchor present after *every* onset class including the immediate-start case; coverage threshold across expected phrases; no ≥5-word verbatim loop, but the saved transcript is flagged, **never mutated** (`detectRepetitionRisk` records metadata only, #903); History/detail matches end-to-end and the finalize state shows the dimmed draft + honest progress (#905/#906); long leading silence yields no hallucinated prefix; real-mic proof after any Private capture/buffer/trim change (fake-device does not substitute). **stop-to-final latency is an accepted RC limitation (owner, 2026-07-14): a full 5-min single Private v2 recording finalizes in ≈90 s of post-stop processing, surfaced as honest "Finalizing…" progress. The earlier `<30 s` requirement is withdrawn — do not gate on it.** This is **not** a blocking gate for controlled beta. **Private v4 activation is OFF for this release** (default `private_v2:whisper-base.en`; `private_stt_v4_*` flags default off; `VITE_PRIVATE_STT_V4_DISABLED='true'` is the build-time hard kill).
- **Ship-signal rule.** RC gate status is the ship/no-ship signal. Quality score, coverage, Lighthouse, benchmarks, backend stress, and browser endurance are advisory unless explicitly named as a blocking gate item. A high quality score cannot override a red or stale RC gate item.
- **Same-SHA release-candidate rule.** Any commit considered a release candidate must pass full CI, production canary, and Service-Level Evidence on the **same commit SHA** before it can be called release-ready. CI optimizations may reduce wasted runs while iterating but do not lower the final bar. A Vercel canary must test the deployed production URL because users receive Vercel's deployed artifact, not CI's internal build artifact.
- **Raw-artifact source rule.** When generated summaries disagree with raw CI/browser artifacts, the raw artifact wins until the aggregator is fixed and rerun on the same commit.
- **Pro test-account rule.** Gate 3 Cloud/Pro evidence requires a known-good Pro cloud-entitled account provisioned by the maintained Test-User-Admin workflow (or an equivalent documented operator procedure), with the current credential secret owner/update path recorded before an RC run. A stale, trial-only, expired, or visually-Pro-but-not-cloud-entitled account does not count as Cloud evidence.

---

## 3. The five RC gates

The everyday CI workflow (`.github/workflows/ci.yml`) is intentionally **not** the full release-certification suite. RC gates are release-time controls. Run the automated suite with `pnpm run audit` or the manually dispatched `Release Candidate Gates` workflow; run one gate with `pnpm rc:gate:1:product` / `:2:sast` / `:3:dast` / `:4:sca` / `:5:ux`. Gate 1 includes external workflow and manual evidence recorded in the release matrix (not all launched by `pnpm run audit`). Do not add these full gates to the push/PR CI path unless a gate graduates into everyday correctness.

Glossary: **SAST** = static application security testing (lint/typecheck, secret scanning, production hardening, entitlement/quota unit tests, Edge Function tests). **DAST** = dynamic application security testing (running-app checks against the deployed app, local mocked Playwright flows and live deployed flows). **SCA** = software composition analysis (dependency & runtime supply-chain review; currently critical advisories via `pnpm audit --audit-level critical` + runtime warning review).

| RC gate | Name | Blocks tester release? | Maintained regression evidence |
|---|---|---|---|
| Gate 1 | Product truth | Yes | `pnpm rc:gate:1:product`, `CI - Test Audit`, `Live Release Matrix`, `Pro STT Artifact Matrix`, deploy/canary workflows, Native Chrome mic proof |
| Gate 2 | SAST / code review | Yes if P0 found | `pnpm rc:gate:2:sast`, `pnpm quality`, `pnpm test:edge`, entitlement/token/quota unit tests, env/test-mode tests, frontend secret scan, production hardening check |
| Gate 3 | DAST / running app | Yes if P0 found | `pnpm rc:gate:3:dast`, live Playwright against production URLs and Supabase Edge Functions |
| Gate 4 | SCA / dependency review | Yes only for critical exploitable risk | `pnpm audit --audit-level critical` + GitHub Actions/runtime warning review |
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

Prove no known critical exploitable dependency/runtime risk blocks release: `pnpm audit --audit-level critical`. Release rule: a critical runtime exploit with an available safe fix blocks tester release; non-critical advisories and GitHub Actions runtime deprecation warnings are P2 unless they break CI/deploy or expose secrets; do not churn dependency majors during the final release window unless it is a real P0/P1. The current documented SCA suppression (GHSA-5xrq, Vitest UI) and the pinned-`pnpm audit` endpoint-retirement breakage — including the `osv-scanner` cross-check proving zero distinct unignored criticals — are recorded in `OPERATIONS_AND_SECURITY.md`.

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
| `deploy-supabase-migrations.yml` | Push to Supabase paths, manual | Deploy Edge Functions and DB migrations (forward-only). | Yes. |
| `canary.yml` | Push, manual, schedule | Production smoke against the deployed URL. | Yes. |
| `rc-gates.yml` | Manual | Runs the five explicit RC gates. | Yes. |
| `live-release-matrix.yml` | Manual | Live product-truth matrix (custom words, Native preflight, Cloud gates/artifacts, Private cache, first-time tester, Stripe readiness). | Release-time. |
| `pro-stt-artifact-matrix.yml` | Manual | Pro STT artifact path. | Release-time / STT changes. |
| `observability-api-smoke.yml` | Manual | Sentry/PostHog API readback. | Release-time / advisory by launch scope. |
| `private-model-smoke.yml` | Manual + weekly | Dormant Private-v4 dependency + deterministic-inference regression guard. NOT a release proof; does not activate v4. | Advisory, non-blocking. |
| `benchmarks.yml` | Schedule/manual | STT ceiling benchmarks. | Advisory; required only for engine/model/perf-SLA changes. |
| `stress-endurance.yml` | Schedule/manual | Backend stress / browser endurance. | Advisory unless investigating stability. |
| `setup-test-users.yml` | Manual | Test-user provisioning. | Utility, not a gate. |

The test files that each gate/workflow enforces (RC-counted ledgers) and the script inventory live in `QUALITY.md`. Deployment mechanics: backend migrations are **forward-only** via `deploy-supabase-migrations.yml` (runs `supabase migration repair … --status applied`, then `supabase db push --dry-run`, then apply; pinned Supabase CLI v2.101.0). **No down-migrations exist** — consistent with the Forward-Fix doctrine. Canary provisions a single reused canary user and runs `pnpm test:deploy:prod` against the public site (fail-closed, `CANARY_MAX=1`). The deployed release identity is `window.__APP_RELEASE__` (injected from `VERCEL_GIT_COMMIT_SHA`; the `__BUILD_ID__` JS define was removed in #1027 so the volatile SHA never rotates chunk hashes) — verification detail is in `OPERATIONS_AND_SECURITY.md`.

---

## 6. Evidence freshness & Same-SHA rules

Each release gate is green only when its definition of green is backed by a **named artifact a reviewer can inspect without relying on operator memory**. The active artifact is always the latest complete passing run; if a newer run fails any required criterion, the parent gate returns to red until a later complete run passes every criterion. Every artifact update must record `Last updated by: [initials] [date] [artifact path]`. Combined with the same-SHA rule (§2), the practical release rule is: the latest evidence for each blocking gate must be green on the same commit SHA, and **every merge to `main` resets the signoff clock** (final-SHA freshness).

---

## 7. Recovery, rollback & forward-fix

> Recovery playbook, not release status. Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

**Recovery doctrine — Forward-Fix First.** Because the system relies on stateful Supabase migrations and Stripe webhooks, a full rollback often causes more data corruption than it solves. **Prefer** fix-in-place and redeploy; **avoid** reverting database migrations once real users have signed up.

### Emergency triage levels

| Symptom | Severity | Action |
|---|---|---|
| Stripe webhook 500s | P0 | Pause new checkouts in Stripe; investigate Edge Function logs. |
| Quota fail-open (revenue leak) | P0 | Deploy "Emergency Closed" limit function (hardcode `can_start: false`). |
| Database connection exhaustion | P0 | Scale Supabase instance or terminate idle connections via Dashboard. |
| Private STT model 404s | P1 | Disable or retry the CPU/Transformers.js Private setup, explain the outage, present Cloud/Native as explicit user-selectable alternatives. **Do not silently switch a Private session to Cloud.** |
| Transcript data loss | P1 | The in-session safeguard is the localStorage recovery draft (`frontend/src/services/sessionRecoveryDraft.ts`, key `speaksharp_unsaved_session_draft`): a throttled heartbeat (`App.tsx` `flushRecoveryDraft`, ~every 2 s) plus a `beforeunload` flush, consumed on resume in `SessionPage.tsx`. If it regresses, verify the heartbeat interval and `beforeunload` handler are wired; there is no separate "aggressive persistence" mode. |

### Emergency rollback criteria

Only roll back the frontend if: (1) the new deployment prevents users from signing in entirely; (2) the UI is completely broken (blank screen) on more than two major browsers; or (3) a critical security vulnerability is discovered that cannot be patched within 30 minutes.

```bash
# Frontend rollback (Vercel; manual — no automated frontend-rollback workflow)
vercel rollback [PREVIOUS_DEPLOYMENT_ID]

# Supabase emergency patch — deploy one Edge Function without a full CI run
supabase functions deploy [FUNCTION_NAME] --project-ref [PROJECT_ID]
```

### Data-integrity recovery (respects Level 3)

If a bug causes incorrect billing status: (1) identify affected users via the real profile table **`user_profiles`** (singular; `20250811062708_initial_schema.sql` — there is no `users_profiles`); (2) reconcile billing state from Stripe via the real mechanism — the **`stripe-webhook`** edge function (`backend/supabase/functions/stripe-webhook/index.ts`) calling the idempotent RPC **`process_stripe_webhook_event`** (`20260310000000_stripe_webhook_rpc.sql`), de-duplicated by the `processed_webhook_events` table; re-deliver the affected event(s) from the Stripe dashboard so the webhook re-processes them (there is no standalone "Sync from Stripe" script; `scripts/stripe-price-audit.mjs` audits prices only); (3) notify users via Sentry/PostHog + in-app toasts — there is **no** `system_notifications` table (the schema has no notifications table of any name). Real schema tables (from migrations): `user_profiles`, `sessions`, `user_goals`, `custom_vocabulary`, `processed_webhook_events`, `tier_configs`, `trial_entitlements`, `usage_checkpoints`, `ai_suggestion_usage_daily`, `formatter_usage_daily`, `active_recording_lease`, `user_issue_reports`.

### Communication protocol

Minute 0 — detect failure via Sentry/PostHog. Minute 5 — update internal status (`/admin/ops-status`; workflow `ops-health.yml`). Minute 15 — if unpatched, post "Investigating" to the public status page. Minute 60 — if still broken, declare Launch Postponed. Respect the Beta-50 billing freeze: no live Stripe charges/refunds in testing; any refund action requires written owner approval.
