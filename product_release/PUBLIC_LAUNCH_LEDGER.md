# Public Launch Ledger

> Broad public-launch ledger, not controlled tester release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

**Last updated:** 2026-05-26
**Current public-launch decision:** NO-GO
**Controlled desktop tester decision:** tracked separately in `product_release/RELEASE_STATUS.md`
**Workflow posture:** use `product_release/RELEASE_STATUS.md` for current CI, canary, RC, and ops-health evidence.

This ledger records broad public-launch gates and historical evidence. It must not be mixed with the controlled desktop tester burn-down, and it must not be used for current workflow status.

Historical artifact paths in this ledger may contain old `basic` filename slugs from earlier evidence captures. Treat those as artifact names only; the current public baseline is Free and paid Basic is a future placeholder.

## Gate Ledger

| ID | Gate | Severity | Why It Blocks Public Launch | Evidence Required | Status | Evidence |
|---|---|---:|---|---|---:|---|
| PL-001 | Public signup + first-user onboarding | P0 | A public user must be able to enter without admin-created accounts. | Brand-new user signs up through public UI, reaches Session, logs out/in, and recovers state. | PASS | `/private/tmp/speaksharp-pl001-public-signup-1778802961686/report.json`; public `/signup` alias fixed in commit `994d06a1` |
| PL-002 | First useful Free session | P0/P1 | New users need immediate product value. | Public user completes Native Browser session with transcript/save/history/detail/analytics, or receives clear browser/mic guidance. | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/report.json` |
| PL-003 | Production Stripe checkout | P0 | Public Pro purchase cannot rely on admin provisioning. | Checkout→entitlement journey proven; live keys configured for paid public. | ✅ JOURNEY PROVEN (TEST = accepted proof) / LIVE = OPS CUTOVER | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/report.json`; hosted Checkout completed with `cs_test_...`, returned to public app, and showed Pro entitlement. Per `RELEASE_CLOSEOUT_LEDGER.md` §D the test-mode journey **is** the accepted proof; opening paid public is a **config cutover** (swap to live keys + register live webhook + verify `stripeKeyClass==="live"`), not a required `cs_live_` money-proof. |
| PL-004 | Production Stripe webhook entitlement | P0 | Paid users must become Pro without manual intervention. | Production webhook verifies signature, updates entitlement, persists after refresh/logout/login. | PASS IN TEST MODE / LIVE KEYS PENDING | `/private/tmp/speaksharp-pl004-entitlement-recovery-1778805922232/report.json`; Stripe test checkout user stayed Pro through refresh and logout/login; deployed webhook rejected unsigned events; local webhook tests passed signed handler, downgrade, failure, and idempotency cases. Production launch still requires live Stripe keys and a live webhook rerun. |
| PL-005 | Billing failure/cancel/downgrade lifecycle | P0 | Stale Pro access or wrong downgrade is trust/billing risk. | Canceled, failed, duplicate, and replayed payment states keep entitlement correct. | PASS IN LOCAL/TEST MODE / LIVE EVENT PENDING | Local webhook tests prove cancellation, unpaid, past_due, 3+ payment failures, skipped duplicate events, and RPC failure handling. Live signed cancel/failure events require real Stripe webhook signing secret or Stripe test API access. |
| PL-006 | Automatic trial lifecycle | P0/P1 | Launch includes trials, so trial entitlement must be safe. | New signup receives one trial window; expired trial downgrades through effective-tier checks. | PASS | `/private/tmp/speaksharp-pl006-trial-1778806498265/report.json`; focused reuse proof `/private/tmp/speaksharp-pl006-reuse-timing-1778806590781/report.json`; expired trial live smoke run `25894288884` passed with artifact `7008001175` |
| PL-007 | Real-mic Pro Cloud | P1 | Cloud is marketed as a Pro feature. | Real human speech in normal Chrome produces Cloud transcript -> save -> history/detail/analytics. | PASS REAL-MIC | Manual Chrome physical-mic proof completed on 2026-05-15 with Pro account `manual-pro-cloud-20260515@speaksharp.app`: 40s Cloud session saved as `130bbc6c-5d89-465d-91e6-51f5a5951e34`, transcript present, history/detail Cloud metadata present, analytics WPM/clarity plausible. Screenshots: `/private/tmp/speaksharp-after-cloud-real-mic-session.png`, `/private/tmp/speaksharp-after-cloud-real-mic-analytics.png`, `/private/tmp/speaksharp-after-cloud-real-mic-detail.png`. |
| PL-008 | Pro AI feedback | P1 | AI is a launch promise. | Saved session generates useful AI feedback; provider failures degrade gracefully. | PASS | Pro STT artifact matrix run `25894670273` in `private` mode; `get-ai-suggestions` returned HTTP 200 with concrete coaching suggestions and no UI error. |
| PL-009 | Pro PDF export | P1 | PDF is a launch promise. | Exported PDF is parsed/inspected for transcript, metrics, branding, and engine metadata. | PASS | Pro STT artifact matrix run `25894670273`; downloaded PDF artifact parsed locally and contained SpeakSharp branding, duration/WPM, STT engine metadata, filler metrics, and transcript. |
| PL-010 | Mobile baseline | P1 | Public traffic will include mobile users. | Auth, nav, Session controls, transcript, fillers, status/toasts work on mobile viewport/device. | PASS VIEWPORT / PHYSICAL DEVICE PENDING | `/private/tmp/speaksharp-pl010-mobile-final2-1778808295430/report.json`; mobile public signup reached Session, idle status showed `Mic ready`, no inactive private-model progress leaked into Free Native Browser, idle sticky mobile action bar was hidden, and screenshots verify Recording -> Filler Words -> Live Transcript -> Stats ordering. Physical device/manual touch pass remains recommended before broad launch. |
| PL-011 | Observability/support loop | P1 | Public failures must be visible and triageable. | Frontend, Edge, provider, auth, billing, and tester feedback signals are distinguishable. | PASS | Observability API Smoke run `25895177106` passed. Frontend Sentry proof `launch-1778808400098-aec72cb1`, Edge Sentry proof `launch-1778808399999-043f128a`, and PostHog proof `launch-1778808399719-2476b62c` all had provider API readback. Tester fallback template exists at `.github/ISSUE_TEMPLATE/tester-feedback.yml`. |

