# Ops Health Dashboard

SpeakSharp uses a single high-level ops health workflow so release checks do not require logging into every vendor dashboard first.

## Implementation Status

The protected operator webpage is **implemented**: the in-app route `/admin/ops-status` (`frontend/src/pages/OpsStatusPage.tsx`), gated at the edge by Vercel middleware HTTP Basic auth (`middleware.js`, env `OPS_STATUS_PASSWORD` + optional `OPS_STATUS_USERNAME`, default user `admin`). It renders from the Supabase **public** bucket object `ops-health/ops-health.summary.json` (with same-origin fallbacks), which the `ops-health.yml` workflow generates and publishes (via `scripts/publish-ops-health-summary.mjs`) on its daily schedule plus manual `workflow_dispatch`. The GitHub workflow summary and the `ops-health-dashboard` artifact remain the machine record. The data-path architecture lives in `ARCHITECTURE.operational.md`.

### Production access model (how to reach the page)

**Intended model:** `/admin/ops-status` is protected in production by **one** gate — HTTP Basic auth at the Vercel edge (`middleware.js`, `OPS_STATUS_PASSWORD`, default user `admin`). Enter the password in the browser's Basic-auth prompt; that is all that should be required.

**Current-code caveat (fixed by PR #962):** in the shipped build the route was **also** wrapped in the app's `InternalRoute` guard (`frontend/src/App.tsx`), which renders the app's "Page not found" unless `VITE_ENABLE_INTERNAL_ROUTES === 'true'` is set at **build** time. Because that flag is off in a production build, `/admin/ops-status` returned "Page not found" **even with the correct password**. ⚠️ **Do NOT enable `VITE_ENABLE_INTERNAL_ROUTES` in production to work around this** — that flag also unlocks `/design` (the design-system page), which the edge middleware does **not** cover, so `/design` would become **publicly reachable**.

**Fix:** [PR #962](https://github.com/relativityE/speaksharp/pull/962) decouples `/admin/ops-status` from `InternalRoute` so the edge Basic-auth middleware is its **sole** production gate (middleware matcher unchanged); `/design` stays behind `InternalRoute`. After that PR ships, the page is reachable in production with the password and **without** enabling internal routes.

**Rotating `OPS_STATUS_PASSWORD`:** the value is bound into the Edge Middleware at **deploy** time — update it in Vercel (Prod + Preview) **and redeploy**; the old password keeps working until the next deployment. No code/CI change is needed (nothing else consumes it).

**No-password alternative:** the identical data is in the `ops-health.yml` GitHub run summary + the `ops-health-dashboard` artifact — no Basic-auth password and no Vercel flag required.

## What It Answers

The dashboard answers: "Are the main software/API interfaces we rely on reachable and credentialed right now?"

It is intentionally not a replacement for vendor dashboards. It is an early signal board with drill-down links.

## Pre-Invite Release Gating (Beta-50)

Before any controlled-beta invites go out, run this Ops Health pull as a **full-stack** check — all nine rows (SpeakSharp app, Vercel, Supabase, AssemblyAI, Gemini, Stripe, Sentry, PostHog, GitHub), not a single vendor.

- **Sentry alone is insufficient.** Sentry reports client/edge *crashes* that were actually thrown; it does not prove the release gates are green, the STT/AI/billing providers are reachable and credentialed, or that the app deployment matches the intended SHA. A clean Sentry board with a red GitHub/rc-gates row is still NO-GO.
- **Any 🔴 FAIL or ⚠️ REVIEW must be explicitly classified before invites release** as one of: resolved (with evidence), superseded by current Beta-50 scope, waived by owner decision, or still-blocking. Do not send invites while an unclassified red/review row stands.
- The `GitHub API` row rolls up the release workflows, so a red rc-gates run (e.g. the current Gate 3 / DAST opening-fidelity failure) surfaces here as a GitHub 🔴 — that is the release-blocking signal, distinct from the vendor-reachability rows. `⚠️ REVIEW` on `Stripe API` for `basic=404` is the reserved/not-launched Basic price (non-blocking), not a failure. Current run-level verdicts and their classifications live in `RELEASE_STATUS.md`, not here.

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

The workflow runs once daily (scheduled) plus manual `workflow_dispatch`. It uploads the `ops-health/` directory (JSON + Markdown) as the `ops-health-dashboard` artifact, appends `ops-health.md` to the GitHub run summary, and publishes `ops-health.summary.json` to the Supabase public `ops-health` bucket so the `/admin/ops-status` page can read the latest summary without calling GitHub artifact APIs. Keep the cadence low before product release to avoid unnecessary vendor API traffic; use manual dispatch for active investigations.

## Work In Progress Checks

Some rows may show `🚧 NOT READY` until the corresponding secret is added to GitHub Actions. That is intentional: not-ready rows are inventory debt, not hidden success.

| Check | Required env/secret |
|---|---|
| Vercel API | `VERCEL_ACCESS_TOKEN`, `VERCEL_PROJECT_ID`; `VERCEL_TEAM_ID` only if Vercel requires team scoping for this token |
| Supabase API | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| AssemblyAI API | `ASSEMBLYAI_API_KEY` |
| Gemini API | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| Stripe API | `STRIPE_SECRET_KEY`, `STRIPE_BASIC_PRICE_ID`, `STRIPE_PRO_PRICE_ID` |
| Sentry API | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, optional `SENTRY_API_BASE` |
| PostHog API | `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, optional `POSTHOG_API_HOST` |
| GitHub API | `GITHUB_TOKEN` in Actions, or `GH_TOKEN` / `GH_PAT` locally |

## Future Checks

The protected admin view (`/admin/ops-status`) and Supabase-backed summary storage are now implemented. Good next additions:

- Vercel production alias target compared to latest expected GitHub SHA.
- Authenticated Supabase Edge Function smokes that prove real token paths without mutating production user data.
- DNS/custom-domain status if SpeakSharp moves to a custom production domain.
