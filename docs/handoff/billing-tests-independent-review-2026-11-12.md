# Billing tests: independent review and the two tests worth keeping

2026-11-12. Independent, read-only review for Sam's deep review and Akin's go. Nothing was pushed, run,
dispatched or changed, and no Stripe key was used. Base: main `7bdad2b`. PR heads: #1795 `901d6f95`,
#1813 `3e4b9829`, #1822 `077e7d46`.

Legend: **[seen]** read in code, a PR or a run record. **[inferred]** reasoned, not confirmed by a run.
**[docs]** Stripe's own documentation, not checked against our account.

`/mnt/project-files/.notes/inputs.md` does not exist, so nothing was taken from it.

## Summary

1. **I agree with the shape of the existing proposal (two tests), but not with how it builds test 2, and it
   misses two real gaps.**
2. **Gap 1: the offline billing qualification does not run on merge-ready PRs or on main.** It sits only in
   CI's `draft-checks` job, which is skipped whenever the full lane runs (`ci.yml:74-77`, `:189`). Main's
   latest CI run 43124571682 shows `draft-checks` skipped. The proposal says it runs on every PR. A one-step
   move into the full lane fixes it.
3. **Gap 2: the test-clock lifecycle (the one Stripe test that has passed) does not go through the checkout
   path real customers use.** Its fake checkout event carries no `billingOperationId`, so the webhook takes
   the legacy RPC path, not `apply_account_checkout_snapshot`, which every real checkout has used since the
   checkout-settlement change (`stripe-webhook/index.ts:176-220`, `stripe-checkout/index.ts:396-417`).
4. **The #1795/#1813/#1822 stack cannot pass as written.** Its cleanup reads three tables that migrations
   revoke from the service role, so every journey ends `cleanup_unproven` even when billing works. Its
   `supabase start` uses the repo seed, which collides with the signup trigger. The two local fixes the
   proposal cites (`c203e640`, `765e93c6`) are not on GitHub.
5. **My design:**
   - **Test 1, billing contract, gates every merge:** the offline, database and function tests, with the
     qualification step moved into the full lane.
   - **Test 2, Stripe test-mode check, two stages in one workflow:**
     - **Stage L, lifecycle:** the existing test-clock runner, upgraded. It runs automatically on
       billing-path PRs and weekly, with no approval needed.
     - **Stage C, hosted Checkout:** #1795's conversion and portal journeys on #1813's local stack, fixed.
       It runs before a billing release, with approval.
   - **Retire:** the canary billing lane, the June live spec and #1795's renewal_recovery, which duplicates
     stage L.
   - **Keep out of the billing gate:** #1822's paid value loop. It is a product test that happens to need a
     paid account.

---

## 1. The outcome the billing tests must protect

From `product_release/ENTITLEMENTS_AND_BILLING.md` (authoritative product contract) and the code [seen]:

| # | What a trialling or paying user must experience | Where it is enforced | Business harm if it breaks |
|---|---|---|---|
| O1 | A new account gets the full product free for 30 days, from server time, with **no Stripe object** | signup trigger `ensure_trial_profile_for_new_user`, five-argument `effective_subscription_tier` | Lost signups; or a premature charge |
| O2 | At exact expiry an unpaid account can't record, save or analyse a new take, but keeps History, Progress, export, account and upgrade | DB resolver; contract "Server authority and expiry" | Free use forever (revenue leak), or a locked-out user losing their data (trust) |
| O3 | Paying is hosted Stripe Checkout for **exactly $10.00 monthly, billed at once (no Stripe trial)**, and Pro access follows without manual help and survives reload and sign-in | `stripe-checkout/index.ts:321-349` (price check), `:396-417` (reservation and session); webhook `:85-233` | **Highest:** a customer pays and gets nothing; or a wrong price is charged |
| O4 | Renewal keeps access; a failed payment stops new recording; paying the open invoice restores access | webhook grants only `active`/`trialing` (`:153-156`) | Access without payment, or a paying user cut off |
| O5 | A paid user can open the portal and cancel; access lasts to period end, then stops; account and history stay | `stripe-billing-portal`; `cancel_at_period_end` handling (`:155`) | Can't cancel (consumer-protection exposure); access cut early; or charging after cancel |
| O6 | Safety: checkout stays closed until activation; forged or unsigned events are refused; a wrong price can't grant; duplicates are idempotent; no test touches live money | checkout gate `:152-170`; signature check `:69-73`; snapshot RPC idempotent per event id | A live charge during testing; free Pro by forged event |

