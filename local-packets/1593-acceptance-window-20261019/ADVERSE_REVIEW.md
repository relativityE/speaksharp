# Case13/14 exact-source adverse observer review
Browser PM,19 October2026. Read-only independent source / offline execution. App remains sole implementation writer; Sam selects priority and release scope.

## Current source and scope

Executed actual helper/logger/injection source from #1662 a81fbb97850749596f6fbfba006895fc56c65b26 at13:10:57UTC. Before disposition, live PR was re-read at45c579099c86c38a91d1df811856e822e9cdde97. The authoritative GitHub compare a81→45c is one commit with only rwtDocumentIdentity.ts, rwtWatchdog.ts and rwtWatchdog1593.test.ts changed. All three files exercised here are unchanged on45c. This is equivalent-source proof for these files, not an independent rerun of App's full latest-head suite.

Run: `node scripts/host-interlock.mjs hold local -- node local-packets/1593-acceptance-window-20261019/probe-adverse.mjs`

Eight grouped controls passed. Hashes, observed sequences, expected limits and outcomes are in adverse-results.json. Existing installed TypeScript and jsdom were used; no new dependencies, browser download, provider/model inference, hosted DB, account or live run.

## Confirmed false-PASS observer path

[armModelStatusLog lines72–80](https://github.com/relativityE/speaksharp/blob/45c579099c86c38a91d1df811856e822e9cdde97/tests/live/rwt-adverse-mic-model.live.spec.ts#L72-L80) promises every published status but its MutationObserver callback reads only the attribute's final current value. Actual function executed with real jsdom MutationObserver:

| Published attribute changes | Callback delivery | Retained history | Actual downloadFailureVerdict |
|---|---|---|---|
| loading→error | one batch | loading,error | PASS: honest failure positive |
| loading→ready→error | separate batches | loading,ready,error | FAIL: existing ready guard works when history is complete |
| loading→ready→error | ready+error in one batch | loading,error | PASS: intermediate published ready is erased |
| Same ready+error mutations with existing case11 oldValue observer | one batch | ready,error | FAIL: complete-history control |

This is a concrete actual logger→actual predicate false-PASS path, not just a missing test name. It does not establish that the original production run published ready, nor how often a live render uses this mutation schedule. React batching that prevents a ready attribute from ever being published is a different schedule; the control above explicitly mutates the published DOM twice.

Receiving fix: reconstruct each attribute transition using MutationRecords/oldValue (as the already-proven case11 helper does), include the initial status, and bind/drain/disconnect the observer within the actual page/attempt/fault lifecycle. Preserve both honest failure and separately-delivered ready controls; add same-delivery ready→error and loading→ready→error regressions. Missing/replaced observation must not look like a complete never-ready history. This does not require a product status rewrite.

## Offline injection count can miss a failure during the awaited transition

[lines227–244](https://github.com/relativityE/speaksharp/blob/45c579099c86c38a91d1df811856e822e9cdde97/tests/live/rwt-adverse-mic-model.live.spec.ts#L227-L244): the requestfailed listener counts only when faultOn is true, but the offline branch sets it after awaiting context.setOffline(true). The watchdog's phase opens earlier; that does not open this separate counter.

The actual listener + injection block, executed with a controlled fake context that delivers a model requestfailed during setOffline before its Promise settles, records0. Actual downloadFailureVerdict then returns HOLD/not-exercised despite that supplied failure. The same request delivered after the await records1. A non-model URL is excluded. This is a deterministic source ordering counterexample; Playwright callback-order frequency and attribution to the original case14 remain unmeasured.

Receiving fix: arm the selected fault counter before inducing offline, record whether injection succeeded, and conservatively retain uncertain injection/lost-source evidence rather than presenting it as no fault. Bind the actual selected model asset/request/attempt to the fault interval; a generic /models/ prefix is not causal proof. Existing control also demonstrates that a failed unrelated model config under that prefix counts. Sam already tracks exact-weight/fault/handler binding; do not mark it closed from these counters.

## Preserved dispositions and next boundary

- #1663's fault-state teardown correction remains credited/deployed in its recorded scope; these findings concern test observation, not a returned product fix.
- Historical case14 did exercise a model failure (modelFailuresAfterFault=1). This counterexample does not erase that fact or retroactively declare its fault unexercised.
- Historical cases13/14 remain open for chosen served release, truthful visible failure/Retry, exact injected-fault binding and recovery/save/no-Cloud evidence.
- Sam's a81 provenance RETURNs and App's45c successor review are separate. No duplicate identity finding or independent merge/CI/release decision is created here.
- No new live run is needed merely to fix these observation contracts. Reuse original receipts and the bounded offline negative controls; final live acceptance still needs its separate scope.


