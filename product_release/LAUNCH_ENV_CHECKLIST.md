**Owner:** relativityE
**Last Reviewed:** 2026-07-20
**Version:** v0.9.0-rc-series (sanitized lineage; see `RELEASE_STATUS.md` crosswalk)
**Last Updated:** 2026-07-20 (reconciled to private-first main: dual fail-closed billing, exact-origin CORS deployed)

# Runtime Configuration Verification (Launch Checklist)

> Environment checklist, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.
> The canonical variable catalog (every var × scope × storage home) is `ENV_INVENTORY.md` —
> this file only **verifies live values**; add/migrate/rotate from the inventory.

This checklist MUST be verified against the LIVE production environment. Modern failures often stem from environment mismatch; verification of runtime truth is the primary release gate.

---

## 1. Billing & Payments (Stripe)

> **Four-corner live alignment — ALL must be the SAME live mode for authorized paid activation (release-owner, 2026-06-18).** Storage home determines how each value reaches production:
>
> | Corner | Variable (live value) | Storage home (owner) | How it reaches prod |
> |---|---|---|---|
> | Frontend pub key | `VITE_STRIPE_PUBLISHABLE_KEY` = `pk_live_…` | **Vercel** prod env | Vite build — only `VITE_*` vars reach the client |
> | Backend secret key | `STRIPE_SECRET_KEY` = `sk_live_…` | **Supabase** Edge secrets | set directly in Supabase (**not** GitHub-synced) |
> | Backend webhook secret | `STRIPE_WEBHOOK_SECRET` = live `whsec_…` | **Supabase** Edge secrets | set directly in Supabase (**not** GitHub-synced) |
> | Backend Pro price | `STRIPE_PRO_PRICE_ID` = live `price_…` | **Supabase** Edge secrets | set directly in Supabase (**not** GitHub-synced — the auto-sync was removed 2026-06-18) |
> | Backend site URL | `SITE_URL` = production URL | **Supabase** Edge secrets | set directly in Supabase |
>
> **Source-of-truth policy (release-owner, 2026-06-18):** Supabase Edge Function secrets are the **authoritative** home for ALL live Stripe runtime config (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_BASIC_PRICE_ID`, `SITE_URL`). `deploy-supabase-migrations.yml` **no longer syncs the Stripe price IDs** (removed to eliminate the foot-gun where a CI/test value could silently overwrite the live runtime price). **Never** place `sk_live`/`whsec` live values in GitHub — GitHub's Stripe secrets feed **test-mode CI** only and must never become the implicit production authority. **Sequence:** (1) set Vercel `VITE_STRIPE_PUBLISHABLE_KEY=pk_live`; (2) set/verify Supabase `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRO_PRICE_ID`/`SITE_URL` live, directly in Supabase; (3) re-run the Dev redacted config-readiness check; (4) **only then**, after authorized activation, Test/Ops verify live activation config (both switches ON + aligned live config + webhook/price/entitlement verification). A live charge is an optional post-activation smoke, **not** a required proof.

> **P0.1 dual-enablement rule (fail-closed beta).** Correct live keys are necessary but NOT sufficient. Paid enrollment requires **two explicit kill-switches deliberately turned on, in addition to live keys**: the frontend flag `VITE_PAYMENTS_ENABLED=true` (Vercel) AND the backend flag `PAYMENTS_ENABLED=true` (Supabase Edge). Either flag off ⇒ checkout closed. The beta ships with both **off**, so a stray `pk_live_` key alone can never open checkout. Both the frontend (`arePaymentsEnabled()`) and the backend (`stripe-checkout` → `403 payments_disabled` before any Stripe call) enforce this independently.

**Beta fail-closed billing state (CURRENT — verify these are TRUE before/while inviting testers):**
- [ ] **Frontend switch OFF**: `VITE_PAYMENTS_ENABLED` is unset or not `"true"` in Vercel Production, so `arePaymentsEnabled()` is false and every Upgrade/checkout surface is hidden — independently of the publishable key class.
- [ ] **Backend switch OFF**: `PAYMENTS_ENABLED` is unset or not `"true"` in Supabase Edge secrets. The two switches are **independent**: either one off ⇒ checkout closed.
- [ ] **Endpoint proves CLOSED**: an anonymous POST to the deployed `stripe-checkout` returns **403 `payments_disabled`** — the guard runs *before* any auth/Stripe call (`backend/supabase/functions/stripe-checkout/index.ts`; `ErrorCodes.PAYMENTS_DISABLED` → 403). This is exercised read-only by `.github/workflows/billing-freeze-check.yml` (Beta-50 billing freeze), which also fails if any live subscription/open invoice/open checkout session exists for the audited accounts. A live `pk_live_`/`sk_live_` present in prod does NOT open checkout while the switches are off.

**Paid-launch enablement sequence (SEPARATE future flow — run in order; each is a hard gate; do NOT run during the fail-closed beta):**
- [ ] **Frontend flag ON**: `VITE_PAYMENTS_ENABLED=true` set in Vercel Production env.
- [ ] **Backend flag ON**: `PAYMENTS_ENABLED=true` set directly in Supabase Edge secrets.
- [ ] **Correct live keys**: `pk_live_…` (Vercel) + `sk_live_…` (Supabase) — same live mode (four-corner alignment below).
- [ ] **Live activation verification**: after authorized activation, both payment switches ON + aligned live config + webhook/price/entitlement verified end-to-end. (A real live-money charge is optional post-activation ops diligence, **not** a required proof.)
- [ ] **Webhook confirmation**: `checkout.session.completed` reaches the live `stripe-webhook` and grants entitlement.
- [ ] **Entitlement confirmation**: the test account shows a real `stripe_subscription_id` and gains Pro/Cloud (`hasCloudSttEntitlement`).
- [ ] **Rollback to disabled proven**: setting either `VITE_PAYMENTS_ENABLED` or `PAYMENTS_ENABLED` back to false/unset (or removing the live keys) restores the fail-closed state — no Upgrade control, `403 payments_disabled` from the endpoint — verified before relying on the switch.

- [ ] **Live Keys**: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` are using `sk_live_...` and `pk_live_...`.
- [ ] **Frontend publishable key injected by Vercel**: `VITE_STRIPE_PUBLISHABLE_KEY` is set to the `pk_live_...` key in the **Vercel project env (Production scope)**. There is no committed `frontend/.env.production` (removed — it was outside Vite `envDir` and never build-loaded), and no `pk_test_...` is committed. If the publishable key is absent, a production build renders `ConfigurationNeededPage` rather than silently shipping a Stripe TEST-mode key — this is the **config-page gate**, NOT the billing-closure control. **Billing/checkout closure does NOT depend on the key being present or absent**: checkout is closed unless BOTH `VITE_PAYMENTS_ENABLED=true` and `PAYMENTS_ENABLED=true` (either OFF keeps it closed).
- [ ] **Runtime key-class proof**: On the live production URL, `window.__APP_RUNTIME_CONFIG__.stripeKeyClass === "live"`. Any other value blocks launch: `"test"` = a test key reached production (billing risk), `"missing"` = the Vercel env override is absent, `"unknown"` = malformed key.
- [ ] **Webhook Endpoint**: Production URL `https://[PROJECT].supabase.co/functions/v1/stripe-webhook` is registered.
- [ ] **Webhook Secret**: `STRIPE_WEBHOOK_SECRET` (Supabase Edge secret) matches the **live** webhook endpoint's signing secret from the Stripe dashboard. Subscribed events include `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
- [ ] **Site URL**: `SITE_URL` (Supabase Edge secret) is the production URL — `stripe-checkout` fails closed without it and builds checkout success/cancel URLs from it.
- [ ] **Free Signup**: Public signup starts the unpaid baseline without Stripe checkout or card collection.
- [ ] **Pro Price ID (Supabase, live)**: `STRIPE_PRO_PRICE_ID` is set **directly in Supabase** Edge secrets to the recurring Pro **live** production price. Current soft-release target is **$9.99/month**. (Backend reads `STRIPE_PRO_PRICE_ID`, never `STRIPE_PRICE_ID`; fails closed if missing.)
- [ ] **No GitHub overwrite path**: `deploy-supabase-migrations.yml` does **not** sync `STRIPE_PRO_PRICE_ID`/`STRIPE_BASIC_PRICE_ID` into Supabase (auto-sync removed). If a guarded production price sync is ever reintroduced, it must be behind an explicit `confirm_live_stripe_secret_sync` input, names-only, never a default `operation=secrets`/`all` step.
- [ ] **Future Basic Pricing**: Stripe Basic may remain as a future placeholder. Current placeholder target is **$4.99/month**, but paid Basic checkout is intentionally unavailable in production code and must return `paid_basic_future` if requested directly.

## 2. Backend Infrastructure (Supabase)
- [ ] **Project URL**: `VITE_SUPABASE_URL` points to the production instance.
- [ ] **Service Role**: `SUPABASE_SERVICE_ROLE_KEY` is correctly set in Edge Function secrets.
- [ ] **CORS Origins (exact-origin, fail-closed — P0.3)**: The product origins are the **built-in** exact allowlist in `backend/supabase/functions/_shared/cors.ts` (`BUILTIN_ALLOWED_ORIGINS`): `https://speaksharp-public.vercel.app`, `https://speaksharp.ai`, `https://www.speaksharp.ai`, plus local dev `http://localhost:5173/5174` and `http://127.0.0.1:5173/5174`. `ALLOWED_ORIGIN` (Supabase Edge secret) is **only** for **additional exact** origins (e.g. an explicit preview host), comma-separated. Every entry (built-in and env) is normalized to a canonical `URL.origin` — there is **no** wildcard/suffix/substring match; malformed entries are logged and ignored. Verify the deployed edge functions echo an approved origin exactly and reject hostile lookalikes/wrong-protocol/unapproved-port with a **403 and NO `Access-Control-Allow-Origin`** (proven live by `tests/live/cors-exact-origin.live.spec.ts` in Gate 3, non-skipping). Note: `https://speaksharp.vercel.app` (legacy) is **not** an approved origin — only `speaksharp-public.vercel.app` is. The legacy origin was removed from the deploy `ALLOWED_ORIGIN` sync (#1010) and is **proven rejected in production** (preflight + POST → `403`, no `Access-Control-Allow-Origin`), confirmed by the live Gate 3 CORS DAST; the approved origin returns `204` with exact ACAO.
- [ ] **Auth Redirects**: Production domain added to Supabase Auth Allow List.
- [ ] **Storage Buckets**: Verify any production storage buckets still used by the app have correct RLS policies. Audio files are not expected to be stored for launch; finalized session records do persist transcript/analysis text needed for coaching comparison, PDF regeneration, AI suggestions, and WER-ready validation.

## 3. Vercel Frontend Environment Safety
- [ ] **No Profile Login Bypass**: Production and manual tester builds use real Supabase auth/profile state. `devBypass` and `VITE_DEV_USER` must not grant profile login, Pro, Private, or Cloud access in the app path.
- [ ] **Internal Routes Disabled**: Production Vercel environment has `VITE_ENABLE_INTERNAL_ROUTES` absent or set to `false`.
- [ ] **Production Mode Build**: Production deployment is built with Vite production mode, source maps disabled, and no manual auth bypass behavior enabled.
- [ ] **Release SHA exposed**: On the live production URL, `window.__APP_RUNTIME_CONFIG__.release` equals the deployed git commit SHA. Path: Vercel sets `VERCEL_GIT_COMMIT_SHA` at build → injected into `index.html` as the inline `window.__APP_RELEASE__` global → read into `window.__APP_RUNTIME_CONFIG__.release` (PR #1027; **no longer** a `__BUILD_ID__` JS define, which was removed to stop the volatile SHA rotating chunk hashes). Verify directly by reading `window.__APP_RELEASE__` from the deployed `index.html`. A value of `"unknown"` (runtime config) or absent `window.__APP_RELEASE__` means the build received no SHA, so bug reports / log correlation lose the build pin. (PROD-CONFIG-1)
- [ ] **Preview URL Policy**: Preview deployments must not be shared as tester/public URLs unless their environment is explicitly reviewed. Preview links may allow non-production developer behavior by design.

## 4. Observability & Monitoring
- [ ] **Sentry DSN**: `VITE_SENTRY_DSN` is set to the production project.
- [ ] **Backend Sentry DSN**: `SENTRY_DSN` is set for Edge Functions if backend ingest is used.
- [ ] **Sentry Ingest**: Verified one manual test error has been ingested in live project.
- [ ] **Log Levels**: Production `LOG_LEVEL` is set to `info` to avoid debug overhead.

## 5. Third-Party APIs
- [ ] **AssemblyAI**: `ASSEMBLYAI_API_KEY` using production paid-tier key.
- [ ] **PostHog**: `VITE_POSTHOG_KEY` set to production project.
- [ ] **AssemblyAI Token Denial**: Unauthenticated token request returns 401.
- [ ] **AssemblyAI Token Grant**: Authenticated, in-limit Pro token request returns a short-lived token.
- [ ] **AssemblyAI Over-Limit Denial**: Authenticated, over-limit Pro token request returns 403.

## 6. Live Database Entitlement Evidence
- [ ] **Free Baseline Function**: Live `effective_subscription_tier` falls back to `free` for null/unknown inactive statuses.
- [ ] **Usage Update Function**: Live `update_user_usage(INT, TEXT, UUID)` does not write `subscription_status = 'basic'` as part of a normal Free usage update.
- [ ] **Tier Config Rows**: Live `tier_configs.free` exists. If `tier_configs.basic` exists as a future placeholder, it must be equivalent to Free for current unpaid-baseline behavior or documented as inactive.
- [ ] **Private Sample Policy**: Fresh Free profile gets one server-backed Private sample (`private_sample_limit_seconds = 300`) while Browser transcription remains available before and after the sample.
- [ ] **Cloud Policy**: Private sample access does not grant Cloud STT. Cloud requires paid Pro entitlement evidence.

## 7. Security & Rate Limiting
- [ ] **Rate Limits**: `rate-limiter` config set to production values (e.g., 100/min per IP).
- [ ] **SSL/TLS**: Production domain has a valid, active certificate.
- [ ] **Private Sample Entitlement**: Migration `20260610143000_private_sample_entitlement.sql` is deployed. A fresh production signup creates a Free profile with sample fields and does not create an active Pro trial window.
- [ ] **#979 RPC grant lockdown**: Migration `20260714000000_harden_get_user_id_by_email_grant.sql` deployed; `db-grant-check.yml` reports EXECUTE on `public.get_user_id_by_email(text)` granted to **service_role only** (PUBLIC/anon/authenticated = none).

## 8. STT feature flags & runtime toggles (verify live build)
- [ ] **Native punctuation restore**: `VITE_NATIVE_PUNCTUATION_RESTORE` unset or `true` in the prod Vercel build (default-on word-preserving restore).
- [ ] **v4 disabled for release**: v4 WebGPU is OFF — PostHog `private_stt_v4_*` flags at 0%/off, and (if used) `VITE_PRIVATE_STT_V4_DISABLED='true'` build kill confirmed. Default Private saves `private_v2:whisper-base.en`.
- [ ] **Developer premium access**: `VITE_DEV_PREMIUM_ACCESS` is NOT relied on in production — it is unused in `src`; entitlement is server-driven (`stripe_subscription_id` required). No env Pro bypass in the prod build.
- [ ] **Sentry environment**: `VITE_SENTRY_DSN` set to the prod DSN; Sentry `environment` resolves to the prod build `MODE` (`production`).
- [ ] **SITE_URL**: Supabase Edge secret `SITE_URL` set to the production origin (Stripe checkout/portal redirects); no localhost fallback in prod.
- [ ] **Stripe gating (fail-closed, not key-class-gated)**: The beta stays closed because **both** `VITE_PAYMENTS_ENABLED` and `PAYMENTS_ENABLED` are OFF — NOT because a test key is deployed. The deployed app may legitimately carry `pk_live_`/`sk_live_`; `stripeKeyClass` reported by the runtime is informational and does not, by itself, open or close checkout. Do not assert "test key = beta"; assert the dual switches are off and the endpoint returns `403 payments_disabled` (see §1). Beta-50 billing freeze respected.

---

## 🛡️ Verification Protocol
1. **Manual Check**: Verify each key in the Supabase/Stripe/Vercel dashboards.
2. **Connectivity**: Invoke `check-usage-limit` via `curl` against production URL.
3. **Audit**: Review Supabase "Logs" for any environment variable load errors after deployment.
