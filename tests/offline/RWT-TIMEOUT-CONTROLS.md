# Offline RWT timeout controls, 2026-10-18

This packet exercises Playwright's real body-timeout and separate `afterEach` scheduler without a browser, account, database, credentials, or Production writes. The cleanup adapter and browser wait in `rwt-timeout-races.spec.cjs` are fakes. They characterize the required orchestration behavior; they do not prove App's live watchdog or finalizer has implemented it.

`node --test tests/unit/rwtTimeoutCleanupPlaywright1593.test.cjs tests/unit/rwtTimeoutRacesPlaywright1593.test.cjs` returned **9/9 PASS**. The cases cover cleanup after an expired body, failed residue readback, a diagnostic that consumes teardown before cleanup, late body continuation racing teardown, context-close rejection of an in-flight wait, and partial signup with one, zero, or ambiguous exact-email lookup. The late case has a negative control: disabling the shared single-flight guard calls cleanup and writes the receipt twice. The test with the guard calls each once.

The separate real `cleanupRunOwnedAccount` helper is exercised with a fake admin in `runOwnedCleanupNullCount1593.test.ts`: **14/14 PASS** with coverage enforcement disabled for the targeted run. New controls prove a minted email with no captured UID recovers one exact match, deletes that UID, and emits a counted-zero verdict; two exact matches refuse deletion and emit no clean verdict. No real admin client or credentials are used.

The dynamic-label regression in `rwtInterruptedRunRecovery1258.test.ts` remains **intentionally RED** on the existing selector: eight generated labels are unrecognized. The legacy-domain and unknown-label negative assertions are now a separate executable test, which passes even while the dynamic-label test fails (**30 PASS, 1 expected FAIL**). No recovery grammar or deletion authority was changed.

App still owns live implementation and case-12 operational proof. These offline results do not establish live timeout-safe cleanup, residue zero, or recovery eligibility.
