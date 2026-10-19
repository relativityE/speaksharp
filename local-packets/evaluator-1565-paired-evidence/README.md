# #1565 paired evidence prerequisite

Initial base: main `ecce3e8d9e154ddb12f7238a514f0ec85d4b75b4`.
Corrected successor incorporates main `ba1a9f5ad31778460a4ea9e383a08be14b3222f6`.
Bounded response to Sam's preparation review of PM `d553f130`:
https://app.slack.com/archives/C0C9RE8KNHG/p1792373234268369

`tests/evidence/certification/pairedEvidence.ts` validates against the predeclared
manifest × repeated-trial population before statistical analysis. Both arms must
contain exactly those unique `(utteranceId, trialId)` rows. Duplicate, missing, extra
or substituted samples reject; even the same missing row in both arms rejects.
Reference SHA-256, reference word count and cluster identity must match the manifest,
not merely agree between arms. Repeated trials for one clip must retain the same
reference and cluster identity. Compound keys cannot alias through delimiter text.

All three containers must be arrays at runtime. Sets, generators and malformed
array-like containers are rejected before length checks or indexing; TypeScript
annotations alone cannot establish the runtime boundary. The empty-Set bypass and
three container-rejection controls were executed RED on `24a7bc2d` before the fix.

Caller prerequisite: independently construct `expected` from the frozen corpus ×
declared trials, never from observed output. The validator checks equality to this
population; it cannot detect an omission already present in that population. Runner
integration must include a control that omits the same observed clip from both arms
while keeping the independently frozen expected population complete. The existing
primitive-level shared-omission control remains; runner-level enforcement is still open.

Complete input rows and manifest order are preserved. An expected-empty silence row
may have zero reference words. An execution-failure row remains in the returned full
population; the validator does not convert it to missing-evidence HOLD, invent scores,
drop it from a denominator or claim that the model succeeded. Reliability disposition,
silence scoring and actual verification of source/reference bytes remain separate.

This is a receiving-contract primitive, not a second evaluator or a completed runner
integration. The latest Research `6bab65f` source/API export was not delivered to this
worktree. The receiving runner must derive these identities from verified inputs and
call this validator before aggregation/statistics. No existing call site is falsely
claimed to use it. The legacy `pairedBootstrapInterval` is unchanged and must not be
used as the completeness validator: it currently intersects IDs and reads A's word
counts. Repeated-trial aggregation, paired-speaker resampling, sparse-cluster handling,
ratio-of-counts and confidence-bound policy remain explicitly unapproved/open.

## Executed evidence

```
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false --reporter=dot tests/evidence/certification/__tests__/pairedEvidence.test.ts tests/evidence/certification/__tests__/selectionPolicy.test.ts
```

52/52 PASS: 18 validator controls and 34 retained selection-policy controls.
Scoped ESLint and full default `pnpm quality` PASS (exit0), including frontend,
live and evidence typechecks. Diff check is clean.
No real-model evaluation, corpus download, provider use, policy/baseline activation
or human/device acceptance occurred. No new implementation PR is opened; #1658
remains the CLI implementation landing queue while this source preparation proceeds.
