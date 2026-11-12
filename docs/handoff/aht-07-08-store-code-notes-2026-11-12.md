# AHT-07 / AHT-08 recovery store code: notes for Sam (2026-11-12)

Patch: `aht-07-08-store-code-2026-11-12.patch` (sha256 `67b4efafa84d2734519cb6441d7ce29806c4c5e699fda5d9ceaaf3eeb1147c11`).
Local only. Nothing was pushed, no PR or remote branch, no live spec or workflow run, no network test. Nothing is provisioned.

- **Base:** origin/main `49fc9cada866f86e319652b66f9bdb0b1522d5e1`
- **Head:** `72521dbb83b74d83f24b28edb7570dd0cd00704f`. Branch `local/aht07-08-store-code`, worktree `/home/user/wt-store`.

## Commits
1. `15ac3fc2` AHT-07/08 recovery store code: executor, ordering control, AHT-08 durable path
2. `72521dbb` Refresh RWT release-binding TEST_PINS for the AHT-07/08 recovery store files

## Files changed (10)
New:
- `tests/live/helpers/feedbackRecoveryExecutor.ts`
- `tests/live/feedback-recovery-executor.live.spec.ts`
- `tests/unit/feedbackRecoveryExecutor.test.ts`
- `docs/rwt-feedback-recovery-executor.draft-job.yml`

Changed:
- `tests/live/helpers/feedbackRecoveryInventory.ts`
- `tests/live/helpers/feedbackNoSessionCleanup.ts`
- `tests/live/rwt-feedback-association-boundaries.live.spec.ts`
- `tests/unit/feedbackBoundedWrites.test.ts`
- `tests/unit/feedbackNoSessionCleanup.test.ts`
- `tools/cloud-test/scripts/validate_rwt_release_binding.cjs` (pins only)

None of the single-writer files you listed were edited.

## What each item does

**A. Recovery executor.** `feedbackRecoveryExecutor.ts` is the first caller of `recoverFromInventory`. It works like this:
- It verifies the store and lists only names that match `^(aht07|aht08)-….jsonl`. The marker and probes are ignored.
- It reads each file locally and labels it `ready`, `noStopRecord`, `otherStore`, `malformed`, `unreadable` or `unsafe`. `unsafe` covers a symlink and a file whose name doesn't match its own run line.
- By default it only detects: it uses no credential, makes no database read and deletes nothing.
- It deletes only when all of these hold: the run is on `refs/heads/main`, it is attempt 1, HEAD equals the dispatched SHA, and the ack is `RWT-FEEDBACK-RECOVERY-DELETE@<exact 40-hex sha>`. This mirrors `recoveryDeleteAck`, but with a separate value. The interrupted-run ack does not authorize it.
- With that authority it calls `recoverFromInventory` on each ready file. A HOLD keeps the file. A FAIL or a throw stops the run.
- A listing error gives `HOLD_LISTING_FAILED`.
- Output is one count line, `RWT_FEEDBACK_RECOVERY status=…`. It never contains ids, keys, uids, emails or file names.

The entry point is `tests/live/feedback-recovery-executor.live.spec.ts`. It follows the interrupted-run pattern: authority is checked before any credential, and the service-role client is created only when deletion is authorized. The ack is read from `RWT_FEEDBACK_RECOVERY_ACK`, never from `RWT_WRITES_ACK`.

The draft job is `docs/rwt-feedback-recovery-executor.draft-job.yml`. It covers OIDC/WIF, a gcsfuse mount at `/mnt/rwt-recovery` with `--file-mode 600 --dir-mode 700` and zero-TTL caches, `RWT_RECOVERY_DIR`, the `feedback_recovery_ack` input and a credential-free authority step. It is marked DRAFT, is not wired into any workflow, and is not to be enabled without Akin's go. A unit test checks that no file in `.github/workflows` references it.

**B. Ordering control** (`feedbackRecoveryExecutor.test.ts`). It calls the real `recoverInterruptedRuns` with a fake cleanup that deletes the account the way the product does, so report `user_id` becomes NULL. The executor then finds both reports by their recorded keys, deletes exactly those ids, and residue reads zero.

