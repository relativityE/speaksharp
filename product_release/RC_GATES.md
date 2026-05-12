# Release Candidate Gates

**Purpose:** define the maintained regression gates that must be run before a controlled human tester release.

This is a controlled tester release process, not an enterprise certification audit. A gate is green only when it has a named test, workflow, artifact, or manual checklist with recorded evidence.

## Gate Summary

| RC Gate | Name | Blocks Tester Release? | Maintained Regression Evidence |
|---|---|---:|---|
| Gate 1 | Product truth gate | Yes | `CI - Test Audit`, `Expired Promo Live Smoke`, `Pro STT Artifact Matrix`, deploy/canary workflows, Native Chrome mic proof |
| Gate 2 | SAST / code review | Yes if P0 found | `pnpm quality`, `pnpm test:edge`, entitlement/token/quota unit tests, env/test-mode tests |
| Gate 3 | DAST / running app review | Yes if P0 found | Live Playwright workflows against production URLs and Supabase Edge Functions |
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

## Gate 2 - SAST / Code Review

Required maintained tests:

| OWASP-Aligned Risk | Regression Test | Expected Assertion |
|---|---|---|
| Broken access control: Free user Cloud token | `backend/supabase/functions/assemblyai-token/index.test.ts` | Non-Pro request returns 403 and AssemblyAI provider is not called |
| Broken access control: expired promo Cloud token | `backend/supabase/functions/assemblyai-token/index.test.ts`, `tests/live/cloud-token-gates.live.spec.ts` | Expired promo-only Pro returns 403 before provider token mint |
| Insecure design: quota fail-open | `backend/supabase/functions/assemblyai-token/index.test.ts`, `backend/supabase/functions/check-usage-limit/index.test.ts` | Usage verification failure denies start/token and does not mint paid provider token |
| Auth/session failure | `backend/supabase/functions/check-usage-limit/index.test.ts`, `backend/supabase/functions/assemblyai-token/index.test.ts` | Missing/invalid auth returns structured denial |
| Test/E2E mode leakage | `frontend/src/config/__tests__/env.test.ts`, CI production build validation | Test-only branches are gated by test mode and not production assumptions |
| Secrets server-side only | `scripts/validate-env.mjs`, `frontend/src/main.tsx`, Edge Function tests | Provider secret keys are not required as frontend `VITE_*` values; frontend uses DSN/project public keys only |
| Stripe open redirect/origin spoofing | `tests/live/stripe-security.canary.spec.ts` | Client-supplied origin does not control checkout return origin |

Gate command set:

```bash
pnpm quality
pnpm test:edge
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/config/__tests__/env.test.ts \
  frontend/src/constants/__tests__/subscriptionTiers.test.ts \
  frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx
```

## Gate 3 - DAST / Running App

Required maintained live workflows:

| Running-App Risk | Workflow / Test | Required Evidence |
|---|---|---|
| Expired promo downgrade trap | `Expired Promo Live Smoke` | Dialog dismisses, effective tier is `free`, stored status is `free`, mode is Native |
| Cloud token denied for expired/over-quota | `tests/live/cloud-token-gates.live.spec.ts` | Expired promo returns 403, over-quota returns 429, no token issued |
| Cloud Pro artifact path | `Pro STT Artifact Matrix` with `mode=cloud` | Transcript -> save -> history/detail -> AI -> PDF text |
| Stripe checkout/webhook readiness | `tests/live/stripe-checkout-readiness.live.spec.ts`, `tests/live/stripe-webhook-readiness.live.spec.ts` | Test-mode checkout/webhook path completes without production-charge assumptions |
| Canary user path | Production canary workflow | Production URL can be exercised with provisioned user |

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
| Native support expectations | Tester instructions and manual Native proof | Native is explicitly Chrome/browser-dependent |
| Errors are actionable | `tests/e2e/error-states.e2e.spec.ts` | User sees recoverable state, not only internal diagnostics |

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