Two facts shape the design:

- **Payments are not live.** Checkout refuses anything but a live key with payments on (`stripe-checkout/index.ts:156-170`). Until activation, the tests protect against regressions and prepare for activation day. They do not watch revenue.
- **The webhook trusts very little of the event.** It takes the event type and ids, then re-reads the subscription from Stripe (`subscriptions.retrieve`, webhook `:136-145`) and decides from Stripe's current state. Only `checkout.session.completed` carries facts the handler uses directly: `metadata.userId`, `client_reference_id`, `customer`, `subscription` and `billingOperationId`. This matters for the question in section 3.3.

---

## 2. Every billing test: why it worked, broke or never ran, and what to keep

### 2.1 Corrections to the claimed history

| Claim | What the record shows |
|---|---|
| Offline billing tests run on every PR | **Only partly.** `pnpm test:billing-qualification` is in `draft-checks` only (`ci.yml:74-77`, `:189`). That job is skipped for any non-draft PR, push or merge-queue run (`scripts/ci-change-scope.mjs:93-101`). Run 43124571682 on main: `draft-checks` skipped [seen]. The database tests in `tests/db` and `tests/billing` run in the unit shards, and the function tests run in `edge-tests` on the full lane [seen]. The comment at `ci.yml:180-182` ("Runs every CI") is now false. |
| Lifecycle passed Aug 30 and Nov 11 by manual dispatch | Aug 30's passes (runs 33305168019 and 33308173788) were **pull_request** runs, after **6** failures (runs 1 to 6), not 7. Nov 11 (run 43030974465) is the **only dispatch ever** (9 runs in total) [seen]. |
| Canary billing step never passed: a payment-method bug, then the canary trial account expired | The first half is right: Sep 28's billing lane failed while active-trial passed (run 36419538307, job 108918797248). The bug is in `runner.ts:176-177`, which passes the `pm_card_visa` token as the default payment method; `commercialRunner.ts:156-162` documents and fixes the same bug. **The second half is wrong.** The billing lane never uses the trial account (`canary.yml:170-177`, `:182`). The only October Monday run, 40316411691 on Oct 26, stopped at the release-identity job ("verify last released production identity"), so no lane ran. The trial expiry breaks only the active-trial lane. |
| June spec broke after #995 | Consistent with code: checkout now needs `sk_live_` (`stripe-checkout/index.ts:160-161`). Also, it never required Stripe's own event (below). |
| #1795, #1813, #1822: none has run | Right. The workflow file has no runs and is not registered (GitHub returns 404) [seen by the sub-review]. |

### 2.2 Test by test

**A. Offline billing qualification** (`scripts/billing-qualification/*.test.ts`, Deno with PGlite and a fake Stripe)
- **Why it works:** it drives the real handler on real migrations with no network.
- **Weakness:** it runs only on drafts, so a merge can break it unseen (2.1). Not run here; this machine has no Deno.
- **Keep:** all of it, including the fake-Stripe request-shape and order assertions (`runner.test.ts`).

**B. Database tests** (`tests/db/*` webhook lifecycle, checkout rejection recovery, trial journey and activation, `tests/billing/commercialLifecycle.test.ts`)
- **Why it works:** they run in the vitest unit shards on the full lane [seen].
- **Weakness:** the two matrix workflows (`webhook-snapshot-db-matrix.yml`, `trial-commercial-db-matrix.yml`) trigger only on PRs touching named, older files, so a new billing migration doesn't trigger them [seen].
- **Keep:** as they are.

**C. Function tests** (`backend/supabase/functions/stripe-*`)
- **Why it works:** the `edge-tests` job on the full lane [seen].
- **Coverage:** the only test of which RPC the handler picks for a reserved checkout (`stripe-webhook/index.test.ts:43-91`, mocked).
- **Keep:** as they are.

