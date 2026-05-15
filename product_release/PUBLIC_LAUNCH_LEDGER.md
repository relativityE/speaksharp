# Public Launch Ledger

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

**Last updated:** 2026-05-15
**Current public-launch decision:** NO-GO
**Controlled desktop tester decision:** GO WITH LIMITATIONS, tracked separately in `product_release/RELEASE_DECISION.md`
**Latest workflow evidence commit:** `1066ba6d`
**Workflow hygiene:** Node 20 artifact warning resolved; CI/Test Audit, production canary, and Edge Function deploy are green on `main`.

This ledger is the source of truth for broad public launch gates. It must not be mixed with the controlled desktop tester burn-down.

## Gate Ledger

| ID | Gate | Severity | Why It Blocks Public Launch | Evidence Required | Status | Evidence |
|---|---|---:|---|---|---:|---|
| PL-001 | Public signup + first-user onboarding | P0 | A public user must be able to enter without admin-created accounts. | Brand-new user signs up through public UI, reaches Session, logs out/in, and recovers state. | PASS | `/private/tmp/speaksharp-pl001-public-signup-1778802961686/report.json`; public `/signup` alias fixed in commit `994d06a1` |
| PL-002 | First useful Basic session | P0/P1 | New users need immediate product value. | Public user completes Native Browser session with transcript/save/history/detail/analytics, or receives clear browser/mic guidance. | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/report.json` |
| PL-003 | Production Stripe checkout | P0 | Public Pro purchase cannot rely on admin provisioning or test mode. | Basic user starts production checkout from public UI and completes real payment. | PASS IN TEST MODE / LIVE KEYS PENDING | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/report.json`; hosted Checkout completed with `cs_test_...`, returned to public app, and showed Pro entitlement. Production launch still requires live Stripe keys and the same rerun with `cs_live_...`. |
| PL-004 | Production Stripe webhook entitlement | P0 | Paid users must become Pro without manual intervention. | Production webhook verifies signature, updates entitlement, persists after refresh/logout/login. | PASS IN TEST MODE / LIVE KEYS PENDING | `/private/tmp/speaksharp-pl004-entitlement-recovery-1778805922232/report.json`; Stripe test checkout user stayed Pro through refresh and logout/login; deployed webhook rejected unsigned events; local webhook tests passed signed handler, downgrade, failure, and idempotency cases. Production launch still requires live Stripe keys and a live webhook rerun. |
| PL-005 | Billing failure/cancel/downgrade lifecycle | P0 | Stale Pro access or wrong downgrade is trust/billing risk. | Canceled, failed, duplicate, and replayed payment states keep entitlement correct. | PASS IN LOCAL/TEST MODE / LIVE EVENT PENDING | Local webhook tests prove cancellation, unpaid, past_due, 3+ payment failures, skipped duplicate events, and RPC failure handling. Live signed cancel/failure events require real Stripe webhook signing secret or Stripe test API access. |
| PL-006 | Promo redemption/reuse/expiry | P0/P1 | Launch includes promos, so promo entitlement must be safe. | Public promo apply succeeds once, reuse/invalid/expired codes fail clearly, expiry downgrades correctly. | PASS | `/private/tmp/speaksharp-pl006-promo-1778806498265/report.json`; focused reuse proof `/private/tmp/speaksharp-pl006-reuse-timing-1778806590781/report.json`; expired promo live smoke run `25894288884` passed with artifact `7008001175` |
| PL-007 | Real-mic Pro Cloud | P1 | Cloud is marketed as a Pro feature. | Real human speech in normal Chrome produces Cloud transcript -> save -> history/detail/analytics. | PASS PROVIDER-LEVEL / REAL-MIC PENDING | Cloud Live Smoke run `25895378619` passed against the deployed app with Pro credentials, AssemblyAI token issuance, WebSocket audio streaming, Cloud transcript, save, and analytics history. Artifact `7008407787`. This is provider-level fake-audio fixture proof, not physical real-mic proof. |
| PL-008 | Pro AI feedback | P1 | AI is a launch promise. | Saved session generates useful AI feedback; provider failures degrade gracefully. | PASS | Pro STT artifact matrix run `25894670273` in `private` mode; `get-ai-suggestions` returned HTTP 200 with concrete coaching suggestions and no UI error. |
| PL-009 | Pro PDF export | P1 | PDF is a launch promise. | Exported PDF is parsed/inspected for transcript, metrics, branding, and engine metadata. | PASS | Pro STT artifact matrix run `25894670273`; downloaded PDF artifact parsed locally and contained SpeakSharp branding, duration/WPM, STT engine metadata, filler metrics, and transcript. |
| PL-010 | Mobile baseline | P1 | Public traffic will include mobile users. | Auth, nav, Session controls, transcript, fillers, status/toasts work on mobile viewport/device. | PASS VIEWPORT / PHYSICAL DEVICE PENDING | `/private/tmp/speaksharp-pl010-mobile-final2-1778808295430/report.json`; mobile public signup reached Session, idle status showed `Mic ready`, no inactive private-model progress leaked into Basic Native Browser, idle sticky mobile action bar was hidden, and screenshots verify Recording -> Filler Words -> Live Transcript -> Stats ordering. Physical device/manual touch pass remains recommended before broad launch. |
| PL-011 | Observability/support loop | P1 | Public failures must be visible and triageable. | Frontend, Edge, provider, auth, billing, and tester feedback signals are distinguishable. | PASS | Observability API Smoke run `25895177106` passed. Frontend Sentry proof `launch-1778808400098-aec72cb1`, Edge Sentry proof `launch-1778808399999-043f128a`, and PostHog proof `launch-1778808399719-2476b62c` all had provider API readback. Tester fallback template exists at `.github/ISSUE_TEMPLATE/tester-feedback.yml`. |

