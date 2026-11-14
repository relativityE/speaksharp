# Nightly AHT suite (offline core)

This folder holds the offline core of the nine-journey nightly suite designed in #1864. It sits beside the existing AHT
harness and uses it: each journey leg runs as (part of) an existing harness case, and this code turns the case results
into leg and run verdicts, enforces the coaching hard stop per journey, and derives the nightly limits.

Nothing here runs a live AHT, writes to production, touches Stripe or activates the nightly. The vendored harness
packet (`../harness/bundle`, `../harness/draft-adapters`) is not edited; the changes it needs are listed in
`docs/aht-nightly/harness-handoff-2026-11-14.md` for the owners of those files.

## Files

| File | What it does |
|---|---|
| `journey-plan.cjs` | The nine journeys and 24 legs, the home of every one of the catalog's 204 rows, the 19 new rows, each leg's harness case and Start presses, and its gates |
| `case-results.cjs` | Splits one harness case result (`{ caseId, assertions }`) into the results of the legs that case covers; a row the plan places nowhere fails the legs |
| `leg-verdicts.cjs` | Leg and run verdicts: FAIL over HOLD over NOT RUN over PASS; a dependent leg whose dependency did not pass is NOT RUN; an unmet gate is its own outcome |
| `coaching-budget.cjs` | The coaching hard stop per journey: a request past a journey's cap is refused, fails that journey's budget row and stops its remaining coaching legs (NOT RUN) |
| `limits.cjs` | The lowest limits that give a truthful result: exact counts for sign-ups, takes, starts, coaching, identity reads and provider calls; request and time limits per journey from complete baselines plus the evidence-based margins (11% and 14%); dollar caps from a supplied price |
| `oracles/*.cjs` | The new rows' checks: 30-day trial, ending a canary-tagged run-owned trial, sign-out (no unauthorized read, no stale request), payment wall and server refusal, short Stop saves nothing, billing portal opens (bounded, URL never logged), billing-row reconciliation, the test-mode paid fixture, kept sessions send no new coaching |
| `tests/*.test.cjs` | node:test files (106 tests), run by `../tests/test_nightly_suite.py` inside the package unit tests |
| `negative-controls/` | 52 seeded breaks: each must make its test fail and pass again once restored |

## Rules the code enforces

- A leg PASSes only when every row it must report passed. Anything skipped, gated or not reached is NOT RUN, never PASS.
- A leg with no harness case yet (J1.e, J1.f, J2, J7.d, J8.c, J9.a, J9.b) is NOT RUN until its adapter lands through the handoff.
- J9.a is labelled Stripe test-mode sandbox, never production billing proof; J9.b is NOT RUN by design on every run.
- Counted limits carry no margin. Measured limits stay unset until a baseline run in which every runnable leg executed.

## Commands

```
node --test tools/cloud-test/nightly/tests/*.test.cjs
node tools/cloud-test/nightly/negative-controls/run.cjs --out /tmp/nightly-negative-controls.json
python3 -m unittest tools/cloud-test/tests/test_nightly_suite.py
```
