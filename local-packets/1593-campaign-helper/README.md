# #1593 campaign helper: App Dev's read-only integration of the bootstrap contract (correction 3)

`collect.mjs` is the **read-only adapter** that feeds the Browser PM's decision table, `../1593-bootstrap/contract.mjs`. The contract is vendored byte-identical from `ecd2c048` (blob `fe5b6c79`) and is **unchanged**; its own 70 tests still pass. The adapter gathers each fact from its real source, asks `assess()` for GO or HOLD, and **prints** the exact dispatch for that case. It never dispatches, writes, deletes, claims, cleans up or mints a receipt. Any fact it cannot prove reaches the contract as missing or dominant, so the contract holds.

This correction answers Sam's operational HOLD on `7e3e6872` (review 1792317800, findings §1–§6) and CLI Dev's 2026-10-18 cross-check. §6 and the cleanup null-count finding are fixed in the maintained specs on PR #1655, which this branch is built on.

## Correction 3 (Sam 1792322163.663469: four reproduced gaps in correction 2)
1. **Unknown history holds.** `classifyPriorAttempt` exempts only positively identified evidence:
   - `no_dast`: the single Gate 3 job was skipped;
   - `non_rwt`: one named non-RWT spec, matching in output and environment;
   - `read_only`: exactly case 15's spec and grep, both acks empty, no cleanup line;
   - `rwt_clean`: one verified zero-residue cleanup.

   A missing or ambiguous spec, an environment mismatch, a missing log, or an RWT spec without cleanup proof is `unknown`, and it holds case 1.
2. **Attempts by their own start time.** The window lists runs back to GitHub's re-run horizon (31 days) and expands each to its attempts via the attempt API. An in-window retry of an older run is counted. An unreadable start time is counted, never dropped. Bootstrap classifies **every** earlier attempt on S, not just the latest, so an earlier attempt's residue can't hide behind a clean retry. An unreadable list leaves the bootstrap unverified.
3. **Effective inputs are bound.** The attempt's own diagnostic step prints its `env:` block in the job log (verified on rc-gates runs 39076238188 and 39075833843). These must equal the case's expected values exactly: `BASE_URL`, `EXPECTED_RELEASE_SHA` (= run head), `EVIDENCE_SCOPE=diagnostic`, spec, grep, `MODEL_COMPARISON_AUTHORIZATION_FILE=''` (`comparison_cell=none`), `RWT_WRITES_ACK`, `RWT_CANARY_CLAIM_ACK` and `RWT_HUMAN_REFLEX_MS=500`. The receipt's `meta.humanReflexMs` must be 500. Every gate job other than Gate 3, and the comparison authorization, must be `skipped`. A missing key, a repeated key, or a second step block is an error.
4. **Bridge N/A is explicit.** `readback.journeys` and `readback.missingBindings` must both be arrays and both empty (the receipt always writes both: `rwtJourney.ts` `write()`). An absent field is unknown, never empty.

## Who judges a receipt: the repository finalizer, not this helper (§1)
`evaluate.mts` runs `automatedEvaluation()` from `tests/live/helpers/rwtAcceptance.ts`, added in #1655. That is the same `validateReceipt` and readback settlement that `pnpm rwt:finalize` uses, minus the worksheet. Human observations are excluded; they are the PO's human/device acceptance and are never inferred. The rows each suite must carry come from that suite's own `requiredAutomatedRows()` inventory. **No row label is written into the helper.** Before it trusts the evaluator, the helper requires `git diff --quiet S -- tests/live/helpers frontend/src/services/telemetry` (dependency identity).

Each suite's identity rows are the identity steps in **its own inventory**, and each must be PASS:

| Cases | Identity rows (from source) |
|---|---|
| 1 Open Mic | `signup`, `sign-in`, `session bears canary claim` |
| 2–3 Focus | `session bears canary claim` only. **Flagged:** the Focus journey emits no signup row. Account creation is proven only by the canary-claim row plus run-owned cleanup. |
| 4–14 | `run-owned signup`, `canary claim in fresh login` |
| 15 returning user | `returning-user sign-in`, `returning account state` |