## Phase Plan

| Phase | Gates Included | Exit Criteria | Status |
|---|---|---|---:|
| Phase 1: Public entry | PL-001, PL-002 | A brand-new public Basic user can sign up, complete first useful session, and return after logout/login. | PASS |
| Phase 2: Paid entitlement | PL-003, PL-004, PL-005 | A real production payment creates durable Pro entitlement; cancel/failure/downgrade paths are safe. | TEST-MODE PARTIAL |
| Phase 3: Promo lifecycle | PL-006 | Public promo behavior is safe for redeem, reuse, expiry, and downgrade. | PASS |
| Phase 4: Pro product promises | PL-007, PL-008, PL-009 | Cloud, AI, and PDF each pass with provider/live artifact evidence. | PASS PROVIDER-LEVEL; REAL-MIC CLOUD STILL RECOMMENDED |
| Phase 5: Launch coverage | PL-010, PL-011 | Mobile baseline and observability/support are sufficient for uncontrolled public users. | PASS VIEWPORT; PHYSICAL MOBILE DEVICE STILL RECOMMENDED |

## Latest Evidence

| Gate | Account Source | Browser / Device | Evidence Type | Result | Report |
|---|---|---|---|---:|---|
| PL-001 | public-signup | Chrome CDP 9222 | manual-chrome-cdp | PASS | `/private/tmp/speaksharp-pl001-public-signup-1778802961686/report.json` |
| PL-002 | public-signup | Chrome CDP 9222 | manual-chrome-cdp; synthetic system speech attempted via macOS `say`; not manual-real-mic | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/report.json` |
| PL-003 | public-signup | Chrome CDP 9222 | manual-chrome-cdp; Stripe test-mode hosted checkout | PASS IN TEST MODE | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/report.json` |
| PL-004 | public-signup + Stripe test checkout | Chrome CDP 9222 plus deployed webhook HTTP check plus local Deno tests | manual-chrome-cdp; provider-live-api unsigned rejection; local webhook unit/adversarial | PASS IN TEST MODE | `/private/tmp/speaksharp-pl004-entitlement-recovery-1778805922232/report.json` |
| PL-005 | local webhook lifecycle tests | Deno | local webhook unit/adversarial | PASS IN LOCAL/TEST MODE | `deno test --config backend/supabase/functions/deno.json --allow-env --allow-net backend/supabase/functions/stripe-webhook/index.test.ts backend/supabase/functions/stripe-webhook/adversarial.test.ts`; `4 passed (14 steps)` |
| PL-006 | public-signup + generated one-use promo + expired-promo seeded workflow | Chrome CDP 9222; GitHub Actions live smoke | manual-chrome-cdp; promo-redemption-ui; provider-live-api/service-role seeded expired promo | PASS | `/private/tmp/speaksharp-pl006-promo-1778806498265/report.json`; `/private/tmp/speaksharp-pl006-reuse-timing-1778806590781/report.json`; GitHub run `25894288884` |
| PL-007 | Pro stored credentials | GitHub Actions live browser workflow + AssemblyAI provider + fake audio fixture | provider-live-api; automated-live-ui; fake audio fixture; not manual-real-mic | PASS PROVIDER-LEVEL | Cloud Live Smoke run `25895378619`, artifact `7008407787`; `LIVE_CLOUD_TRANSCRIPT_EVIDENCE` logged 975 chars / 190 words and the test passed save/history assertion. |
| PL-008 | saved Pro private session | GitHub Actions live browser workflow | automated-live-ui; provider-live-api `get-ai-suggestions` | PASS | Pro STT artifact matrix run `25894670273`; response logged `GET_AI_SUGGESTIONS_LIVE_RESPONSE` with HTTP 200 and coaching suggestions |
| PL-009 | saved Pro private session PDF export | GitHub Actions live browser workflow + local PDF parsing | automated-live-ui; downloaded PDF artifact parse | PASS | Pro STT artifact matrix run `25894670273`, artifact `7008146769`; parsed PDF at `/private/tmp/pro-stt-artifact-25894670273/test-results/live/live-pro-stt-artifact-matr-f2fb7-AI-feedback-and-exports-PDF-live-stt-chromium/session_20260515_e62369e1_ef68_417b_a303_f3e0c2eba441.pdf` |
| PL-010 | public-signup | isolated Playwright Chromium mobile viewport, 390x844 | mobile viewport UI screenshot proof; not physical-device/manual-touch evidence | PASS VIEWPORT | `/private/tmp/speaksharp-pl010-mobile-final2-1778808295430/report.json` |
| PL-011 | GitHub Actions observability smoke | Provider APIs | Sentry frontend ingest/readback; Edge Function Sentry ingest/readback; PostHog ingest/readback; GitHub feedback fallback | PASS | Workflow run `25895177106`; jobs `76106648644`, `76106648659`, `76106648669` |

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

