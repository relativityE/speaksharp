# PM independent timestamp reconciliation review

Exact helper e1680001513fa6e35e47f81ad225acbe19e7617e (collect blob4e4c200a7bf77e6291e00d39c955f74c24387e5d).

Browser PM independently ran the unchanged reference70 and successor38 tests:108/108 PASS, exit0. Actual evaluator/finalizer and its source dependencies were fetched at this exact commit. The local runner used the repository's module metadata and an existing TypeScript loader; no source implementation was changed.

The separate mocked-only repro independently confirms Sam's remaining timestamp finding1792325347.393409: old run summary before validFrom + null attempt run_started_at results in campaignWindowRuns=[] and priorRunsOnRelease=[]; actual campaignStartPreflight plus unchanged assess incorrectly return eligible:true/explicit_bootstrap. PASS in this repro asserts the unsafe old behavior; it is not campaign acceptance.

Run from this checkout:

```sh
chmod +x local-packets/1593-pm-timestamp-review/mock/gh
node local-packets/1593-pm-timestamp-review/repro.mjs
```

The GH executable is a closed local stub. It returns one old run summary and one null-time attempt, throws for every other route, and never calls GitHub or Production. No live receipt, cleanup or authority is created. All source dispatch paths remain unexecuted.

Review conclusion: earlier schema/artifact/reflex/bridge corrections are present and existing108 tests pass, but e1680001 remains operational HOLD on this one reproduced reconciliation boundary. App owns the bounded correction and exact regression: unreadable attempt time must become an explicit reconciliation error/HOLD, in both collection paths; an old summary cannot skip inspection of an unknown attempt. Keep previous finalizer errors/readback/dominant-stop controls. One corrected successor, then independent review; no competing product PR.

#1655 has merged as968e67a45604cab23cb2aa5b82035471182c3ee1 per GitHub. Served/canary identity and final campaign config remain separate receipts; no new PM Production read, dispatch, merge, migration, provider/account operation or cleanup was performed. Existing15-case/9-spec packetc168dd4b remains prepared; only genuinely missing final binding/qualification/PO authority fields are pending.
