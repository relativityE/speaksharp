# #1593 campaign helper: App Dev's read-only integration of the bootstrap contract

`collect.mjs` is the **read-only adapter** that feeds the Browser PM's decision table, `../1593-bootstrap/contract.mjs`. That file is vendored byte-identical from `ecd2c048` (blob `fe5b6c79`), and its own 70 tests still pass. The adapter gathers each fact from its real source, asks `assess()` for GO or HOLD, and **prints** the exact dispatch for that case. It never dispatches, writes, deletes, claims, cleans up or mints a receipt. Any fact it cannot prove reaches the contract as missing, so the contract holds.

| Contract input | Real source |
|---|---|
| `observation.mainSha` | `git ls-remote …/refs/heads/main` |
| `observation.servedSha` | The production bundle's single `VITE_VERCEL_GIT_COMMIT_SHA` (more than one, or none, is unreadable and holds) |
| `observation.workflowSha` | The main SHA, because a `--ref main` dispatch runs main's `rc-gates.yml` and `EXPECTED_RELEASE_SHA = github.sha` |
| `observation.configDigest` | SHA-256 of the effective-config record at S: blob SHAs of `rc-gates.yml`, `playwright.deployed-live.config.ts` and all nine RWT specs, plus base URL, gate, reflex 500 ms, and the workers and retries read from the live config (they must be exactly **1 and 0**, with `fullyParallel: false`) |
| `observation.main / rcGates / production` | Run lists for main, `rc-gates.yml`, and Edge deploy, canary and migration-apply. Any queued or in-progress run is `busy`; an unreadable list is `unknown` |
| `ledger.entries[i]` | The actual run's Gate 3 log. The `RWT_RECEIPT` line gives the release, rows, outcome and the SHA-256 of the receipt line. The `RUN_OWNED_CLEANUP cleanup_verified residue=N` line gives a numeric residue; a missing line is null, never "0". The `coaching request budget` row's `browserRequests` gives the request count. "Reviewed" and "continuation approved" come from the operator's ledger file. |
| Dominant stop | A FAIL **or absence** of `run-owned signup`, `canary claim in fresh login`, `run-owned cleanup` or `telemetry decodable`. Product rows such as the coaching budget are ordinary. |
| Case 1 `bootstrap` | An explicit `campaign_start_preflight` with `previousReceipt: null`. It is never a cleanup receipt. |
| `invocation` | Cases 1–14 carry both literal acknowledgements. Case 15 carries neither (empty strings) and has no cleanup of its own. |

Each case's grep is verified to select **exactly one** test title in its spec.

## Known gap, reported and not papered over
The Open Mic, full Focus and partial Focus specs (cases 1–3) **do not emit a browser coaching-request count**: they have no `coaching request budget` row. Their ledger entries therefore carry `requests: null`, and the contract correctly **holds case 2** with `unknown_or_exceeded_case_requests`. Closing this needs a selected decision: emit the budget row in those three specs, or count from another proven source. The adapter never assumes a count.

## Run
```sh
node --test local-packets/1593-campaign-helper/collect.test.mjs     # 11 tests, no network
node --test local-packets/1593-bootstrap/contract.test.mjs          # 70 tests, vendored contract
node local-packets/1593-campaign-helper/collect.mjs --case 1 --authority <authority.json> --ledger <ledger.json>   # read-only GO/HOLD + printed command
```