## Phase Plan

| Phase | Gates Included | Exit Criteria | Status |
|---|---|---|---:|
| Phase 1: Public entry | PL-001, PL-002 | A brand-new public Free user can sign up, complete first useful session, and return after logout/login. | PASS |
| Phase 2: Paid entitlement | PL-003, PL-004, PL-005 | A real production payment creates durable Pro entitlement; cancel/failure/downgrade paths are safe. | TEST-MODE PARTIAL |
| Phase 3: Trial lifecycle | PL-006 | Public trial behavior is safe for redeem, reuse, expiry, and downgrade. | PASS |
| Phase 4: Pro product promises | PL-007, PL-008, PL-009 | Cloud, AI, and PDF each pass with provider/live artifact evidence. | PASS |
| Phase 5: Launch coverage | PL-010, PL-011 | Mobile baseline and observability/support are sufficient for uncontrolled public users. | PASS VIEWPORT; PHYSICAL MOBILE DEVICE STILL RECOMMENDED |

## Latest Evidence

| Gate | Account Source | Browser / Device | Evidence Type | Result | Report |
|---|---|---|---|---:|---|
| PL-001 | public-signup | Chrome CDP 9222 | manual-chrome-cdp | PASS | `/private/tmp/speaksharp-pl001-public-signup-1778802961686/report.json` |
| PL-002 | public-signup | Chrome CDP 9222 | manual-chrome-cdp; synthetic system speech attempted via macOS `say`; not manual-real-mic | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/report.json` |
| PL-003 | public-signup | Chrome CDP 9222 | manual-chrome-cdp; Stripe test-mode hosted checkout | PASS IN TEST MODE | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/report.json` |
| PL-004 | public-signup + Stripe test checkout | Chrome CDP 9222 plus deployed webhook HTTP check plus local Deno tests | manual-chrome-cdp; provider-live-api unsigned rejection; local webhook unit/adversarial | PASS IN TEST MODE | `/private/tmp/speaksharp-pl004-entitlement-recovery-1778805922232/report.json` |
| PL-005 | local webhook lifecycle tests | Deno | local webhook unit/adversarial | PASS IN LOCAL/TEST MODE | `deno test --config backend/supabase/functions/deno.json --allow-env --allow-net backend/supabase/functions/stripe-webhook/index.test.ts backend/supabase/functions/stripe-webhook/adversarial.test.ts`; `4 passed (14 steps)` |
| PL-006 | **Superseded access-lifecycle evidence** | Chrome CDP 9222; GitHub Actions live smoke | Historical public-access workflow | SUPERSEDED | Current paid-soft-release policy is #85: Browser-first plus one server-backed Private sample capped at 5 minutes. |
| PL-007 | Pro admin-created account | Normal Chrome via CDP 9222 with user speaking into physical mic | manual-real-mic + manual-chrome-cdp inspection | PASS | Session `130bbc6c-5d89-465d-91e6-51f5a5951e34`; screenshots `/private/tmp/speaksharp-after-cloud-real-mic-session.png`, `/private/tmp/speaksharp-after-cloud-real-mic-analytics.png`, `/private/tmp/speaksharp-after-cloud-real-mic-detail.png`. Provider-level fallback remains Cloud Live Smoke run `25895378619`, artifact `7008407787`. |
| PL-008 | saved Pro private session | GitHub Actions live browser workflow | automated-live-ui; provider-live-api `get-ai-suggestions` | PASS | Pro STT artifact matrix run `25894670273`; response logged `GET_AI_SUGGESTIONS_LIVE_RESPONSE` with HTTP 200 and coaching suggestions |
| PL-009 | saved Pro private session PDF export | GitHub Actions live browser workflow + local PDF parsing | automated-live-ui; downloaded PDF artifact parse | PASS | Pro STT artifact matrix run `25894670273`, artifact `7008146769`; parsed PDF at `/private/tmp/pro-stt-artifact-25894670273/test-results/live/live-pro-stt-artifact-matr-f2fb7-AI-feedback-and-exports-PDF-live-stt-chromium/session_20260515_e62369e1_ef68_417b_a303_f3e0c2eba441.pdf` |
| PL-010 | public-signup | isolated Playwright Chromium mobile viewport, 390x844 | mobile viewport UI screenshot proof; not physical-device/manual-touch evidence | PASS VIEWPORT | `/private/tmp/speaksharp-pl010-mobile-final2-1778808295430/report.json` |
| PL-011 | GitHub Actions observability smoke | Provider APIs | Sentry frontend ingest/readback; Edge Function Sentry ingest/readback; PostHog ingest/readback; GitHub feedback fallback | PASS | Workflow run `25895177106`; jobs `76106648644`, `76106648659`, `76106648669` |

