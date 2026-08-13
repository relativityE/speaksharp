# Paid Private canary cutover

This is a coordinated operational procedure, not authorization to perform it. The production canary
runs on every `main` push and daily at 05:00 UTC. The old head expects the current Free account while
the corrected head expects a genuinely paid, Private-only synthetic account, so account preparation
and source integration must occur in one controlled window.

## Preconditions and evidence

The Product Owner must separately authorize the synthetic-entitlement operation and the exact accepted
#1288 merge head. Before any mutation, the operator must record sanitized, read-only evidence that:

- no production canary workflow is active and the window is clear of the 05:00 UTC schedule;
- the exact canary profile has nonblank customer and subscription IDs;
- Stripe returns that exact customer and exact subscription;
- the subscription belongs to that customer, is `active`, and contains the configured approved
  $10/month Price (active Price, configured currency, 1000 unit amount, monthly interval, count 1);
- the account ceiling is one and no customer recording or trial window is reset or extended.

Wrong customer, wrong subscription, inactive status, wrong/missing Price, an active canary run, or an
uncertain response is a HOLD. Local `user_profiles` fields alone are not Stripe authority.

## Coordinated sequence

1. Reconfirm no active canary run and sufficient clearance from 05:00 UTC.
2. Under separate written authorization, establish the genuine paid synthetic entitlement. Do not add
   an entitlement bypass, grant a customer-style trial, or weaken/skip a canary assertion.
3. Immediately repeat the read-only Stripe checks above and record only sanitized identities/status.
4. Immediately merge only the PM-accepted exact #1288 head under separate merge authorization.
5. Require the push-triggered canary to resolve and test the deployed merge SHA, then complete the full
   Private record → stop/save → History/readback journey and the account-ceiling hygiene step.
6. Record the merge SHA, deployed `window.__APP_RELEASE__`, canary run, Stripe-authority check result,
   journey result, and ceiling result. The canary must be fully green; no failure is waived or rerun
   against a different head as substitute evidence.

If any step fails or the schedule window closes, stop and HOLD. Do not revert the account to Free while
an old-head canary may run, do not mutate another account, and do not soften checks. A new coordinated
window and explicit authorization are required.
