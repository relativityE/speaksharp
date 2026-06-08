# Environment Variable Inventory (Single Source of Truth)

**Owner:** [unassigned] · **Last updated:** 2026-06-08 · maps to `main@c5a2a460`

This is the **canonical catalog** of every environment variable SpeakSharp uses, **where each
one is stored**, who consumes it, and its scope. Use it to **add new vars, migrate/replicate
config, and rotate keys** — one place to update.

Related docs (each references THIS file; do not duplicate the catalog there):
- `LAUNCH_ENV_CHECKLIST.md` — verifies the *live* values at release.
- `SECRET_ROTATION_RUNBOOK.md` — how to rotate the **Secret** rows below.
- `env.required` / `env.optional` — machine-readable build gate (read by `scripts/validate-env.mjs`).
- `frontend/.env.production`, `.env.test.example`, `frontend/.env.test.example` — committed templates.

> ⚠️ This catalog lists variable **names, scopes, and homes** — never paste secret **values** here.
> Treat the live consoles (Vercel / GitHub / Supabase) as authoritative for values; reconcile this
> file against them during the launch checklist.

---

## Storage Homes (legend)

| Home | What lives here | Who sets it |
|---|---|---|
| **A. Committed `frontend/.env.production`** | client-public `VITE_*` build vars (baked into the shipped bundle) | dev (repo) |
| **B. Vercel Project Env → Production scope** | build-time overrides (e.g. live Stripe key) + platform vars (`VERCEL_GIT_COMMIT_SHA`) | product-ops (Vercel UI) |
| **C. Supabase Edge Function secrets** | all server-side secrets used by edge functions | product-ops (Supabase UI / `supabase secrets set`) |
| **D. GitHub Actions secrets** | CI/deploy credentials + the **sync source** that pushes some values into Home C | product-ops (GitHub repo settings) |
| **E. Local `.env` / `.env.test` (gitignored)** | developer/test-only values | each developer |

> **Auto-provided:** Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
> into Edge Functions automatically — they are not manually set in Home C unless overriding.

---

## 1. Client-public `VITE_*` (NOT secrets — shipped in the browser bundle)

Build gate: `env.required` (must be set) / `env.optional` (warn-only). See `validate-env.mjs`.

| Variable | Required? | Home (today) | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | **required** | A (committed) | Production Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | **required** | A (committed) | Public anon key (RLS-guarded). |
| `VITE_STRIPE_PUBLISHABLE_KEY` | optional | **B (Vercel only)** | Committed **empty** on purpose (fail-closed). Prod MUST inject `pk_live_…`; verify `window.__APP_RUNTIME_CONFIG__.stripeKeyClass === "live"`. |
| `VITE_SENTRY_DSN` | optional | A (committed) | Absent → error monitoring disabled. |
| `VITE_POSTHOG_KEY` | optional | A (committed) | Analytics; absent → disabled. |
| `VITE_POSTHOG_HOST` | optional | A (committed) | PostHog ingest host. |
| `VITE_LOG_LEVEL` | optional | A | Client log level. |
| `VITE_ENABLE_SENTRY_TRACING` | optional | A/B | Feature flag. |
| `VITE_ENABLE_SENTRY_REPLAY` | optional | A/B | Feature flag. |
| `VITE_ENABLE_SENTRY_CONSOLE_CAPTURE` | optional | A/B | Feature flag. |
| `VITE_ENABLE_FREE_PLAN_SUPPORT` | optional | A/B | Product flag. |
| `VITE_AUTH_MODE` | optional | A/B | Auth mode selector. |
| `VITE_AUTH_TIMEOUT` | optional | A/B | Auth timeout ms. |
| `VITE_ENABLE_INTERNAL_ROUTES` | **must be false/absent in prod** | B/E | Dev/internal routes gate. |