**D. Test-clock lifecycle** (`stripe-commercial-lifecycle.yml`, `commercialRunner.ts`)
- **Why it worked:**
  - It is small: one process, 344 lines, about 2 minutes.
  - It creates real Stripe test objects, so subscription status, invoices and the $10 price check are Stripe's own; the handler re-reads them.
  - On Aug 30 it had a `pull_request` trigger scoped to billing paths, so it ran from the PR and fixes landed six times in an hour (runs 1 to 8, each commit message naming the fix).
  - Cleanup is proven by a 404 (`commercialRunner.ts:299-340`).
- **Why it went stale:** #1654 removed the PR trigger (per the earlier investigation; not re-checked). After that it ran once in ten weeks.
- **Weaknesses:**
  1. **It binds through the legacy path.** Its checkout event has no `billingOperationId` (`commercialRunner.ts:195-197`), so the handler calls `apply_stripe_subscription_snapshot` then `settle_account_checkout(null)`. Real checkouts go through `apply_account_checkout_snapshot` [seen]. That path has database coverage only through the account-closure tests [seen grep].
  2. **It doesn't check where events come from.** It signs and posts its own events (`:33-44`).
  3. **Its duplicate and out-of-order checks prove little.** The handler re-reads the current subscription, so an old event still applies the current state and Pro stays Pro either way [inferred from webhook `:136-145`]. The check can only fail if the RPC applies an older event's period over a newer one.
  4. **Three of its "casualties" test the test.** `wrong_currency`, `wrong_amount` and `unpaid_first_invoice` (`:241-249`) feed altered objects to the test's own `assertFirstPaidInvoice`, not to product code. So does `premature_stripe_object`.
  5. **It doesn't check which Stripe account the key belongs to.** There is no account-identity preflight, which Sam asked for [seen absence].
- **Keep:** the whole runner as stage L, with the fixes in section 4.

**E. Canary weekly billing lane** (`canary.yml:210-240`, `runner.ts`)
- **Why it never worked:**
  - The token bug above.
  - Since October it sits behind the canary's release-identity gate, so it never even starts [seen].
- **Coverage:** an older, weaker copy of D.
- **Keep:** nothing. Retire it.

**F. June live soft-launch spec** (`tests/live/stripe-paid-soft-launch-runtime.live.spec.ts`)
- **Why it "worked" in June:**
  - It completed real hosted Checkout on the public app in test mode.
  - It then **always posted its own signed `checkout.session.completed`** (`:494-527`) and a synthetic downgrade (`:575-589`).
  - Whether Stripe's own event had already granted Pro was recorded in a try/catch, not required (`:478-489`).
  - The portal check only asserts a `billing.stripe.com` URL comes back (`:544-545`).
  - So it would have passed even with the real webhook broken.
- **Why it broke:** #995's live-key gate. In live mode it would need real money.
- **Keep:** nothing new. #1795 already has its own Checkout filling. Retire it from the Live Release Matrix (`live-release-matrix.yml:17`).

**G. Manual Checkout, May 15** (`PUBLIC_LAUNCH_LEDGER.md` PL-003 to PL-005)
- **Why it matters:** its first run found a **deployed configuration bug.** Stripe returned to `speaksharp.app`, which served Not Found, because the deployed `SITE_URL` was wrong (ledger `:87-91`) [seen].
- **The lesson:** no local-stack test can catch that class of bug, because the workflow sets `SITE_URL` itself.
- **Keep:** the lesson, as an activation-day check (section 4.4).

**H, I, J. #1795, #1822, #1813**
- **Why they never ran:** a dispatch needs the workflow on main, and the stack has blockers (section 3.2).
- **Keep:** #1795's correlation of Stripe's own events, its conversion and portal journeys, and #1813's loopback-only checkout gate and listener.

**K. Production read-only checks** (`billing-freeze-check.yml`, live readiness specs, entitlement and downgrade proofs)
- **What they are:** dispatch-only configuration checks, not flow tests.
- **Keep:** as activation checks, outside the two tests.

---

## 3. Critique

### 3.1 The existing proposal (`billing-test-consolidation-proposal-2026-11-12.md`)

**Where I agree:**
- Two tests, offline plus real Stripe test mode.
- Retire E and F.
- Hosted Checkout and the portal need a real browser run.
- Production configuration stays with the activation checks.
- One shared test account needs one-at-a-time runs.

**Where I disagree:**

