# Environment Variable Inventory (Single Source of Truth)

**Owner:** relativityE · **Last updated:** 2026-07-20 · reconciled to private-first `main` (billing fail-closed, exact-origin CORS deployed, Private v4 disabled)

This is the **canonical catalog** of every environment variable SpeakSharp uses, **where each
one is stored**, who consumes it, and its scope. Use it to **add new vars, migrate/replicate
config, and rotate keys** — one place to update.

Related docs (each references THIS file; do not duplicate the catalog there):
- `LAUNCH_ENV_CHECKLIST.md` — verifies the *live* values at release.
- `SECRET_ROTATION_RUNBOOK.md` — how to rotate the **Secret** rows below.
- `env.required` / `env.optional` — machine-readable build gate (read by `scripts/validate-env.mjs`).
- `.env.test.example` (root) — the one committed env template.

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
| **E. Committed templates** | root `.env.test.example` only | dev (repo) |

> **⚠️ LOADING MODEL (critical):** `frontend/vite.config.mjs` sets `envDir = repo root`, and there is
> **no root `.env.production`**. So at build/dev time Vite loads `.env*` from the **repo ROOT** (Home A)
> plus actual `process.env` `VITE_*` (Home B on Vercel).
> **Production billing closure does NOT depend on the Stripe key being absent** — Vercel may inject a live publishable key, yet checkout stays closed unless `VITE_PAYMENTS_ENABLED=true` (frontend) AND `PAYMENTS_ENABLED=true` (Supabase); either switch unset/false keeps checkout closed.
> (The old `frontend/.env.production` was outside `envDir`, never build-loaded, and has been **removed** — do not re-add it.)
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
| ~~`frontend/.env.production`~~ | **REMOVED** | — | **REMOVED** on `main@c010434d` (was outside `envDir`, never build-loaded; real prod config = Home B + this inventory) |
| `frontend/.env.test` | gitignored | **nothing** (outside `envDir`) | leftover; local-only, harmless |
| ~~`frontend/.env.test.example`~~ | **REMOVED** | — | **REMOVED** on `main@c010434d` (was redundant with root `.env.test.example`) |
| `frontend/.env.development` | ~~tracked symlink~~ | — | **REMOVED** (was a tracked symlink → gitignored target; dangled on clone) |

**Minimum tracked set (in effect):** root `.env.test.example` only. `frontend/.env.production`, `frontend/.env.test.example`, and the `frontend/.env.development` symlink have all been removed.

## Decisions log
- **ORT-WASM-SAME-ORIGIN = NO** (2026-06-08). Claim boundary stays **"no Hugging Face model weights"** (model weights local; ONNX runtime WASM from jsDelivr CDN is acceptable). Not wiring same-origin WASM.
- **ENV-PROD = REMOVE `frontend/.env.production`** (2026-06-08, supersedes the earlier "keep") — outside Vite `envDir`, never build-loaded, documentation-only. Removed on `main@c010434d`. Real prod client config = Home B (Vercel) + this inventory. Do not re-add.
- **`.env.development` symlink removed** (2026-06-08) as dead/broken-on-clone.

---

## 1. Client-public `VITE_*` (NOT secrets — shipped in the browser bundle)

Build gate: `env.required` (must be set) / `env.optional` (warn-only). See `validate-env.mjs`.

| Variable | Required? | Home (today) | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | **required** | A (committed) | Production Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | **required** | A (committed) | Public anon key (RLS-guarded). |
| `VITE_STRIPE_PUBLISHABLE_KEY` | optional | **B (Vercel only)** | Committed **empty** on purpose (fail-closed). Prod MUST inject `pk_live_…`; verify `window.__APP_RUNTIME_CONFIG__.stripeKeyClass === "live"`. **Not sufficient alone** — also requires `VITE_PAYMENTS_ENABLED=true` (see below). |
| `VITE_PAYMENTS_ENABLED` | optional | **B (Vercel only)** | **Explicit frontend payments kill-switch (P0.1). Default OFF.** `arePaymentsEnabled()` is true ONLY when this === `"true"` AND the publishable key is `pk_live_`. Beta = unset/false → checkout & Upgrade UI hidden even with a live key present. Mirrors backend `PAYMENTS_ENABLED`; **both** must be deliberately enabled to sell Pro. |
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
| `VITE_STT_PRIVATE_PRIMARY_DISABLED` | optional | **B (Vercel only)** | #1120 S1 build-time HARD kill switch for the Private-primary STT hierarchy. `=== "true"` forces the hierarchy OFF (today's Browser-default behavior) regardless of the PostHog flag `stt_private_primary_v1`. Consumer: `frontend/src/config/sttHierarchyFlags.ts` (`isPrivatePrimaryEnabled`). Default unset → PostHog flag governs. |
| `VITE_CLOUD_STT_DISABLED` | optional | **B (Vercel only)** | #1120 S1 build-time HARD kill switch for Cloud STT. `=== "true"` forces Cloud OFF regardless of the PostHog flag `cloud_stt_enabled`. Consumer: `sttHierarchyFlags.ts` (`isCloudSttEnabled`). Cloud is fail-closed: unset/absent flag → Cloud denied. |

