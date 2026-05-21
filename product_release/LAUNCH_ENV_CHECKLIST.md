**Owner:** [unassigned]
**Last Reviewed:** 2026-05-15
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-15

# Runtime Configuration Verification (Launch Checklist)

<!-- PRODUCT_RELEASE_SYNC_START -->

## Current Evidence Snapshot (2026-05-15)

| Item | Current Status |
|---|---|
| Controlled desktop tester release | GO WITH LIMITATIONS; see `RELEASE_DECISION.md` and `TESTER_RELEASE_MATRIX.md`. |
| Broad public launch | NO-GO until remaining public-launch gates are proven; see `PUBLIC_LAUNCH_LEDGER.md`. |
| Latest release evidence commit | `1066ba6d` (`Use Node 24 artifact actions`). |
| CI/Test Audit | PASS: GitHub run `25944598514` on `main`. |
| Production canary | PASS: GitHub run `25944598537` on `main`. |
| Edge Function deploy | PASS: GitHub run `25944598524` on `main`. |
| Lighthouse release scores | Performance 98, Accessibility 94, Best Practices 100, SEO 100. |
| Artifact action runtime | Node 20 artifact warning resolved by upgrading `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`. |
| Documentation rule | This snapshot supersedes older run IDs or stale status tables lower in this file until those sections are next deeply reconciled. |

<!-- PRODUCT_RELEASE_SYNC_END -->

This checklist MUST be verified against the LIVE production environment. Modern failures often stem from environment mismatch; verification of runtime truth is the primary release gate.

---

## 1. Billing & Payments (Stripe)
- [ ] **Live Keys**: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` are using `sk_live_...` and `pk_live_...`.
- [ ] **Webhook Endpoint**: Production URL `https://[PROJECT].supabase.co/functions/v1/stripe-webhook` is registered.
- [ ] **Webhook Secret**: `STRIPE_WEBHOOK_SECRET` matches the production dashboard.
- [ ] **Price IDs**: `VITE_STRIPE_PRO_PRICE_ID` matches the production product ID.
- [ ] **Future Basic Pricing**: Stripe test-mode Product/Price IDs may be used to validate the deferred Basic checkout path without real charges. Do not treat test-mode Basic pricing as production-ready until the Free -> Basic app migration, Edge Function semantics, tests, and live Price ID are aligned.

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
- [ ] **Promo Generator Secret**: `PROMO_GEN_ADMIN_SECRET` is set in Supabase Edge Function secrets and GitHub Actions if production promo generation is run from CI. Without this secret, `pnpm generate-promo` cannot mint tester promo codes through the admin Edge Function.

---

## 🛡️ Verification Protocol
1. **Manual Check**: Verify each key in the Supabase/Stripe/Vercel dashboards.
2. **Connectivity**: Invoke `check-usage-limit` via `curl` against production URL.
3. **Audit**: Review Supabase "Logs" for any environment variable load errors after deployment.