## PL-002 Evidence Summary

| Step | Result | Evidence |
|---|---:|---|
| Create public Free account | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/02-after-signup.png` |
| Confirm Free state and Native Browser mode | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/03-basic-session-initial.png` |
| Start Native Browser recording | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/04-recording-started.png` |
| Observe live transcript | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/05-transcript-observation.png` |
| Stop recording | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/06-after-stop.png` |
| Save useful session | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/07-after-save.png` |
| Open Analytics/History | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/08-analytics.png` |
| Open session detail | PASS | `/private/tmp/speaksharp-pl002-basic-useful-session-1778803561321/09-session-detail.png` |

## PL-003 Test-Mode Checkout Summary

| Step | Result | Evidence |
|---|---:|---|
| Create public Free user | PASS | `/private/tmp/speaksharp-pl003-stripe-test-checkout-1778804816138/01-after-public-signup.png` |
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
| `STRIPE_PRO_PRICE_ID` | Live-mode recurring Pro price ID; soft-release target is $9.99/month |
| Frontend Stripe publishable key | `pk_live_...` for the deployed public app if Stripe.js is initialized client-side |
| `SITE_URL` | `https://speaksharp-public.vercel.app` |

At paid-public cutover, configure live Stripe keys/price/webhook (Ops launch-day step). The checkout→entitlement **journey is already the accepted proof in TEST mode** (`RELEASE_CLOSEOUT_LEDGER.md` §D) — a single controlled `cs_live_...` smoke after cutover is optional ops diligence, **not** a required money-proof gate. Public Free signup must not create a Stripe Checkout session. Paid Basic remains a future placeholder and direct checkout requests must return `paid_basic_future`.

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
| Duplicate/replayed webhook remains idempotent | Webhook is signature-verified + fails-closed (mode-agnostic; proven in the test-mode journey, `RELEASE_CLOSEOUT_LEDGER.md` §D). A live event replay is optional ops diligence, not a required gate. |

