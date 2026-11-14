# Nightly AHT suite: harness handoff

Date: 14 November 2026. For: the owners of the pinned and shared harness files (Elon for the runner and release, Sam for review). From: #1865, whose offline core is in `tools/cloud-test/nightly/`. Design: #1864 at `2c72705`, with Sam's review of it (frozen per-leg allocations, atomic reservation, no retry borrowing, the probe reserve, protected cleanup). Checked against main `d81aa86`: #1858, #1859 and #1860 changed nothing under `tools/cloud-test`; what they change for this handoff is in section 1 and section 3.

The product owner chose the existing AHT harness, "with isolated browser/fault legs and explicit file handoffs to avoid overlap with #1860" (14 Nov 17:31Z). #1865 adds new files only, outside the hash-pinned packet. Every change the suite needs in a pinned or shared file is listed here, file by file, for a separate reviewed PR. Nothing here is activated, run live, or applied to production.

Two shared files are changed in #1865 itself, because the package's own checks require it and no open PR touches them:

- `tools/cloud-test/config/required-test-ids.v1.json`: the two test ids of `tests/test_nightly_suite.py` added to the inventory, in sorted order. `sourceHead` and `sourceTree` are left as they were; regenerate them with the inventory tool when this file is next reviewed.
- Nothing else. `config/equivalence-file-set.v1.json` is not edited: its identity is already INCOMPLETE on main (more than 100 unlisted files), so listing the new folder belongs with the next review of that list.

## 1. New rows emitted by existing cases

These rows sit on legs that already have a case. Until the case emits them, `case-results.cjs` leaves them NOT RUN and the leg can't pass.

