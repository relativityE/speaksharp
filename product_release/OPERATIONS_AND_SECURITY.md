**Status:** Authoritative (SSOT for env/secrets/config catalog, rotation, paid-path activation controls, ops health, SCA exceptions, and security rules)
**Owner:** Operations / Security (relativityE)
**Last Reviewed:** 2026-07-30
**Last Verified:** 2026-07-30 — consolidated from approved interim sources (`LAUNCH_ENV_CHECKLIST.md`, `ENV_INVENTORY.md`, `SECRET_ROTATION_RUNBOOK.md`, `PAID_OPS_HARDENING_RUNBOOK.md`, `OPS_HEALTH_DASHBOARD.md`, `SCA_EXCEPTIONS.md`) and cross-checked against the cited `backend/`, `frontend/`, and `.github/workflows` paths. This document lists variable **names and scopes only — never secret values**. No current run IDs, SHAs, or deployment posture are carried here — those live only in `RELEASE_STATUS.md`.
**Applies To:** The SpeakSharp beta platform's operational surface — environment configuration, secret handling, paid-path activation gating, operational health, dependency-audit exceptions, and runtime security rules.
**Class:** Procedure.
**Authority:** The source for the environment-variable catalog (names × scope × storage home), secret inventory & rotation procedures, the paid-path activation controls & gating architecture, operational-health checks & their security rules, the documented SCA suppressions, and the operational security rules.
**Not Authoritative For:** current release/ops posture, run IDs & SHAs (→ `RELEASE_STATUS.md`); the release gates & workflows (→ `RELEASE_PROCESS.md`); the quality/test estate (→ `QUALITY.md`); tier/entitlement/pricing policy (→ `ENTITLEMENTS_AND_BILLING.md`); the authoritative-source & retention ADRs and structural invariants (→ `ARCHITECTURE.md`); dated audit evidence (→ `EVIDENCE_INDEX.md`); tester administration (→ `TESTER_OPERATIONS.md`).
**Supersedes:** `LAUNCH_ENV_CHECKLIST.md`, `ENV_INVENTORY.md`, `SECRET_ROTATION_RUNBOOK.md`, `PAID_OPS_HARDENING_RUNBOOK.md`, `OPS_HEALTH_DASHBOARD.md`, `SCA_EXCEPTIONS.md` (interim sources; archived at documentation closeout per `DOC_MIGRATION_LEDGER.md`).
**Evidence Sources:** `DOC_MIGRATION_LEDGER.md` §3.G extraction mapping; the `backend/supabase/functions/*`, `frontend/src/*`, and `.github/workflows/*` paths cited inline; the live consoles (Vercel / GitHub / Supabase) which remain authoritative for actual values.

# SpeakSharp Operations & Security (v1)

Canonical statement of how SpeakSharp is configured, secured, and kept operationally healthy: the catalog of every environment variable and where it lives, how secrets are handled and rotated, how the paid path is gated and activated, how operational health is monitored, which dependency advisories are suppressed and why, and the runtime security rules.

This is a **documentation** artifact. It records **variable names, scopes, storage homes, and procedures — never secret values, tokens, passwords, customer data, or changing production identifiers**. The live consoles (Vercel / GitHub / Supabase) are authoritative for actual values; reconcile this catalog against them during the launch checklist. It changes no code, secret, configuration, or product behavior.

**Precedence reminder (from `README.md` §1).** **Never trade security for survivability** — a Security Invariant (Level 4) may not be bypassed to restore availability (Level 5). Silent data corruption is categorically worse than an outage (L3 > L5). Fail-closed is the default posture for every control described here.

---

## 1. Scope & boundaries

This document owns the **operational + security surface**. It routes: the *authoritative-source* and *retention* ADRs and structural invariants → `ARCHITECTURE.md`; the release gates that consume these controls (Gate 2 SAST, Gate 3 DAST, Gate 4 SCA) → `RELEASE_PROCESS.md`; tier/entitlement/quota/pricing *policy* → `ENTITLEMENTS_AND_BILLING.md`; dated audit proof → `EVIDENCE_INDEX.md`; changing run IDs/SHAs/posture → `RELEASE_STATUS.md`. **Secret-handling policy:** report a secret as present/absent only; never paste fingerprints, values, or production identifiers into docs, logs, chat, or commits.

---

## 2. Environment variables & scopes (catalog — names only)