1. **"Test 1 needs no change."** It does. The qualification step must move into the full lane. Otherwise the suite the proposal calls "every PR" protects drafts only.
2. **Folding D in as the first job of the approval-gated local-stack workflow.** That turns the cheap, proven check into a manual, gated one. Manual dispatch is exactly why D went stale (one run in ten weeks after its PR trigger went). D should be automatic: on billing-path PRs and weekly. Its risk is low: test key only, no production access, and the canary billing job and the lifecycle workflow already use the same key with no environment (`canary.yml:133-240` has none; only `migration-readiness` uses one, `:56`; `stripe-commercial-lifecycle.yml` has none).
3. **Including #1822's paid value loop in the billing test.** It tests coaching, repeat and comparison on a paid account.
   - It needs Gemini.
   - It adds a cold model setup and about 200 lines copied from #1795 (sub-review).
   - It ties the billing signal to coaching flakiness.
   It is a fine product test, but not a billing one. Run it separately, owned by whoever owns coaching, on the same stack if useful.
4. **Keeping #1795's renewal_recovery.** Stage L already proves renewal, failure and recovery on real Stripe objects in 2 minutes. #1795's version:
   - advances the clock only one hour past period end, which is borderline for the renewal invoice to finalise [inferred];
   - drives failure and recovery through the API anyway, so it adds no user action that L lacks;
   - never checks revoked access in the UI.
   Drop it and keep L's.
5. **"Nothing unique is lost" by retiring E.** True, but D (or L) covers E only if it actually runs (point 2).
6. **The stated state of the prepared fixes.** `c203e640` and `765e93c6` are not in any PR head or on GitHub (sub-review used `get_commit` and commit search). They exist only in a local workspace, so step 2 of the proposal's migration has nothing to push yet from a reviewer's point of view.
7. **Minor factual errors:** "after 7 failed tries" (6); D's Aug 30 passes were PR runs, not dispatches; the canary trial account is not why the billing lane stopped.

### 3.2 The #1795, #1813 and #1822 stack (verified against the PR heads)

**Blockers (a run cannot pass):**

1. **Cleanup always fails.**
   - #1795's cleanup reads `account_billing_fences`, `account_checkout_operations` and `account_save_obligations` with the service-role key (`journey.billing.spec.ts` at #1795, around `:387-392`).
   - Migrations revoke ALL on those tables from `service_role` (`20261013180000_account_closure_tokens.sql:56-58`; `20261020230653_account_pending_completion_journal_1643.sql:40-41`) [seen both].
   - So the read errors, `cleanup_unproven` is set, and every journey fails even when billing works.
   - On a throwaway stack those rows die with the stack, so this check should be removed for the local target, not fixed.
2. **`supabase start` probably fails.**
   - #1813 starts the stack in `backend/` with the repo's `config.toml`, which holds production's `project_id` with seeding on.
   - `seed.sql:9-20` inserts users into `auth.users` and then plain-inserts the same ids into `user_profiles`. The signup trigger (`20260521100000_auto_trial_entitlements.sql:102-132`) has already created those rows, so the second insert hits a duplicate key [inferred; both files seen].
   - The repo already has a working disposable-stack pattern: fresh config, seed off and a digest-pinned Postgres (`tests/db/account-closure-full-chain.mjs:890-901`, `:1028-1053`, per the sub-review).
