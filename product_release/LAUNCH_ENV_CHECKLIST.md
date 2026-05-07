**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-07

# Runtime Configuration Verification (Launch Checklist)

This checklist MUST be verified against the LIVE production environment. Modern failures often stem from environment mismatch; verification of runtime truth is the primary release gate.

---

## 1. Billing & Payments (Stripe)
- [ ] **Live Keys**: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` are using `sk_live_...` and `pk_live_...`.
- [ ] **Webhook Endpoint**: Production URL `https://[PROJECT].supabase.co/functions/v1/stripe-webhook` is registered.
- [ ] **Webhook Secret**: `STRIPE_WEBHOOK_SECRET` matches the production dashboard.
- [ ] **Price IDs**: `VITE_STRIPE_PRO_PRICE_ID` matches the production product ID.

## 2. Backend Infrastructure (Supabase)
- [ ] **Project URL**: `VITE_SUPABASE_URL` points to the production instance.
- [ ] **Service Role**: `SUPABASE_SERVICE_ROLE_KEY` is correctly set in Edge Function secrets.
- [ ] **CORS Origins**: `ALLOWED_ORIGIN` matches the production domain (e.g., `https://speaksharp.app`).
- [ ] **Auth Redirects**: Production domain added to Supabase Auth Allow List.
- [ ] **Storage Buckets**: `transcripts` and `audio` buckets exist with production RLS policies.

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

---

## 🛡️ Verification Protocol
1. **Manual Check**: Verify each key in the Supabase/Stripe/Vercel dashboards.
2. **Connectivity**: Invoke `check-usage-limit` via `curl` against production URL.
3. **Audit**: Review Supabase "Logs" for any environment variable load errors after deployment.