### Dev/test-only `VITE_*` — MUST be unset/false in production
`VITE_TEST_MODE`, `VITE_E2E_MODE`, `VITE_USE_MOCK_AUTH`, `VITE_ALLOW_MOCK_AUTH_IN_TESTS`,
`VITE_SKIP_MSW`, `VITE_USE_LIVE_DB`, `VITE_USE_REAL_DATABASE` — Home **E** only. If any of these
reach a production build it is a launch blocker (test/mock behavior in prod).

### Platform-provided (build time)
| Variable | Home | Notes |
|---|---|---|
| `VERCEL_GIT_COMMIT_SHA` | B (auto) | Vercel sets at build → `__BUILD_ID__` → `window.__APP_RUNTIME_CONFIG__.release`. |

---

## 2. Server-side **secrets** (Supabase Edge Functions — Home C)

Rotate per `SECRET_ROTATION_RUNBOOK.md`. **Never commit real values.**

| Variable | Home | Consumed by | Rotation owner |
|---|---|---|---|
| `SUPABASE_URL` | C (auto) | all edge fns | platform |
| `SUPABASE_ANON_KEY` | C (auto) | edge fns | platform (rolls with JWT secret) |
| `SUPABASE_SERVICE_ROLE_KEY` | C (auto) | create-user, admin paths | product-ops |
| `STRIPE_SECRET_KEY` | C (+D sync) | stripe-checkout, stripe-webhook | product-ops |
| `STRIPE_WEBHOOK_SECRET` | C (+D sync) | stripe-webhook | product-ops |
| `STRIPE_PRO_PRICE_ID` | C (+D sync) | checkout | product-ops |
| `STRIPE_BASIC_PRICE_ID` | C (+D sync) | checkout (future/placeholder) | product-ops |
| `ASSEMBLYAI_API_KEY` | C (+D sync) | assemblyai-token (Cloud STT) | product-ops |
| `GEMINI_API_KEY` | C (+D sync) | get-ai-suggestions (NOT format-transcript — that was removed) | product-ops |
| `ALLOWED_ORIGIN` | C (+D sync) | `_shared/cors.ts` (origin allowlist) | product-ops |
| `AGENT_SECRET` | C (+D sync) | agent/internal auth | product-ops |
| `OBSERVABILITY_SMOKE_SECRET` | C | observability-smoke | product-ops |
| `SENTRY_DSN` (backend) | C | edge-fn error ingest | product-ops |
| `LOG_LEVEL` (backend) | C | edge-fn log level | product-ops |

---

## 3. CI/deploy secrets (GitHub Actions — Home D)

| Variable | Home | Purpose |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | D | `supabase` CLI auth in deploy workflow |
| `SUPABASE_PROJECT_ID` | D | target project for `functions deploy` |
| (sync source) `GEMINI_API_KEY`, `AGENT_SECRET`, `ALLOWED_ORIGIN`, `STRIPE_*` | D → C | `deploy-supabase-migrations.yml` pushes these into Supabase secrets |

---

## How to add a NEW environment variable

1. **Classify:** client-public (`VITE_*`, shipped in bundle) **or** server secret. If it's a secret, it must NEVER be `VITE_*` and never committed.
2. **Pick the home** from the legend (A–E) and add a row to the right table above.
3. **Client-public:** add to `frontend/.env.production` (or Vercel if it's an override); if startup must fail without it, add to `env.required`, else `env.optional`.
4. **Server secret:** add to Supabase Edge Function secrets (Home C); if CI must inject it, add to GitHub secrets (Home D) + the `deploy-supabase-migrations.yml` sync step.
5. **Verification:** add a check line to `LAUNCH_ENV_CHECKLIST.md`. If it's a rotatable secret, add it to `SECRET_ROTATION_RUNBOOK.md`.
6. Update **this file** (it is the source of truth) — keep names only, no values.

## Open decisions affecting this inventory
- **ENV-PROD:** whether to migrate the Home-A committed `VITE_*` (public) into Home B (Vercel), to match the Stripe-key pattern. This table is the migration checklist if so.
- **ORT-WASM-SAME-ORIGIN:** unrelated to env, but tracked in `BACKLOG.md` re-assessment addendum.