### Dev/test-only `VITE_*` — MUST be unset/false in production
`VITE_TEST_MODE`, `VITE_E2E_MODE`, `VITE_USE_MOCK_AUTH`, `VITE_ALLOW_MOCK_AUTH_IN_TESTS`,
`VITE_SKIP_MSW`, `VITE_USE_LIVE_DB`, `VITE_USE_REAL_DATABASE` — Home **E** only. If any of these
reach a production build it is a launch blocker (test/mock behavior in prod).

### Platform-provided (build time)
| Variable | Home | Notes |
|---|---|---|
| `VERCEL_GIT_COMMIT_SHA` | B (auto) | Vercel sets at build → injected into `index.html` as inline `window.__APP_RELEASE__` → `window.__APP_RUNTIME_CONFIG__.release` + PostHog `release_sha`. (PR #1027: NOT a `__BUILD_ID__` JS define — removed so the volatile SHA never rotates chunk hashes. Sentry release injection also disabled; Sentry release set at runtime from `window.__APP_RELEASE__`.) |

---

## 2. Server-side **secrets** (Supabase Edge Functions — Home C)

Rotate per `SECRET_ROTATION_RUNBOOK.md`. **Never commit real values.**

| Variable | Home | Consumed by | Rotation owner |
|---|---|---|---|
| `SUPABASE_URL` | C (auto) | all edge fns | platform |
| `SUPABASE_ANON_KEY` | C (auto) | edge fns | platform (rolls with JWT secret) |
| `SUPABASE_SERVICE_ROLE_KEY` | C (auto) | create-user, admin paths | product-ops |
| `PAYMENTS_ENABLED` | Supabase Edge secret | stripe-checkout | **Explicit backend payments kill-switch (P0.1). Default OFF.** `stripe-checkout` returns `403 payments_disabled` (before any Stripe call) unless this === `"true"` AND `STRIPE_SECRET_KEY` is `sk_live_`. Mirrors frontend `VITE_PAYMENTS_ENABLED`; **both** frontend and backend must be deliberately enabled to sell Pro. **Checkout is closed by the switch being OFF — NOT by the Stripe key being absent:** live Stripe keys may be present in Supabase while both `VITE_PAYMENTS_ENABLED` and `PAYMENTS_ENABLED` stay OFF, keeping checkout closed. |
| `STRIPE_SECRET_KEY` | C — **Ops-managed in Supabase; NOT synced from GitHub** | stripe-checkout, stripe-webhook | product-ops |
| `STRIPE_WEBHOOK_SECRET` | C — **Ops-managed in Supabase; NOT synced from GitHub** | stripe-webhook | product-ops |
| `STRIPE_PRO_PRICE_ID` | C — **Ops-managed in Supabase; NOT synced from GitHub** | checkout | product-ops |
| `STRIPE_BASIC_PRICE_ID` | C — **Ops-managed in Supabase; NOT synced from GitHub** | checkout (future/placeholder) | product-ops |
| `ASSEMBLYAI_API_KEY` | C — **Ops-managed in Supabase; NOT synced from GitHub** | assemblyai-token (Cloud STT) | product-ops |
| `CLOUD_STT_ENABLED` | Supabase Edge secret | **#1120 S1 backend Cloud kill-switch (fail-closed). Default OFF.** `assemblyai-token` returns `503` (before any JWT auth, Supabase access, or AssemblyAI token/provider call) unless this === `"true"`. Independent of the client PostHog flag `cloud_stt_enabled`; a stale/direct client cannot mint a paid provider token while Cloud is globally off. Launch invariant: Cloud stays default-disabled unless separately authorized. | product-ops |
| `GEMINI_API_KEY` | C (+D sync) | get-ai-suggestions (NOT format-transcript — that was removed) | product-ops |
| `ALLOWED_ORIGIN` | C (+D sync) | `_shared/cors.ts` (`getAllowedOrigins`/`parseConfiguredOrigins`) | product-ops. **APPENDS extra exact origins only.** `cors.ts` ships a frozen `BUILTIN_ALLOWED_ORIGINS` exact allowlist (`https://speaksharp-public.vercel.app`, `https://speaksharp.ai`, `https://www.speaksharp.ai`, plus `http://localhost:5173/5174` + `http://127.0.0.1:5173/5174`); `ALLOWED_ORIGIN` adds comma-separated **exact** origins (e.g. explicit preview hosts). Every entry is parsed to canonical `URL.origin` — no wildcard/suffix/substring; malformed entries are logged and ignored. Fail-closed: a disallowed origin gets a 403 with NO `Access-Control-Allow-Origin`. |
| `AGENT_SECRET` | C (+D sync) | agent/internal auth | product-ops |
| `OBSERVABILITY_SMOKE_SECRET` | C | observability-smoke | product-ops |
| `SENTRY_DSN` (backend) | C | edge-fn error ingest | product-ops |
| `LOG_LEVEL` (backend) | C | edge-fn log level | product-ops |

> **GitHub→Supabase secret sync (`deploy-supabase-migrations.yml`, `operation=secrets`) sets ONLY `AGENT_SECRET`, `ALLOWED_ORIGIN`, and `GEMINI_API_KEY`.** All other Home-C runtime secrets — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_BASIC_PRICE_ID`, `ASSEMBLYAI_API_KEY`, `SITE_URL` — are **Ops-managed directly in Supabase and are NOT synced from GitHub** (the sync intentionally excludes them so a CI/test value can never overwrite the live production runtime). `ALLOWED_ORIGIN` reflects #1010's deployed, live-DAST-proven exact-origin allowlist (legacy `speaksharp.vercel.app` removed).

---

## 3. GitHub Actions env (Home D) — Secrets vs Variables

Names are referenced as `secrets.*` across `.github/workflows`; a **small number of GitHub `vars.*` are also referenced** (e.g. `vars.SUPABASE_PROJECT_ID`, `vars.SUPABASE_URL`, `vars.EDGE_FN_URL`) — reconcile any count against the current workflows rather than assuming "none." Many `secrets.*` are **non-secret config over-classified as Secrets** — they should be GitHub Actions
**Variables** (plaintext, still env-injected) so the true-secret surface is small + auditable.

> **HISTORICAL SNAPSHOT — 2026-06-08 (`gh`, read-only, no values); re-verify before trusting counts.** The "0 Variables" count is stale: workflows now reference GitHub `vars.*` (e.g. `vars.SUPABASE_PROJECT_ID`), so at least some Variables are defined. At the time: **36 repo Secrets, 0 Variables, no
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
| `VERCEL_PROJECT_ID` | non-secret platform ID (`VERCEL_ORG_ID`/`VERCEL_TEAM_ID` are referenced by workflows but NOT set as GitHub secrets) |
| `BASIC_TEST_EMAIL` · `PRO_TEST_EMAIL` | test-account emails — **DECIDED 2026-06-08: move to Variables** (the matching passwords stay Secrets in 3a). |

> **✅ FINAL (live-verified, 2026-06-08): 18 → Variable / 18 keep Secret = 36 total.** The 18-move set
> is exactly what `scripts/ops/reclassify-github-env.sh` creates. Same-name `secrets.X → vars.X` is
> allowed (probe-verified — secret + variable can coexist), so no rename. (`FREE_TEST_EMAIL`/
> `FREE_TEST_PASSWORD` are not set as GitHub secrets → out of scope.)

#### Migration status — 2026-06-08
**8 Variables CREATED** (values public/derivable; same-named Secrets still present + still used by CI —
this is the safe intermediate state, nothing flipped yet):
`SUPABASE_URL` · `SUPABASE_PROJECT_ID` · `EDGE_FN_URL` · `SENTRY_DSN` · `POSTHOG_PROJECT_API_KEY` ·
`POSTHOG_INGEST_HOST` · `POSTHOG_API_HOST` · `VERCEL_PROJECT_ID`

- **`SUPABASE_ANON_KEY` — owner decision: KEEP as a Secret** (despite being client-public). Removed from the move set.
- **Still pending owner values (9):** `STRIPE_PUBLISHABLE_KEY` (local is `pk_test_`; prod needs `pk_live_`),
  `STRIPE_PRO_PRICE_ID` (local is test-mode), `STRIPE_BASIC_PRICE_ID`, `SENTRY_API_BASE` (region unconfirmed),
  `SENTRY_ORG`, `SENTRY_PROJECT`, `POSTHOG_PROJECT_ID`, `BASIC_TEST_EMAIL`, `PRO_TEST_EMAIL`.
- **Cutover progress:**
  1. ✅ **DONE** — flipped `secrets.X → vars.X` for the 8 (52 refs across 11 files; merged to `main@c010434d`). Workflows now read the Variables; the old Secrets are unused for these names.
  2. ✅ **DONE** — post-merge verification green: `CI - Test Audit` run `27153261348`, `Production Canary` run `27153261334`, and `Deploy Supabase` run `27153261357`.
  3. ⏳ **Owner** — deletion is now safe but optional: delete ONLY the 8 duplicated old Secrets above, at owner convenience. Do not delete `SUPABASE_ANON_KEY` or any unmoved/true secret.

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
3. **Client-public:** add to root `.env*` for local dev, and to **Vercel Project Env (Home B)** for production; if startup must fail without it, add to `env.required`, else `env.optional`. (Do not create `frontend/.env.production` — it is not build-loaded.)
4. **Server secret:** add to Supabase Edge Function secrets (Home C); if CI must inject it, add to GitHub secrets (Home D) + the `deploy-supabase-migrations.yml` sync step.
5. **Verification:** add a check line to `LAUNCH_ENV_CHECKLIST.md`. If it's a rotatable secret, add it to `SECRET_ROTATION_RUNBOOK.md`.
6. Update **this file** (it is the source of truth) — keep names only, no values.

## Feature-flag & runtime vars — code-verified sync (2026-07-15)

Verified by reading the source on the current `main` baseline (names/homes only; no values). This is a point-in-time code-verified snapshot — re-verify against `main` when env usage changes rather than trusting a pinned SHA.

| Variable | Home | Where read (code) | Default / effect |
|---|---|---|---|
| `VITE_NATIVE_PUNCTUATION_RESTORE` | A/B (`VITE_*`) | `frontend/src/services/transcription/modes/nativePunctuationRestore.ts:62` | Default **true**; only `'false'` disables. Selects word-preserving punctuation restore vs minimal cleanup for saved Native transcripts. |
| `VITE_PRIVATE_STT_V4_DISABLED` | A/B (`VITE_*`) | `frontend/src/services/transcription/privateV4Flags.ts:63` | Default off. `'true'` = build-time hard kill of v4 WebGPU, forcing v2-base. Primary v4 control is PostHog flags (`private_stt_v4_enabled`, `_distil_enabled`, `_internal_only`, `_allowlist`), all default off. |
| `VITE_DEV_PREMIUM_ACCESS` | (test-only) | Stubbed `'false'` in `frontend/tests/setup.ts:314`; **no read in `frontend/src`** | Dead/historical — no shipping code consumes it. Pro entitlement is server-driven: `hasPaidProEntitlement()` requires `subscription_status==='pro'` **and** a real `stripe_subscription_id` (`frontend/src/constants/subscriptionTiers.ts:49`); no env dev/owner bypass exists. |
| `VITE_SENTRY_DSN` | A/B (`VITE_*`) | `frontend/src/main.tsx:104,116` | Frontend Sentry DSN; skipped if absent or contains `example.invalid`. Sentry **environment** = `import.meta.env.MODE` (Vite build mode), `main.tsx:121` — not a dedicated var. Gating flags: `VITE_ENABLE_SENTRY_TRACING`, `VITE_ENABLE_SENTRY_REPLAY`, `VITE_ENABLE_SENTRY_CONSOLE_CAPTURE`. |
| `SENTRY_DSN` (backend) | C (Supabase) / D (CI `vars`) | `backend/supabase/functions/observability-smoke/index.ts:27`; workflows also use `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` | Edge/observability Sentry sender (`_shared/sentry.ts`). |
| `SITE_URL` | C — **Ops-managed in Supabase; NOT synced from GitHub** | `stripe-checkout/index.ts:99,103,212`, `stripe-billing-portal/index.ts:75,130` (via `getEnv`) | Base URL for Stripe checkout/portal redirect URLs. Prod-required (errors if missing); local-dev fallback `http://localhost:${DEV_PORT}`. No `VITE_SITE_URL`/`PUBLIC_SITE_URL` variant exists. |
| Stripe gating | C (Ops-managed) / D | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_BASIC_PRICE_ID`, `STRIPE_PRO_PRICE_ID` (edge, Ops-managed); `VITE_STRIPE_PUBLISHABLE_KEY` (client); `VITE_ENABLE_FREE_PLAN_SUPPORT` (`config.ts:54`) | Checkout opens ONLY when BOTH payment switches are ON (`VITE_PAYMENTS_ENABLED=true` **and** `PAYMENTS_ENABLED=true` — either OFF keeps checkout closed) **and** the live Stripe keys/webhook/prices are correctly aligned (verified by `rc-gates.yml` `paid_launch` + `billing-freeze-check.yml`, `BILLING_FREEZE_EMAILS`). Key class alone does not open checkout. Beta billing freeze active. |
| #979 grant check | (workflow inputs) | `.github/workflows/db-grant-check.yml` — inputs `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`; default target `public.get_user_id_by_email(text)` | Read-only `has_function_privilege()` audit of EXECUTE grants; enforced by migration `20260714000000_harden_get_user_id_by_email_grant.sql`. |

## Draft #1006 — NOT deployed (do not treat as shipped vars)

The #1006 telemetry outbox / provenance proposal is **DRAFT** and **NOT deployed**. Any variables it
introduces (e.g. `POSTHOG_DISTINCT_ID_HMAC_KEY`, `TELEMETRY_WORKER_ENABLED`) are **not** current,
**not** consumed by shipping code, and **must not** be added to §1–§4 above as live/required vars until
#1006 actually merges and deploys. Listed here only so a future reader does not mistake the proposal
for current configuration.

## Open decisions affecting this inventory
- **ENV-PROD:** whether to migrate the Home-A committed `VITE_*` (public) into Home B (Vercel), to match the Stripe-key pattern. This table is the migration checklist if so.
- **ORT-WASM-SAME-ORIGIN:** unrelated to env, but tracked in `BACKLOG.md` (P2 dependency/bloat maintenance epic).
- **VITE_DEV_PREMIUM_ACCESS cleanup:** remove the dead test-only stub or wire an intentional owner-QA path; today it is stubbed but unused in `src`.

## GitHub Actions inventory for the tester-evidence audit (names + scope only)

**Captured 2026-07-24 (names and scope only — never values).** The `tester-evidence-audit.yml` workflow consumes ONLY the following, and references no individual per-account email/password secret, no anon key, and no hardcoded operational address:

| Name | Kind | Role |
|---|---|---|
| `SUPABASE_URL` | **variable** | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | Auth-Admin `listUsers` + PostgREST select (the established key) |
| `AUDIT_EXCLUDED_EMAILS_JSON` | **secret** | centralized exclusion manifest (JSON: owner_admin/synthetic/checkout/canary/qa arrays of emails); audit fails closed if absent/malformed/incomplete |
| `AUDIT_EXCLUSION_LIST_VERSION` | **variable** | manifest version string (printed for traceability; part of the completion gate) |
| `AUDIT_EXCLUSION_LIST_REVIEWED_AT` | **variable** | ISO timestamp the manifest was last reviewed (must be a valid non-future time; completion gate) |

Workflow inputs: `practice_deploy_at`, `final_deploy_at`, `confirm_exclusion_manifest_complete` (required boolean; the operator attests manifest completeness — the audit fails closed unless true).

**Note the variable-vs-secret split:** `SUPABASE_URL`, `AUDIT_EXCLUSION_LIST_VERSION`, and `AUDIT_EXCLUSION_LIST_REVIEWED_AT` are **variables**; `SUPABASE_SERVICE_ROLE_KEY` and `AUDIT_EXCLUDED_EMAILS_JSON` are **secrets**. The audit no longer depends on the individual `*_TEST_EMAIL` secrets (those remain for the workflows that operate those accounts). Not present at capture time (the audit fails closed until the owner provisions them): `AUDIT_EXCLUDED_EMAILS_JSON`, `AUDIT_EXCLUSION_LIST_VERSION`, `AUDIT_EXCLUSION_LIST_REVIEWED_AT`. Re-verify names only with `gh api /repos/:owner/:repo/actions/secrets` and `.../actions/variables`.
