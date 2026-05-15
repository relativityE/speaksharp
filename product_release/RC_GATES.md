# Release Candidate Gates

<!-- PRODUCT_RELEASE_SYNC_START -->

## Current Evidence Snapshot (2026-05-15)

| Item | Current Status |
|---|---|
| Controlled desktop tester release | GO WITH LIMITATIONS; see `RELEASE_DECISION.md` and `TESTER_RELEASE_MATRIX.md`. |
| Broad public launch | NO-GO until remaining public-launch gates are proven; see `PUBLIC_LAUNCH_LEDGER.md`. |
| Latest release evidence commit | `1066ba6d` (`Use Node 24 artifact actions`). |
| CI/Test Audit | PASS: GitHub run `25944598514` on `main`. |
| Production canary | PASS: GitHub run `25944598537` on `main`. |
| Edge Function deploy | PASS: GitHub run `25944598524` on `main`. |
| Lighthouse release scores | Performance 98, Accessibility 94, Best Practices 100, SEO 100. |
| Artifact action runtime | Node 20 artifact warning resolved by upgrading `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`. |
| Documentation rule | This snapshot supersedes older run IDs or stale status tables lower in this file until those sections are next deeply reconciled. |

<!-- PRODUCT_RELEASE_SYNC_END -->

**Purpose:** define the maintained regression gates that must be run before a controlled human tester release.

This is a controlled tester release process, not an enterprise certification audit. A gate is green only when it has a named test, workflow, artifact, or manual checklist with recorded evidence.

## Gate Summary

The everyday CI workflow remains `.github/workflows/ci.yml` and is intentionally not the full release certification suite. RC gates are release-time controls:

- Run the automated RC command suite with `pnpm run audit` or the manually dispatched `Release Candidate Gates` workflow.
- Run an individual gate at any time with `pnpm rc:gate:1:product`, `pnpm rc:gate:2:sast`, `pnpm rc:gate:3:dast`, `pnpm rc:gate:4:sca`, or `pnpm rc:gate:5:ux`.
- Gate 1 includes external workflow and manual evidence that is recorded in the release matrix, not all launched by `pnpm run audit`.
- Do not add these full RC gates to the push/PR main CI path unless a gate graduates into everyday correctness.

| RC Gate | Name | Blocks Tester Release? | Maintained Regression Evidence |
|---|---|---:|---|
| Gate 1 | Product truth gate | Yes | `pnpm rc:gate:1:product`, `CI - Test Audit`, `Expired Promo Live Smoke`, `Pro STT Artifact Matrix`, deploy/canary workflows, Native Chrome mic proof |
| Gate 2 | SAST / code review | Yes if P0 found | `pnpm rc:gate:2:sast`, `pnpm quality`, `pnpm test:edge`, entitlement/token/quota unit tests, env/test-mode tests, frontend secret scan, production E2E/test-branch hardening check |
| Gate 3 | DAST / running app review | Yes if P0 found | `pnpm rc:gate:3:dast`, live Playwright tests against production URLs and Supabase Edge Functions |
| Gate 4 | SCA / dependency review | Yes only for critical exploitable risk | `pnpm audit --audit-level critical` plus GitHub Actions/runtime warning review |
| Gate 5 | UX smoke | Yes if onboarding/core flow is unusable | Canary, primary/user-feature/error-state E2E, Native browser-dependent manual wording check |

## Gate 1 - Product Truth

Required maintained tests and workflows:

| Risk | Regression Test / Workflow | Required Evidence |
|---|---|---|
| Expired promo or stale profile grants Pro | `.github/workflows/expired-promo-live-smoke.yml`, `tests/live/expired-promo-denial.live.spec.ts`, `frontend/src/constants/__tests__/subscriptionTiers.test.ts`, `frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx` | Effective tier becomes `free`, stored profile downgrades to `free`, Pro badge hidden, STT mode forced to Native |
| Basic/free access sanity | `tests/live/expired-promo-denial.live.spec.ts`, `tests/e2e/user-features.e2e.spec.ts` | Baseline users retain Native/free-safe path and do not retain Cloud/Private entitlement |
| Pro Cloud artifact path | `.github/workflows/pro-stt-artifact-matrix.yml`, `tests/live/pro-stt-artifact-matrix.live.spec.ts` | Cloud selected, token issued to Pro, transcript visible, stop/save, history/detail, AI feedback, PDF transcript text |
| Pro Private artifact/cache path | `.github/workflows/private-cache-live-smoke.yml`, `tests/live/private-cache.live.spec.ts` | Private starts, caches, saves, and remains usable on second start |
| Native Chrome mic | `scripts/manual-native-chrome-proof.mjs` | Real Chrome `getUserMedia`, live transcript, stop/save, history, analytics |
| CI/deploy/canary | `.github/workflows/ci.yml`, `.github/workflows/deploy-edge-functions.yml`, production canary workflow | Latest release commit has green CI, deploy, and canary |
| Session save/history/analytics retrieval | `tests/e2e/analytics-truth.e2e.spec.ts`, `tests/e2e/user-features.e2e.spec.ts`, `tests/live/pro-stt-artifact-matrix.live.spec.ts` | Saved transcript appears in history/detail, analytics values survive reload/export, Cloud PDF includes transcript text |
| Custom filler words save/retrieval | `tests/live/user-filler-words-persistence.live.spec.ts`, `tests/e2e/user-filler-words.e2e.spec.ts`, `frontend/src/utils/__tests__/fillerWordUtils.test.ts` | Custom words persist, reload, and affect analysis without regex/query breakage |

