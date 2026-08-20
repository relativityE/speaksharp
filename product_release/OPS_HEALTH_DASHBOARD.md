# Ops Health Dashboard

SpeakSharp uses a single high-level ops health workflow so release checks do not require logging into every vendor dashboard first.

## Implementation Status

Two layers now exist:
- **V1 — GitHub artifact + workflow summary.** `ops-health.yml` runs daily (cron `6 13 * * *`) and on manual dispatch, uploading `ops-health/ops-health.json` + `.md`.
- **Protected operator page — SHIPPED.** `/admin/ops-status` (`frontend/src/pages/OpsStatusPage.tsx`, wired in `App.tsx`, case-sensitive route) is the product-facing operator view. It is **gated** by the internal-routes guard (`frontend/src/config/internalRoutes.ts`, `VITE_ENABLE_INTERNAL_ROUTES`), covered by `frontend/src/__tests__/opsStatusRouteGating.test.tsx` and `frontend/src/pages/__tests__/OpsStatusPage.component.test.tsx`. When internal routes are disabled the path does not resolve to the operator view.

The data-path architecture lives in `ARCHITECTURE.operational.md`.

## What It Answers

The dashboard answers: "Are the main software/API interfaces we rely on reachable and credentialed right now?"

It is intentionally not a replacement for vendor dashboards. It is an early signal board with drill-down links.

## Current V1 Rows

| Tool | Signal | Drill-down |
|---|---|---|
| SpeakSharp app | Production URL returns HTTP success | Vercel/app URL |
| Vercel API | Latest production deployment if Vercel credentials are configured | Vercel dashboard |
| Supabase API | Auth plus SpeakSharp-owned Edge Function entrypoints | Supabase dashboard |
| AssemblyAI API | Cloud STT provider credential reachability | AssemblyAI dashboard |
| Gemini API | AI suggestions provider credential reachability | Google AI Studio |
| Stripe API | Billing credential and price reachability | Stripe dashboard |
| Sentry API | Error monitoring project query reachability | Sentry |
| PostHog API | Analytics query reachability | PostHog |
| GitHub API | Repository metadata and release workflow rollup (bounded-retry, see below) | GitHub Actions |

Detailed lower-level checks, such as frontend env contract, Private model assets, Private worker assets, release evidence freshness, SAST/DAST/SCA, canary, and benchmark proof freshness, belong in the JSON/admin drill-down or release docs, not in the simple v1 health table.

## GitHub API row — bounded-retry & recovery semantics (#990)

The GitHub row probes `api.github.com` **from inside GitHub Actions** (a circular vendor dependency: a GitHub API blip can hit both the probe target and the runner). To stop a single transient upstream `5xx` from raising a false product-emergency RED, the probe uses **bounded** resilience (`scripts/lib/github-ops-fetch.mjs` + `scripts/lib/github-ops-row.mjs`) — it does **not** "retry until green":

- **Bounded retry:** at most **3 attempts**, jittered exponential backoff; retries only idempotent GET on network error / timeout / `408/500/502/503/504`.
- **Hard deadline, shared across the whole row:** one deadline is shared by every sub-check request (repository metadata / authoritative RC status / ci|canary workflow query), and it stays active **through response-body consumption** — a server that returns headers then stalls the body still hits the deadline. Exceeding it yields `BUDGET_EXHAUSTED`; a response arriving after the deadline never counts as green.
- **Rate limiting:** honors `Retry-After` and `x-ratelimit-remaining/reset` (and `x-ratelimit-remaining: 0` even without a usable reset), plus secondary-limit body language. A required wait beyond the budget → `RATE_LIMITED`; an unqualified 429 uses GitHub's ≥60s fallback → `RATE_LIMITED` immediately (never busy-retried). A `403` with no rate-limit evidence → permission RED.
- **Recovery is a non-gating yellow:** a sub-check that fails transiently and then succeeds within budget surfaces as **`🟡 REVIEW`** ("recovered after N attempts"), recorded in the release ledger, **not** a hard failure. Only an exhausted-retry / non-retryable / permission / auth / rate-limited / budget-exhausted terminal is **`🔴 FAIL`**.
- **Labeled failures:** a terminal failure names the exact sub-check (e.g. "repository metadata") rather than collapsing to `github=<status>`, and emits sanitized diagnostics (status, `x-github-request-id`, rate-limit trio) — never the token or `Authorization` header.

## Status Vocabulary

| Status | Meaning |
|---|---|
| `🟢 OK` | The API/check responded and returned acceptable data. |
| `🔴 FAIL` | The API/check was unreachable, errored, or returned launch-blocking bad data. |
| `⚠️ REVIEW` | Data came back, but it needs attention, such as stale or unexpected content. |
| `🚧 NOT READY` | The run could not produce a useful signal yet, usually because credentials are not available in that run context. |

## Security Rules

- Do not expose vendor API keys in the frontend.
- Do not write raw vendor payloads into artifacts.
- Do not store transcripts, user emails, or user content in health artifacts.
- Health output is limited to status, short detail, latency, timestamp, and drill-down URL.

## Usage

Manual local run with env loaded:

```bash
pnpm ops:health
```

GitHub:

```bash
gh workflow run ops-health.yml
```

The workflow runs once daily and uploads `ops-health/ops-health.json` plus `ops-health/ops-health.md` as artifacts. Keep the cadence low before product release to avoid unnecessary vendor API traffic; use manual dispatch for active investigations.

## Work In Progress Checks

Some rows may show `🚧 NOT READY` until the corresponding secret is added to GitHub Actions. That is intentional: not-ready rows are inventory debt, not hidden success.

| Check | Required env/secret |
|---|---|
| Vercel API | `VERCEL_ACCESS_TOKEN`, `VERCEL_PROJECT_ID`; `VERCEL_TEAM_ID` only if Vercel requires team scoping for this token |
| Supabase API | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| AssemblyAI API | `ASSEMBLYAI_API_KEY` |
| Gemini API | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| Stripe API | `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID` |
| Sentry API | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, optional `SENTRY_API_BASE` |
| PostHog API | `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, optional `POSTHOG_API_HOST` |
| GitHub API | `GITHUB_TOKEN` in Actions, or `GH_TOKEN` / `GH_PAT` locally |

## Future Checks

Good next additions after the first protected admin view exists:

- Vercel production alias target compared to latest expected GitHub SHA.
- Authenticated Supabase Edge Function smokes that prove real token paths without mutating production user data.
- DNS/custom-domain status if SpeakSharp moves to a custom production domain.
- Supabase-backed storage for the latest JSON so the Vercel admin page can read it without calling GitHub artifact APIs.
