# Nightly AHT suite (offline core)

This folder holds the offline core of the nine-journey nightly suite designed in #1864. It sits beside the existing AHT
harness and uses it: each journey leg runs as (part of) an existing harness case, and this code turns the case results
into leg and run verdicts, holds the run budget (the legs the run request names, frozen per-leg allocations and each
journey's protected cleanup reserve, reserved before the run and shared safely between workers), records cleanup
evidence for the next run's admission, and derives the nightly limits.

Nothing here runs a live AHT, writes to production, touches Stripe or activates the nightly. The vendored harness
packet (`../harness/bundle`, `../harness/draft-adapters`) is not edited; the changes it needs are listed, file by
file, in the harness handoff in the description of #1865, for the owners of those files.

## Files

| File | What it does |
|---|---|
| `journey-plan.cjs` | The nine journeys and 24 legs, the home of every one of the catalog's 204 rows, the 19 new rows, each leg's harness case and Start presses, and its gates |
| `case-results.cjs` | Splits one harness case result (`{ caseId, assertions }`) into the results of the legs that case covers; a row the plan places nowhere fails the legs |
| `leg-verdicts.cjs` | Leg and run verdicts: FAIL over HOLD over NOT RUN over PASS. A dependent leg whose dependency did not pass never PASSes: it keeps a known HOLD (a HOLD gate or HOLD rows) and is otherwise NOT RUN with the dependency as the reason. A recorded FAIL or a budget overrun stays FAIL whatever comes later; a budget that can't be read, or a torn journal, holds the leg (never NOT RUN, never PASS), and the run's ledger never overwrites a worse verdict. The full suite reads INCOMPLETE while any planned leg (J9.b every night) is not PASS; the selected legs' result is a separate summary ("All runnable legs passed: N of 24 planned legs run; excluded: ...") that never changes it |
| `run-budget.cjs` | The run budget to Sam's #1864 and #1865 reviews. The run request names its legs (a leg only with the legs it needs); a ceiling that can't cover them, or is above their need, is refused before the run, never met by dropping legs. Each allocated leg's coaching and Start presses and each journey's cleanup reserve are fixed before the run; every reservation is one atomic step over an event journal, in one process or across workers (`openSharedRunBudget`: a lock directory owned by a pid, host and token; a dead owner's lock broken only after re-reading it under a break lock, a live one waited for and then refused, and a step never removes a lock it doesn't hold; a write cut short by a crash is repaired into a `torn` event that stops all further test work, counts against every journey's cleanup and holds every leg's budget row; an unreadable journal or an altered plan refuses everything, and cleanup then reads as incomplete); no release, so a retry can't borrow; J1.e's expired-token probe reserved at its worst case; cleanup draws only on its journey's reserve, which ordinary work can't reach; a cleanup reservation that fails for any reason marks its journey's cleanup incomplete |
| `cleanup-plan.cjs` | Each journey's protected cleanup reserve, the structural worst case of the cleanup code as it is (`tests/live/helpers/runOwnedCleanup.ts`, `feedbackFence.ts`; a drift test re-reads it): requests, and time at a 10 s deadline per request, for one run-owned account per harness case (each case signs up its own account today; AHT-15 runs on a maintained account, read from its harness template, so it is neither signed up nor deleted) plus one for a journey's legs that have no harness case yet plus every take the journey can open and each fenced case. The id-recovery poll (600 requests) is left out: it belongs to the protected recovery route, so a journey that needs it reads as incomplete. J2 has no reviewed cleanup step, so it gets no reserve and a run naming it is refused |
| `cleanup-evidence.cjs` | Durable cleanup evidence: admission and the start record are one step under an exclusive lock (`beginRun`), so two runners can't both be admitted, and a lock left by a killed runner refuses every later run until removed; the start record comes before the first send, then per journey what was done and what was left; the start record names the run's journeys and the evidence must name exactly those, so empty evidence is never complete; a journey whose reserve the run budget reports exhausted is incomplete whatever the caller says; evidence is written once (a hard link, never a rename over), so it can't be overwritten; the next run is refused while an earlier one has no evidence, incomplete cleanup or unreadable evidence, until a recovery is recorded |
| `counts.cjs` | One rule for every count a check reads: a nonnegative whole number, or the read is not observed (NaN, negative, fractional or missing is never zero) |
| `limits.cjs` | The lowest limits that give a truthful result: exact counts for sign-ups, takes, starts, coaching (probe reserves included), identity reads and provider calls; request and time limits per journey from complete baselines plus the evidence-based margins (11% and 14%), plus each journey's cleanup reserve; dollar caps from a supplied price |
| `oracles/*.cjs` | The new rows' checks: 30-day trial, ending a canary-tagged run-owned trial, sign-out (no unauthorized read, no stale request), payment wall and server refusal, short Stop saves nothing (HOLD unless Stop was pressed while recording; FAIL unless the page says the take wasn't saved; a new row or placeholder settled as failed is allowed, a completed or changed saved take FAILs, an unsettled discard, a duplicate row or any other change HOLDs), billing portal opens (only an explicit true counts as shown; the test-mode check and every step bounded; only an explicit true proves test mode, so a timeout or anything else FAILs with no session created; URL never logged), billing-row reconciliation, the test-mode paid fixture, kept sessions send no new coaching |
| `tests/*.test.cjs` | node:test files (198 tests), run by `../tests/test_nightly_suite.py` inside the package unit tests |
| `negative-controls/` | 160 seeded breaks: each must make its test fail and pass again once restored |

## Rules the code enforces

- A leg PASSes only when every row it must report passed. Anything skipped, gated or not reached is NOT RUN, never PASS.
- A leg with no harness case yet (J1.e, J1.f, J2, J7.d, J8.c, J9.a, J9.b) is NOT RUN until its adapter lands through the handoff.
- J9.a is labelled Stripe test-mode sandbox, never production billing proof; J9.b is NOT RUN by design on every run.
- Counted limits carry no margin. Measured limits stay unset until a baseline run in which every runnable leg executed.
- The run request names its legs; the budget never chooses them. A ceiling that can't cover the named legs is refused, never trimmed.
- Every leg's allocation is fixed and reserved before the run starts. A leg that asks for more fails its budget row and sends no more ordinary work of any kind (cleanup stays available); it can't borrow from another leg, another journey or a cleanup reserve.
- Cleanup is never silently skipped: a reserve that runs out, a failed step or anything left behind makes cleanup incomplete, and the next run is refused until it is recovered.
- Every count a check reads must be a nonnegative whole number; anything else is HOLD (or FAIL where the check fails closed), never zero.
- A FAIL is never hidden: no later NOT RUN or HOLD turns it into anything else.

## Commands

```
node --test tools/cloud-test/nightly/tests/*.test.cjs
node tools/cloud-test/nightly/negative-controls/run.cjs --out /tmp/nightly-negative-controls.json
python3 -m unittest tools/cloud-test/tests/test_nightly_suite.py
```
