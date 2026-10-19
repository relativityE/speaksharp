# Existing evaluator: executed findings and receiving contract

Browser PM → Sam (central PM), @relativityE; CLI Dev. Source **6185f14cd05b2aa985aa539e8221282c2237e200** throughout. No shared-source correction made.

## Actual execution

| Evidence | Actual outcome | Meaning |
|---|---|---|
| Six existing Vitest files | **71/71 PASS**, exit0 | Existing comparator, adapter pin digest, CLI, paired-run, paired validator and legacy selection controls. Named assertions in `existing-test-results.json`. Not model inference. |
| Existing CLI scenarios | Four retained reports: one HOLD, three FAIL | Actual exit2/1 and intended causes; no synthetic winner. |
| Additional real CLI preflights | Four exit1 rejections, no report | Wrong WAV hash, PCM hash, device backend and manifest schema rejected before execution. |
| Real CLI lifecycle trace | exit2/HOLD | Both logical adapter instances initialized before all12 decode calls; AB/BA decode order does not isolate device residency. Decorator delegates execution to existing offline adapter. |
| Actual APIs/selected AST methods | **105 observation groups, zero probe errors**, exit0 | Includes deliberately demonstrated missing guards; not105 product PASSes. Full inputs/source digests/results in `probe-existing-seams.mjs` and `seam-results.json`. |
| PM receiving-wrapper verification | Four retained reports accepted; **16 negative mutations rejected**, exit0 | Missing report, wrong verdict, incomplete pairs or absent intended cause cannot pass on exit code alone. This fixes Sam's wrapper review; no accepted evaluator implementation changed. |

The first Vitest invocation incorrectly kept the parent process cwd while changing test root:68 passed, three subprocess cases could not read a report. `initial-test-invocation.json` retains that failed attempt. Running from the isolated source cwd produced71/71; no evaluator source changed. Initial probe-loader directory/JSON interoperability errors were corrected in PM's harness before the final105-group result; they are not product defects. The p95 probe uses the existing API's percentage argument95, not0.95.

## Guards that work at the accepted seam

`freezePairedRunPlan` / `evaluatePairedRun` reject duplicate or omitted trials, shared omissions, excluded failed rows, mutated references, wrong reference hash/cluster/trial binding. `compareModelArms` rejects wrong PCM digest or observed model/runtime/backend/asset identity, retains decode errors and refuses unavailable/nonfinite/negative final latency. An explicit annotated weak slice fails even when the pooled test margin is generous. Actual CLI rejects bad input bytes/schema/backend before adapter execution. Existing report device and asset-transfer evidence remains null when unavailable; costs/tokens are absent fields, represented as unknown in our receiving summary, never0.

## Verified counterexamples: do not promote these helper results

1. **Legacy `selectionPolicy.qualify` / `select`: invalid p95 can qualify and rank.** Starting from that module's existing perfect600-row fixture, change only `speed.realTimeFactorP95` to NaN, undefined or−1. `qualify` returns qualified=true; NaN also reaches `select().primary = "arm"`. Null correctly rejects. Exact reproduction: groups `legacy qualify p95 …` / `legacy select can rank NaN p95 input`. Minimal CLI discriminator: invalid/missing/nonfinite/negative p95 must produce no qualified arm/no primary; valid0.3 stays eligible. This is a verified unsafe legacy receiving API, **not** a claim that the accepted CLI emitted an overall winner: its separate acceptance remains HOLD and does not call this selector.
2. **Legacy `pairedBootstrapInterval`: zero reference denominator becomes zero delta.** One silence row, referenceWords0, errorsA1/errorsB0 produces observedDelta0, bounds[0,0], tied=true. The already-returned statistical contract requires unavailable lexical interval/HOLD plus separate hallucination evidence. Do not introduce an unreviewed estimator; reconcile the existing implementation with the accepted specification/Research delta. The helper also silently intersects rows; accepted paired-population validation must precede any use of it.
3. **Filler omission is invisible to Track-A lexical qualification.** Three synthetic independent clusters, two declared trials, reference `um hello uh world`, candidate `hello world`: actual model comparator PASS/zero WER under the strict synthetic test policy. Actual shipping final-string detector counts2 versus0. This reproduces the known missing contextual-filler metric, not a defect in the official lexical normalization or evidence that the audio contained fillers. Overall CLI remains HOLD.
4. **Missing required slices/run identity are outside this API.** A corpus containing only declared `all` can return comparator PASS; there is no frozen required-slice register argument. Arbitrary runId metadata on returned rows is ignored. A valid manifest/PCM pair is not authenticated workflow/run/attempt/release evidence. Supply a separate trusted receiving envelope before qualification, rather than pretending these unrecognized fields are validated.

## Statistical boundaries honestly retained

The existing identical-arm/all-zero-error and all-high-error paired controls return a tied zero-width difference interval. This is calibration only; it does not establish population success probability, power or a general uncertainty bound. No all-success/all-failure clustered usable-rate boundary implementation was found or claimed.

The current percentile helper reports nearest-rank empirical p95=19 for20 values1…20. It does not calculate a confidence-qualified population p95, independent boot adequacy, p95 ratio versus paired-ratio distribution, or a multiplicity register. Those were already explicit corrections in e98da8f8, not newly invented requirements. Proposed budgets and family size remain unapproved. No new estimator was written here.

Expected silence and filler-only references remain unscoreable in the legacy corpus scorer, and successful speech-empty outputs invalidate the arm rather than adding full deletion counts under the proposed expanded denominator. Those conservative outcomes prevent a false winner but do not implement the planned reliability/hallucination metrics. Retain failed rows and distinguish an empty successful decode from timeout/error.

## Report receiving limit

Current CLI has no standalone imported-report authentication/qualification API. `runId`, experiment/release envelope, arbitrary edited JSON verdicts, model-response byte proofs, costs/tokens and device-session provenance must not be trusted merely because a JSON object parses. PM's bounded wrapper now checks the four intended reports and rejects16 inconsistent/missing-cause mutations; it is **test evidence**, not a replacement production report validator. Keep normal CLI overall HOLD until the receiving contract is implemented and independently reviewed.

## Runtime clarification requested by Sam

`runtime-source-pins.json` hashes the accepted package/lock files and installed package metadata in **this** isolated PM dependency tree: package HF exact4.3.0, Xenova range^2.17.2; lock and installed metadata resolve HF4.3.0/Xenova2.17.2. Target manifests name those versions. No4.3.1 pin, compatible source qualification or inference was observed. CLI separately reported its shared local tree has HF4.2.0 and correctly refused the4.3.0 preflight. These are different workspaces; neither offline run proves a real model runtime. Do not relabel existing4.3.0 evidence as4.3.1 or place both arms on one runtime by assumption.
