# Release Closeout Ledger

Dev-owned closeout per release-owner directive (2026-06-13). Every pending item has a single
status + named owner. Dev is review/support-only; this doc is documentation/disposition, not code.

## Target state (release-owner)

| Lane | Owner | Goal |
|---|---|---|
| #774 db push | Test/Ops | Apply migration and record proof |
| #775 merge | Test | Merge after green CI/review |
| #765/#772 proof | Test | Rerun under revised `repeated_span` acceptance |
| SLO/SLC | Test | Refresh current-SHA evidence |
| Stripe live cutover | Ops/Test/Product | Blocked until live Stripe keys (live paid launch IS in scope) |
| Backlog ledger | Dev | Convert deferred items into explicit non-blocking entries (this doc) |
| Group D branches | Test | Classify keep / delete / backlog |

## Live release lane — current status

| Item | Status | Owner | Proof |
|---|---|---|---|
| #770 migration reconciliation | Closed — merged | — | `46e0fd97`; prod migration run `27450253678` PASS |
| #771 recovery actions | Closed — merged | — | `c11789ef` |
| #773 exact-doubling collapse | Closed — merged (KEEP, do not revert) | — | `8cee74fe` |
| #774 index dedup + analytics routing | Closed — merged | — | `75fb9ac0` (branch deleted) |
| #774 migration apply (`supabase db push`) | Open — active Test/Ops | Test/Ops | migration `20260613100000`; record evidence |
| #775 canUsePrivate split + SunsetModals fix | Open — active Test | Test | CI 17/17 green; review/merge under invariants below |
| #765/#772 first-time-sample proof | Open — active Test | Test | rerun under revised acceptance (Section C) |
| `repeated_span` policy | Closed — explicit release-owner disposition | — | Option A non-destructive guardrail |

### #775 merge invariants (Test must confirm)
1. Paid Pro users still get Private.
2. Free users with a valid sample get Private only while the sample is valid.
3. Expired-sample users are locked again.
4. `SunsetModals` receives real paid-Pro status, not sample access.

## A. Backlog / disposition ledger (deferred, non-blocking)

