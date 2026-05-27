**Last Updated:** 2026-05-27

# Free / Basic / Pro Audit

## Decision

SpeakSharp now needs three distinct user types:

| Type | Meaning | Billing truth | Current launch posture |
|---|---|---:|---|
| `free` | Unpaid public signup and default baseline | $0 | Active soft-release entry path |
| `basic` | Future paid Basic plan | $4.99 placeholder | Not offered; checkout blocked |
| `pro` | Paid Pro plan | $9.99 | Active upgrade path |

The important correction is that `subscription_status = basic` must not mean "free user." If Basic becomes a paid product later, unpaid historical users must already be distinguishable as `free`, otherwise revenue, churn, and entitlement reporting will miscount Free users as $4.99 Basic users.

## Code Changes

| Area | Status | Notes |
|---|---|---|
| SQL user type | Implemented locally | Added migration `20260527162000_restore_free_user_type.sql` to restore `free` as default, copy Basic limits to Free, and migrate unpaid Basic rows without Stripe evidence to Free. |
| Fresh signup | Implemented locally | New trigger version writes `subscription_status = 'free'`. |
| Future paid Basic | Implemented locally | Stripe webhook still supports `activate_basic`, but app checkout blocks Basic with `paid_basic_future`. |
| Pro checkout | Implemented locally | Pro is checkout-only and uses `$9.99` price ID `price_1TbnH175Lp2WYe28RTatJout`. |
| Pricing page | Implemented locally | Public card is `Free` with `$0`; CTA is `Start Free`; Pro is `$9.99`. |
| Conversion tracking | Implemented locally | The legacy pricing-card conversion source was changed to `pricing_free_card`; checkout body now accepts only Pro. |

## Confirmed Stripe Evidence

The GitHub Stripe price audit queried Stripe and confirmed:

| Stripe product | Amount | Status |
|---|---:|---|
| SpeakSharp Basic | $4.99/mo | Active placeholder |
| SpeakSharp Pro | $9.99/mo | Active Pro target |

The audit failed only because the workflow on current `main` still expected the old `$2.99` / `$7.99` values. Local workflow/script changes update those expectations to `$4.99` / `$9.99`.

## High-Risk Misses Found

| Finding | Risk | Required Fix |
|---|---|---|
| Release docs said "public Basic user" for the unpaid baseline. | Public release materials and tester protocol would contradict the app. | Launch-facing docs updated to "Free user/path"; reserve "Basic" for future paid Basic. |
| E2E helpers defaulted mock users to `basic`. | Tests could accidentally keep validating the old baseline model. | Default E2E baseline to `free`; use `basic` only for explicit future paid Basic scenarios. |
| `subscriptionTiers.ts` previously normalized unknown/null to `basic`. | Unknown statuses could be treated as paid Basic later. | Normalize unknown/null to `free`; keep `basic` explicit only. |
| Pricing conversion source used the old Basic-card name. | Analytics would attribute Free signup as Basic intent. | Renamed to `pricing_free_card`. |
| `stripe-webhook` downgrade log said downgraded to Basic. | Operational logs would describe canceled paid users as Basic instead of Free. | Log downgraded to Free; SQL downgrade should write `free`. |
| Product docs mention "Basic to Pro" conversion rate. | Funnel target is now Free to Pro. | Update active docs to "Free to Pro." |

## Medium-Risk / Intentional Basic References

These should remain or be renamed carefully:

| Area | Why It May Stay |
|---|---|
| `stripe-webhook` `activate_basic` tests | Needed so future paid Basic does not accidentally grant Pro. |
| `STRIPE_BASIC_PRICE_ID` in audits | Useful to monitor the future Basic placeholder, but it must not imply Basic checkout is active. |
| Tests named "Basic feature matrix" | Should become "Free/baseline feature matrix" unless explicitly testing future paid Basic. |
| `tier_configs.basic` | May remain for future paid Basic. `tier_configs.free` must also exist and match current baseline limits. |

## Docs Needing Cleanup

| File | Current issue |
|---|---|
| `product_release/BACKLOG.md` | Says the unpaid baseline was cut over to Basic; now obsolete. |
| `product_release/RC_GATES.md` | Updated current gates from Basic baseline language to Free baseline language. |
| `product_release/PUBLIC_LAUNCH_LEDGER.md` | Updated public entry and Pro checkout language from public Basic user to public Free user. |
| `product_release/PRD.operational.md` | Conversion rate says Basic to Pro; should be Free to Pro. |
| `product_release/SOFT_RELEASE_TESTER_INSTRUCTIONS.md` | Says user-facing baseline plan says Basic; should say Free. |
| `product_release/RC_TEST_INVENTORY.md` | Basic/Pro matrix language should split Free baseline from future paid Basic. |

## Acceptance Criteria

Before soft release, the following should be true:

1. Public signup creates or reads `subscription_status = 'free'`.
2. Public UI says Free, not Basic, for the unpaid baseline.
3. All visible upgrade CTAs go to Pro.
4. Direct `stripe-checkout` requests for `plan = basic` return `paid_basic_future`.
5. Pro checkout uses the `$9.99` Pro price ID.
6. Any revenue/MRR reporting requires Stripe subscription evidence, not `subscription_status` alone.
7. `tier_configs` contains both `free` and `basic`; Free is active, Basic is future placeholder.
8. Docs and tester protocol use Free for the soft-release baseline.
