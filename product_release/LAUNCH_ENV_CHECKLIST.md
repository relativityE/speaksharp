**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-26

# Runtime Configuration Verification (Launch Checklist)

> Environment checklist, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This checklist MUST be verified against the LIVE production environment. Modern failures often stem from environment mismatch; verification of runtime truth is the primary release gate.

---

## 1. Billing & Payments (Stripe)
- [ ] **Live Keys**: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` are using `sk_live_...` and `pk_live_...`.
- [ ] **Webhook Endpoint**: Production URL `https://[PROJECT].supabase.co/functions/v1/stripe-webhook` is registered.
- [ ] **Webhook Secret**: `STRIPE_WEBHOOK_SECRET` matches the production dashboard.
- [ ] **Price IDs**: `VITE_STRIPE_PRO_PRICE_ID` matches the production product ID.
- [ ] **Future Basic Pricing**: Stripe test-mode Product/Price IDs may be used to validate a future paid Basic checkout path without real charges. Do not treat paid Basic pricing as production-ready until app copy, Edge Function semantics, tests, and live Price ID are aligned.

## 2. Backend Infrastructure (Supabase)
- [ ] **Project URL**: `VITE_SUPABASE_URL` points to the production instance.
- [ ] **Service Role**: `SUPABASE_SERVICE_ROLE_KEY` is correctly set in Edge Function secrets.
- [ ] **CORS Origins**: `ALLOWED_ORIGIN` matches the production domain (e.g., `https://speaksharp.app`).
- [ ] **Auth Redirects**: Production domain added to Supabase Auth Allow List.
- [ ] **Storage Buckets**: Verify any production storage buckets still used by the app have correct RLS policies. Audio files are not expected to be stored for launch; finalized session records do persist transcript/analysis text needed for coaching comparison, PDF regeneration, AI suggestions, and WER-ready validation.

## 3. Observability & Monitoring
- [ ] **Sentry DSN**: `VITE_SENTRY_DSN` is set to the production project.
- [ ] **Backend Sentry DSN**: `SENTRY_DSN` is set for Edge Functions if backend ingest is used.
- [ ] **Sentry Ingest**: Verified one manual test error has been ingested in live project.
- [ ] **Log Levels**: Production `LOG_LEVEL` is set to `info` to avoid debug overhead.

## 4. Third-Party APIs
- [ ] **AssemblyAI**: `ASSEMBLYAI_API_KEY` using production paid-tier key.
- [ ] **PostHog**: `VITE_POSTHOG_KEY` set to production project.
- [ ] **AssemblyAI Token Denial**: Unauthenticated token request returns 401.
- [ ] **AssemblyAI Token Grant**: Authenticated, in-limit Pro token request returns a short-lived token.
- [ ] **AssemblyAI Over-Limit Denial**: Authenticated, over-limit Pro token request returns 403.

## 5. Security & Rate Limiting
- [ ] **Rate Limits**: `rate-limiter` config set to production values (e.g., 100/min per IP).
- [ ] **SSL/TLS**: Production domain has a valid, active certificate.
- [ ] **Automatic Trial**: Migration `20260521100000_auto_trial_entitlements.sql` is deployed. A fresh production signup creates `trial_started_at` and `trial_expires_at` without any tester code or admin Edge Function.

---

## 🛡️ Verification Protocol
1. **Manual Check**: Verify each key in the Supabase/Stripe/Vercel dashboards.
2. **Connectivity**: Invoke `check-usage-limit` via `curl` against production URL.
3. **Audit**: Review Supabase "Logs" for any environment variable load errors after deployment.