## Per-case evidence, all from the same run attempt (§2, §3)
| Fact | Source and check |
|---|---|
| Run identity | `GET …/runs/{id}/attempts/{n}`: id and attempt equal the ledger's; `path = .github/workflows/rc-gates.yml`; `head_branch = main`; `event = workflow_dispatch`; `status = completed`; `run_started_at` inside the authority window |
| Job | Exactly one `Gate 3 - DAST / Running App` job in that attempt |
| Spec and grep | Exactly one **output** line `spec=… grep=…` (`rc-gates.yml:349`), equal to the case's. The step's own `echo` script text is never read as output. |
| Receipt | Artifact `rwt-receipts-attempt-<n>` (`rc-gates.yml:459`): exactly one, unexpired. It holds exactly one `<case suite>.receipt.json`, JSON-equal to the job log's single `RWT_RECEIPT` line. The receipt's `release` must equal the run's `head_sha`. |
| Readback | **Declared** (cases 1–3, 7–8; the inventory requires `journey telemetry received`): exactly one `<suite>.readback-verdicts.json`, settled by the finalizer. Every bound journey must be `QUALIFIED`, so received telemetry is PASS. **Bridge** (4–6, 9–15; the workflow writes no verdicts, `rc-gates.yml:402`): the receipt must have zero bindings and zero missing bindings, and no verdicts file may exist. That is recorded as `not_applicable_source_defined`, never as "missing means complete". |
| Cleanup | From this job's log: exactly one `RUN_OWNED_CLEANUP cleanup_verified residue=N tables_verified=M` line, **first**, with M > 0. A later `cleanup_not_required` (the partial suite's `afterEach` after its in-body cleanup) is allowed. Residue is the printed number, never a default. The scope digest is the hash of `runOwnedCleanup.ts`'s blob **at the run's head**. Case 15 must log no cleanup line. |
| Config | The config digest is computed at the run's own `head_sha` from that SHA's blobs: `rc-gates.yml`, the live config, nine spec blobs, and the `tests/live/helpers` and `frontend/src/services/telemetry` tree ids. It is never copied from authority. |

## Dominant stops: no `continuationApproved` can override these (§4)
The entry's `dominantStop` is true on **any** verification error above. It is also true on any of these rows being non-PASS (or absent where the suite's inventory requires them): an identity row, `receipt content-free` (privacy), `telemetry decodable`, `coaching request budget` (unknown or unanswered provider cost, or exceeded), `run-owned cleanup`, `no Cloud STT request`, `navigation writes nothing` or `no mic on navigation`. It is likewise true on any `EXTERNAL` provider-outage row, and on unqualified readback for a declared suite. Only other product rows produce an ordinary `HOLD`/`FAIL`, and only those can be continued by review.

## Ledger, activity, bootstrap and freshness (§5)
- The operator ledger file is input. `campaignId`, `entries`, `inFlight` and `unresolvedCleanup` are **required** (no empty defaults). Each entry needs `caseNumber`, `runId`, `runAttempt`, `reviewed` and `continuationApproved`. A file that asserts `verified` is refused; `verified` is computed.
- **Complete accounting:** every `rc-gates.yml` run attempt created since `authority.validFrom` is read (paginated). Each must be a ledger entry or listed in flight, and every entry must be one of them.
- **Activity:** every page and every active status (`queued`, `in_progress`, `waiting`, `requested`, `pending`) at any age, for main, `rc-gates.yml`, and the Edge deploy, canary, migration-apply and migration-deploy workflows. Any active run means busy; an unreadable list means unknown.
- **Case 1 bootstrap** has three conditions. The operator passes `--first-dispatch` explicitly. No rc-gates run may exist since `validFrom`. Every earlier RWT run on S must be the read-only case or show a verified `residue=0` cleanup. If either list is unreadable, the bootstrap is not verified.
- **Freshness:** the observation window starts when collection starts. `now` is taken **after** every read, so an observation or authority that expires during collection holds.

## Run
```sh
node --test local-packets/1593-campaign-helper/collect.test.mjs     # 38 tests, no network (needs tsx: node_modules/.bin/tsx or TSX_BIN)
node --test local-packets/1593-bootstrap/contract.test.mjs          # 70 tests, vendored contract, unchanged
node local-packets/1593-campaign-helper/collect.mjs --case 1 --authority <authority.json> --ledger <ledger.json> --first-dispatch
```
The tests build every fixture from each suite's real inventory and judge it with the real finalizer. They include the negatives Sam named:
- wrong suite, wrong attempt and wrong artifact;
- missing readback, unknown cost and privacy FAIL (each held even with continuation approved);
- omitted ledger state, older active runs, and expiry during collection.

They also cover:
- spec/grep mismatch and script-text immunity;
- bridge N/A validation, cleanup ordering, residue and scope;
- dependency identity;
- no authority stamping.

Mutating any dominant check, the ledger defaults or the `now` ordering turns the suite red. The same is true of each correction-3 fix: unknown→read-only, latest-attempt-only, unbound env inputs, unbound receipt reflex, and absent→empty bridge arrays.
