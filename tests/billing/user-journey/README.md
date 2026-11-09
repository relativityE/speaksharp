# Subscription lifecycle acceptance

This family is separate from, and does not renumber, the 15 practice journeys. Its
requirements come from [ENTITLEMENTS_AND_BILLING](../../../product_release/ENTITLEMENTS_AND_BILLING.md),
the [accepted commercial readiness matrix](https://github.com/relativityE/speaksharp/issues/1318#issuecomment-6233782501),
and the preserved integrated-conversion requirement in [#1495](https://github.com/relativityE/speaksharp/issues/1495).

## Separate outcomes

- `conversion`: server-granted card-free trial, expired disposable fixture, real
  hosted Checkout, exact initial $10 monthly paid invoice without a second trial,
  genuine deployed webhook processing, correct account entitlement, app return,
  visible paid membership, reload and fresh sign-in, then a saved Private recording.
- `renewal_recovery`: independent Checkout fixture, paid renewal, genuine failed
  invoice delivery and revoked access, payment recovery and restored access.
- `portal_expiry`: independent Checkout fixture, actual hosted portal cancellation,
  paid access until period end, genuine expiry delivery, expired access, retained
  account and readable saved history.

Each has an independent fixture, test and receipt. No serial-test suppression,
retries, skips or synthetic-webhook fallback can make missing work pass. A real
Stripe event is retrieved from Stripe and joined by its exact event ID to the
deployed `processed_webhook_events` ledger. Matching only a profile tier or an HTTP
200 is insufficient. These checks prove processing at this database boundary;
they do not replace Stripe endpoint-delivery diagnostics when investigating a failure.

## Source prerequisites that must not be bypassed

The committed `sandbox-target.json` is deliberately UNCONFIGURED. The browser suite
fails before using credentials or creating fixtures until a Code/Security-reviewed
target binds the exact isolated app, database and production-denylist origins.
Environment values alone cannot select a different target.

The public payment UI and `stripe-checkout` currently require live keys. Therefore
this test-key suite cannot complete against that unchanged runtime. A separately
reviewed, isolated sandbox payment entry path must exist before execution can
qualify the journey. Do not supply a fake live key, change production settings,
seed paid entitlement, weaken a release gate or sign your own event to get green.
The cancellation branch also requires the real sandbox portal to offer scheduled
period-end cancellation. Unsupported Checkout/Test Clock combinations or absent
portal capabilities are incomplete evidence, never skipped acceptance.

The account cleanup helper predates non-cascading billing/save obligations. The
suite additionally demands counted zero residue for `account_billing_fences`,
`account_checkout_operations` and `account_save_obligations`. A reviewed isolated
cleanup/settlement path must be provided before qualification; missing table-read
permissions or leftover records fail closed. Do not grant broad permissions or
delete unsettled obligations merely to make the test pass. This draft does not
implement that privileged cleanup path.

The suite exercises the real checkout API followed by the real hosted UI. It does
not claim to prove the public upgrade button. Duplicate/out-of-order webhook
controls remain separate handler/DB evidence. Account deletion, actual microphone
hardware, live activation and rollback remain separate acceptance obligations.

## Review and offline checks

Use the repository's supported Node and pnpm versions and host interlock:

```sh
node scripts/host-interlock.mjs hold local -- pnpm exec vitest run --config vitest.billing-journey.config.ts
node scripts/host-interlock.mjs hold local -- pnpm exec tsc --noEmit -p tsconfig.billing-journey.json
pnpm exec eslint tests/billing/user-journey/*.ts playwright.billing-journey.config.ts vitest.billing-journey.config.ts
pnpm quality
```

The controls falsify missing steps, incorrect amounts/identities, live-mode objects,
uncorrelated or absent processing records, production targets and incomplete
configuration. They are offline controls, not receipts of a sandbox transaction.
Normal unit discovery includes `contract.test.ts`; the browser suite requires its
own config and is not silently added to the default live suite or any schedule.

## Authorized isolated execution

Execution creates and removes disposable sandbox accounts, customers, subscriptions
and clocks, shortens only each disposable fixture's expiry, and creates short
Private recordings. It requires explicit operational authorization for that target.
PR review or merge alone does not authorize execution, deployment, provisioning,
permission changes, payments activation, or installing credentials.

The operator verifies an isolated app and database, genuine Stripe test-mode webhook
delivery to that database, sandbox-only provider configuration, applicable migrations,
and a sandbox portal that cancels at period end. It is not enough to rename a production
environment variable. The app/backend origins must correspond to the reviewed isolated
target; the production database origin is supplied solely as an explicit denylist check.

Inject these values privately through the approved execution environment, never in
chat, PR text, command-line arguments, local committed files, or raw artifacts:

- `BILLING_SANDBOX_APP_URL`, `BILLING_SANDBOX_SUPABASE_URL`
- `BILLING_PRODUCTION_SUPABASE_URL` (denylist only)
- `BILLING_SANDBOX_ANON_KEY`, `BILLING_SANDBOX_SERVICE_ROLE_KEY`
- `BILLING_SANDBOX_STRIPE_KEY` (must be test-scoped), `BILLING_SANDBOX_PRICE_ID`
- `BILLING_SANDBOX_RELEASE_SHA` (full exact served commit)
- `BILLING_JOURNEY_APPROVAL=ISOLATED-TEST-MODE-ONLY`

No webhook signing secret is accepted. No existing environment secrets, workflow,
schedule, production default or dotenv fallback is used. Browser traces, video and
screenshots are off because they can retain credentials or hosted checkout URLs.

After the sandbox prerequisite and authorization are satisfied:

```sh
node scripts/host-interlock.mjs hold local -- pnpm exec playwright test --config playwright.billing-journey.config.ts
```

Retain each content-free JSON attachment and exact source/run identity through an
approved artifact destination. A missing receipt, missing phase, unknown outcome,
preflight refusal, failed branch, or unproven cleanup is not PASS. Sanitized failure
stages are deliberate; investigate provider details privately, not by enabling traces.

Cleanup attempts Stripe and account cleanup independently. Customer/clock deletion
and account/profile/session residue checks must succeed. Uncertain create responses
remain unproven even if known objects were removed. Stripe's immutable invoice/event
audit history and deployed processed-event audit records are not deleted by this
test; cleanup does not claim the deletion of those audit records.

## Closeout

Require exact-head Code and Security review, applicable required CI, and separate
retained PASSED receipts for all three branches before calling the subscription
lifecycle qualified. A source-only draft, mocked test, old commercial-runner result,
or old hosted-runtime result with a synthetic fallback cannot close this gap.
Record the active source/execution blocker in the owning PR and current release
status authority, not as a new practice journey or a silently closed requirement.
