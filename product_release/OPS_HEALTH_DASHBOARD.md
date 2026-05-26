# Ops Health Dashboard

SpeakSharp uses a single high-level ops health workflow so release checks do not require logging into every vendor dashboard first.

## What It Answers

The dashboard answers: "Are the tools we rely on reachable and credentialed right now?"

It is intentionally not a replacement for vendor dashboards. It is an early signal board with drill-down links.

## Current Checks

| Tool | Signal | Drill-down |
|---|---|---|
| SpeakSharp app | Production URL returns HTTP success | Vercel/app URL |
| Supabase | Auth REST endpoint accepts anon-key access | Supabase dashboard |
| AssemblyAI | API key can read transcript API | AssemblyAI dashboard |
| Stripe | API key can read account balance and webhook secret is configured | Stripe dashboard |
| GitHub | Latest RC gate workflow status is readable | GitHub Actions |
| Sentry | Project API is reachable | Sentry project |
| PostHog | Project API is reachable | PostHog project |

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

## Future Checks

Good next additions:

- Vercel deployment alias and latest production commit.
- Supabase Edge Function smoke for `assemblyai-token`, `stripe-checkout`, and `check-usage-limit`.
- Sentry issue count in the last hour.
- PostHog event ingestion freshness.
- Latest STT benchmark artifact freshness.
