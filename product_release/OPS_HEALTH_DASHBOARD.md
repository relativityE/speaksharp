# Ops Health Dashboard

SpeakSharp uses a single high-level ops health workflow so release checks do not require logging into every vendor dashboard first.

## What It Answers

The dashboard answers: "Are the tools we rely on reachable and credentialed right now?"

It is intentionally not a replacement for vendor dashboards. It is an early signal board with drill-down links.

## Current Dashboard Rows

| Tool | Signal | Drill-down |
|---|---|---|
| SpeakSharp app | Production URL returns HTTP success | Vercel/app URL |
| Vercel | Platform status and latest production deployment if Vercel credentials are configured | Vercel dashboard/status |
| Supabase | Auth, one Edge Function entrypoint, and Supabase platform status | Supabase dashboard/status |
| STT/AI Providers | AssemblyAI and Gemini API reachability | AssemblyAI / Google AI Studio |
| Billing | Stripe API and webhook secret shape | Stripe dashboard |
| Observability | Sentry and PostHog query access | Sentry / PostHog |
| GitHub | Latest release-critical workflow rollup | GitHub Actions |
| Benchmarks | Cloud, Private v2, and Private v4 benchmark freshness | Benchmark workflow |

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

The workflow runs every 30 minutes and uploads `ops-health/ops-health.json` plus `ops-health/ops-health.md` as artifacts.

## Work In Progress Checks

Some rows may show `SKIP` or `WARN` until the corresponding secret is added to GitHub Actions. That is intentional: skipped rows are inventory debt, not hidden success.

| Check | Required env/secret |
|---|---|
| Vercel deployment health | `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, optional `VERCEL_TEAM_ID` |
| Gemini API health | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| STT benchmark freshness | Fresh `tests/STT_BENCHMARKS.json` history for Cloud, Private v2, and Private v4 |

## Future Checks

Good next additions after the first protected admin view exists:

- Vercel production alias target compared to latest expected GitHub SHA.
- Authenticated Supabase Edge Function smokes that prove real token paths without mutating production user data.
- DNS/custom-domain status if SpeakSharp moves to a custom production domain.
