# DEADLOCK-5 isolated repair — CLI Dev candidate 3 `deadlock5-20261007-clidev-c3-f8f4e612488d`

**Status: DRAFT / NOT ACCEPTED.** This candidate supersedes CLI Dev candidate 2 (`deadlock5-20261007-clidev-6ac2913a3162` at `6f765c602c934d8b22a69d9acf95c60807770230`), which stays immutable. It answers Browser PM review 6048387240. That review read packet `deadlock5-20261007-c488bf92c914` at `f885af1e…`, which is another actor's lineage (captured patch `0447adcc…`); this candidate does not derive from it. Publishing it authorizes no install, restart, live board mutation, merge, deployment or Production action.

Lineage: pristine deadlock.4 `c543cdf9…` → CLI Dev captured patch `6936d6ca…` → c2 → **c3**. Isolated tuple: `fix/rwt-deadlock5-isolated-6048172525` @ `18a601dcc18413744ccb50cdbf00beffb8219d75` / tree `da79db0d0b947a340dd5521343ceb1ab49bb6bb1`. Bundle source digest `ae284ad25c4af761ead6102995e5a255803a6f1913aed8a874b6e4503e68bc24`.

## Files
- `deadlock4-to-deadlock5-c3.patch.txt`: the full patch from pristine. Apply with `patch -p1`, then copy `replacement-files/.` over it.
- `c2-to-c3.patch.txt`: this candidate's increment over c2 (6 files).
- `replacement-files/…/designer/5e77cf0dbf6c/README.md`: the cleaned file, copied whole. Its diff would have to quote the removed personal path.
- `rwt-pr-handoff-v4.6.16-deadlock.5-c3.zip`: optional reproducible bundle (two builds were byte-identical).
- `manifest.json`: SHA-256 for every packet file and every bundle file.

## Review 6048387240, finding by finding
| Finding | In c3 (source) | Executed evidence |
|---|---|---|
| **P1-1** Durable dedup across distinct sources, restart and concurrency | `guarded_pm.canonical_key`: the refresh identity is `kind/pr/head/base` only. `execute_pm_actions` claims with a journal `INSERT`. `provenance` keeps each source/queue id separately. Phases `draft_requested → draft_confirmed → ready_requested → ready_confirmed` are journaled. `running` becomes `unconfirmed` at restart. `_resume_refresh` / `resume_interrupted_actions` reconcile by readback and never replay blindly. | Host plan→journal→executor tests: distinct source ids (one cycle, two provenance rows), concurrent requests, restart after the Draft write, restart after Ready landed before the journal commit (no write), lost Draft write, interrupted Ready write. |
| **P1-2** Ask disposition through owner delivery and Dev receipt | `asks` ledger. `ask_dispositions` adds `dispatched` + `review_handoff_index`. The ask stays open until the owner echoes the handoff's `RECEIPT RH-…`. Handoff states are recorded → delivered → received (Dev invoked) → acknowledged. A generic reply, unrelated patch or newer event closes nothing. `pending_handoff_watchdog` gives one PM recovery, then a board blocker. | `test_end_to_end_review_to_owner_receipt_without_po_relay` (ask → refresh → exact-head review → board wake → PM handoff → Dev invoked → Dev receipt → ask closed; no PO row). Also stalled-handoff recovery, dispatched-needs-handoff, generic-reply, unpublished-reply and receipt-binding tests. |
| **P2-3** Blocked results stop dependent handoffs | `action_results_block()` is the typed gate over HOLD/BLOCKED/UNCONFIRMED/RECORDED-running. `dev_depends_on_actions` (default true) holds `next=dev`, and also the board's active-assignment none→dev correction, which was a second bypass. Independent Dev work proceeds when the PM sets it false. | Unsupported-action and disabled-executor tests with a dependent handoff, plus the independent-work test. |
| **Remote sharing** | `handoff_location()` and `GET /api/handoff-location` name the per-PR location. `verify_remote_packet()` and `GET /api/handoff-verify` read a packet back at an exact 40-hex commit and verify every manifest hash; branch refs and paths outside the PR are refused. Both are surfaced in the PM/Dev prompts and the dashboard. | Readback regression with a fake fetcher (ok, tamper, unsupported manifest, branch ref, out-of-PR path, traversal). A live read-only run on commit `6f765c60…` verified all 5 c2 files. The sibling `c488bf92c914` manifest reports "no per-file SHA-256 in a supported format". |

## Executed evidence for this candidate
- Lease: shared `host-interlock hold local`, claimed fresh. CLEAR at 23:02:39 UTC; acquired at 23:02:39 by holder 40809; released at 23:03:31; CLEAR again.
- **235 Python tests passed** (226 + 9 new) and **the Node UI smoke passed**, from a scratch copy whose digest matched `ae284ad2…`. Temp DB, loopback, fake GitHub adapter.
- RED: removing the dependent-hold check fails 2 tests; putting the source id back into the refresh key fails 3 tests. The 3 c2 mutants are retained.

## Still HOLD
- Installed-board restart and live acceptance (separately gated).
- A live `refresh_reviews` run on a real PR (deliberately not run).
- Real external App Dev receipt traffic.
- Connector readback of THIS commit by Browser PM.