This is the canonical catalog of every environment variable SpeakSharp uses, where each is stored, who consumes it, and its scope. Use it to add new variables, migrate/replicate config, and rotate keys. **Never paste secret values here** — treat the live consoles as authoritative for values.

### Storage homes (legend)

| Home | What lives here | Who sets it |
|---|---|---|
| A. Local root `.env*` (gitignored) | client-public `VITE_*` for local dev/test — Vite's `envDir` (repo root) | each developer |
| B. Vercel Project Env → Production scope | the real production `VITE_*` (incl. live Stripe key) + platform vars (`VERCEL_GIT_COMMIT_SHA`) | product-ops (Vercel UI) |
| C. Supabase Edge Function secrets | all server-side secrets used by edge functions | product-ops (Supabase UI / `supabase secrets set`) |
| D. GitHub Actions secrets/variables | CI/deploy credentials + the sync source that pushes some values into Home C | product-ops (GitHub repo settings) |
| E. Committed templates | root `.env.test.example` only | dev (repo) |

**Loading model (critical).** `frontend/vite.config.mjs` sets `envDir = repo root`, and there is **no root `.env.production`**. At build/dev time Vite loads `.env*` from the repo root (Home A) plus actual `process.env` `VITE_*` (Home B on Vercel). Production billing closure does **not** depend on the Stripe key being absent — Vercel may inject a live publishable key, yet checkout stays closed unless both payment switches are ON (§5). The old `frontend/.env.production` was outside `envDir`, never build-loaded, and has been removed — do not re-add it. Supabase auto-provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` into Edge Functions.

**`.env.*` file map.** Minimum tracked set in effect = root `.env.test.example` only. Gitignored per-dev: root `.env`, `.env.test`, `.env.local`. Removed (do not re-add): `frontend/.env.production`, `frontend/.env.test.example`, and the `frontend/.env.development` tracked symlink. `scripts/validate-env.mjs` reads root `.env` + root `.env.test`. **Decisions log:** `ORT-WASM-SAME-ORIGIN = NO` (2026-06-08 — claim boundary stays "no Hugging Face model weights"; ONNX-runtime WASM from CDN is acceptable); `ENV-PROD = REMOVE frontend/.env.production` (2026-06-08; real prod client config = Home B + this catalog).

### 2.1 Client-public `VITE_*` (NOT secrets — shipped in the browser bundle)

Build gate: `env.required` (must be set) / `env.optional` (warn-only), read by `validate-env.mjs`.

| Variable | Required? | Home | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | required | A | Production Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | required | A | Public anon key (RLS-guarded). |
| `VITE_STRIPE_PUBLISHABLE_KEY` | optional | B (Vercel only) | Committed empty on purpose (fail-closed). Prod must inject the live publishable key; verify `window.__APP_RUNTIME_CONFIG__.stripeKeyClass === "live"`. Not sufficient alone — also requires `VITE_PAYMENTS_ENABLED=true`. |
| `VITE_PAYMENTS_ENABLED` | optional | B (Vercel only) | Explicit frontend payments kill-switch (P0.1). Default OFF. `arePaymentsEnabled()` is true only when this === `"true"` AND the publishable key is live. Mirrors backend `PAYMENTS_ENABLED`; both must be deliberately enabled to sell Pro. |
| `VITE_SENTRY_DSN` | optional | A | Absent → error monitoring disabled. |
| `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` | optional | A | Analytics; absent → disabled. |
| `VITE_LOG_LEVEL` | optional | A | Client log level. |
| `VITE_ENABLE_SENTRY_TRACING` / `_REPLAY` / `_CONSOLE_CAPTURE` | optional | A/B | Sentry feature flags. |
| `VITE_AUTH_MODE` / `VITE_AUTH_TIMEOUT` | optional | A/B | Authentication configuration. |
| `VITE_ENABLE_INTERNAL_ROUTES` | must be false/absent in prod | B/E | Dev/internal-routes gate. |
| `VITE_GUIDED_WAITLIST_ENABLED` | optional | A/B | Activates the Guided "Notify me" waitlist backend call; `=== 'true'` gates `GUIDED_WAITLIST_ENABLED` (`frontend/src/config/env.ts`). Default off → the dialog shows the coming-soon acknowledgement, no capture/backend call (#1081). |
| `VITE_EXECUTIVE_REHEARSAL_DISABLED` | optional | A/B | Build-time hard kill for the Focus Points coverage slice; `=== 'true'` disables it (`frontend/src/services/rehearsal/executiveRehearsalFlags.ts`). The variable and module keep their existing names because they are code identifiers that exist under those exact names — renaming them here would make this table wrong. |

**Dev/test-only `VITE_*` — MUST be unset/false in production** (Home E only; any reaching a prod build is a launch blocker): `VITE_TEST_MODE`, `VITE_E2E_MODE`, `VITE_USE_MOCK_AUTH`, `VITE_ALLOW_MOCK_AUTH_IN_TESTS`, `VITE_SKIP_MSW`, `VITE_USE_LIVE_DB`, `VITE_USE_REAL_DATABASE`. **Platform-provided (build time):** `VERCEL_GIT_COMMIT_SHA` (Home B, auto) → injected into `index.html` as the inline `window.__APP_RELEASE__` global → `window.__APP_RUNTIME_CONFIG__.release` + PostHog `release_sha` (PR #1027: not a `__BUILD_ID__` JS define — removed so the volatile SHA never rotates chunk hashes; Sentry release set at runtime from `window.__APP_RELEASE__`).

### 2.2 Server-side secrets (Supabase Edge Functions — Home C; names/scope only)

Rotate per §3. Never commit real values.

| Variable | Home | Consumed by |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | C (auto) | all edge fns / create-user & admin paths |
| `PAYMENTS_ENABLED` | C | `stripe-checkout` — backend payments kill-switch (P0.1), default OFF; returns `403 payments_disabled` before any Stripe call unless === `"true"` AND `STRIPE_SECRET_KEY` is live. Checkout is closed by the switch being OFF, NOT by the key being absent. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRO_PRICE_ID` | C — Ops-managed in Supabase; NOT synced from GitHub | stripe-checkout / stripe-webhook / the single $10/month product checkout |
| `SITE_URL` | C — Ops-managed in Supabase; NOT synced from GitHub | stripe-checkout / stripe-billing-portal redirect base (prod-required; local-dev fallback only) |
| `ASSEMBLYAI_API_KEY` | Retired customer path; keep server-side only until separately authorized secret removal | legacy `assemblyai-token` denial endpoint must not read or use it |
| `GEMINI_API_KEY` | C (+D sync) | get-ai-suggestions |
| `ALLOWED_ORIGIN` | C (+D sync) | `_shared/cors.ts` — APPENDS extra exact origins only (see §6) |
| `AGENT_SECRET` | C (+D sync) | agent/internal auth |
| `OBSERVABILITY_SMOKE_SECRET` | C | observability-smoke (must match the GitHub secret of the same name) |
| `SENTRY_DSN` (backend) / `LOG_LEVEL` (backend) | C | edge-fn error ingest / log level |

