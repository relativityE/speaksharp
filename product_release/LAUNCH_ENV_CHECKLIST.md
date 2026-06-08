**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-29

# Runtime Configuration Verification (Launch Checklist)

> Environment checklist, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This checklist MUST be verified against the LIVE production environment. Modern failures often stem from environment mismatch; verification of runtime truth is the primary release gate.

---

## 1. Billing & Payments (Stripe)
- [ ] **Live Keys**: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` are using `sk_live_...` and `pk_live_...`.
- [ ] **Frontend publishable key injected by Vercel**: `VITE_STRIPE_PUBLISHABLE_KEY` is set to the `pk_live_...` key in the **Vercel project env (Production scope)**. The committed `frontend/.env.production` ships this **empty on purpose** (fail-closed) — a production build without the Vercel override renders `ConfigurationNeededPage` rather than silently shipping a Stripe TEST-mode key. There is no `pk_test_...` committed to the repo.
- [ ] **Runtime key-class proof**: On the live production URL, `window.__APP_RUNTIME_CONFIG__.stripeKeyClass === "live"`. Any other value blocks launch: `"test"` = a test key reached production (billing risk), `"missing"` = the Vercel env override is absent, `"unknown"` = malformed key.
- [ ] **Webhook Endpoint**: Production URL `https://[PROJECT].supabase.co/functions/v1/stripe-webhook` is registered.
- [ ] **Webhook Secret**: `STRIPE_WEBHOOK_SECRET` matches the production dashboard.
- [ ] **Free Signup**: Public signup starts the unpaid baseline without Stripe checkout or card collection.
- [ ] **Pro Price ID**: `STRIPE_PRO_PRICE_ID` matches the recurring Pro production price. Current soft-release target is **$9.99/month**.
- [ ] **Future Basic Pricing**: Stripe Basic may remain as a future placeholder. Current placeholder target is **$4.99/month**, but paid Basic checkout is intentionally unavailable in production code and must return `paid_basic_future` if requested directly.

## 2. Backend Infrastructure (Supabase)
- [ ] **Project URL**: `VITE_SUPABASE_URL` points to the production instance.
- [ ] **Service Role**: `SUPABASE_SERVICE_ROLE_KEY` is correctly set in Edge Function secrets.
- [ ] **CORS Origins**: `ALLOWED_ORIGIN` is set in Supabase Edge Function secrets to the exact allowed origins, comma-separated if needed. Current expected soft-release values are `https://speaksharp.vercel.app,https://speaksharp-public.vercel.app,http://localhost:5173`.
- [ ] **Auth Redirects**: Production domain added to Supabase Auth Allow List.
- [ ] **Storage Buckets**: Verify any production storage buckets still used by the app have correct RLS policies. Audio files are not expected to be stored for launch; finalized session records do persist transcript/analysis text needed for coaching comparison, PDF regeneration, AI suggestions, and WER-ready validation.

## 3. Vercel Frontend Environment Safety
- [ ] **No Profile Login Bypass**: Production and manual tester builds use real Supabase auth/profile state. `devBypass` and `VITE_DEV_USER` must not grant profile login, Pro, Private, or Cloud access in the app path.
- [ ] **Internal Routes Disabled**: Production Vercel environment has `VITE_ENABLE_INTERNAL_ROUTES` absent or set to `false`.
- [ ] **Production Mode Build**: Production deployment is built with Vite production mode, source maps disabled, and no manual auth bypass behavior enabled.
- [ ] **Release SHA exposed**: On the live production URL, `window.__APP_RUNTIME_CONFIG__.release` equals the deployed git commit SHA (Vercel sets `VERCEL_GIT_COMMIT_SHA` at build → `__BUILD_ID__`). A value of `"unknown"` means the build received no SHA, so bug reports / log correlation lose the build pin. (PROD-CONFIG-1)
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
- [ ] **Usage Update Function**: Live `update_user_usage(INT, TEXT)` does not write `subscription_status = 'basic'` as part of a normal Free usage update.
- [ ] **Tier Config Rows**: Live `tier_configs.free` exists. If `tier_configs.basic` exists as a future placeholder, it must be equivalent to Free for current unpaid-baseline behavior or documented as inactive.
- [ ] **Cloud Policy**: Active trial profile can use Private, but Cloud STT remains a Pro feature and is unavailable for trial.

## 7. Security & Rate Limiting
- [ ] **Rate Limits**: `rate-limiter` config set to production values (e.g., 100/min per IP).
- [ ] **SSL/TLS**: Production domain has a valid, active certificate.
- [ ] **Automatic Trial**: Migration `20260521100000_auto_trial_entitlements.sql` is deployed. A fresh production signup creates `trial_started_at` and `trial_expires_at` without any tester code or admin Edge Function.

---

## 🛡️ Verification Protocol
1. **Manual Check**: Verify each key in the Supabase/Stripe/Vercel dashboards.
2. **Connectivity**: Invoke `check-usage-limit` via `curl` against production URL.
3. **Audit**: Review Supabase "Logs" for any environment variable load errors after deployment.