## PL-004 Test-Mode Entitlement Summary

| Step | Result | Evidence |
|---|---:|---|
| Login after Stripe test checkout | PASS | `/private/tmp/speaksharp-pl004-entitlement-recovery-1778805922232/01-login-pro-session.png` |
| Refresh persistence | PASS | `/private/tmp/speaksharp-pl004-entitlement-recovery-1778805922232/02-after-reload.png` |
| Logout | PASS | `/private/tmp/speaksharp-pl004-entitlement-recovery-1778805922232/03-after-signout.png` |
| Logout/login persistence | PASS | `/private/tmp/speaksharp-pl004-entitlement-recovery-1778805922232/04-after-relogin.png` |
| Pro mode availability | PASS | `/private/tmp/speaksharp-pl004-entitlement-recovery-1778805922232/05-pro-modes-visible.png` |
| Deployed webhook unsigned rejection | PASS | `SUPABASE_URL=https://yxlapjuovrsvjswkwnrk.supabase.co STRIPE_WEBHOOK_SECRET= pnpm exec playwright test tests/live/stripe-webhook-readiness.live.spec.ts --config=playwright.deployed-live.config.ts --project=deployed-live-chromium --reporter=line --output=/private/tmp/speaksharp-pl004-webhook-readiness-net`; evidence printed `status:400`, `code:STRIPE_WEBHOOK_INVALID`, message `No stripe-signature header value was provided.` |
| Webhook handler/idempotency tests | PASS | `deno test --config backend/supabase/functions/deno.json --allow-env --allow-net backend/supabase/functions/stripe-webhook/index.test.ts backend/supabase/functions/stripe-webhook/adversarial.test.ts`; `4 passed (14 steps)` |