**GitHub→Supabase secret sync** (`deploy-supabase-migrations.yml`, `operation=secrets`) sets **ONLY** `AGENT_SECRET`, `ALLOWED_ORIGIN`, and `GEMINI_API_KEY`. All other Home-C runtime secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `ASSEMBLYAI_API_KEY`, `SITE_URL`) are **Ops-managed directly in Supabase and NOT synced from GitHub** — the sync intentionally excludes them so a CI/test value can never overwrite the live production runtime. If a guarded production price sync is ever reintroduced it must be behind an explicit `confirm_live_stripe_secret_sync` input, names-only, never a default `operation=secrets`/`all` step.

### 2.3 GitHub Actions env (Home D) — secrets vs variables

Many `secrets.*` are non-secret config over-classified as Secrets; a small number of GitHub `vars.*` are also referenced (e.g. `vars.SUPABASE_PROJECT_ID`, `vars.SUPABASE_URL`, `vars.EDGE_FN_URL`) — reconcile counts against the current workflows rather than assuming "none." **Genuine secrets (keep as GitHub Secrets):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `ASSEMBLYAI_API_KEY`, `GEMINI_API_KEY`, `SENTRY_AUTH_TOKEN`, `POSTHOG_PERSONAL_API_KEY`, `AGENT_SECRET`, `OBSERVABILITY_SMOKE_SECRET`, `PROMO_GEN_ADMIN_SECRET`, `GH_PAT`, `VERCEL_ACCESS_TOKEN`, and the real test-account passwords (`*_TEST_PASSWORD`, `CANARY_TRIAL_PASSWORD`, `CANARY_PAID_PASSWORD`, `SOAK_TEST_PASSWORD`). **Over-classified → should be GitHub Variables (non-secret config):** `SUPABASE_URL`, `SUPABASE_ANON_KEY` (owner decision: kept a Secret despite being client-public), `SUPABASE_PROJECT_ID`, publishable-key/price-ID names, `SENTRY_DSN`/`SENTRY_API_BASE`/`SENTRY_ORG`/`SENTRY_PROJECT`, `POSTHOG_PROJECT_API_KEY`/`POSTHOG_PROJECT_ID`/hosts, `EDGE_FN_URL`, `VERCEL_PROJECT_ID`, and test-account emails. **Safe migration order (CI never breaks):** product-ops creates the Variable (copy value) → dev flips the workflow ref `secrets.X → vars.X` → owner deletes the old Secret. Agents do NOT mutate the secret store; dev only edits the `.yml` refs. Same-name `secrets.X`/`vars.X` may coexist, so no rename is required. The `tester-evidence-audit.yml` workflow consumes only `SUPABASE_URL` (variable), `SUPABASE_SERVICE_ROLE_KEY` (secret), `AUDIT_EXCLUDED_EMAILS_JSON` (secret — centralized exclusion manifest; audit fails closed if absent/malformed), `AUDIT_EXCLUSION_LIST_VERSION` (variable), `AUDIT_EXCLUSION_LIST_REVIEWED_AT` (variable), plus the operator's `confirm_exclusion_manifest_complete` attestation input.

