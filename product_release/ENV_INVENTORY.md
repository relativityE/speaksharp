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
| **A. Local root `.env*` (gitignored)** | client-public `VITE_*` for **local dev/test** — this is Vite's `envDir` (repo root) | each developer |
| **B. Vercel Project Env → Production scope** | the **real production** `VITE_*` (incl. live Stripe key) + platform vars (`VERCEL_GIT_COMMIT_SHA`) | product-ops (Vercel UI) |
| **C. Supabase Edge Function secrets** | all server-side secrets used by edge functions | product-ops (Supabase UI / `supabase secrets set`) |
| **D. GitHub Actions secrets** | CI/deploy credentials + the **sync source** that pushes some values into Home C | product-ops (GitHub repo settings) |
| **E. Committed templates** | `*.env*.example` + `frontend/.env.production` (documentation ONLY — see Loading Model) | dev (repo) |

> **⚠️ LOADING MODEL (critical):** `frontend/vite.config.mjs` sets `envDir = repo root`, and there is
> **no root `.env.production`**. So at build/dev time Vite loads `.env*` from the **repo ROOT** (Home A)
> plus actual `process.env` `VITE_*` (Home B on Vercel). **`frontend/.env.production` is NOT loaded by
> the build** — it ships the Stripe key empty as fail-closed *documentation*, but the real fail-closed
> behavior comes from the key simply being absent in `process.env`. Treat it as a template, not config.
> `scripts/validate-env.mjs` reads root `.env` + root `.env.test`.

> **Auto-provided:** Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
> into Edge Functions automatically — they are not manually set in Home C unless overriding.

## `.env.*` file map + minimum set

| File | Tracked? | Loaded by | Verdict |
|---|---|---|---|
| root `.env` | gitignored | Vite (dev) + validate-env | local dev — keep (per-dev) |
| root `.env.test` | gitignored | Vite (test) + validate-env | local test — keep (per-dev) |
| root `.env.local` | gitignored | Vite | local override — keep (per-dev) |
| root `.env.test.example` | **tracked** | template only | **KEEP** — the one canonical template |
| `frontend/.env.production` | **tracked** | **nothing** (outside `envDir`) | not-loaded doc → remove or keep purely as a labeled template (product decided "keep"; see Decisions) |
| `frontend/.env.test` | gitignored | **nothing** (outside `envDir`) | leftover; local-only, harmless |
| `frontend/.env.test.example` | **tracked** | template for a not-loaded file | **redundant** with root `.env.test.example` → remove candidate |
| `frontend/.env.development` | ~~tracked symlink~~ | — | **REMOVED** (was a tracked symlink → gitignored target; dangled on clone) |

**Minimum tracked set (target):** root `.env.test.example` only (+ `frontend/.env.production` if kept as a labeled doc template). `frontend/.env.test.example` and the `frontend/.env.development` symlink are removable.

## Decisions log
- **ORT-WASM-SAME-ORIGIN = NO** (2026-06-08). Claim boundary stays **"no Hugging Face model weights"** (model weights local; ONNX runtime WASM from jsDelivr CDN is acceptable). Not wiring same-origin WASM.
- **ENV-PROD = KEEP committed `frontend/.env.production`** (2026-06-08) — but note it is **not build-loaded** (see Loading Model); it functions as documentation. Re-confirm whether to keep it as a labeled template or remove it (real prod config = Home B + this inventory).
- **`.env.development` symlink removed** (2026-06-08) as dead/broken-on-clone.

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

## 3. GitHub Actions env (Home D) — Secrets vs Variables

**40** names are referenced as `secrets.*` across `.github/workflows`; **nothing uses `vars.*` yet.**
Many are **non-secret config over-classified as Secrets** — they should be GitHub Actions
**Variables** (plaintext, still env-injected) so the true-secret surface is small + auditable.

> **✅ Live-verified 2026-06-08 (`gh`, read-only, no values):** **36 repo Secrets, 0 Variables, no
> env-scoped secrets** (Preview/Production/production-db envs empty). Reconciliation vs workflow refs:
> `SUPABASE_DB_PASSWORD` is set but was uncatalogued → added to 3a. 5 workflow-referenced names are
> NOT set in GitHub (`VERCEL_ORG_ID`, `VERCEL_TEAM_ID`, `VITE_STRIPE_PUBLISHABLE_KEY` [Vercel-side],
> `FREE_TEST_EMAIL`, `FREE_TEST_PASSWORD`) → dead refs or Vercel-only; owner to confirm.