### PL-004 Remaining Production Requirement

The Stripe test-mode checkout proves the entitlement path executes correctly in the current environment. Broad public launch still requires the same proof with live Stripe keys:

| Requirement | Status |
|---|---:|
| Live Stripe Checkout session `cs_live_...` | Pending live keys |
| Live webhook signature verification from production Stripe event | Pending live keys |
| Live paid user remains Pro after refresh/logout/login | Pending live payment |
| Duplicate/replayed webhook remains idempotent | Covered locally; live replay proof pending if required |

## PL-005 Billing Lifecycle Summary

| Scenario | Result | Evidence |
|---|---:|---|
| `customer.subscription.deleted` | PASS | Local webhook test maps event to `downgrade_to_free` and calls atomic RPC. |
| `customer.subscription.updated` with `canceled` | PASS | Local webhook test maps status to `downgrade_to_free`. |
| `customer.subscription.updated` with `unpaid` | PASS | Local webhook test maps status to `downgrade_to_free`. |
| `customer.subscription.updated` with `past_due` | PASS | Local webhook test maps status to `downgrade_to_free`. |
| `customer.subscription.updated` with `active` | PASS | Local webhook test maps status to `none`. |
| `invoice.payment_failed` with fewer than 3 attempts | PASS | Local webhook test maps event to `none`. |
| `invoice.payment_failed` with 3+ attempts | PASS | Local webhook test maps event to `downgrade_to_free`. |
| Duplicate/replayed webhook event | PASS | Adversarial test returns `skipped: true` through the atomic webhook RPC. |
| RPC action failure | PASS | Adversarial test returns failure instead of pretending success, allowing retry. |

### PL-005 Remaining Production Requirement

The billing lifecycle contract is proven at handler/RPC-call level, but broad public launch still needs live/test-Stripe event proof:

| Requirement | Status |
|---|---:|
| Signed live/test Stripe cancellation event reaches deployed webhook | Pending real `whsec_...` or Stripe API/dashboard access |
| Signed live/test Stripe payment-failed event reaches deployed webhook | Pending real `whsec_...` or Stripe API/dashboard access |
| Paid public user downgrades in deployed UI after cancel/failure event | Pending live/test Stripe event |
| Duplicate/replayed deployed webhook remains idempotent | Covered locally; deployed signed replay pending if required |

## PL-006 Promo Lifecycle Summary

| Scenario | Result | Evidence |
|---|---:|---|
| Generate one-use public promo code | PASS | GitHub workflow `generate-promo.yml` run `25894147333` produced code `7574926` with duration `60 minutes` and `max_uses: 1`. |
| Invalid promo code during public signup | PASS | `/private/tmp/speaksharp-pl006-promo-1778806498265/invalid-first-after-submit.png`; user lands on Basic with clear `Promo failed: Invalid or inactive promo code` messaging. |
| Valid promo code during public signup | PASS | `/private/tmp/speaksharp-pl006-promo-1778806498265/valid-once-after-submit.png`; public signup lands on Session with `PRO` badge and Pro STT mode surface. |
| Reuse same one-use promo code | PASS | `/private/tmp/speaksharp-pl006-reuse-timing-1778806590781/report.json`; user lands on Basic with clear `Promo failed: Promo code already used` messaging. |
| Expired promo downgrade | PASS | GitHub workflow `expired-promo-live-smoke.yml` run `25894288884`; evidence line `LIVE_EXPIRED_PROMO_DENIAL_EVIDENCE {"checkUsageStatus":200,"promoJustExpired":true,"effectiveSubscriptionStatus":"free","isPro":false,"canStart":true,"storedSubscriptionStatus":"free","storedPromoExpired":true,"dialogDismissed":true,"sttMode":"native"}`. |
| Expired promo artifacts | PASS | GitHub artifact `7008001175`, `expired-promo-live-smoke-artifacts`. |

