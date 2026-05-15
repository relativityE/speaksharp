# Public Launch Ledger

**Last updated:** 2026-05-14
**Current public-launch decision:** NO-GO
**Controlled desktop tester decision:** GO WITH LIMITATIONS, tracked separately in `product_release/RELEASE_DECISION.md`

This ledger is the source of truth for broad public launch gates. It must not be mixed with the controlled desktop tester burn-down.

## Gate Ledger

| ID | Gate | Severity | Why It Blocks Public Launch | Evidence Required | Status | Evidence |
|---|---|---:|---|---|---:|---|
| PL-001 | Public signup + first-user onboarding | P0 | A public user must be able to enter without admin-created accounts. | Brand-new user signs up through public UI, reaches Session, logs out/in, and recovers state. | PASS | `/private/tmp/speaksharp-pl001-public-signup-1778802961686/report.json`; public `/signup` alias fixed in commit `994d06a1` |
| PL-002 | First useful Basic session | P0/P1 | New users need immediate product value. | Public user completes Native Browser session with transcript/save/history/detail/analytics, or receives clear browser/mic guidance. | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/report.json` |
| PL-003 | Production Stripe checkout | P0 | Public Pro purchase cannot rely on admin provisioning or test mode. | Basic user starts production checkout from public UI and completes real payment. | PASS IN TEST MODE / LIVE KEYS PENDING | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/report.json`; hosted Checkout completed with `cs_test_...`, returned to public app, and showed Pro entitlement. Production launch still requires live Stripe keys and the same rerun with `cs_live_...`. |
| PL-004 | Production Stripe webhook entitlement | P0 | Paid users must become Pro without manual intervention. | Production webhook verifies signature, updates entitlement, persists after refresh/logout/login. | OPEN | Not started |
| PL-005 | Billing failure/cancel/downgrade lifecycle | P0 | Stale Pro access or wrong downgrade is trust/billing risk. | Canceled, failed, duplicate, and replayed payment states keep entitlement correct. | OPEN | Not started |
| PL-006 | Promo redemption/reuse/expiry | P0/P1 | Launch includes promos, so promo entitlement must be safe. | Public promo apply succeeds once, reuse/invalid/expired codes fail clearly, expiry downgrades correctly. | OPEN | Not started |
| PL-007 | Real-mic Pro Cloud | P1 | Cloud is marketed as a Pro feature. | Real human speech in normal Chrome produces Cloud transcript -> save -> history/detail/analytics. | OPEN | Not started |
| PL-008 | Pro AI feedback | P1 | AI is a launch promise. | Saved session generates useful AI feedback; provider failures degrade gracefully. | OPEN | Not started |
| PL-009 | Pro PDF export | P1 | PDF is a launch promise. | Exported PDF is parsed/inspected for transcript, metrics, branding, and engine metadata. | OPEN | Not started |
| PL-010 | Mobile baseline | P1 | Public traffic will include mobile users. | Auth, nav, Session controls, transcript, fillers, status/toasts work on mobile viewport/device. | OPEN | Not started |
| PL-011 | Observability/support loop | P1 | Public failures must be visible and triageable. | Frontend, Edge, provider, auth, billing, and tester feedback signals are distinguishable. | OPEN | Not started |

## Phase Plan

| Phase | Gates Included | Exit Criteria | Status |
|---|---|---|---:|
| Phase 1: Public entry | PL-001, PL-002 | A brand-new public Basic user can sign up, complete first useful session, and return after logout/login. | PASS |
| Phase 2: Paid entitlement | PL-003, PL-004, PL-005 | A real production payment creates durable Pro entitlement; cancel/failure/downgrade paths are safe. | TEST-MODE PARTIAL |
| Phase 3: Promo lifecycle | PL-006 | Public promo behavior is safe for redeem, reuse, expiry, and downgrade. | OPEN |
| Phase 4: Pro product promises | PL-007, PL-008, PL-009 | Cloud, AI, and PDF each pass with provider/live artifact evidence. | OPEN |
| Phase 5: Launch coverage | PL-010, PL-011 | Mobile baseline and observability/support are sufficient for uncontrolled public users. | OPEN |

## Latest Evidence

| Gate | Account Source | Browser / Device | Evidence Type | Result | Report |
|---|---|---|---|---:|---|
| PL-001 | public-signup | Chrome CDP 9222 | manual-chrome-cdp | PASS | `/private/tmp/speaksharp-pl001-public-signup-1778802961686/report.json` |
| PL-002 | public-signup | Chrome CDP 9222 | manual-chrome-cdp; synthetic system speech attempted via macOS `say`; not manual-real-mic | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/report.json` |
| PL-003 | public-signup | Chrome CDP 9222 | manual-chrome-cdp; Stripe test-mode hosted checkout | PASS IN TEST MODE | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/report.json` |

## PL-002 Evidence Summary

| Step | Result | Evidence |
|---|---:|---|
| Create public Basic account | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/02-after-signup.png` |
| Confirm Basic state and Native Browser mode | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/03-basic-session-initial.png` |
| Start Native Browser recording | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/04-recording-started.png` |
| Observe live transcript | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/05-transcript-observation.png` |
| Stop recording | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/06-after-stop.png` |
| Save useful session | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/07-after-save.png` |
| Open Analytics/History | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/08-analytics.png` |
| Open session detail | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/09-session-detail.png` |

## PL-003 Test-Mode Checkout Summary

| Step | Result | Evidence |
|---|---:|---|
| Create public Basic user | PASS | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/01-after-public-signup.png` |
| Hosted checkout reached | PASS | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/02-stripe-checkout.png`; session was `cs_test_a1ksc1qy9SrUbrCzDNfLwV4DBDifoXG1gcpjdYP2IyvzHVAPIZyyieIdIK` |
| Fill Stripe test card | PASS | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/03-stripe-filled.png` |
| Submit Stripe checkout | PASS | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/03-stripe-filled.png` |
| Return to public app | PASS | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/04-after-checkout-return.png`; returned to `https://speaksharp-public.vercel.app/session` |
| Pro entitlement surface after reload | PASS | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/05-entitlement-after-reload.png` |

### Configuration Fix Applied During Burn-Down

The first PL-003 run proved the checkout success URL was using the wrong app origin:

| Previous Result | Fix Applied |
|---|---|
| Stripe returned to `https://speaksharp.app/session?checkout=success`, which served `{"detail":"Not Found"}`. | Updated deployed Supabase Edge Function secret `SITE_URL=https://speaksharp-public.vercel.app`. |

### Remaining Production Requirement

Configure the deployed production checkout environment with live Stripe credentials and a live Pro price:

| Required Secret / Config | Expected |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` in the production Supabase Edge Function environment |
| `STRIPE_PRO_PRICE_ID` | Live-mode recurring Pro price ID |
| Frontend Stripe publishable key | `pk_live_...` for the deployed public app if Stripe.js is initialized client-side |
| `SITE_URL` | `https://speaksharp-public.vercel.app` |

After updating live Stripe configuration, rerun the same PL-003 flow from the public UI and require a `cs_live_...` Checkout session plus real payment completion before broad public launch.

## Next Gate

| Gate | Why Next | Required Evidence |
|---|---|---|
| PL-004 Production Stripe webhook entitlement | Checkout execution is proven in test mode; entitlement lifecycle now needs explicit webhook verification. | Production webhook verifies signature, updates entitlement, and entitlement persists after refresh/logout/login. Test-mode evidence can be used as a rehearsal only; production still requires live keys before broad launch. |
