# Cases 7, 10 and 15 — independent proof packet

Refs #1593. Source base `ba1a9f5ad31778460a4ea9e383a08be14b3222f6`.
App retains sole product-fix and landing ownership. This packet changes tests only; the audit consumes private retained evidence locally and publishes allowlisted assertions/hashes, never copies raw artifacts.

## Case 7: received feedback diagnostic assurance

Run `39180129880`, served `ecce3e8d9e154ddb12f7238a514f0ec85d4b75b4`: older-take association and exclusion of the newer request passed. The share-feedback journey qualified. Calling the maintained `automatedEvaluation(receipt, readback)` independently produces no binding errors and settles journey telemetry PASS, but leaves the diagnostic chain HOLD. The receipt has neither expected request/attempt digests nor an independent coaching diagnostic result. Therefore another generic finalization cannot close it.

Responsible boundary: `feedbackDiagnosticChainRow` emits settlement bindings only when `expected.outcome === 'success'`; the received `CoachingDiagnosticExpectation`/`validExpectation` also accepts success only. The retained budget contains two answered Edge-502 exchanges. Synthetic provider-429/Edge-502 controls reproduce a correctly linked failure that has only `telemetry_not_received` yet cannot enter the received gate. A success control emits the expected binding; borrowing the newer request FAILs. This establishes an assurance-path gap, not a persisted association defect or proof of received failure telemetry.

App's smallest successor should preserve the terminal failure outcome and exact sent request/attempt/release/product/model identities through the received assurance path, with coherent endpoint/provider classes and the received storage-success feedback link. Missing records must HOLD; mismatched identity, duplicate terminal records and wrong links must FAIL. Proving a received failure chain must never turn coaching itself into success. Sam owns the outcome/qualification disposition. No reason to re-run coaching merely to make the success-only gate pass.

## Case 10: permanent recovery fence versus zero-active oracle

Run `39179792398`: returned Start truthfully refused once then recorded; the successor saved. The failing oracle row records one baseline row, two final rows and one active row. It captures only row id/status in the caller: no permanent fence or lease identity is retained. Original FAIL remains.

Two added PGlite migration-chain controls exercise forced and stale replacement. They show the abandoned row remains `active` with a permanent `displaced` fence while the distinct successor is completed and its lease released. Old heartbeats fail; duration accrual, fence removal and reopening fail. Reacquiring even the old lease id does not remove the row fence; recovery saving remains possible. The current live zero-active oracle rejects this valid source state. These are offline source controls, not a claim about the deployed/historical row.

The follow-up runs both successor completion and displaced recovery through the actual eleven-argument `complete_session_v2` RPC. The displaced response-lost replay is idempotent, row count remains two, the permanent fence is unchanged and completion does not switch the current lease. Both forced/stale controls pass. The fixture applies the explicit historical migration chain listed in the test, not every later migration or the hosted database.

Required caller capture and oracle contract for App:

1. Bind the abandoned row and lease before leaving; capture exact baseline identities. Bind the distinct successor row/lease after return. Counts alone cannot establish exclusion.
2. Require exactly one newly created completed successor matching the persisted page id, distinct from every baseline/abandoned id. Duplicate, reused or missing identities FAIL.
3. Permit a remaining active row only if it is the exact known abandoned row with a non-null permanent `recording_fenced_at`, reason `displaced`, and its lease excluded from current recording authority. Unknown/unfenced active rows FAIL. Unreadable required facts HOLD.
4. Retain the fence identity through successor completion/release; assert no old lease can authorize ongoing recording. Do not delete or fail the recoverable row to satisfy zero-active.
5. A later authorized exact-release rerun must retain those assertions. Old counts cannot retroactively prove them.

## Case 15: fixture and physical evidence

Run `39179807441`: navigation/history/no-mic/no-session-write rows passed. The maintained Free account had `canStart=false`, `trialActive=false`, `isPro=false`; access remains HOLD. Both physical observations are pending.

The caller accepts an explicitly authorized `RWT_RETURNING_*` fixture, otherwise maintained `FREE_TEST_*`. Actions can inject existing credentials. Select an eligible existing/authorized fixture and verify identity, profile, prior history and current access; do not mutate entitlement or replace returning-user proof with a newly signed-up account without Sam's explicit fixture decision. Real microphone Allow/Deny on a fresh browser profile and real-phone Stop-during-flick confirmation require named device/OS/browser/observer outcomes at the served SHA. Synthetic mic probes and navigation receipts cannot fill these cells. Browser PM owns human/device preparation; App owns approved execution.

## Verification

- 76/76: case-7 boundary controls (3), full one-active-engine migration-chain suite (20), existing abandon/recovery oracle suite (53).
- 32/32 human acceptance/finalization and 34/34 existing coaching adapter controls passed in the initial bounded run. The new provider failure fixture initially used the application's pre-provider quota reason with provider429; corrected to the valid provider HTTP failure shape, then all three controls passed.
- Scoped ESLint passed. Full `pnpm quality` passed (exit 0): product contract, bounded repository lint, frontend/live/evidence typechecks and banned-disable check. Both enhanced forced/stale RPC controls were re-executed after the initial 76-test checkpoint and passed.
- `audit-retained.mts <private-run-set2-directory>` passed against four retained inputs; `retained-audit.json` contains the input hashes and allowlisted assertions.

No live run, provider/model call, deployment, database apply, production data mutation or physical acceptance was performed. Parent cases remain open until their missing integration/received/live/human evidence is delivered.
