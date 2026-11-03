# Nightly activation inputs (contract)

The reviewed cron (`0 3 * * *`) is registered in `.github/workflows/cloud-test-live.yml`. Every scheduled invocation stays quiet in the
credential-free `nightly-gate` job unless the switch is on and every input below verifies. This file states what each input is and how it is
verified. It does not record whether an input is currently present: current activation status and blockers live only in
`product_release/RELEASE_STATUS.md`.

Each input comes from its named owner through an independently reviewed change. Nothing is invented, defaulted or copied. Activation is
complete only when a real scheduled run reports.

| # | Input | Pinned in | Owner / source | Verified by |
|---|---|---|---|---|
| 1 | Reviewed state-ref root | `scripts/state_ref_writer.py` `REVIEWED_ROOT` | Root of `refs/heads/cloud-test-state`, selected by Sam | `state_ref_writer.validate_chain`; `check_gates.authenticated_chain` |
| 2 | Accepted accounting bootstrap and root | `config/aggregate/accounting-bootstrap.json`; `scripts/accounting_rollup.py` `ACCEPTED_BOOTSTRAP_SHA256`, `ACCEPTED_ROOT` | Jensen (custodian), accepted by Sam | `accounting_rollup.receive` (`rollup-*` refusals) |
| 3 | Accepted period scope | `config/aggregate/period-scope.json`; `scripts/manual_reservation.py` `ACCEPTED_SCOPE_SHA256` | Sam. A nightly period's ceilings must equal the standing approval's period caps | `manual_reservation.accepted_scope`; `init_run_inputs.checkpoint_and_scope` |
| 4 | Standing (recurring) approval | `config/recurring-approval.json` | PO decision, recorded by its approval reference | `nightly_request.check_approval`; gate G11 |
| 5 | Reviewed nightly template and accepted budget | `scripts/nightly_request.py` `TEMPLATE_PATH`/`TEMPLATE_SHA256`, `BUDGET_PATH`/`BUDGET_SHA256` | Template from the reviewed all-15 request; budget accepted by Sam | `nightly_request.derive` (refuses until anchored) |
| 6 | Retained aggregate receiver pins | `config/test-config.v1.json` `aggregateReceiver`; `config/aggregate/manifest.json` | Jensen (manifest), Sam review | `aggregate_receiver.receive_bundle` plus the authenticated occurrence envelope |
| 7 | On/off switch | repository variable `RUN_NIGHTLY_REGRESSION` (`run_nightly_regression`) | PO 2026-11-02: `true` runs it, `false` or unset keeps it off. Set `true` only to prove a real run end to end, then `false` | `nightly_request.gate`: quiet unless exactly `true` |

Inputs 1, 2, 3 and 6 are shared with the approved manual all-15 run; one accepted period scope is in force at a time, so a nightly period
replaces a manual one only after that manual run has settled.

## Credentials

The live job reads only the **existing** repository Secrets, by reference (PO decision, Sam 1793647229.528719);
`.github/workflows/cloud-test-live.yml` names them. Nothing is duplicated. The credential-bearing job stays bound to
`trusted-main-credentials` on protected `main`.

## Per-run requirements the approval must cover

Computed by the source; re-derive them at the final merged head.
- **Runner minutes:** `nightly_request.nightly_runner_minutes` sums the scheduled jobs' timeouts.
- **Starts, takes and identity reads:** the all-15 request minimum from the accepted full-coverage budget.
- **Request cap:** the per-case estimate sum plus the cleanup reserve plus pooled slack, as derived by `full_coverage_budget.py`.
- **Coaching:** the standing approval's per-run coaching cap is a ceiling. `nightly_request.derive` clamps the budget's coaching need to it,
  and the guard stops coaching for the rest of the campaign after the provider's own limit refusal.
- **Paid actions:** `$0`.