## PL-005 Billing Lifecycle Summary

| Scenario | Result | Evidence |
|---|---:|---|
| `customer.subscription.deleted` | PASS | Local webhook test maps event to the legacy `downgrade_to_basic` RPC action, which now writes the Free baseline. |
| `customer.subscription.updated` with `canceled` | PASS | Local webhook test maps status to the legacy `downgrade_to_basic` RPC action, which now writes the Free baseline. |
| `customer.subscription.updated` with `unpaid` | PASS | Local webhook test maps status to the legacy `downgrade_to_basic` RPC action, which now writes the Free baseline. |
| `customer.subscription.updated` with `past_due` | PASS | Local webhook test maps status to the legacy `downgrade_to_basic` RPC action, which now writes the Free baseline. |
| `customer.subscription.updated` with `active` | PASS | Local webhook test maps status to `none`. |
| `invoice.payment_failed` with fewer than 3 attempts | PASS | Local webhook test maps event to `none`. |
| `invoice.payment_failed` with 3+ attempts | PASS | Local webhook test maps event to the legacy `downgrade_to_basic` RPC action, which now writes the Free baseline. |
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

## PL-006 Access Lifecycle Summary

PL-006 is retained only as a historical evidence slot. Its original public-access
proofs are superseded by #85:

```text
Browser-first free path
-> one server-backed Private sample session capped at 5 minutes
-> paid Early Access for continued Private/local transcription
```

Do not use prior PL-006 artifacts as current paid-soft-release evidence. Current
closure requires the #85 migration/app-path proof on a real Supabase stack.

## Next Gate

| Gate | Why Next | Required Evidence |
|---|---|---|
| PL-003 / PL-004 / PL-005 Live Stripe configuration (Ops cutover) | The checkout→webhook→billing-portal **journey is PROVEN with Stripe TEST-mode keys = the accepted proof** (`RELEASE_CLOSEOUT_LEDGER.md` §D); live keys are not money-tested and not required as a proof. Only the **config cutover** remains for paid launch. | **Ops launch-day step (not a Dev/QA proof):** set `sk_live`/`pk_live`/live `whsec`/live price IDs in prod env, register the live webhook endpoint in the Stripe LIVE dashboard, then verify `window.__APP_RUNTIME_CONFIG__.stripeKeyClass==="live"`. The "Pending live keys/events" rows below are this cutover, not an outstanding proof. |

## PL-007 Cloud Transcript Attempt

