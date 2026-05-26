# Ops Health Dashboard

SpeakSharp uses a single high-level ops health workflow so release checks do not require logging into every vendor dashboard first.

## Implementation Status

V1 is the GitHub artifact and workflow summary. The protected Vercel admin page is the intended product-facing operator view, but it is not implemented yet. The data-path architecture lives in `ARCHITECTURE.operational.md`.

## What It Answers

The dashboard answers: "Are the main software/API interfaces we rely on reachable and credentialed right now?"

It is intentionally not a replacement for vendor dashboards. It is an early signal board with drill-down links.

## Current V1 Rows

| Tool | Signal | Drill-down |
|---|---|---|
| SpeakSharp app | Production URL returns HTTP success | Vercel/app URL |
| Vercel API | Latest production deployment if Vercel credentials are configured | Vercel dashboard |
| Supabase API | Auth, REST, and one Edge Function entrypoint | Supabase dashboard |
| AssemblyAI API | Cloud STT provider credential reachability | AssemblyAI dashboard |
| Gemini API | AI suggestions provider credential reachability | Google AI Studio |
| Stripe API | Billing credential and price reachability | Stripe dashboard |
| Sentry API | Error monitoring project query reachability | Sentry |
| PostHog API | Analytics query reachability | PostHog |
| GitHub API | Repository metadata and release workflow rollup | GitHub Actions |

Detailed lower-level checks, such as frontend env contract, Private model assets, Private worker assets, release evidence freshness, SAST/DAST/SCA, canary, and benchmark proof freshness, belong in the JSON/admin drill-down or release docs, not in the simple v1 health table.

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
| Vercel API | `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, optional `VERCEL_TEAM_ID` |
| Supabase API | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| AssemblyAI API | `ASSEMBLYAI_API_KEY` |
| Gemini API | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| Stripe API | `STRIPE_SECRET_KEY`, `STRIPE_BASIC_PRICE_ID`, `STRIPE_PRO_PRICE_ID` |
| Sentry API | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, optional `SENTRY_API_BASE` |
| PostHog API | `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, optional `POSTHOG_API_HOST` |
| GitHub API | `GITHUB_TOKEN` in Actions, or `GH_TOKEN` / `GH_PAT` locally |

## Future Checks

Good next additions after the first protected admin view exists:

- Vercel production alias target compared to latest expected GitHub SHA.
- Authenticated Supabase Edge Function smokes that prove real token paths without mutating production user data.
- DNS/custom-domain status if SpeakSharp moves to a custom production domain.
- Supabase-backed storage for the latest JSON so the Vercel admin page can read it without calling GitHub artifact APIs.