### 2.4 Vercel Project Env (Home B)

The real production values for the §2.1 `VITE_*` live here (Production scope) plus platform vars, all encrypted at rest in Vercel: the public `VITE_*` set (`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, live `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_SENTRY_DSN`/`VITE_POSTHOG_KEY`/`VITE_POSTHOG_HOST`), `OPS_STATUS_PASSWORD` (a real secret — gates the Ops status page), and the auto-provided `VERCEL_GIT_COMMIT_SHA`.

### 2.5 Feature-flag & runtime vars (code-verified)

| Variable | Home | Where read (code) | Default / effect |
|---|---|---|---|
| `VITE_NATIVE_PUNCTUATION_RESTORE` | Internal E2E compatibility only | `.../modes/nativePunctuationRestore.ts` | Must not affect the production customer path; Native is not a customer entitlement. |
| `VITE_PRIVATE_STT_V4_DISABLED` | A/B | `.../transcription/privateV4Flags.ts` | Default off. `'true'` = build-time hard kill of v4 WebGPU, forcing v2-base. Primary v4 control is PostHog flags (`private_stt_v4_enabled`, `_distil_enabled`, `_internal_only`, `_allowlist`), all default off. |
| `VITE_DEV_PREMIUM_ACCESS` | (test-only) | stubbed `'false'` in tests; **no read in `frontend/src`** | Dead/historical — no shipping code consumes it. Pro entitlement is server-driven (`subscription_status==='pro'` AND a real `stripe_subscription_id`); no env dev/owner bypass exists. |
| `VITE_SENTRY_DSN` | A/B | `frontend/src/main.tsx` | Frontend Sentry DSN; skipped if absent or `example.invalid`. Sentry `environment` = Vite build `MODE` (not a dedicated var). |
| `SENTRY_DSN` (backend) | C / D | `observability-smoke/index.ts`; `_shared/sentry.ts` | Edge/observability Sentry sender. |
| `SITE_URL` | C — Ops-managed | `stripe-checkout` / `stripe-billing-portal` | Base URL for Stripe redirect URLs. No `VITE_SITE_URL` variant exists. |

**Add a NEW env variable:** (1) classify client-public (`VITE_*`, shipped in bundle) or server secret (a secret must never be `VITE_*` and never committed); (2) pick the home (A–E) and add a row above; (3) client-public → root `.env*` for local + Vercel Home B for prod (`env.required` if startup must fail without it, else `env.optional`; do not create `frontend/.env.production`); (4) server secret → Supabase Home C, plus GitHub Home D + the deploy sync step only if CI must inject it; (5) add a live-value check to §4; if rotatable, add it to §3; (6) update this catalog (names only, no values). **Draft #1006 is NOT deployed** — any variables it proposes (e.g. `POSTHOG_DISTINCT_ID_HMAC_KEY`, `TELEMETRY_WORKER_ENABLED`) are not current, not consumed by shipping code, and must not be added above as live/required until #1006 merges and deploys.

---

## 3. Secrets & rotation

> **Status: not an active action item.** Owner ruling (2026-06-08): the "committed secrets" were a misclassification — the tracked `.env.test` entries held mock values, and a full-tree/full-history scan found no real secret ever committed. Real provider secrets live only in the secret stores and were never exposed. This runbook is retained as reference in case a *real* exposure ever occurs.

**What must be rotated or proved fake if an exposure occurs:** Supabase legacy `SERVICE_ROLE_KEY`; Supabase anon/publishable key (if the project JWT secret is regenerated); Stripe secret key; Stripe webhook secret; AssemblyAI API key; any committed test-account passwords that map to real accounts.

**Automation reality — no clean one-button cross-provider rotation.** Stripe secret/webhook: partly automatable (owner rolls via Dashboard/API with overlap/grace, then updates GitHub/Supabase/Vercel). AssemblyAI: mostly manual (dashboard self-serve). Supabase legacy service-role/anon JWT: disruptive/manual (regenerating the project JWT secret also invalidates anon; plan a deploy window). Test passwords: automatable after Supabase rotation (via Supabase Admin API, which itself needs a valid service-role/admin credential).

**Recommended product-ops sequence:** (1) preserve old key **fingerprints, not full secrets**; (2) rotate Supabase first if a real service-role value was exposed (regenerate JWT secret → update stores → redeploy/re-run auth, canary, live DAST, and Edge checks); (3) rotate Stripe only in its authorized window and prove the exact checkout/webhook/binding contract; (4) verify the retired provider-token endpoint cannot use its legacy provider key, then remove that secret only under separate authorization; (5) reset any real test accounts/passwords found in exposed files; (6) decide history handling (fake → record proof, no purge; any real → incident record and separately authorized cleanup).

**Verification after rotation:** run `pnpm rc:sast:secrets`, `pnpm test:edge`, and `pnpm run rc:dast:live`; verify tracked environment files contain no real secret, update timestamps post-date the cleanup commit, production uses real Supabase auth with no mock/test mode, checkout obeys both payment switches, and the retired provider-token endpoint denies customers without a provider call. **Ownership:** product-ops owns provider credential rotation; dev/test own repo-side scans, app verification, and content-safe proof. Never paste secret values or fingerprints into coordination files, logs, chat, or commits.

---

## 4. Live-value verification protocol

The launch checklist verifies each variable against the **live production environment** (runtime truth is the primary release gate). Verify configuration through the approved Supabase/Stripe/Vercel readbacks and review logs for environment-load errors after deployment. Required checks include: `window.__APP_RUNTIME_CONFIG__.release` equals the deployed git SHA (`"unknown"`/absent breaks release correlation); production has source maps disabled, no auth bypass, `VITE_ENABLE_INTERNAL_ROUTES` absent/false, and no dev/test `VITE_*`; the customer transcription allow-list is exactly `['private']`; the legacy provider-token endpoint denies customer requests without contacting the provider; access uncertainty fails closed; retired sample or accumulated-usage fields cannot deny an active-trial or paid user; and exact expiry preserves the read/export/account/upgrade permission matrix. Stripe key class is configuration validation, not authority to open checkout. Preview deployments must not be shared as tester/public URLs unless explicitly reviewed.

---

## 5. Paid-path activation controls

> The current release is a **controlled, no-billing beta** — paid checkout is intentionally NOT open, **closed by the payment switches (`VITE_PAYMENTS_ENABLED` / `PAYMENTS_ENABLED` both OFF), NOT by the key class.** The Beta-50 billing freeze is active (no live Stripe charges/subscriptions/refunds; comped-DB entitlement only for Pro QA). This section is the procedure for a **later** paid cutover — a separate, written owner-approved Ops action, not an active step. Pricing/packaging *policy* lives in `ENTITLEMENTS_AND_BILLING.md`.

### How the paid path is gated (architecture)

Checkout is closed by **two independent payment switches**, one on each side; **either switch unset/OFF keeps checkout closed.** The Stripe key class *validates configuration* but does not by itself open or close checkout.

1. **Frontend closure switch — `VITE_PAYMENTS_ENABLED`.** Frontend checkout requires it `=true` AND a valid aligned live publishable key. `classifyStripeKey(key)` (`frontend/src/config/appRuntimeConfig.ts`) → `'live' | 'test' | 'missing' | 'unknown'` validates config only; it does not open checkout. `missing` config is additionally fail-closed to `ConfigurationNeededPage` (`main.tsx`) — a broken-config safety net, not the closure control. Checkout surfaces are hidden unless the frontend switch is ON with aligned live config (`Navigation.tsx`, `UpgradePromptDialog.tsx`, `FreePlanSupport.tsx` return null).
2. **Backend closure switch — `PAYMENTS_ENABLED`.** Backend checkout requires it `=true` AND valid aligned live backend Stripe config (live secret key, live webhook secret, live price IDs). `stripe-checkout` returns `403 payments_disabled` before any Stripe call otherwise.
3. **Backend entitlement gate — `stripe-webhook/index.ts`.** Verifies `Stripe-Signature` via `constructStripeEvent(...)` before any mutation; only signature-verified `checkout.session.completed` / `customer.subscription.{updated,deleted}` events drive entitlement. **No Pro unlock without a verified webhook** — entitlement is server-confirmed, not client-claimed.

**Opening paid enrollment requires ALL of:** both payment switches ON, aligned live Stripe keys/webhook/prices, and entitlement verification. A key swap alone does not open enrollment.

### Four-corner live alignment (release-owner, 2026-06-18)

All four must be the SAME live mode for authorized paid activation. Supabase Edge Function secrets are the **authoritative** home for ALL live Stripe runtime config; `deploy-supabase-migrations.yml` no longer syncs the Stripe price IDs (removed to eliminate the foot-gun where a CI/test value could overwrite the live runtime price). Never place live secret/webhook values in GitHub (GitHub's Stripe secrets feed test-mode CI only).

| Corner | Variable | Storage home | How it reaches prod |
|---|---|---|---|
| Frontend pub key | `VITE_STRIPE_PUBLISHABLE_KEY` (live) | Vercel prod env | Vite build (only `VITE_*` reach the client) |
| Backend secret key | `STRIPE_SECRET_KEY` (live) | Supabase Edge secrets | set directly in Supabase (not GitHub-synced) |
| Backend webhook secret | `STRIPE_WEBHOOK_SECRET` (live) | Supabase Edge secrets | set directly in Supabase (not GitHub-synced) |
| Backend Pro price | `STRIPE_PRO_PRICE_ID` (live) | Supabase Edge secrets | set directly in Supabase (not GitHub-synced) |
| Backend site URL | `SITE_URL` (production URL) | Supabase Edge secrets | set directly in Supabase |

### Checklist — verifiable now (no live keys)

Payment switches close checkout (either OFF ⇒ closed; opening needs both ON with aligned live config; verified by `appRuntimeConfig.test.ts` `classifyStripeKey`); missing live config is fail-closed to `ConfigurationNeededPage`; no raw Stripe errors in UI (Nav checkout-fail → customer-safe toast; Pricing/Analytics catch-block copy is a queued follow-up verify); no Pro unlock without Supabase entitlement (webhook signature-verified before mutation); billing portal / cancel / refund path is clear (`PricingPage` `BillingManagementPanel` → `stripe-billing-portal`; refund copy "reviewed case by case"); a synthetic/signed test webhook is **code-path evidence only**, not a live transaction — the test-mode checkout→webhook→entitlement→portal journey is the accepted functional proof, and **no live-money charge is a required Dev/CI/QA or launch proof**. The read-only `billing-freeze-check.yml` exercises the closed endpoint and also fails if any live subscription/open invoice/open checkout session exists for the audited accounts.

### Activation & optional smoke (after separately authorized activation)

**Required activation verification (the functional bar):** set BOTH payment switches ON and inject aligned live config, then validate key class `'live'`, `price.livemode === true`, a reachable webhook endpoint whose signature verifies, and the entitlement path. The key class is a config-validity check and does **not** by itself open or gate checkout — the two switches are the control. Injecting aligned live keys alone does not open enrollment; both switches must be ON.

**Optional live smoke (post-activation, separately authorized — NOT a launch gate):** only after activation is authorized and complete, Ops MAY run one controlled real checkout → live event → webhook → entitlement → refund as optional ops diligence; Dev does not run it.

**Rollback to disabled proven:** setting either switch back to false/unset restores the fail-closed state (no Upgrade control, `403 payments_disabled`) — verify this before relying on the switch.

**Guardrails honored:** v2-base default unchanged; no v4 touched; STT engine defaults untouched; no live Stripe secrets handled by Dev; no real payment; synthetic webhook never labeled live-money; no merges. Pricing and packaging are **DECIDED**: one Private Practice product — complete for 30 days, then exactly **$10/month** for the same Private-only product. There is **no Basic product** and no permanent Free tier. The authoritative contract lives in `ENTITLEMENTS_AND_BILLING.md`; commercial activation itself remains a separately authorized launch step.

---

## 6. Security rules & invariants

- **Exact-origin, fail-closed CORS (P0.3).** The product origin in the built-in exact allowlist at `backend/supabase/functions/_shared/cors.ts` (`BUILTIN_ALLOWED_ORIGINS`) is `https://speaksharp-public.vercel.app`, alongside local dev `http://localhost:5173/5174` and `http://127.0.0.1:5173/5174`. `ALLOWED_ORIGIN` (Supabase Edge secret) adds **additional exact** origins only, comma-separated. Every entry is normalized to a canonical `URL.origin` — there is **no** wildcard/suffix/substring match; malformed entries are logged and ignored. Approved origins are echoed exactly (204 with exact ACAO); hostile lookalikes/wrong-protocol/unapproved-port get **403 with NO `Access-Control-Allow-Origin`**. The legacy `https://speaksharp.vercel.app` is **not** approved and is proven rejected in production (proven live by `cors-exact-origin.live.spec.ts` in Gate 3, non-skipping).
- **Auth & entitlement fail-closed.** Missing/invalid auth returns a structured denial. The retired provider-token endpoint returns a customer-safe denial without any provider call. Active-trial and paid access require authoritative server state; unknown or mismatched identity/price fails closed. Accumulated usage cannot deny an entitled user. Paid authority requires the complete Stripe customer/subscription/approved-price binding, not a profile status alone.
- **RPC grant lockdown (#979).** Migration `20260714000000_harden_get_user_id_by_email_grant.sql` grants EXECUTE on `public.get_user_id_by_email(text)` to **service_role only** (PUBLIC/anon/authenticated = none); enforced by the read-only `db-grant-check.yml` audit.
- **Rate limiting & transport.** Rate limiting is applied where it is implemented — notably the Guided-waitlist Edge Function throttles **both** submit and confirm (over-limit → `429`, no row written; proven in `backend/supabase/functions/guided-waitlist/index.test.ts`). There is **no** documented product-wide "N/min per IP" limiter — do not assert one. Production domain has a valid active TLS certificate.
- **Secrets server-side only.** Provider secret keys are never required as frontend `VITE_*`; the frontend uses DSN/project public keys only. No env Pro bypass in the prod build (`devBypass`/`VITE_DEV_USER`/`VITE_DEV_PREMIUM_ACCESS` grant nothing in the app path).
- **Storage / RLS.** Verify any production storage buckets still used have correct RLS policies. Audio files are **not** stored for launch; finalized session records persist transcript/analysis text needed for coaching comparison, PDF regeneration, AI suggestions, and WER-ready validation (retention-duration ADR → `ARCHITECTURE.md`).

---

## 7. Operational health

A single high-level ops-health workflow so release checks do not require logging into every vendor dashboard first. Two layers exist: **V1 GitHub artifact + workflow summary** (`ops-health.yml`, daily cron + manual dispatch, uploads `ops-health/ops-health.json` + `.md`) and a **protected operator page** `/admin/ops-status` (`frontend/src/pages/OpsStatusPage.tsx`, gated by the internal-routes guard `VITE_ENABLE_INTERNAL_ROUTES`; when internal routes are disabled the path does not resolve). It answers "Are the main software/API interfaces we rely on reachable and credentialed right now?" — an early signal board with drill-down links, not a replacement for vendor dashboards.

**Current V1 rows:** SpeakSharp app (prod URL HTTP success), Vercel API, Supabase API (auth + owned Edge Function entrypoints), AssemblyAI, Gemini, Stripe, Sentry, PostHog, and GitHub API (metadata + release-workflow rollup, bounded-retry). **Status vocabulary:** `🟢 OK`, `🔴 FAIL` (unreachable/errored/launch-blocking bad data), `⚠️ REVIEW` (data returned but needs attention), `🚧 NOT READY` (no useful signal yet, usually missing credentials — inventory debt, not hidden success). **GitHub API row bounded-retry & recovery (#990):** the probe runs from inside GitHub Actions (a circular vendor dependency), so it uses **bounded** resilience — at most 3 attempts with jittered exponential backoff on idempotent GET for network error/timeout/`408/500/502/503/504`; a hard deadline shared across the whole row and active through response-body consumption (`BUDGET_EXHAUSTED` if exceeded; a late response never counts green); honors `Retry-After` / `x-ratelimit-*` (`RATE_LIMITED`; a `403` with no rate-limit evidence → permission RED); a transient-then-recovered sub-check surfaces as non-gating `🟡 REVIEW`; terminal failures name the exact sub-check and emit sanitized diagnostics (never the token or `Authorization` header).

**Security rules for health output:** do not expose vendor API keys in the frontend; do not write raw vendor payloads into artifacts; do not store transcripts, user emails, or user content in health artifacts; health output is limited to status, short detail, latency, timestamp, and drill-down URL. **Usage:** `pnpm ops:health` (local, env loaded) or `gh workflow run ops-health.yml`; keep cadence low before release to avoid unnecessary vendor API traffic. Not-ready rows require their secret to be added to GitHub Actions (Vercel/Supabase/AssemblyAI/Gemini/Stripe/Sentry/PostHog/GitHub each list their required env/secret names). WIP and future checks (Vercel alias vs expected SHA, authenticated Edge smokes, DNS/custom-domain status, Supabase-backed storage for the latest JSON) route to `ROADMAP.md`.

---

## 8. SCA / dependency exceptions

Documented, justified suppressions consumed by the SCA gate. Gate 4 (`rc:gate:4:sca`) runs `node scripts/sca-osv-gate.mjs`, which runs **`osv-scanner`** over the root `pnpm-lock.yaml` and fails on any distinct un-ignored CRITICAL (or unclassifiable UNKNOWN) advisory (`.github/workflows/sca.yml`). Each entry states the advisory, why it is not reachable, the compensating control, and the real remediation path. The ignore set is declared in `package.json` and loaded by the gate (`ignoreSetFromPkg`).

**GHSA-5xrq-8626-4rwp — Vitest UI server arbitrary file read/exec.** Package `vitest` (`<4.1.0`; installed `3.2.4`), Critical, **Suppressed (not reachable).** The vulnerability requires the Vitest UI/API server to be **listening**; this repo never starts it (no `vitest --ui`/`--api` script; CI and local runs use `vitest run` only; `vitest` is a devDependency that ships in no production/runtime bundle), so the exploit precondition is unreachable. Compensating control: `@vitest/ui` is dormant (declared but never invoked) and can be dropped at the next dependency pass. **Real remediation (deferred):** upgrade to `vitest >= 4.1.0` — a major 3→4 bump requiring re-validation of the unit suite, coverage thresholds, and the `vitest.config.mjs` API surface, scheduled as a standalone change (`frontend/package.json` already carries `@vitest/coverage-v8@^4.1.0`, a partial migration). Remove the suppression once vitest is `>= 4.1.0`, or sooner if any script begins exposing the Vitest UI/API server.

**Resolved — the SCA gate was migrated off the retired pnpm-audit endpoint.** Historically `pnpm audit` called the retired legacy npm audit endpoint (`registry.npmjs.org/-/npm/v1/security/audits`, now HTTP 410) and could not produce a valid pass/fail. The gate was therefore moved to `scripts/sca-osv-gate.mjs`, which runs **`osv-scanner`** over the root `pnpm-lock.yaml`; that is the **current, operational** Gate 4 (green in CI). The scan confirms the **only** distinct critical is `vitest@3.2.4` → GHSA-5xrq (the already-ignored advisory; the historical "2 critical" count was a single-advisory duplicate-path artifact of `vitest` resolving into two importers) — i.e. **zero un-ignored distinct criticals**. The one remaining durable item (→ `ROADMAP.md`): retire the suppression by upgrading vitest to `>= 4.1.0`. Dated audit-run evidence is indexed by `EVIDENCE_INDEX.md`.