### PL-006 Notes

The UI proof used public signups and the deployed app. The expired-promo proof uses a seeded expired promo-only account through the dedicated live smoke workflow because expiry requires service-role setup that should not be performed manually through public UI.

## Next Gate

| Gate | Why Next | Required Evidence |
|---|---|---|
| PL-003 / PL-004 / PL-005 Live Stripe configuration | Cloud provider-level proof is now green; the remaining public-launch blocker is live Stripe keys/events. | Configure production Stripe live keys/price/webhook secret and rerun checkout, entitlement, cancellation/failure, and idempotency proof with live-mode evidence. |

## PL-007 Cloud Transcript Attempt

| Step | Result | Evidence |
|---|---:|---|
| Login as Pro-capable public account | PASS | `/private/tmp/speaksharp-pl007-cloud-1778806823269/01-after-login.png` |
| Select Cloud mode | PASS | `/private/tmp/speaksharp-pl007-cloud-1778806823269/04-cloud-selected.png` |
| Record for about 60 seconds | TOOL-LIMITED | `/private/tmp/speaksharp-pl007-cloud-1778806823269/06-after-60s-recording.png`; page showed Cloud and elapsed time but transcript stayed `Listening...`. |
| Stop/save/history/detail | NOT PROVEN | `/private/tmp/speaksharp-pl007-cloud-1778806823269/report.json`; no useful transcript/save path was available from this attempt. |

### PL-007 Remaining Requirement

Provider-level Cloud transcript and persistence proof is now green. A normal Chrome physical-mic proof is still recommended before broad marketing claims that depend on real-mic Cloud behavior.

| Acceptable Evidence | Status |
|---|---:|
| Normal Chrome + real physical mic/human speech produces Cloud transcript -> save -> history/detail/analytics | Pending / recommended |
| Provider-level Cloud transcript proof plus deployed persistence proof | PASS; Cloud Live Smoke run `25895378619`, artifact `7008407787` |

## PL-007 Cloud Provider-Level Proof

| Scenario | Result | Evidence |
|---|---:|---|
| Pro Cloud mode starts against deployed app | PASS | Cloud Live Smoke run `25895378619`; test `Pro Cloud live STT can transcribe, save, and show analytics history` passed. |
| AssemblyAI token/provider path | PASS | Run used deployed app, Pro stored credentials, `/functions/v1/assemblyai-token`, and AssemblyAI WebSocket streaming. Logs show `WebSocket open` and audio chunks sent. |
| Cloud transcript appears | PASS | Log line `LIVE_CLOUD_TRANSCRIPT_EVIDENCE {"fixture":"harvard_benchmark_16k_loop_120s.wav","transcriptPreview":"A stale smell of old beer lingers...","transcriptLength":975,"wordCount":190}`. |
| Save and analytics history | PASS | The live smoke asserts Session saved and first analytics history item is visible after navigation to `/analytics`; overall test passed in `51.1s`. |
| Artifact retained | PASS | Artifact `7008407787`, `cloud-live-smoke-artifacts`. |
| Physical real mic | PENDING | This proof used a fake audio fixture in a live browser workflow, not a physical microphone. |

## PL-008 AI Feedback Summary

| Scenario | Result | Evidence |
|---|---:|---|
| Saved Pro session opens detail page | PASS | Pro STT artifact matrix run `25894670273` created and opened `/analytics/12533362-fe0e-414d-b995-02d736a062f7`. |
| AI feedback provider call | PASS | Log line `GET_AI_SUGGESTIONS_LIVE_RESPONSE` returned status `200` from `https://yxlapjuovrsvjswkwnrk.supabase.co/functions/v1/get-ai-suggestions`. |
| AI output usefulness | PASS | Response body included summary plus coaching items for `Clarity`, `Pacing`, and `Filler Words`. |
| UI graceful failure check | PASS | Test asserted no `Error` heading appeared on the AI suggestions card after provider response. |

