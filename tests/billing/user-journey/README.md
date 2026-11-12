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

The disposable local stack (`BILLING_SANDBOX_TARGET=local-disposable-stack`) does
not count those three tables, because migrations revoke all access to them from
`service_role` and permissions are not widened for a test. On that stack the
journey's own receipt therefore never says PASSED or VERIFIED: it says
`PENDING_STACK_DESTRUCTION`, with `billingRowResidue:
NOT_READ_REQUIRES_STACK_DESTRUCTION_PROOF`. The rows are not claimed destroyed
because disposal is intended. Right after the stack starts,
`localStackResources.mjs capture` records this run's exact container, volume and
network identities and the database's own system identifier; each Docker query is
checked on its own, the label and name selectors must agree, and this run's
database container and data volume must be among them, so a wrong selector fails
there. The workflow then stops the stack as a checked step (a failed stop fails the
run), and only after that `localStackResources.mjs verify` proves each recorded
identity is gone (Docker's own "no such" answer; any other error is unverified),
then Stripe is checked for leftovers. Only then does `localStackReceipt.mjs` write
the combined receipt. It says PASSED only if all of those succeeded and the
journey receipt is exactly the spec's shape, for the dispatched journey, release
and stack, with every required step PASSED, and the destruction proof is for the
same stack; it records the raw receipt's sha256. Anything else is NOT_PROVEN.
Stripe-side and auth/profile cleanup are still required. The hosted-sandbox target
keeps the fail-closed counts unchanged.

Every test clock is created with this run's marker as its `name`, in the create
request itself, so a clock whose create response was lost can still be attributed
to its run. The marker does not authorize deleting anything: a dirty test account
is a blocked prerequisite, and the run deletes nothing it did not create.

The local checkout exception's allowlist includes `http://kong:8000`, which is also
the gateway address of a self-hosted Supabase. The guarantee that no deployed
project can match relies on staying on hosted Supabase, where `SUPABASE_URL` is
`https://<ref>.supabase.co`.

The suite exercises the real checkout API followed by the real hosted UI. It does
not claim to prove the public upgrade button. Duplicate/out-of-order webhook
controls remain separate handler/DB evidence. Account deletion, actual microphone
hardware, live activation and rollback remain separate acceptance obligations.

### Broader paid acceptance remains separate and NOT PROVEN

This sandbox family is not full `PAID-01` or `PAID-04` acceptance. The
[requirements traceability matrix](../../../tools/cloud-test/harness/run-packet/requirements-traceability.matrix.json)
requires the same genuinely paid identity to continue through successful grounded
coaching, a deliberate same-target linked repeat, honest target-specific comparison,
and returning-user readback, with the linked COACH-01, VALUE-01 and applicable human
observations. This suite ends its conversion branch at a paid recording/save and does
not implement or count those later outcomes. Test-mode Stripe is not Production paid
proof. Supported Open Mic/Focus paid entitlement still needs its applicable coverage.

`PAID-04` additionally requires the intended credential pair to remain atomic,
verified auth/profile/entitlement identity, HOLD before mutation for missing, partial
or ambiguous credentials, no password/signup fallback, and a truthful mutated outcome
when post-write verification fails. Disposable sandbox credentials are not a substitute
for that current identity-consumer acceptance. Both broader requirements remain
NOT PROVEN by this draft, regardless of any future sandbox-family PASSED receipts.

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

## Local disposable stack (draft, not yet run)

`.github/workflows/billing-local-stack-journey.yml` runs this spec against a disposable local Supabase stack
instead of a hosted sandbox project. It selects the committed loopback target `sandbox-target.local.json`
with `BILLING_SANDBOX_TARGET=local-disposable-stack`; the hosted `sandbox-target.json` is unchanged.
Plain `http` is admitted only for that loopback target. Checkout opens in test mode only through
`stripe-checkout/localSandbox.ts`, whose allowlist names the local stack's own API and app origins, so no
hosted project can match it. The webhook signing secret is issued per run by `stripe listen` to the local
`stripe-webhook` function; the spec itself still receives none. A PASS is sandbox-qualified only: it does not
prove the deployed webhook endpoint, production configuration, or a real charge.

### Runner modes (draft, offline only)

`BILLING_RUNNER_MODE` picks which branches the spec collects. Unset keeps the three lifecycle branches above;
`smoke` is conversion only (repeated click, cancel and retry before it pays); `full` adds `failed_checkout`
(declined card, expired session, one paid retry), `portal_recovery` (failed renewal repaired by the member in
Manage billing, never by an API payment) and `refund_period_end` (a whole refund, Pro to the end of the paid
month, no second charge). Any other value is refused. `runnerPlan.mjs --dry-run --mode smoke|full` prints the
plan and what still blocks it; it reads committed files only and never authorizes a run.

Access after a membership ends is on hold until the end-of-access policy is confirmed. `access_expired` and
`history_retained` in `portal_expiry` and `refund_period_end` read `PENDING_POLICY`: they are never asserted,
the spec fails with `access_after_end_policy_pending`, the combined receipt keeps the `policy_pending` defect,
and full mode can say `PENDING_POLICY` at best, never `PASSED`. The run still proves the account and saved
data are kept, from the database only.
