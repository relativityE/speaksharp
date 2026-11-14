# Nightly AHT suite (offline core)

This folder holds the offline core of the nine-journey nightly suite designed in #1864. It sits beside the existing AHT
harness and uses it: each journey leg runs as (part of) an existing harness case, and this code turns the case results
into leg and run verdicts, holds the run budget (frozen per-leg allocations reserved before the run), and derives the
nightly limits.

Nothing here runs a live AHT, writes to production, touches Stripe or activates the nightly. The vendored harness
packet (`../harness/bundle`, `../harness/draft-adapters`) is not edited; the changes it needs are listed, file by
file, in the harness handoff in the description of #1865, for the owners of those files.

## Files

| File | What it does |
|---|---|
| `journey-plan.cjs` | The nine journeys and 24 legs, the home of every one of the catalog's 204 rows, the 19 new rows, each leg's harness case and Start presses, and its gates |
| `case-results.cjs` | Splits one harness case result (`{ caseId, assertions }`) into the results of the legs that case covers; a row the plan places nowhere fails the legs |
| `leg-verdicts.cjs` | Leg and run verdicts: FAIL over HOLD over NOT RUN over PASS; a dependent leg whose dependency did not pass is NOT RUN; an unmet gate is its own outcome; a recorded FAIL or a budget overrun stays FAIL whatever NOT RUN comes later, and the run's ledger never overwrites a worse verdict |
| `run-budget.cjs` | The run budget to Sam's #1864 review: every runnable leg's coaching, Start presses and cleanup allocated and reserved in full before the run, then frozen; synchronous reservation before each send; no release, so a retry can't borrow; J1.e's expired-token probe reserved at its worst case; cleanup from a protected per-leg pool ordinary work can't reach |
| `limits.cjs` | The lowest limits that give a truthful result: exact counts for sign-ups, takes, starts, coaching (probe reserves included), identity reads and provider calls; request and time limits per journey from complete baselines plus the evidence-based margins (11% and 14%); dollar caps from a supplied price |
| `oracles/*.cjs` | The new rows' checks: 30-day trial, ending a canary-tagged run-owned trial, sign-out (no unauthorized read, no stale request), payment wall and server refusal, short Stop saves nothing, billing portal opens (bounded, URL never logged), billing-row reconciliation, the test-mode paid fixture, kept sessions send no new coaching |
| `tests/*.test.cjs` | node:test files (137 tests), run by `../tests/test_nightly_suite.py` inside the package unit tests |
| `negative-controls/` | 82 seeded breaks: each must make its test fail and pass again once restored |

## Rules the code enforces

- A leg PASSes only when every row it must report passed. Anything skipped, gated or not reached is NOT RUN, never PASS.
- A leg with no harness case yet (J1.e, J1.f, J2, J7.d, J8.c, J9.a, J9.b) is NOT RUN until its adapter lands through the handoff.
- J9.a is labelled Stripe test-mode sandbox, never production billing proof; J9.b is NOT RUN by design on every run.
- Counted limits carry no margin. Measured limits stay unset until a baseline run in which every runnable leg executed.
- Every leg's allocation is fixed and reserved before the run starts. A leg that asks for more fails its budget row and sends no more ordinary work of any kind (cleanup stays available); it can't borrow from another leg, another journey or the cleanup pool.
- A FAIL is never hidden: no later NOT RUN or HOLD turns it into anything else.

## Commands

```
node --test tools/cloud-test/nightly/tests/*.test.cjs
node tools/cloud-test/nightly/negative-controls/run.cjs --out /tmp/nightly-negative-controls.json
python3 -m unittest tools/cloud-test/tests/test_nightly_suite.py
```