### PL-008 Evidence Caveat

The proof uses the dedicated live Pro artifact workflow with stored E2E Pro credentials and a live audio fixture. It is provider/live artifact evidence, not manual-real-mic evidence.

## PL-009 PDF Export Summary

| Scenario | Result | Evidence |
|---|---:|---|
| PDF download | PASS | Workflow run `25894670273`; filename `session_20260515_e62369e1_ef68_417b_a303_f3e0c2eba441.pdf`. |
| Artifact retained | PASS | GitHub artifact `7008146769`, `pro-stt-artifact-matrix-artifacts`. |
| Parsed text includes branding | PASS | Local parse found `SpeakSharp Session Report` and `Generated by SpeakSharp`. |
| Parsed text includes metrics | PASS | Local parse found `Duration: 1 minutes`, `Speaking Pace (WPM) 166`, pause metrics, and filler-word frequencies. |
| Parsed text includes engine metadata | PASS | Local parse found `STT Engine private (unknown, unknown, unknown)`. |
| Parsed text includes transcript | PASS | Local parse found the recorded private-session transcript text; parsed text length `949`. |

## PL-010 Mobile Baseline Summary

| Scenario | Result | Evidence |
|---|---:|---|
| Mobile public signup reaches Session | PASS | `/private/tmp/speaksharp-pl010-mobile-final2-1778808295430/01-auth-signup-mobile.png`; `/private/tmp/speaksharp-pl010-mobile-final2-1778808295430/02-session-top.png` |
| Basic Native Browser status is clean | PASS | Report shows `statusText: "Mic ready"` and `hasPrivateProgress: false`; inactive private model progress is not shown for Basic Native Browser. |
| Idle sticky mobile action bar does not obstruct content | PASS | Report shows `mobileBtnVisibleIdle: false`; screenshots show no fixed Start Recording bar covering Filler Words, Transcript, or Stats while scrolling. |
| Mobile order is usable | PASS | Screenshots verify Recording Control first, Filler Words before Live Transcript, then Live Stats/Speaking Pace/Pause Analysis/Quick Tip. |
| Physical mobile device/touch pass | PENDING | Current evidence is an isolated Chromium mobile viewport, not a real phone/manual touch session. |

### PL-010 Fixes Applied

| Commit | Fix |
|---|---|
| `7905c25d` | Hid inactive private model progress from Basic/Native Browser mobile action surfaces. |
| `cb75b1e2` | Stopped `StatusNotificationBar` from reading raw private model progress and hid the fixed mobile action bar while idle. |

## PL-011 Observability / Support Summary

| Surface | Result | Evidence |
|---|---:|---|
| Frontend Sentry ingest/readback | PASS | Observability API Smoke run `25895177106`, job `76106648644`; envelope accepted with event ID `bce2569a1568493593201a1ec4d763a0`, issue proof search confirmed proof `launch-1778808400098-aec72cb1`. |
| Edge Function Sentry ingest/readback | PASS | Observability API Smoke run `25895177106`, job `76106648659`; deployed `observability-smoke` returned status `200`, ingest status `200`, event ID `6e154ec3b48749f4a83d5d0b936d1260`, and issue proof search confirmed proof `launch-1778808399999-043f128a`. |
| PostHog ingest/readback | PASS | Observability API Smoke run `25895177106`, job `76106648669`; capture accepted status `200`, query readback found `launch_observability_smoke` with proof `launch-1778808399719-2476b62c`. |
| Tester feedback fallback | PASS | `.github/ISSUE_TEMPLATE/tester-feedback.yml` captures tester ID, flow, severity, steps, expected/actual, and evidence fields. |

### PL-011 Notes

The Sentry API token can read back issues but receives `403` on the events endpoint; the smoke still passes because issue proof search confirms the event. This is acceptable for launch triage, but broader Sentry Events API access can be upgraded later if deeper event-level querying is needed.
