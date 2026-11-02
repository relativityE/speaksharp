# Nightly activation inputs (contract)

The nightly regression is **NOT ACTIVATED**. This branch registers the reviewed cron (`0 3 * * *`) and binds `TRACKING_ISSUE` to #1763. Every scheduled invocation stays quiet in the credential-free `nightly-gate` job until **all** of the inputs below exist.

Each input is supplied only by its named owner, through an independently reviewed change. Nothing here is invented, defaulted or copied. Activation is complete only when a real scheduled run reports.

| # | Input | Where it is pinned (today) | Owner / source | Verified by |
|---|---|---|---|---|
| 1 | Reviewed state-ref root (commit id) | `scripts/state_ref_writer.py` `REVIEWED_ROOT = None` | Sam selects the reviewed root of `refs/heads/cloud-test-state` | `state_ref_writer.validate_chain`; `check_gates.authenticated_chain` (G11 and the aggregate receiver) |
| 2 | Accepted accounting bootstrap: bytes + sha256 + root | `config/aggregate/accounting-bootstrap.json` (absent); `scripts/accounting_rollup.py` `ACCEPTED_BOOTSTRAP_SHA256 = None`, `ACCEPTED_ROOT = None` | Jensen (custodian), accepted by Sam | `accounting_rollup.receive` (`rollup-*` refusals) |
| 3 | Accepted period scope: bytes + sha256 | `config/aggregate/period-scope.json` (absent); `scripts/manual_reservation.py` `ACCEPTED_SCOPE_SHA256 = None` | Sam, from the standing approval's period and ceilings | `manual_reservation.accepted_scope`; `init_run_inputs.checkpoint_and_scope` |
| 4 | Standing (recurring) approval | `config/recurring-approval.json` (`status: NOT APPROVED`, every value null) | PO decision, presented by Sam and Jensen as a completed, evidence-backed packet | `nightly_request.gate` / `standing_envelope`; gate G11 |
| 5 | Reviewed nightly template + accepted budget | `scripts/nightly_request.py` `TEMPLATE_PATH, TEMPLATE_SHA256 = None, None`; `BUDGET_PATH, BUDGET_SHA256 = None, None` | Jensen (template), Sam (budget acceptance) | `nightly_request.derive` (refuses until anchored) |
| 6 | Retained aggregate receiver pins | `config/test-config.v1.json` `aggregateReceiver.activated=false`, `manifestSha256=null`, `bundleRootSha256=null` | Jensen (v2 manifest: historical components and the release only), Sam review | `aggregate_receiver.receive_bundle` plus the authenticated occurrence envelope |
| 7 | On/off switch | repository variable `CLOUD_TEST_NIGHTLY_ENABLED` (unset) | Created once, set to `true`, as the last step of the approved activation (Sam 1793648273.779769) | `nightly_request.gate`: quiet unless exactly `true` |

## Credentials

The live job reads the **existing** repository Secrets by reference only (PO decision, Sam 1793647229.528719):
- `CLOUD_TEST_LIVE_ACCOUNTS`
- `SUPABASE_ANON_KEY`
- `THROWAWAY_TEST_PASSWORD`
- `FREE_TEST_PASSWORD`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POSTHOG_PERSONAL_API_KEY`
- `POSTHOG_PROJECT_ID`

Nothing is duplicated. The credential-bearing job stays bound to `trusted-main-credentials` on protected `main`.

## Per-run requirements the approval must cover

These are computed by the source. They are requirements, not approved limits, and must be re-derived at the final merged head.
- **Runner minutes:** a scheduled run needs **359**. That is `nightly-gate` 3, `record-begin` 5, `journal-reserve` 3, `live` 340, `journal-settle` 3 and `record-complete` 5 (`nightly_request.nightly_runner_minutes`).
- **Starts, takes and identity reads:** the all-15 request minimum, computed by Jensen at `43099a0b`, is **42** Starts, **31** takes and **32** identity reads.
- **Cleanup:** cleanup requests reserve **150**.
- **Request cap:** the per-case estimate sum P + 150 + 15 % of P rounded up to 10. The 6,000 figure is a structural maximum, not an estimate.
- **Paid actions:** `$0`.