| File | Change |
|---|---|
| `harness/draft-adapters/source-adapters.cjs` (`CONTRACTS['AHT-01']`, `run`) | Emit `trial-length-thirty-days` (J1.a: read with the account's own token, oracle `nightly/oracles/trial-window.cjs`) and `short-stop-no-save` (J1.c: one extra Start press, a Stop before the minimum take length, no session row saved, oracle `shortStopVerdict` in `nightly/oracles/payment-wall.cjs`) |
| `harness/draft-adapters/source-adapters.cjs` (`CONTRACTS['AHT-15']`, `run`) | Emit `signout-no-unauthorized-read` and `signout-no-stale-request` as two rows (J1.d, oracle `nightly/oracles/sign-out.cjs`). A 401 or 403 after sign-out is a correct answer and fails neither row |
| `harness/draft-adapters/contracts.json` | The same rows in `cases.AHT-01.requiredAssertions` and `cases.AHT-15.requiredAssertions`; `minimumAuthorizedStartPresses` for AHT-01 goes from 4 to 5 |
| `tests/live/rwt-open-mic-first-session.live.spec.ts` (on main since #1860) | `AHT01_START_PRESS_BUDGET.total` goes from 4 to 5 for J1.c's short Stop, and the comment above `startPressRow` that still says "plus 2 presses of headroom" is corrected: the budget is exact. The short-Stop take must write no feedback, so it needs no change to the run fence #1860 opens for AHT-01 |
| `config/assertion-catalog.json` | Regenerated with `scripts/derive_assertion_catalog.py --out config/assertion-catalog.json`, and the next `config/history/catalogs/vN.json` added, so the catalog stays additive |

## 2. Adapters for the legs with no case

Each leg below reports NOT RUN (gate `no-harness-case`) until its adapter lands. Each is a new file beside the existing ones in `harness/draft-adapters/`, with its contract in `contracts.json`. The new adapters run in a fresh browser context, on a fresh run-owned account unless noted.

| Leg | Rows | Gate that still applies after the adapter lands |
|---|---|---|
| J1.e | `trial-expired-wall-on-open-session`, `trial-expired-payment-wall`, `trial-expired-server-refuses` | Canary claim acknowledged (`RWT_CANARY_CLAIM_ACK` and the server-issued claim), via `nightly/oracles/canary-trial-end.cjs` |
| J1.f | `account-delete-from-wall` (needs J1.e) | Canary claim; a mailbox the harness can read for the run-owned address |
| J2 | `paid-wall-before-payment`, `checkout-opens-for-expired-user`, `abandoned-checkout-stays-walled`, `deployed-webhook-ready` | Canary claim, and disabled until a reviewed cleanup expires the Checkout Session and settles the checkout operation |
| J7.d | `account-delete-during-trial` | A mailbox the harness can read |
| J8.c | `no-session-choice-with-takes` (needs J8.b) | None |
| J9.a | `pre-upgrade-history-opens`, `pre-upgrade-progress-opens`, `old-sessions-no-new-coaching`, `entitlement-survives-upgrade` | The billing sandbox is runnable; the account is paid once through the product with a Stripe test-mode card (`nightly/oracles/paid-account-fixture.cjs` refuses any live key or object). Result labelled "Stripe test-mode sandbox: not production billing proof" |
| J9.b | `production-entitlement-after-upgrade` | NOT RUN by design: no adapter is wanted until there is a safe, approved way to hold a paid account on production |

## 3. Per-journey limits in the runner

| File | Change |
|---|---|
| `harness/draft-adapters/source-adapters.cjs` (budget guard) | Build one `RunBudget` with `planRunBudget` from `nightly/run-budget.cjs` before the first leg starts, and refuse the run if it throws. Before each coaching request or Start press leaves the browser, call `reserve(leg, kind)` (or `send`) with no await in between, and abort the action when refused. Cleanup requests use `reserveCleanup(leg)` only. J1.e's expired-token probe goes through `reserve('J1.e', 'coaching')` like any coaching request. Pass `legBudget(leg)` to `legVerdict`, and record every verdict in one `VerdictLedger` |
| Cleanup allocations | Each leg's cleanup requests, from the baseline run (no margin; a cleanup that needs more fails its leg). On main since #1860, AHT-01, 02, 07 and 08 close and clean their feedback fence after the account is deleted; those calls come from the leg's cleanup allocation (J1.a to J1.c, J3.a, J8.a, J8.b), never from its ordinary work. Until the baseline gives them, `planRunBudget` refuses the run |
| `harness/bundle/harness/identity-check.cjs`, `campaign-runner.cjs` | Read identity once at the start and once at the end of each journey (J7.a's separate launch inside J7's pair), plus admission and final: 18 with every leg, 16 today. Today the harness reads 2 per case plus 2. If the per-journey read can't be done, the count in `nightly/limits.cjs` is re-derived |
| `config/test-config.v1.json` `modes.full.budgetModel`, `caseMaxMs` | Request and time allowances per journey rather than per case, from `nightly/limits.cjs` once a complete baseline exists. The baseline has to come from a build that includes #1859 and #1860, since the fence adds requests to AHT-01, 02, 07 and 08. Remove the flat allowances the product owner ruled out: `allowancePct` 125, `pooledSlackPct` 15, `coachingRetryAllowancePct` 25 (becomes 0: a coaching retry fails its row), and keep `cleanupReservePerCase` 10 only as far as a measured cleanup needs it |
| `scripts/recurring_budget.py` `per_run_measured` | Accept a run in which every runnable leg executed, not every catalog row (impossible while J7.a is held), and drop the 25% `margin_pct` on `runCapRequests`. The margins are the evidence-based 11% (requests) and 14% (time) from #1864, lowered to the spread of complete baselines when that is smaller |
| `scripts/full_coverage_budget.py` | The same flat percentages appear in its estimate (`allowancePct`, `coachingRetryAllowancePct`, `pooledSlackPct`); it should read the nightly limits instead for the nightly mode |

## 4. Nightly request and packet pins

| File | Change |
|---|---|
| `scripts/nightly_request.py` | `TEMPLATE_PATH`/`TEMPLATE_SHA256` to a reviewed nightly campaign template that selects the journeys' cases, and `BUDGET_PATH`/`BUDGET_SHA256` to the accepted limits produced from `nightly/limits.cjs`. Both stay `None` until the product owner accepts them |
| `harness/bundle/CODE.sha256`, `harness/PACKET-MANIFEST.sha256`, `config/test-config.v1.json` `harness.expectedCodeManifestSha256` and `harness.expectedPacketManifestSha256` | Re-pinned for every packet file changed or added above; `scripts/verify_harness.py --config config/test-config.v1.json` must pass |
| `config/recurring-approval.json` | Caps set from the accepted limits; the nightly stays refused until it is APPROVED with every field set |
| `config/nightly/schedule.proposed.yml`, `.github/workflows/cloud-test-live.yml` | No change until the product owner activates the nightly |

## 5. Checks in CI

`tests/test_nightly_suite.py` (in #1865) runs the 121 node:test tests inside `package-unit-tests`, so `scripts/run_offline_checks.py` covers them. The 64 negative controls (`nightly/negative-controls/run.cjs`) rewrite files while they run, so they are not part of that suite; wiring them into CI as a separate step is for the reviewer to decide.

## Order

1. Section 1 and the J8.c and J7.d adapters (no gate beyond a mailbox), with negative controls, then re-pin.
2. Section 3, so limits are per journey before any baseline.
3. A baseline run, only on the product owner's approval, to set the request and time limits.
4. Section 4, then activation by the product owner.

J1.e, J1.f, J2 and J9.a land when their gates can be met; until then they report NOT RUN, which is the truthful result.