3. **The first run needs a merge.** A dispatch requires the workflow on main (shown by lifecycle run 1's commit message), so the `stripe-checkout` change ships to main before the workflow has run once. Either accept that with review, or add a path-scoped `pull_request` trigger as D did on Aug 30.

**Risks:**

- The new Deno refusal tests for the loopback gate (`index.test.ts:660-685`, `localSandbox.test.ts`) have never run in CI, because #1813 targets #1795's branch, not main.
- `GEMINI_API_KEY` is injected into the functions for every journey (`billing-local-stack-journey.yml:155,168`), not only the paid loop.
- The leftover check is account-wide (`limit=1` clocks and subscriptions, yml `:228-240`), and there is no pre-run sweep.
  - One killed run leaves a clock that fails every later run.
  - The canary lane and the lifecycle workflow use the same key in different concurrency groups.
- The Stripe CLI checksum comes from the same release as the binary. That checks integrity, not authenticity; pin the hash in the repo.
- The `billing-local-stack` environment's existence and reviewers are unverified. If it doesn't exist, GitHub creates it unprotected on first use.
- The gate accepts `SUPABASE_URL=http://kong:8000`, which a self-hosted Supabase would also use [inferred]. That is acceptable, because production is Supabase-hosted and holds a live key, but the PR's "no deployed project can match" should say "no Supabase-hosted project".
- Account settings are assumed, not checked: the default API version `2024-06-20` (required by contract `:60`), portal cancel mode and retry settings.
- Checkout opens by calling the function from Node (spec `:191`), not through the app's Upgrade button. That leaves the pricing page and button out.

### 3.3 Is "Stripe's own event reached the webhook" required, and is it proven?

**What each design proves:**

| Design | Payload made by Stripe? | Delivered by Stripe's transport? | Proves the deployed endpoint, secret and enabled events? |
|---|---|---|---|
| D and F (self-signed, self-built events) | No | No | No |
| #1795 on #1813 (`stripe listen`) | **Yes**: #1795 fetches the event from Stripe by id and requires a `processed_webhook_events` row with that id (spec `:98-118`, contract `:56-65`) | Partly: the CLI relays Stripe's events, but re-signs them with its own per-session secret [docs] | No: the local endpoint isn't the deployed one |
| Fetch the run's events from Stripe's Events API and post their exact bodies, signed with a run secret | **Yes** | No | No |

**Conclusions:**

1. **Required, in one narrow sense.** For `checkout.session.completed`, the handler uses the payload's metadata, `client_reference_id`, customer and subscription directly. A Stripe-made payload proves that what `stripe-checkout` put on the session (including `billingOperationId`) comes back in the event and binds the right account. For the other event types the handler re-reads Stripe, so payload origin matters little.
2. **Proven, mostly.** #1795's check blocks fully synthetic events. It does not prove the event came through `stripe listen`; a genuine event replayed by anyone holding the run secret also passes. That is fine, since the transport is local either way. One small fix: its offline control rejects `evt_synthetic_local` only because of the underscore (contract.test `:36`); require the Stripe fetch to succeed instead.
3. **Not proven by any local design:** the deployed webhook URL, signing secret, enabled event types and API version. That is the bug class G found, and it belongs to the activation check (4.4), not these tests.
4. **Practical consequence:** stage L can adopt "Stripe's own payload" cheaply by fetching its run's events from the Events API instead of building them. Stage C keeps `stripe listen`, with Events-API replay as the fallback if the CLI proves flaky on its first runs.

---

## 4. The design

### 4.1 Test 1: billing contract (every merge candidate)

- **What:** the offline qualification (A), the database tests (B) and the function tests (C).
- **Trigger:** the CI full lane: non-draft PRs, merge queue, pushes to main.
- **Change:** move the `Billing Qualification Contract` step from `draft-checks` into the `edge-tests` job, which already installs Deno (`ci.yml:352-371`). Correct the comment at `ci.yml:180-182`.
- **Add two offline cases, each small:**
  1. In PGlite, bind through `begin_account_checkout` and `record_account_checkout`, then send a `checkout.session.completed` that carries `billingOperationId`. Assert `apply_account_checkout_snapshot` grants Pro and a duplicate is skipped. This closes gap 2 offline.
  2. An older event arriving after a newer one, with the fake Stripe returning a *different* state (for example, canceled now and active then). This makes the ordering check able to fail.
- **Environment and secrets:** none.
- **Owner:** the developer changing billing code; Sam confirms who.
- **Reuses:** A, B and C unchanged; D's PGlite bootstrap (`pglite_supabase.ts`).
- **Protects:** O1, O2, O6 fully; O3 to O5 as rules (no real Stripe).

### 4.2 Test 2: Stripe test-mode billing check (one workflow, two stages)

One workflow, for example by evolving `stripe-commercial-lifecycle.yml`. It has one concurrency group, `stripe-test-account`, which every workflow using `STRIPE_TEST_SECRET_KEY` must share, the canary lane until it is removed included.

**Stage L: lifecycle (automatic)**

- **Trigger:**
  - `pull_request` on billing paths: `backend/supabase/functions/stripe-*/**`, `backend/supabase/functions/_shared/**`, billing and entitlement migrations, `scripts/billing-qualification/**`.
  - Weekly schedule.
  - Manual dispatch.
- **Environment and secrets:** test key, test price; no approval. Same exposure as today's canary. Fork PRs get no secrets and fail closed, as noted in run 1's commit message.
- **Assertions:** D's, plus:
  1. **Account preflight:** `accounts.retrieve()` with the test key must equal the `STRIPE_TEST_ACCOUNT_ID` variable before anything is created (Sam's lasting requirement).
  2. **Real binding path:** reserve the checkout with `begin_account_checkout`, put `billingOperationId` in the metadata, and require `apply_account_checkout_snapshot`.
  3. **Stripe's own payloads:** after each phase, fetch the run customer's events from the Events API and post those exact bodies, signed with a run secret, to the in-process handler. Require each expected type to be present.
  4. **Run tag and sweep:** name every test clock `ss-billing-<run id>`. A pre-run sweep deletes only tagged clocks older than 2 hours. This replaces "refuse forever on leftovers" with "clean our own leftovers".
  5. Drop the four casualties that only test the test (move them to unit tests of the helper). Keep the forged-signature one, which hits the real handler.
- **Owner:** #1795's owner (Sam to confirm).
- **Run time:** about 2 minutes [seen on Nov 11].
- **Protects:** O3's price, invoice and binding rules (not the Checkout page); O4 fully; O5's cancel rules (not the portal UI); O6 against real Stripe.

**Stage C: hosted Checkout and portal (before a billing release)**

- **Trigger:** manual dispatch before any release that touches checkout, the webhook, the portal or entitlement code; also before payment activation. Consider weekly only after several clean runs.
- **Environment and secrets:** protected environment `billing-local-stack` with required reviewers; test key, test price, `STRIPE_TEST_ACCOUNT_ID`, publishable key. **No Gemini key.**
- **Two journeys from #1795:**
  1. **conversion:** trial ends, hosted Checkout with 4242, first $10 invoice, Stripe's own event, Pro after reload and a fresh sign-in.
  2. **portal_expiry:** cancel in the hosted portal, Pro · Ending until period end, then Free with history kept.
- **Fixes required before the first run:**
  1. For the local target, drop the cleanup reads of the three revoked tables; assert Stripe-side cleanup only.
  2. Start the stack the way `tests/db/account-closure-full-chain.mjs` does (fresh config, seed off, pinned image), not with the repo's `config.toml`.
  3. Open Checkout through the app's Upgrade button on a local build with payments shown, so the pricing path is covered [inferred feasible].
  4. Check the expiry UI as well as the database.
  5. Preflight the account's API version and portal cancel mode.
  6. Pin the Stripe CLI hash in the repo.
  7. Start the listener with a readiness check and keep its log as an artifact.
- **Owner:** #1795's owner. Elon reviews #1813, as Sam assigned.
- **Protects:** O3 end to end (Checkout page, metadata round trip, return URL on the local app, reload, sign-in) and O5's portal UI.

### 4.3 Retire, keep and coverage

| Piece | Decision | Coverage kept or lost |
|---|---|---|
| A, B, C | **Keep** as test 1, with A moved into the full lane | Gains: A now gates merges |
| D lifecycle workflow | **Evolve** into stage L | Kept: all phases. Gained: real binding path, Stripe payloads, account preflight, automatic runs |
| E canary billing lane | **Retire** (remove the `billing-qualification` matrix leg and its step from `canary.yml`) | Nothing unique |
| F June live spec | **Retire** from the Live Release Matrix; keep the file in history | Real Checkout and the portal move to stage C. Lost: running against production config, which moves to 4.4 |
| G manual run | Historical | Its lesson moves to 4.4 |
| #1795 renewal_recovery | **Drop** | Covered by stage L with real Stripe |
| #1822 paid value loop | **Separate product test**, not in the billing gate | Not billing coverage |
| K activation checks | **Keep**, outside these tests | Unchanged |

### 4.4 Outside the two tests: an activation-day configuration check

No local test can see production configuration. G's real bug was there. At activation, under the owner's authority and with no charge, add to the existing readiness checks:

- assert that a created live Checkout session's `success_url` origin equals the public app's origin;
- assert that the live webhook endpoint's URL, enabled events and API version match what the handler expects (a GET on the endpoint list).

These are reads and an unpaid session that expires [inferred no charge; confirm against Stripe docs at the time].

---

## 5. Migration steps, in order

| # | Step | Who acts |
|---|---|---|
| 1 | Review this design against the existing proposal and decide test 2's shape: stage L automatic, stage C gated | **Sam** |
| 2 | Move the qualification step into the full lane; fix the CI comment. Small PR, no secrets | **Developer**, **Sam** reviews |
| 3 | Add the two offline cases in 4.1 | **Developer**, **Sam** reviews |
| 4 | Create the `STRIPE_TEST_ACCOUNT_ID` variable (from the Stripe test dashboard) | **Admin** |
| 5 | Evolve D into stage L (preflight, real binding path, Events-API payloads, run tags and sweep, PR and weekly triggers, shared concurrency group). The PR trigger lets it run from its own PR | **#1795's owner**, **Sam** reviews |
| 6 | Remove the canary billing lane in the same or next PR | **Developer**, **Sam** reviews |
| 7 | Fix #1795 and #1813 per 4.2 (cleanup, stack start, Upgrade button, preflights, CLI hash, listener log). Push the two local-only fixes (`c203e640`, `765e93c6`) or redo them. Rebase on main. Drop renewal_recovery. Retarget #1813 at main so its Deno tests run | **#1795's owner**; **Elon** reviews #1813; **Sam** reviews |
| 8 | Create protected environment `billing-local-stack` with required reviewers, and move the test Stripe secrets into it | **Admin** |
| 9 | Merge, then run stage C: conversion first, then portal_expiry | **Akin** approves the first run; a reviewer approves in the environment |
| 10 | Retire F from the Live Release Matrix; update `ENTITLEMENTS_AND_BILLING.md` (or `RELEASE_STATUS.md`) to name the two tests | **Developer**, **Sam** reviews |
| 11 | After several clean stage C runs, decide whether to schedule it | **Sam** and **Akin** |
| 12 | Move #1822 to a separate product-test track with its own owner | **Sam** |
| 13 | At activation: the configuration check in 4.4 | Owner with live access, under **Akin's** authority |

Steps 2, 3 and 5 can start now and don't wait on the shared-evidence-file writer question that blocks #1822.

---

## 6. Open questions for Sam

1. Is an approval-free stage L acceptable, given it uses only the test key the canary already uses unguarded?
2. Should stage C target #1795's owner or Elon as owner?
3. Does `apply_stripe_subscription_snapshot` reject an older `p_event_created`? This decides whether the
   reworked ordering case should expect "skipped" or "no regression".
4. Is the test account's default API version `2024-06-20`? #1795 requires it.
5. Which repo or environment holds `STRIPE_TEST_*` today (repo-level per `canary.yml`)? Moving them into the
   environment would also gate stage L unless L reads repo-level copies.

## Sources

- **Code on main `7bdad2b`:**
  - `.github/workflows/ci.yml`, `canary.yml`, `stripe-commercial-lifecycle.yml`, `live-release-matrix.yml` and the database-matrix workflows
  - `scripts/billing-qualification/*`
  - `backend/supabase/functions/stripe-{checkout,webhook,billing-portal}/index.ts` and `stripe-webhook/index.test.ts`
  - `backend/supabase/seed.sql`, `config.toml` and the migrations named above
  - `tests/live/stripe-*.live.spec.ts`
  - `product_release/ENTITLEMENTS_AND_BILLING.md` and `evidence/retained/PUBLIC_LAUNCH_LEDGER.md`
- **GitHub runs:**
  - Lifecycle: all 9
  - Canary: 36419538307 and 40316411691 with their jobs, plus the scheduled list back to Sep 6
  - CI on main: 43124571682 jobs
- **PR heads** #1795 `901d6f95`, #1813 `3e4b9829` and #1822 `077e7d46`, read by a read-only sub-review. I spot-checked its two blocker claims (revoked tables, seed collision) against the files.
- **Earlier notes**, taken as background and checked where cited: `billing-test-consolidation-proposal-2026-11-12.md`, `outcome7-billing-investigation-2026-11-11.md` and `canary-trial-renewal-design-2026-11-12.md`.