| Step | Result | Evidence |
|---|---:|---|
| Login as Pro account | PASS | Pro account `manual-pro-cloud-20260515@speaksharp.app` created through `create-user.yml` run `25946599064`; Cloud-ready screenshot `/private/tmp/speaksharp-real-mic-cloud-ready.png`. |
| Select Cloud mode | PASS | `/private/tmp/speaksharp-real-mic-cloud-ready.png`; mode selected as Cloud with external-processing copy visible. |
| Record about 40 seconds with physical mic | PASS | User spoke into the normal browser mic; live Session showed 00:40 elapsed, transcript text, WPM 111, pauses, and Cloud selected. Screenshot `/private/tmp/speaksharp-after-cloud-real-mic-session.png`. |
| Stop/save/history/detail | PASS | Session saved; Analytics history row shows `CLOUD`, 0:41 duration, WPM 108, clarity 100%; detail page `/analytics/130bbc6c-5d89-465d-91e6-51f5a5951e34` shows `STT ENGINE Cloud` and transcript. Screenshots `/private/tmp/speaksharp-after-cloud-real-mic-analytics.png` and `/private/tmp/speaksharp-after-cloud-real-mic-detail.png`. |

### PL-007 Result

Provider-level Cloud transcript/persistence proof and normal Chrome physical-mic proof are now both green. The physical proof used a human-spoken session, not a fake audio fixture. The browser console emitted repeated `Flushing 0 queued audio chunks` logs at stop, but product evidence confirms Cloud transcript, save, history, detail, and analytics succeeded.

| Acceptable Evidence | Status |
|---|---:|
| Normal Chrome + real physical mic/human speech produces Cloud transcript -> save -> history/detail/analytics | PASS |
| Provider-level Cloud transcript proof plus deployed persistence proof | PASS; Cloud Live Smoke run `25895378619`, artifact `7008407787` |

## PL-007 Cloud Provider-Level Proof

| Scenario | Result | Evidence |
|---|---:|---|
| Pro Cloud mode starts against deployed app | PASS | Cloud Live Smoke run `25895378619`; test `Pro Cloud live STT can transcribe, save, and show analytics history` passed. |
| AssemblyAI token/provider path | PASS | Run used deployed app, Pro stored credentials, `/functions/v1/assemblyai-token`, and AssemblyAI WebSocket streaming. Logs show `WebSocket open` and audio chunks sent. |
| Cloud transcript appears | PASS | Log line `LIVE_CLOUD_TRANSCRIPT_EVIDENCE {"fixture":"harvard_benchmark_16k_loop_120s.wav","transcriptPreview":"A stale smell of old beer lingers...","transcriptLength":975,"wordCount":190}`. |
| Save and analytics history | PASS | The live smoke asserts Session saved and first analytics history item is visible after navigation to `/analytics`; overall test passed in `51.1s`. |
| Artifact retained | PASS | Artifact `7008407787`, `cloud-live-smoke-artifacts`. |
| Physical real mic | PASS | Manual Chrome physical-mic proof completed on 2026-05-15; see PL-007 result above. |

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
| Free Native Browser status is clean | PASS | Report shows `statusText: "Mic ready"` and `hasPrivateProgress: false`; inactive private model progress is not shown for Free Native Browser. |
| Idle sticky mobile action bar does not obstruct content | PASS | Report shows `mobileBtnVisibleIdle: false`; screenshots show no fixed Start Recording bar covering Filler Words, Transcript, or Stats while scrolling. |
| Mobile order is usable | PASS | Screenshots verify Recording Control first, Filler Words before Live Transcript, then Live Stats/Speaking Pace/Pause Analysis/Quick Tip. |
| Physical mobile device/touch pass | PENDING | Current evidence is an isolated Chromium mobile viewport, not a real phone/manual touch session. |

### PL-010 Fixes Applied

| Commit | Fix |
|---|---|
| `7905c25d` | Hid inactive private model progress from Free/Native Browser mobile action surfaces. |
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