> **Safe migration order (CI never breaks):** product-ops (owner/human) creates the Variable (copy
> value) → dev flips the workflow ref `secrets.X` → `vars.X` → owner deletes the old Secret.
> Agents do NOT mutate the secret store; dev only edits the `.yml` refs.

### 3a. Genuine SECRETS — keep as GitHub Secrets (~18)
| Variable | Why secret |
|---|---|
| `STRIPE_SECRET_KEY` | live API secret |
| `STRIPE_WEBHOOK_SECRET` | webhook signing secret |
| `SUPABASE_SERVICE_ROLE_KEY` | full DB / RLS bypass |
| `SUPABASE_ACCESS_TOKEN` | Supabase management / CLI |
| `SUPABASE_DB_PASSWORD` | Postgres DB password (migrations / `db push`) |
| `ASSEMBLYAI_API_KEY` | paid API key |
| `GEMINI_API_KEY` | paid API key (get-ai-suggestions) |
| `SENTRY_AUTH_TOKEN` | release-upload token |
| `POSTHOG_PERSONAL_API_KEY` | account-level personal API key |
| `AGENT_SECRET` | internal auth |
| `OBSERVABILITY_SMOKE_SECRET` | smoke auth |
| `PROMO_GEN_ADMIN_SECRET` | admin promo auth |
| `GH_PAT` | GitHub PAT |
| `VERCEL_ACCESS_TOKEN` | Vercel deploy token |
| `FREE_TEST_PASSWORD` · `PRO_TEST_PASSWORD` · `BASIC_TEST_PASSWORD` · `CANARY_PASSWORD` · `SOAK_TEST_PASSWORD` | real test-account credentials |

### 3b. Over-classified → should be GitHub **Variables** (non-secret config)
| Variable | Why it is NOT a secret |
|---|---|
| `SUPABASE_URL` | public project URL (also shipped as `VITE_SUPABASE_URL`) |
| `SUPABASE_ANON_KEY` | client-public anon key (shipped in bundle; RLS-guarded) |
| `SUPABASE_PROJECT_ID` | public project ref |
| `STRIPE_PUBLISHABLE_KEY` · `VITE_STRIPE_PUBLISHABLE_KEY` | publishable key is public by design |
| `STRIPE_PRO_PRICE_ID` · `STRIPE_BASIC_PRICE_ID` | public price identifiers |
| `SENTRY_DSN` | client-public DSN (shipped in bundle) |
| `SENTRY_API_BASE` · `SENTRY_ORG` · `SENTRY_PROJECT` | non-secret config / slugs |
| `POSTHOG_PROJECT_API_KEY` | public ingest key (shipped in client) |
| `POSTHOG_PROJECT_ID` · `POSTHOG_API_HOST` · `POSTHOG_INGEST_HOST` | public id / hosts |
| `EDGE_FN_URL` | public function base URL |
| `VERCEL_ORG_ID` · `VERCEL_PROJECT_ID` · `VERCEL_TEAM_ID` | non-secret platform IDs |
| `FREE_TEST_EMAIL` · `PRO_TEST_EMAIL` · `BASIC_TEST_EMAIL` | test-account emails (passwords stay in 3a). Product-ops may keep these secret to reduce account enumeration — their call. |

> ⚠️ **product-ops: verify against the live GitHub console** — add any Secret/Variable the
> workflows don't reference, and confirm each 3b row before moving it.

## 4. Vercel Project Env (Home B)

The **real production** values for the §1 `VITE_*` live here (Production scope) + platform vars.

> **✅ Live-verified 2026-06-08 (`vercel env ls`, names only):** 7 env vars (project `speaksharp/speaksharp`,
> all "Encrypted" at rest in Vercel). 6 are the public `VITE_*`; **`OPS_STATUS_PASSWORD` is a real
> secret here (Vercel-only, gates the Ops status page) — was uncatalogued; added below.**

| Variable | Targets | Nature |
|---|---|---|
| `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` | Prod/Preview/Dev | public |
| `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_live_…`) | Prod/Preview/Dev | public — the one prod-critical injection |
| `VITE_SENTRY_DSN` · `VITE_POSTHOG_KEY` · `VITE_POSTHOG_HOST` | Prod/Preview/Dev | public |
| `OPS_STATUS_PASSWORD` | Prod/Preview | **SECRET** (Ops status page gate) |
| `VERCEL_GIT_COMMIT_SHA` | (auto) | platform-provided at build |

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
