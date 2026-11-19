**Deliverable:** Jack owns the first Focus Points verification wave: J3.a (full fixture) and J3.b (partial fixture, then one repeat). Reuse the merged #1897 checks and existing Focus specs; change only what prevents those two outcomes from being proved.

**Expected outcome:** On the matching build, a user sees accurate Focus statuses and timing as they speak, saves the correct take once, reopens the same result, and can repeat the exact set. Coaching credit requires advice grounded in that saved Focus result, not just a response or a green workflow.

1. Start after the bounded J4.a work on #1901. Map J3.a/AHT-02 and J3.b/AHT-03 from [RELEASE_STATUS](https://github.com/relativityE/speaksharp/blob/main/product_release/RELEASE_STATUS.md) to the existing full and partial Focus specs and merged #1897. Keep the legs separate.
2. Bind the fixture, exact release, Private STT runtime, test owner, and privacy choice before Start. Keep tests that simulate these boundaries distinct from live proof.
3. For the full fixture, verify the live points and final expected statuses, coverage and measured timing on the exact saved take. Reopen that take and compare with browser-independent saved state.
4. For the partial fixture, verify covered, partial and missing points against the fixture, count partial as detected, and repeat the same set once. Compare and re-open the two distinct saves, without cross-product or cross-take leakage.
5. Prove the checks reject substituted take or point results, missing speech/detection and ungrounded or mismatched coaching. For coaching use the saved Focus result and record usefulness review separately. Report unavailable/untested honestly.
6. Batch fixes and request exact-head review once ready. Prepare per-leg release, consent, provider bounds and disposable account cleanup evidence. A live run is separate from this PR and happens only under its own authorized packet. Record unresolved bits, not a blanket PASS.

**Deviation rule:** Comment here with the changed step, reason, evidence and revised action. Escalate a verified out-of-scope issue to Sam and the PO for one separate PR for that issue only. Don't reopen unrelated findings or rerun green engineering just to refresh review evidence.

Draft starting point: acceptance contract only. No production run, deploy, or merge.