**C. AHT-08:**
1. **Store gate.** `verifyRecoveryStore` runs in the no-session test before `prepareDisposable`. If it fails, the test HOLDs with the same `RECOVERY_STORE_STEP` halt as AHT-07.
2. **Inventory.** `prepareDisposable` gained an optional `onAccountCreated` callback (AHT-07's call is unchanged). AHT-08 uses it to open its `aht08` inventory, with the owner uid, right after `owner.uid = account.uid`, before any submit.
3. **Pass-through route.** `NoSessionReportRoute` sits on the report insert only. Reads are passed straight through. For an insert with exactly one valid key, it records and fsyncs the key first, then calls `route.fetch()`, records the settle, and returns `route.fulfill({ response })` with the server's own answer. Anything it can't record is aborted unsent: no key, two keys, an unreadable body, PATCH or DELETE, a lost store, or a write after `stop()`. There is no fault injection, no synthetic answer and no retry.
4. **Settle and stopped record.** The finalizer runs after "owned pages closed" in this order: `reportRoute.stop()`, then `inventory.stop()`, then `drain(15s)`, then `recordWriterStopped(pending)`. Only a drain of 0 writes the record. `withRouteDrain` adds the route's keys to the run keys. The drain result (pending, or null when no drain ran) is carried in `NoSessionInsertSnapshot.inFlightAfterDrain`, so the four source-contract wire lines stay byte-identical. Zero residue now goes through `settleRecoveryInventory`, so the file is retired only on PASS.
5. **Per-case naming.** `recoveryFileName(b, case = 'aht07')` and `FeedbackRecoveryInventory.open(b, store, case = 'aht07')`. AHT-07's file name and schema string (`speaksharp.aht07.feedback-recovery.v2`) are unchanged. AHT-08 uses `aht08-…` and `speaksharp.aht08.feedback-recovery.v1`. `readRecoveryInventory` returns `recoveryCase`.
6. **Guards.** The AHT-08 isolation guard in `feedbackBoundedWrites.test.ts` now requires the store gate, the aht08 inventory, the route, `withRouteDrain` and `settleRecoveryInventory`. It still forbids `installFeedbackWriteRoute`, `FeedbackAttemptLedger`, `runFeedbackFaultLeg`, `ledger.`, `FEEDBACK_FAULT_LEGS`, `armLeg`, `markRetry`, `beginFinal`, `syntheticRejection`, `feedbackLedgerVerdict`, `FEEDBACK_ATTEMPT_CAP` and `recordDurably(` in the test. It also forbids AHT-07 fault and cap names in the helper. The importer lists now allow the executor and the no-session helper. The scope controls in `feedbackNoSessionCleanup.test.ts` were rewritten:
   - They now pin what is true: the key is durable before forwarding, the route is a pure observer, and the known limit is stated.
   - They check that the old "IN-RUN cleanup only / memory-only" sentences are gone.
   - They still forbid recovery inside the journey.
7. **Negative controls**, all in `feedbackNoSessionCleanup.test.ts`:
   - No or unverified store: HOLD before any write.
   - Executor A dies (a real child process exits while its insert is in flight) with no stopped record: B HOLDs, deletes nothing and keeps the file.
   - An insert aborted unsent (refused, or recorded then settled as not forwarded): B finds nothing to delete.
   - A late commit after A stops: B HOLDs, then deletes exactly `late`.
   - B refuses another store's inventory.
   - A key recorded only after the send fails the ordering control (M1 below).

**Known limit** (in the helper, inventory and executor comments): a runner killed before its writer-stopped record cannot be recovered. Recovery HOLDs and keeps the file. No timeout or file age stands in for that record.

## Tests
- **Focused vitest, 12 files: 512/512 pass.** The files:
  - feedbackRecoveryExecutor: 23
  - feedbackNoSessionCleanup: 47
  - feedbackBoundedWrites: 76
  - feedbackAckReceivedAht08: 31
  - feedbackDiagnosticRef1539: 52
  - rwtSupplementalAcceptance1594: 35
  - rwtInterruptedRunRecovery1258: 30
  - helperExecutionEvidence: 18
  - helperExecutionEvidence1812: 1
  - sourceContractEvidence: 20
  - modelComparisonRunAuthority: 67
  - rwtWatchdog1593: 112
- **Full `tests/unit` (vitest, coverage off): 6868/6869.** The one red test is `ciAptImageSkew.test.js` › "an UNREADABLE image.manifest fails closed…". It fails the same way on unchanged base: the runner is root, so the "unreadable" file is readable. It is not related to this change.
- **`node --test tools/cloud-test/tests/rwt_release_binding.test.cjs`: 86/87.** The red test is test 9, "only the exact accepted … postimages may differ", with `DIAGNOSTIC_TEST_SOURCE_PIN_DIFFERS`. The cause is that `INTEGRATION_PINS['product_release/RELEASE_STATUS.md']` (`f823b945…`) is already stale on origin/main, where the actual hash is `2e53046b…`. It was stale before this patch and is not mine to change. Every TEST_PIN this patch touches matches its file.
- **`tsc --noEmit -p tsconfig.live.json`:** clean.
- **`verify-live-typecheck-scope`:** OK.
- **eslint `--max-warnings=0` on every changed .ts file:** clean. The `.cjs` validator shows 12 `no-undef`/`no-require-imports` errors. Those errors are identical on the base file, and only hash strings changed.

## Mutation table (21 caught out of 21 real mutants; 2 equivalent mutants survived)
| # | Mutation | Caught by |
|---|---|---|
| M1 | route records the key only after `fetch` | ORDERING: key on disk when the request leaves the browser |
| M2 | AHT-08 store gate removed | no/unverified store HOLD control; older-take/AHT-08 gate order (bounded writes) |
| M3 | `recoverFromInventory` ignores a missing writer-stopped record | executor A dies with no stopped record → B HOLDs |
| M4 | executor treats no-stop-record as ready | detect-by-default counts; known-limit HOLD control |
| M5 | `recoverFromInventory` accepts another store | B refuses another store's AHT-08 inventory |
| M6 | executor treats another store as ready | other-store / malformed / renamed / symlink HOLD control |
| M7 | executor ack check dropped | detect by default deletes nothing |
| M8b | ack not bound to the sha (any prefix authorizes) | refuses an ack bound to another commit, and others |
| M9 | protected-main check dropped | refuses a branch other than main / a tag |
| M10 | listing error treated as empty | a listing that throws is HOLD_LISTING_FAILED |
| M11 | a file name leaks into the report | content-free report check |
| M12 | finalizer drains before stopping the route | stop-before-drain order control |
| M13 | writer-stopped written with handlers in flight | stop before drain: no record while in flight |
| M14 | keyless insert forwarded | a key it cannot record is aborted, never sent |
| M15 | recovery locates by uid only | ordering control and AHT-07+08 recovery by key |
| M16 | default case switched (AHT-07 name changes) | per-case naming; AHT-07 cross-executor restart control |
| M17 | AHT-08 opens an AHT-07 inventory | AHT-08 wiring and isolation guard |
| M18 | AHT-08 test mentions `runFeedbackFaultLeg` | AHT-08 isolation guard |
| M19 | executor recovers a renamed file | renamed-file HOLD control |
| M20 | entry point creates the client regardless of authority | entry-point authority-before-credential check |

The two equivalent survivors are kept for honesty:
- **M8** set `deleteAuthorized` to any-prefix but kept the bound-refusal line just above it, so its behaviour is identical.
- **M8c** removed the second ack check inside `runFeedbackRecovery`. That check is defence in depth and can't be reached while the authority function is intact, the same pattern as `recoverInterruptedRuns`.

The harness that applied each mutation, ran the named test file and restored the file is in the session scratchpad.

## Registry entries for Sam to add (not edited, since these are single-writer files)
`scripts/lib/helperExecutionEvidence.mjs` `HELPER_CONTRACTS`. Replace the two existing entries and add one. I checked that each callable resolves to exactly one declaration.
```js
}, {
  helperFile:'tests/live/helpers/feedbackNoSessionCleanup.ts',testFile:'tests/unit/feedbackNoSessionCleanup.test.ts',
  callables:["noSessionWriteUncertainty","withRouteDrain","NoSessionReportRoute#handle","NoSessionReportRoute#stop","NoSessionReportRoute#drain","NoSessionReportRoute#observation"],
}, {
  helperFile:'tests/live/helpers/feedbackRecoveryInventory.ts',testFile:'tests/unit/feedbackBoundedWrites.test.ts',
  callables:["verifyRecoveryStore","recoveryFileName","recoveryCaseOfSchema","recordDurably","settleRecoveryInventory","readRecoveryInventory","unresolvedAttempts","recoverFromInventory"],
}, {
  helperFile:'tests/live/helpers/feedbackRecoveryExecutor.ts',testFile:'tests/unit/feedbackRecoveryExecutor.test.ts',
  callables:["feedbackRecoveryDeleteAck","feedbackRecoveryAuthority","listRecoveryFiles","classifyRecoveryFile","runFeedbackRecovery","feedbackRecoveryReportLine"],
```
The same three rows also need updating in the `AHT1811_HELPERS` list in `tests/unit/helperExecutionEvidence.test.js`, which pins each entry with `deepEqual`. That test file is TEST_PINNED too, so its pin would need refreshing. No test is red today without these entries, because the registry is a subset.

Optional, in `scripts/lib/sourceContractEvidence.mjs`, to pin the AHT-08 wiring:
- add `'NoSessionReportRoute','withRouteDrain'` to `REQUIRED_IMPORTS['tests/live/rwt-feedback-association-boundaries.live.spec.ts'].names`;
- add to that spec's wiring needles `'inventory?.recordWriterStopped(pendingAfterDrain);'` and `'insertSnapshot = withRouteDrain(insertSnapshot, reportRoute?.observation() ?? null, pendingAfterDrain);'`.

The four existing wire lines are unchanged and the source-contract tests pass.

## What I could not do, or what Sam should decide
- The draft YAML in `docs/` is not in `SOURCE_PINS`. A diagnostic dispatch whose diff includes it would refuse with `PRODUCT_OR_LIVE_TEST_SOURCE_DIFFERS` unless Sam pins it or keeps it out of the dispatched diff. I added pins for the three new test files. Sam can drop them if he'd rather not.
- I could not check gcsfuse flag names, the `google-github-actions/auth` version or the setup-action path against a live runner. They are marked "pin before enabling". The section-5 store-only proof is still the first real check.
- The executor deletes only through `recoverFromInventory`. If the account still exists when it runs, recovery deletes the run's report ids and then FAILs on residue (the auth user is still present), keeping the file. That is shown in a test as existing behaviour. Run order should be interrupted-run recovery first, then this executor.
- Deps came from the main checkout's `node_modules` by symlink (same lockfile). Nothing was installed.