## Gate 2 - SAST / Code Review

Required maintained tests:

| OWASP-Aligned Risk | Regression Test | Expected Assertion |
|---|---|---|
| Broken access control: Free user Cloud token | `backend/supabase/functions/assemblyai-token/index.test.ts` | Non-Pro request returns 403 and AssemblyAI provider is not called |
| Broken access control: expired promo Cloud token | `backend/supabase/functions/assemblyai-token/index.test.ts`, `tests/live/cloud-token-gates.live.spec.ts` | Expired promo-only Pro returns 403 before provider token mint |
| Insecure design: quota fail-open | `backend/supabase/functions/assemblyai-token/index.test.ts`, `backend/supabase/functions/check-usage-limit/index.test.ts` | Usage verification failure denies start/token and does not mint paid provider token |
| Auth/session failure | `backend/supabase/functions/check-usage-limit/index.test.ts`, `backend/supabase/functions/assemblyai-token/index.test.ts` | Missing/invalid auth returns structured denial |
| Test/E2E mode leakage | `frontend/src/config/__tests__/env.test.ts`, CI production build validation | Test-only branches are gated by test mode and not production assumptions |
| Test-aware production branch activation | `scripts/rc-production-hardening.mjs` through `pnpm rc:gate:2:sast` | `ENV.isE2E` is compile-time disabled in production builds and sensitive test branches remain guarded |
| Secrets server-side only | `scripts/validate-env.mjs`, `frontend/src/main.tsx`, Edge Function tests | Provider secret keys are not required as frontend `VITE_*` values; frontend uses DSN/project public keys only |
| Stripe open redirect/origin spoofing | `tests/live/stripe-security.canary.spec.ts` | Client-supplied origin does not control checkout return origin |
| Stripe webhook replay/idempotency | `backend/supabase/functions/stripe-webhook/adversarial.test.ts` | Duplicate webhook event is skipped by the atomic RPC path |
| Custom words injection / regex abuse | `frontend/src/utils/__tests__/fillerWordUtils.test.ts` | Malformed custom words cannot crash analysis or create unsafe regex behavior |
| CORS misconfiguration | `backend/supabase/functions/_shared/cors.test.ts` | Trusted origins are echoed and untrusted origins are not |
| Refresh/concurrency during recording | `frontend/src/services/transcription/__tests__/TranscriptionService.race.test.ts`, `frontend/src/services/transcription/__tests__/TranscriptionService.zombie.test.ts`, `frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx` | Stale recording callbacks cannot overwrite the active run or corrupt lifecycle state |
| Denied mic permission | `frontend/src/hooks/useSpeechRecognition/__tests__/integration.test.tsx`, `frontend/src/services/transcription/modes/__tests__/NativeBrowser.test.ts`, `product_release/MANUAL_HARDWARE_VALIDATION.md` | Permission denial becomes a user-visible error path and is also checked manually before release |

Gate command set:

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

## Gate 3 - DAST / Running App

Required maintained live workflows:

