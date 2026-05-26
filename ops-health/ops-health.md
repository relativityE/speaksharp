# SpeakSharp Ops Health

Generated: 2026-05-26T22:25:40.957Z
Target: https://speaksharp-public.vercel.app
Repository: relativityE/speaksharp
Run context: local shell

Verdict: NO HARD FAILURES IN CHECKS THAT RAN
Coverage: 1 ok / 0 review / 0 fail / 8 not checked

> This local run is not authoritative for vendor credentials because GitHub Actions secrets are not available in the local shell. Use the GitHub Ops Health workflow for the secret-backed view.

| Area | Status | Meaning | Evidence | Next Action | Drill-down |
|---|---|---|---|---|---|
App | 🟢 OK | Can users reach SpeakSharp? | Production app HTTP 200 | No action. | [Open](https://speaksharp-public.vercel.app)
Vercel API | 🚧 NOT READY | Can we read the latest production deployment? | missing=VERCEL_TOKEN | Run the GitHub Ops Health workflow for the secret-backed result. | 
Supabase API | 🚧 NOT READY | Can clients reach Auth, REST, and Edge Functions? | missing=SUPABASE_URL\|VITE_SUPABASE_URL | Run the GitHub Ops Health workflow for the secret-backed result. | 
AssemblyAI API | 🚧 NOT READY | Can Cloud STT provider credentials reach AssemblyAI? | missing=ASSEMBLYAI_API_KEY | Run the GitHub Ops Health workflow for the secret-backed result. | 
Gemini API | 🚧 NOT READY | Can AI suggestions provider credentials reach Gemini? | missing=GEMINI_API_KEY\|GOOGLE_API_KEY | Run the GitHub Ops Health workflow for the secret-backed result. | 
Stripe API | 🚧 NOT READY | Can billing credentials reach Stripe and read product prices? | missing=STRIPE_SECRET_KEY | Run the GitHub Ops Health workflow for the secret-backed result. | 
Sentry API | 🚧 NOT READY | Can we query Sentry project health? | missing=SENTRY_ORG | Run the GitHub Ops Health workflow for the secret-backed result. | 
PostHog API | 🚧 NOT READY | Can we query PostHog analytics? | missing=POSTHOG_PROJECT_ID | Run the GitHub Ops Health workflow for the secret-backed result. | 
GitHub API | 🚧 NOT READY | Can we query repository metadata and release workflows? | missing=GITHUB_TOKEN\|GH_TOKEN\|GH_PAT | Run the GitHub Ops Health workflow for the secret-backed result. | 

## How To Read This

- `OK` means the check ran and passed.
- `REVIEW` means no hard outage was proven, but freshness, optional credentials, or external status needs attention.
- `FAIL` means a launch-relevant dependency or workflow is red.
- `NOT READY` means the check could not produce a useful signal yet, usually because this run lacks credentials or the integration is intentionally deferred.

> Keep this dashboard simple. It is an early warning board, not a replacement for vendor dashboards.
