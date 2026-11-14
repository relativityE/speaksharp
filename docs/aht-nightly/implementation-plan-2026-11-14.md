# Nightly AHT suite: implementation plan

Date: 14 November 2026. Base: main `897117b`; main is now `d81aa86` (#1860 merged), with no change under `tools/cloud-test` since the base. Design source: draft PR #1864 (`docs/aht-nightly/design-2026-11-14.md`, `coverage-map.v1.json`), checked against head `2c72705`. This PR implements that design; where the two disagree, #1864 wins and this plan is corrected.

## Architecture (product owner, 14 Nov 17:31Z)

"Use the existing AHT harness, with isolated browser/fault legs and explicit file handoffs to avoid overlap with #1860." So the suite does not get a runner of its own. Each journey leg runs as an existing harness case, or as part of one (`tools/cloud-test/harness/draft-adapters/AHT-NN.cjs` through `source-adapters.cjs run()`), and the new code in `tools/cloud-test/nightly/` turns case results into leg and run verdicts, enforces the coaching hard stop per journey, and derives the nightly limits.

The vendored packet (`harness/bundle`, `harness/draft-adapters`) is hash-pinned, so this PR does not edit it. Everything it needs there is in `docs/aht-nightly/harness-handoff-2026-11-14.md`, file by file, for the owners of those files.

## Ground rules

- **Offline only.** Nothing in this PR deploys, applies a migration, touches Stripe live mode or production, or runs a live AHT. Nightly activation is not part of this PR.
- **New files only, outside the pinned packet.** No open PR touches `tools/cloud-test`. Shared and pinned files change only through the handoff.
- **Existing live AHT rows stay.** The 15 cases and their 204 rows stay live and unchanged. A row moves to the nightly suite only once its replacement is independently proven to fail on the same break and pass when restored.
- **Every new or strengthened check has a negative control.** A seeded break makes its test fail; restoring it makes the test pass. All 52 are recorded.
- **NOT RUN and HOLD are never PASS.** A run with any NOT RUN or HOLD leg can't be green.
- **#1857 is left alone.**

## Leg to harness case

| Leg | Harness case | Coaching requests | Start presses |
|---|---|---|---|
| J1.a | AHT-01 | 4 | 4 |
| J1.b, J1.c | AHT-01 | 0 | 0, 1 (the short Stop) |
| J1.d | AHT-15 | 0 | 0 |
| J3.a, J3.b | AHT-02, AHT-03 | 7, 4 | 7, 4 |
| J4.a, J4.b | AHT-05, AHT-06 | 2, 2 | 2, 2 |
| J5.a, J5.b, J5.c | AHT-04, AHT-09, AHT-10 | 1, 2, 2 | 2, 3, 3 |
| J6 | AHT-11 | 2 | 4 |
| J7.a, J7.b, J7.c | AHT-12, AHT-13, AHT-14 | 1, 1, 1 | 3, 3, 3 |
| J8.a, J8.b | AHT-08, AHT-07 | 0, 2 | 0, 2 |
| J1.e, J1.f, J2, J7.d, J8.c, J9.a, J9.b | none yet | 0 | 0 |

Each case spends exactly its catalog Start presses and takes; AHT-01 spends one more for J1.c's short Stop (43 in all). A leg with no harness case reports NOT RUN until its adapter lands through the handoff. A new row on an existing case (the trial-length, short-Stop and sign-out rows) reports NOT RUN until the case emits it, so its leg can't pass early.

## Files this PR adds

| Path | What |
|---|---|
| `docs/aht-nightly/implementation-plan-2026-11-14.md` | This plan |
| `docs/aht-nightly/harness-handoff-2026-11-14.md` | The exact-file handoff for the pinned and shared harness files |
| `tools/cloud-test/nightly/journey-plan.cjs` | J1 to J9: 24 legs, the home of each of the 204 catalog rows and the 19 new rows, each leg's harness case, Start presses, coaching, proof scope, browser context and gates |
| `tools/cloud-test/nightly/case-results.cjs` | Splits one harness case result into its legs' results; a row the plan places nowhere fails those legs |
| `tools/cloud-test/nightly/leg-verdicts.cjs` | Leg and run verdicts, and one report line per leg |
| `tools/cloud-test/nightly/coaching-budget.cjs` | The coaching hard stop, per journey |
| `tools/cloud-test/nightly/limits.cjs` | The nightly limits (below) |
| `tools/cloud-test/nightly/oracles/*.cjs` | The new rows' checks: trial length, canary trial end, sign-out (two rows), payment wall, server refusal, short Stop, billing portal, billing-row reconciliation, test-mode paid fixture, kept sessions send no new coaching |
| `tools/cloud-test/nightly/tests/*.test.cjs` | 106 node:test tests, including the coverage drift test against the catalog |
| `tools/cloud-test/nightly/negative-controls/breaks.json`, `run.cjs` | 52 seeded breaks and their runner |
| `tools/cloud-test/nightly/README.md` | What the folder holds and how to run it |
| `tools/cloud-test/tests/test_nightly_suite.py` | Runs the node:test files inside the package unit tests, failing on any failure or skip |

## Nightly limits

Akin (14 Nov 17:31Z): "Don't add an automatic 20%. Calculate the lowest limits that produce a truthful signal; propose a margin only where the evidence justifies it. Anything skipped must be NOT RUN." `limits.cjs` computes #1864's table from the plan:

| Limit | All legs | Today | Margin |
|---|---|---|---|
| Fresh sign-ups | 8 | 7 | None: an exact count |
| Takes | 31 | 30 | None |
| Start presses | 43 | 40 | None |
| Coaching requests | 31 | 30 | None; enforced per journey |
| Identity reads | 18 | 16 | None: 2 per production journey that runs, plus admission and final |
| Provider calls | 93 | 90 | None: 3 per coaching request is already the most possible |
| Paid actions | $0 | $0 | None |
| Runs | 30 per 30 days | 30 per 30 days | None |
| Requests | Per journey from a complete baseline | Same | 11% proposed, from the largest difference between the two measured runs on cases whose work matched |
| Window and runner minutes | Per journey from a complete baseline, whole minutes | Same | 14% proposed, on the same evidence |
| Provider and GitHub dollars | Calls or minutes times a price the product owner supplies | Same | None of their own |

Today J2 is disabled, J7.a is held, and J1.e, J1.f, J7.d and J8.c wait for their adapters, so they count toward nothing and report NOT RUN. J9 runs on the billing sandbox, so it counts against no production limit. A request or time limit stays unset while any journey that can run has no baseline run in which every runnable leg executed. With two or more such baselines, each margin comes down to their spread if the spread is smaller; it goes up only on the product owner's word. Nothing here applies a limit or activates the nightly.

## Phases

Nothing is pushed until it has passed an independent reviewer agent, then Codex code and security review, and starting the reviewer needs Akin's go-ahead.

1. **Core and oracles (offline, this PR).** Everything in the files table, with the unit tests and negative controls green locally. The earlier TypeScript drafts under `tests/live/nightly` and `tests/unit/nightly` were never pushed and are replaced by this folder.
2. **Harness handoff (separate reviewed PR, by the file owners).** The items in the handoff doc: new rows emitted by AHT-01 and AHT-15, adapters for the seven legs with no case, per-journey identity reads and allowances, the flat allowances removed, the runnable-leg baseline rule, the nightly request anchors, the packet pins. Nothing is activated.
3. **Baseline.** One run on the deployed build in which every runnable leg executed, only when the product owner approves it, to set the request and time limits.
4. **Activation.** Only by the product owner, once `recurring-approval.json` is approved with every cap set.

## Approvals this plan relies on

- Approved: 30-day trial; no export before deletion; early trial end only on test-created, tagged canary accounts.
- No test account is ever charged for real (Akin, 14 Nov). J9.a pays once with a Stripe test-mode card on the billing sandbox and is labelled "Stripe test-mode sandbox: not production billing proof"; J9.b, production, is NOT RUN by design.
- Use the existing AHT harness, with isolated legs and explicit file handoffs (Akin, 14 Nov 17:31Z).
- The lowest limits that give a truthful signal, a margin only where evidence supports it, and anything skipped NOT RUN (Akin, 14 Nov 17:31Z).
- Not authorized: nightly activation, live runs, production writes.