| Running-App Risk | Workflow / Test | Required Evidence |
|---|---|---|
| Expired promo downgrade trap | `Expired Promo Live Smoke` | Dialog dismisses, effective tier is `free`, stored status is `free`, mode is Native |
| Invalid auth | `tests/live/cloud-token-gates.live.spec.ts`, `backend/supabase/functions/assemblyai-token/index.test.ts` | Missing/invalid auth returns 401 and no token issued |
| Cloud token denied for Free/expired/over-quota | `tests/live/cloud-token-gates.live.spec.ts` | Free and expired promo return 403, over-quota returns 429, no token issued |
| Promo brute force | `tests/live/promo-throttle.live.spec.ts` | Ninth wrong promo attempt returns 429 for the same user |
| Cloud Pro artifact path | `Pro STT Artifact Matrix` with `mode=cloud` | Transcript -> save -> history/detail -> AI -> PDF text |
| Stripe checkout/webhook readiness | `tests/live/stripe-checkout-readiness.live.spec.ts`, `tests/live/stripe-webhook-readiness.live.spec.ts` | Test-mode checkout/webhook path completes without production-charge assumptions |
| Stripe webhook replay | `backend/supabase/functions/stripe-webhook/adversarial.test.ts` | Duplicate event skips mutation through idempotent RPC result |
| Custom filler words live persistence | `tests/live/user-filler-words-persistence.live.spec.ts` | Filler words save, reload, and are retrievable for the same user |
| Denied mic permission | `product_release/MANUAL_HARDWARE_VALIDATION.md`, `frontend/src/hooks/useSpeechRecognition/__tests__/integration.test.tsx` | Browser-denied mic path is documented and produces a visible error |
| Refresh during recording | `tests/e2e/analytics-truth.e2e.spec.ts`, lifecycle unit tests in Gate 2 | Saved analytics/history survive reload; stale recording callbacks are unit-guarded |
| Canary user path | Production canary workflow | Production URL can be exercised with provisioned user |

Gate command set:

```bash
pnpm rc:dast:local
pnpm rc:dast:live
```

## Gate 4 - SCA / Dependency Review

Required maintained checks:

```bash
pnpm audit --audit-level critical
```

Release rule:

- Critical runtime exploit with an available safe fix blocks tester release.
- Non-critical advisories and GitHub Actions runtime deprecation warnings are P2 unless they break CI or expose secrets.
- Do not churn dependency majors during the final release window unless the issue is a real P0/P1.

## Gate 5 - UX Smoke

Required maintained checks:

| UX Risk | Regression Test / Review | Required Evidence |
|---|---|---|
| User does not know what to click first | Canary + primary journey smoke | Session entry and recording CTA are reachable |
| STT mode is unclear | `tests/e2e/user-features.e2e.spec.ts`, Native manual checklist | Private/Cloud/Native selection is visible and current mode is inspectable |
| Expired promo copy traps user | `tests/live/expired-promo-denial.live.spec.ts` | Continue as Basic/Free-safe action dismisses dialog and lands in safe state |
| Native support expectations | Tester instructions and manual Native proof | Native is explicitly Chrome/browser-dependent and included only with Chrome proof |
| Errors are actionable | `tests/e2e/error-states.e2e.spec.ts` | User sees recoverable state, not only internal diagnostics |
| Private first-use setup | `tests/e2e/user-features.e2e.spec.ts`, `tests/live/private-cache.live.spec.ts` | Private setup/cache path is understandable enough to start and rerun without stale cache failure |

Automated UX smoke is green when `pnpm rc:gate:5:ux` passes. Subjective copy polish can continue as P2, but it should not reopen release-critical code unless the smoke finds an unusable onboarding/core-flow issue.

## Observability API Readback Requirements

The workflow exists at `.github/workflows/observability-api-smoke.yml` and the proof script exists at `scripts/live-observability-proof.mjs`.

Required GitHub repository secrets:

| Secret | Purpose |
|---|---|
| `SENTRY_DSN` | Sends frontend synthetic smoke event directly to Sentry ingest |
| `SENTRY_AUTH_TOKEN` | Reads the synthetic frontend/edge event back from Sentry API |
| `SENTRY_ORG` | Sentry API organization slug |
| `SENTRY_PROJECT` | Sentry API project slug |
| `POSTHOG_PROJECT_API_KEY` | Captures synthetic PostHog launch event |
| `POSTHOG_PERSONAL_API_KEY` | Queries PostHog events through API |
| `POSTHOG_PROJECT_ID` | PostHog project ID for query endpoint |
| `POSTHOG_API_HOST` | Optional; defaults to `https://us.posthog.com` |
| `POSTHOG_INGEST_HOST` | Optional; defaults to `POSTHOG_API_HOST` when set, otherwise `https://us.posthog.com` |
| `OBSERVABILITY_SMOKE_SECRET` | Authenticates the deployed Edge observability smoke function |

Required Supabase Edge Function secrets:

| Secret | Purpose |
|---|---|
| `SENTRY_DSN` | Lets `observability-smoke` send the Edge synthetic event |
| `OBSERVABILITY_SMOKE_SECRET` | Must match the GitHub repository secret of the same name |

Required permissions:

- Sentry token must read project events for the configured org/project.
- PostHog personal token must run project queries.
- The Supabase function `observability-smoke` must be deployed and configured.

Green evidence:

```text
LIVE_OBSERVABILITY_API_EVIDENCE {
  frontendSentry.apiConfirmed: true,
  edgeSentry.apiConfirmed: true,
  posthog.apiConfirmed: true
}
```

Latest recorded green workflow evidence:

```text
Observability API Smoke run 25764783852: passed
Release Candidate Gates run 25769178359 on e73408c0: all five gates passed
```
