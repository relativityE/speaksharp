# DEADLOCK-5 isolated repair — CLI Dev candidate 4 `deadlock5-20261007-clidev-c4-00337ca0d1c9`

**Status: DRAFT / NOT ACCEPTED.** This is the current CLI Dev candidate on lineage pristine `c543cdf9…` → captured patch `6936d6ca…` → c2 → c3 → **c4**. The PM resolved the lineage in favor of this lineage (delivery 91). Earlier packets stay immutable: c2 `clidev-6ac2913a3162`, c3 `clidev-c3-f8f4e612488d`, and the sibling `c488bf92c914` (lineage `0447adcc…`, not combined). Publishing this packet authorizes no install, restart, live refresh, merge, deployment or Production action.

Isolated tuple: `fix/rwt-deadlock5-isolated-6048172525` @ `18a601dcc18413744ccb50cdbf00beffb8219d75` / tree `da79db0d0b947a340dd5521343ceb1ab49bb6bb1`. Bundle source digest `837ec746151c6b9e3d149f39934a4a6f3bf591c51ae25d45355c140930453019`.

## What c4 fixes (PM P1, delivery 91)
In `execute_pm_actions`, resuming an `unconfirmed` refresh set `resume_phase` even when the conditional `UPDATE … WHERE status='unconfirmed'` changed zero rows. A request that lost the claim to another connection or process could therefore resume and call the lifecycle executor. c4 resumes only when that UPDATE changed exactly one row; otherwise it returns `RECORDED: running` and executes nothing. Within one process, `DB_LOCK` already serialized this; the gap was across connections and processes. c4 also carries every c3 fix for Browser PM review 6048387240 (see the c3 packet README).

## Files
- `deadlock4-to-deadlock5-c4.patch.txt`: the full patch from pristine. Apply with `patch -p1`, then copy `replacement-files/.` over it.
- `c3-to-c4.patch.txt`: the increment over c3 (4 files).
- `replacement-files/…`: the cleaned designer README, copied whole (its diff would quote the removed personal path).
- `rwt-pr-handoff-v4.6.16-deadlock.5-c4.zip`: optional reproducible bundle (two builds were byte-identical).
- `manifest.json`: SHA-256 for every packet and bundle file.

## Executed evidence (c4 bytes)
- Lease: shared `host-interlock hold local`, claimed fresh. CLEAR at 23:07:25 UTC; acquired the same second by holder 48115; released at 23:08:18 UTC; CLEAR again.
- **237 Python tests passed** and **the Node UI smoke passed**, from a scratch copy matching digest `837ec746…`. Temp DB, loopback, fake GitHub adapter.
- New regressions:
  - `test_resume_loser_between_read_and_claim_never_executes`: deterministic. A second sqlite connection claims the row between the request's read and its claim, and the loser makes 0 GitHub writes.
  - `test_two_requests_racing_one_unconfirmed_candidate_resume_once`: two threads, exactly one RESUMED, one Ready write.
- Both new tests were repeated 5× and passed every time.
- RED: reverting only the claim check fails the interleaving test.

## Still HOLD
- Installed-board restart and live acceptance (separately gated).
- A live `refresh_reviews` run on a real PR (not run).
- Real external App Dev receipt traffic.
- PM/Browser PM connector re-review of THIS commit.