| # | Item | Why non-blocking | Owner (post-release) | Next action | Needs |
|---|---|---|---|---|---|
| A1 | v4 app-path lifecycle proof, flag-on (#76) | transformers-js-v4 is behind a PostHog flag, OFF by default; shipped Private path is base Whisper | Dev | run flag-on lifecycle proof when v4 rollout scheduled | code + Test proof |
| A2 | Real RMS recording meter (#96 / AUDIT-C2) | current indicator is honest/decorative (not fake data); release-owner accepted decorative until RMS | Dev | wire `LiveRecordingCard` to real `micLevel` RMS | code |
| A3 | `repeated_span` principled fix (VAD/segmentation) | release uses non-destructive guardrail (Option A); transcript preserved + loop contained | Dev (STT lane) | VAD/segmentation to prevent loops at decode | code + Test proof |
| A4 | v4 cross-utterance context / decode tuning (#37) | v4 flag-gated / experimental | Dev | continue under v4 lane | code + Test proof |
| A5 | Test/naming-debt cleanup (chip `task_9633953d` remainder) | rename DONE (#775), collapse moved to util (#773); remaining = consolidate 3 e2e usage-limit mock layers into one + make e2e bootable locally | Dev/Test | consolidate mock source + fix local e2e boot | code (test infra) |
| A6 | Stale-branch cleanup: 7 `dev/v4-integration`-merged branches + closed `#767` branch | housekeeping; content reaches `main` only when `dev/v4-integration` merges | Test/release-owner | delete after `dev/v4-integration` lands (or convert to tracked) | Ops/Test access |

## B. Documentation-gap closures (recorded statuses)

- **#1 live DB entitlement evidence — Closed — merged** (#768/#769; `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`).
- **#4 Stripe customer-id persistence — Closed — verified already implemented.** `stripe-webhook` → `process_stripe_webhook_event(p_stripe_customer_id)` (migration `20260608190000_store_stripe_customer_id_in_webhook.sql`); 11 customer-id test assertions in `stripe-webhook/index.test.ts`.
- **#5 AI suggestion server-side quota — Closed — verified already implemented.** `get-ai-suggestions` → `consume_ai_suggestion_quota` (atomic `SECURITY DEFINER` counter, HTTP 429 on exhaustion, cached results bypass quota).
- **#6 session save / draft recovery — Closed — merged.** `services/sessionRecoveryDraft.ts` + `App.tsx` (`beforeunload`/`pagehide`/`visibilitychange`) + `SessionPage` restore + visible recovery actions (#771).
- **#85 Private sample entitlement — Closed — merged** (#770; live-verified end-to-end). Do NOT reopen.

## C. Prep-only checklist — #2 SLO/SLC (Dev verified the rig; Test RUNS it)

> Dev does NOT claim SLO/SLC passed. Test must run current-release-SHA evidence and confirm Verdict PASS.

- **Commands:** `pnpm ops:health` → `ops-health/ops-health.summary.json`; `pnpm metrics:service-levels` (synthesizes); full dry: `pnpm rc:slo:dry`.
- **Inputs read by `scripts/write-service-level-evidence.mjs`:** `product_release/evidence/software-quality.latest.json`, `test-results/stress/backend-stress.latest.json`, `test-results/endurance/browser-endurance.latest.json`, `ops-health/ops-health.summary.json`.
- **Outputs:** `product_release/evidence/service-levels.latest.json` + `service-levels-summary.latest.md`.
- **CI:** SLO/SLC workflow (last green run `27441628586` on `b0227ed8`) — re-dispatch on the current release SHA.
- **Targets present in rig:** auth_p95, usage_edge_p95, session_rpc_p95 (< 2000 ms release floor), stress_failure_rate (0%).

## D. Prep-only checklist — #3 Stripe live cutover (Ops/Test; Dev verified paths, touched NO live keys)

> Live paid launch IS in scope for this RC (release-owner). BLOCKED until live Stripe keys are provisioned. Dev does NOT enter live keys or run live-money proofs.

- **Functions:** `stripe-checkout`, `stripe-billing-portal`, `stripe-webhook` (`backend/supabase/functions/`).
- **LIVE env vars to set (deploy env):**
  - `STRIPE_SECRET_KEY` = `sk_live_…`
  - `STRIPE_WEBHOOK_SECRET` = live `whsec_…` (from the live webhook endpoint)
  - `STRIPE_PRO_PRICE_ID`, `STRIPE_BASIC_PRICE_ID` = LIVE price IDs
  - `SITE_URL` = production URL
  - confirm `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **Webhook endpoint:** register `{prod}/functions/v1/stripe-webhook` in the Stripe LIVE dashboard → copy the live `whsec_` → set `STRIPE_WEBHOOK_SECRET`.
- **Webhook security (already correct):** signature-verified via `constructEventAsync`/`constructEvent` (`stripe-webhook/index.ts:171-175`, secret L188); fails closed (non-2xx → Stripe retries).
- **Return URLs (already correct):** `success_url`/`cancel_url` server-derived from `SITE_URL` (`stripe-checkout/index.ts:258-259`); portal `return_url` from `SITE_URL`. No client-supplied URLs → open-redirect safe.
- **Customer-id persistence (already correct):** `process_stripe_webhook_event(p_stripe_customer_id)` (migration `20260608190000`) — verify on one live test event.
- **Ops/Test live-money proof (NOT Dev):** real checkout → webhook round-trip → subscription status + customer-id persisted → billing-portal open. Safe (test-key) checks already PASS (`27441691174` price audit, `27441691671` test-mode spine).

## Dev posture

Open — active Dev work: **none.** Dev is review/support-only. Reopen only on: (1) #775 CI re-fails with a concrete failure; (2) Test proves a concrete #765/#772 product failure under revised acceptance; (3) Test/Ops hits a concrete #774 migration-apply blocker; (4) release-owner assigns a specific backlog item. Dev will not mutate transcripts, implement fuzzy collapse, broaden the entitlement refactor, touch Group D, reopen #85, or start speculative cleanup.
