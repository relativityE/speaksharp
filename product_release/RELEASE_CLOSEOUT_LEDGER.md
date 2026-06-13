# Release Closeout Ledger

Dev-owned closeout per release-owner directive (2026-06-13). Every pending item has a single
status + named owner. This doc is documentation/disposition. Dev is review/support-only EXCEPT
for the one concrete code task currently routed to Dev (#772 post-stop visible-final repetition,
fixed in PR #777 — see live-lane table).

_Last refreshed: 2026-06-13 (post #774/#775 merge; #772 Dev fix raised as PR #777)._

## Target state (release-owner)

| Lane | Owner | Goal | State |
|---|---|---|---|
| #774 db push | Test/Ops | Apply migration + record proof | Done — merged `75fb9ac0`; migration workflow `27470518053` PASS (push-deploy skips DB by design) |
| #775 merge | Test | Merge after green CI/review | Done — merged `9d4b90be` |
| #772 post-stop doubling | Dev | Fix post-stop visible duplication (display-only) | Done — PR #777 merged `18b2a30f` |
| #772 post-stop empty-after-sample | Dev → Test | Keep saved transcript visible after sample auto-save | Done — PR #778 merged `d06700b5` (narrow store-reset guard: post-sample saved transcript remains visible on `/session` after the forced native/browser mode switch, until the next recording). Test reruns live proof. |
| #765/#772 proof | Test | Rerun live proof after the #778 fix | Pending — rerun on `main` (post-#778, `d06700b5`); expect `visibleFinalMatchesSave=true` |
| SLO/SLC | Test | Refresh evidence on current SHA | PASS on `main@9d4b90be` (`27468651667`); needs rerun on post-#777/#778 `main` (`d06700b5`) for final sign-off |
| Stripe paths/journey | Test (proof) → Ops (cutover) | Prove billing journey + flip live at launch | Journey PROVEN with TEST keys (PASS); live launch = config cutover (swap test→live keys), not a money-test |
| Backlog ledger | Dev | Convert deferred items into explicit non-blocking entries (this doc) | Done — this doc |
| Group D branches | Test/release-owner | Classify keep / delete / backlog | Pending — owner decision (none confirmed merged to `main`) |

## Live release lane — current status

| Item | Status | Owner | Proof |
|---|---|---|---|
| #770 migration reconciliation | Closed — merged | — | `46e0fd97`; prod migration run `27450253678` PASS |
| #771 recovery actions | Closed — merged | — | `c11789ef` |
| #773 exact-doubling collapse | Closed — merged (KEEP, do not revert) | — | `8cee74fe` |
| #774 index dedup + analytics routing | Closed — merged | — | `75fb9ac0` (branch deleted) |
| #774 migration apply (`supabase db push`) | Closed — merged | — | migration `20260613100000`; dispatched migration workflow `27470518053` PASS (deploy-production-db + push-migrations PASS) |
| #775 canUsePrivate split + SunsetModals fix | Closed — merged | — | `9d4b90be`; deploy `27468389396`, canary `27468389402`, main CI `27468389406` PASS |
| #772 post-stop visible-final repetition (doubling) | Closed — merged | — | PR #777 `18b2a30f`; display-only collapse in settled view; panel 48/48, affected 85/85; saved transcript untouched |
| #772 post-stop visible-final empty (after sample auto-end) | Closed — merged | — | PR #778 `d06700b5`; narrow store-reset guard (`!sessionSaved` in `setSTTMode`): post-sample saved transcript stays visible on `/session` after the forced native/browser switch, until next recording; store 18/18, affected 92/92, tsc+eslint+build OK; saved data untouched |
| #765/#772 first-time-sample proof | Open — active Test | Test | rerun live proof on `main` (post-#778, `d06700b5`); expect `visibleFinalMatchesSave=true`; `repeated_span` accepted as guardrail, not the blocker |
| SLO/SLC service-level evidence | Open — rerun needed | Test | PASS on `main@9d4b90be` (`27468651667`); rerun on post-#777/#778 `main` (`d06700b5`) for final sign-off |
| `repeated_span` policy | Closed — explicit release-owner disposition | — | non-destructive guardrail: preserved, NOT collapsed, no fuzzy de-dup |

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
| A3 | `repeated_span` principled fix (VAD/segmentation) | release uses the non-destructive guardrail (ambiguous repeated spans preserved, not collapsed); transcript preserved + loop contained | Dev (STT lane) | VAD/segmentation to prevent loops at decode | code + Test proof |
| A4 | v4 cross-utterance context / decode tuning (#37) | v4 flag-gated / experimental | Dev | continue under v4 lane | code + Test proof |
| A5 | Test/naming-debt cleanup (chip `task_9633953d` remainder) | rename DONE (#775), collapse moved to util (#773); remaining = consolidate 3 e2e usage-limit mock layers into one + make e2e bootable locally | Dev/Test | consolidate mock source + fix local e2e boot | code (test infra) |
| A6 | Stale-branch cleanup: 7 `dev/v4-integration`-merged branches + closed `#767` branch | housekeeping; content reaches `main` only when `dev/v4-integration` merges | Test/release-owner | delete after `dev/v4-integration` lands (or convert to tracked) | Ops/Test access |

## B. Documentation-gap closures (recorded statuses)

- **#1 live DB entitlement evidence — Closed — merged** (#768/#769; `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`).
- **#4 Stripe customer-id persistence — Closed — verified already implemented.** `stripe-webhook` → `process_stripe_webhook_event(p_stripe_customer_id)` (migration `20260608190000_store_stripe_customer_id_in_webhook.sql`); 11 customer-id test assertions in `stripe-webhook/index.test.ts`.
- **#5 AI suggestion server-side quota — Closed — verified already implemented.** `get-ai-suggestions` → `consume_ai_suggestion_quota` (atomic `SECURITY DEFINER` counter, HTTP 429 on exhaustion, cached results bypass quota).
- **#6 session save / draft recovery — Closed — merged.** `services/sessionRecoveryDraft.ts` + `App.tsx` (`beforeunload`/`pagehide`/`visibilitychange`) + `SessionPage` restore + visible recovery actions (#771).
- **#85 Private sample entitlement — Closed — merged** (#770; live-verified end-to-end). Do NOT reopen.

## C. Prep-only checklist — #2 SLO/SLC (rig verified by Dev; RUN by Test)

> **Status: PASS on `main@9d4b90be` (`27468651667`); RERUN NEEDED.** #777 and #778 have since merged (current `main` = `d06700b5`), so Test should re-dispatch this on post-#778 `main` for final sign-off. The rig reference below stays for the re-run.

- **Commands:** `pnpm ops:health` → `ops-health/ops-health.summary.json`; `pnpm metrics:service-levels` (synthesizes); full dry: `pnpm rc:slo:dry`.
- **Inputs read by `scripts/write-service-level-evidence.mjs`:** `product_release/evidence/software-quality.latest.json`, `test-results/stress/backend-stress.latest.json`, `test-results/endurance/browser-endurance.latest.json`, `ops-health/ops-health.summary.json`.
- **Outputs:** `product_release/evidence/service-levels.latest.json` + `service-levels-summary.latest.md`.
- **CI:** SLO/SLC workflow (last green run `27441628586` on `b0227ed8`) — re-dispatch on the current release SHA.
- **Targets present in rig:** auth_p95, usage_edge_p95, session_rpc_p95 (< 2000 ms release floor), stress_failure_rate (0%).

## D. #3 Stripe — journey PROVEN with TEST-mode keys; going live = config cutover (NOT a money-test)

> **Correction (release-owner):** Stripe **live** keys are not — and cannot be — "tested" (no real-money transactions are run as a proof). The checkout → webhook → billing-portal **paths and full journey are proven with Stripe TEST-mode keys**, and they **PASS**. That test-mode journey is the accepted proof. Going to live paid launch is a **deployment/config cutover** (swap test keys for live keys + register the live webhook), performed by Ops at launch on the business go-decision — not a Dev/CI/QA money proof. Dev does not enter live keys.

- **Accepted proof (test mode) — PASS:** `27441691671` test-mode spine, `27441691174` price audit (checkout/webhook/portal journey exercised with `sk_test_…`). No real-money proof exists or is required.
- **Functions:** `stripe-checkout`, `stripe-billing-portal`, `stripe-webhook` (`backend/supabase/functions/`).
- **Go-live config cutover (Ops, at launch):** swap deploy-env vars from test → live:
  - `STRIPE_SECRET_KEY` = `sk_live_…`
  - `STRIPE_WEBHOOK_SECRET` = live `whsec_…` (from the live webhook endpoint)
  - `STRIPE_PRO_PRICE_ID`, `STRIPE_BASIC_PRICE_ID` = LIVE price IDs
  - `SITE_URL` = production URL; confirm `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **Webhook endpoint (cutover step):** register `{prod}/functions/v1/stripe-webhook` in the Stripe LIVE dashboard → copy the live `whsec_` → set `STRIPE_WEBHOOK_SECRET`.
- **Webhook security (already correct, mode-agnostic):** signature-verified via `constructEventAsync`/`constructEvent` (`stripe-webhook/index.ts:171-175`, secret L188); fails closed (non-2xx → Stripe retries).
- **Return URLs (already correct):** `success_url`/`cancel_url` server-derived from `SITE_URL` (`stripe-checkout/index.ts:258-259`); portal `return_url` from `SITE_URL`. No client-supplied URLs → open-redirect safe.
- **Customer-id persistence (already correct):** `process_stripe_webhook_event(p_stripe_customer_id)` (migration `20260608190000`) — exercised in the test-mode journey.
- **Not blocked on a proof.** The journey is proven (test mode). The only remaining item is the business decision to flip live keys at cutover.

## Dev posture

Active Dev work: **none in flight.** Both #772 failures are fixed and merged: the post-stop doubling (PR #777 `18b2a30f`) and the post-sample empty-visible (PR #778 `d06700b5`, narrow store-reset guard). Test reruns the #765/#772 live proof on post-#778 `main`. Per release-owner, **#778 is the last authorized product-code fix unless Test finds a new concrete release-blocking failure.**

Reopen Dev work only on: (1) a *new* concrete failure in #777/#778/#765/#772 under the live proof; (2) Test/Ops hits a concrete #774 migration-apply blocker (merged + applied, workflow `27470518053` PASS — not expected); (3) release-owner assigns a specific backlog item. Dev will not mutate the saved/stored transcript, implement fuzzy collapse, collapse ambiguous `repeated_span`, broaden the entitlement refactor, touch Group D, reopen #85, or start speculative cleanup. #773 stays (no revert).
