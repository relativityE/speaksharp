# deadlock.5 verification — 2026-10-07 (candidate 4: resume-claim race; includes candidate 3)

Python regression suite: **237 passed** (196 from the first deadlock.5 checkpoint, 30 in candidate 2, 9 in candidate 3 and 2 in candidate 4, all in `test_deadlock5.py`). Node UI smoke: **passed**. Run on the CLI Dev Mac under the shared `host-interlock` lease, which was claimed fresh for this candidate. The run used a scratch copy of this bundle with loopback-only ephemeral ports, a temporary state DB per test and a fake GitHub adapter. No live board, installed app, GitHub write or PR lifecycle was touched.

Candidate 3 adds:
- refresh deduplication across distinct authorized sources, with provenance kept;
- restart after the Ready write landed but before the journal commit;
- an unsupported action or a disabled executor holding a dependent Dev handoff, including the active-assignment none→dev correction;
- independent Dev work proceeding despite a blocked action;
- `dispatched` requiring a handoff from the same turn;
- an end-to-end run with no PO relay: ask → refresh → exact-head review → PM handoff (ask dispatched) → Dev invoked (handoff received) → Dev receipt (handoff acknowledged, ask closed);
- a stalled handoff getting one recovery, then a blocker;
- exact-commit remote packet readback with hash verification, refusing branch refs and paths outside the PR.

Candidate 4 adds a deterministic regression where a second database connection claims the unconfirmed row between the request's read and its claim (the loser makes no GitHub write), and a two-thread race on one unconfirmed candidate (exactly one resume, one Ready write). RED: reverting only the claim check fails the interleaving test.

RED: mutants that remove the active-assignment hold or put the source id back into the refresh key fail 2 and 3 tests respectively. Candidate 2's three mutants are retained.

A live read-only demonstration of `verify_remote_packet` on published commit `6f765c602c934d8b22a69d9acf95c60807770230` verified all five files of the candidate 2 packet. It reported 0 mismatched and 0 missing.

Not verified here: installed-board restart, a live worker wake-up, a live GitHub refresh, and external Browser PM/App Dev receipts in practice. These need separately authorized installed acceptance. This release adds no merge, deployment, migration or Production-run authority.
