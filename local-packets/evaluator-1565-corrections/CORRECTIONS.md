# #1565 acceptance worksheet corrections

Browser PM, 19 October 2026. Response to Sam's corpus disposition `1792373234.268369`, diagnostic disposition `1792374897.469239`, and explicit receipt request `1792384323.869579`. This addendum corrects preparation d553f130 and the interpretation of diagnostic e57cd8e6. Those immutable receipts remain historical evidence. CLI Dev remains the sole evaluator implementation owner.

## Row states and denominators

Freeze expected corpus IDs × declared trials independently of either arm's output. Preserve every scheduled row and its clip/reference/trial/speaker identity. Missing, duplicate, extra or malformed observed rows are integrity failures, not a smaller qualifying denominator. CLI owns the implementation and its malformed-container correction.

| Expected material / observation | Scoring and disposition |
|---|---|
| Speech, successful nonempty decode | Score against the frozen reference; retain errors and reference-word denominator. |
| Speech, successful empty decode | Complete deletion of the nonempty reference; retain its words in the denominator. A missing-speech reliability/usefulness failure cannot become unscored HOLD. |
| Decode timeout, thrown error, crash or failed acquisition | Retain typed execution failure and scheduled-row denominator; reliability FAIL. Never turn null transcript into successful empty silence, drop the row, or impute a zero-error decode. Any descriptive WER on remaining successful rows must be labelled incomplete and cannot qualify the arm. |
| Expected silence, successful empty decode | Correct empty output. Ordinary WER is N/A because its reference denominator is zero; record hallucinated-token count zero and silence duration. |
| Expected silence, successful nonempty decode | Record hallucinated tokens and tokens per silence minute; apply the predeclared silence/hallucination criterion. No zero-denominator WER calculation or silent omission. |
| Missing/unavailable annotation or required recording | Evidence gap/HOLD for that metric or slice; retain the row and report coverage. This does not downgrade an independently demonstrated execution or critical-content failure to HOLD. |

Retained Track-A WER removes `um`/`uh`. Keep that compatibility metric labelled as normalized lexical WER. It does not measure verbatim disfluency preservation. Add separately declared contextual filler spans, lexical negatives, omission/insertion/count evidence and raw transcript review before claiming filler fidelity. In e57cd8e6 both arms' total coachable-filler count was zero against reference three; the one-clip WER gain does not close that gap.

## Blind rubric and severity

Freeze references, intended target, required facts, annotated filler spans and applicable dimensions before viewing candidate output. Keep model/runtime identity and timings hidden behind opaque counterbalanced arm labels. Record two independent ratings, explanations and critical-error flags before adjudication/unblinding. Human observations have not been performed by this document.

| Dimension | 3 — usable | 2 — minor repair | 1 — major repair | 0 — unusable |
|---|---|---|---|---|
| Lexical meaning / critical facts | Meaning and required facts preserved | Local noncritical wording correction | Substantial repair needed, intended meaning recoverable | Missing, inverted or invented essential meaning |
| Opening / tail / repetition | Required boundaries retained, no invented repetition | Small noncritical boundary error | Important boundary loss or repeated passage | Essential opening/tail lost or output dominated by invented repetition |
| Contextual fillers | Annotated fillers and lexical distractors treated correctly | Isolated low-impact omission/insertion | Repeated miscount or lexical-word misclassification | Output cannot support truthful filler feedback |
| Focus / product usefulness | Correct target, supported feedback and concrete useful next action | Relevant but needs a small clarification | Generic, materially incomplete or requires substantial rewriting | Wrong target, invented evidence or no usable action |

Critical flags are separate from scores: invented assertion presented as spoken fact; wrong person/target; polarity, number or named-fact change that changes required meaning; unsupported coaching attributed to the recording; privacy/engine-attribution breach. Averages cannot erase a critical flag. Major errors require substantive repair without changing the essential target; minor errors are localized and do not alter essential meaning. Adjudicate disputed severity against the frozen context and preserve both original judgments.

N/A requires a reason established from the source material: e.g. no Focus task or no applicable annotated filler opportunity. A missing output, timeout, absent reference annotation, unreviewed clip or unknown model identity is not N/A. Natural filler evaluation still needs lexical-negative and zero-filler controls; do not exclude them merely because the positive count is zero.

Calibrate raters using development material with predeclared baseline/tie and fixed degraded controls. Retain assessor/rubric IDs, raw paired ratings, severity disagreements, adjudication, raw agreement and ordinal weighted agreement with uncertainty. Do not report a kappa as meaningful when categories have no variation. No calibrated-rater result or agreement threshold is claimed here; the acceptance threshold must be selected before held-out ratings are opened. Development calibration does not certify the proposed public fold was previously untouched.

## Statistical worksheet, for implementation and policy review

1. **Pooled lexical statistic:** for each clip and arm, average edit counts over the fixed declared number of trials; sum those mean error counts across clips and divide by the sum of their frozen reference-word counts. Compute candidate minus baseline on the same clips. Do not average clip WERs. Equal repeated trials do not create additional reference recordings or independent speakers. Preserve all raw rows and failure counts; this complete-score estimator is unavailable if required executions are missing/failed.
2. **Paired cluster uncertainty:** resample whole speaker IDs with replacement, bringing all clips and both arms' corresponding trial records with each sampled speaker. Use the same sampled cluster multiplicities for both arms and recompute the ratio of counts in every replicate. Average declared trials within clips, never resample trials as independent speakers. Retain 2,000 resamples and the declared deterministic seed as a proposal compatible with retained settings, not a newly approved policy. The chapter/session proxy is sensitivity analysis, not a verified independent recording session.
3. **Bounds:** a one-sided 95% upper bound is the 95th percentile of candidate-minus-baseline replicates. A descriptive two-sided 95% interval uses the 2.5th and 97.5th percentiles. These are different and must not share an ambiguous “upper95%” label. For a family of K predeclared selection comparisons, propose a familywise error convention (e.g. one-sided alpha=.05/K for Bonferroni) and disclose it before measurement; the individual 95% proposal is not automatically familywise95%.
4. **Sparse slices:** report clip, reference-word and unique-speaker counts per required slice. With fewer than two observed speaker clusters, do not manufacture a cluster interval. With inadequate predeclared precision/power or insufficient clusters, report a descriptive result and HOLD selection; do not merge slices after seeing candidate outcomes or treat degenerate zero-width intervals as proof. Sample adequacy must be frozen from baseline-only variance/meaningful-difference analysis before candidate qualification output is opened. This worksheet has not completed that calculation.
5. **Latency:** retain each observed duration and explicitly define any pooled ratio or tail statistic before selection. Compare matched device/backend and declared cache state. Do not equate median model decode latency with p95 real-time factor, first useful partial, Stop-to-visible-review or whole-product responsiveness. Shared-host smoke timings and null acquisition bytes cannot satisfy device/cold-load budgets.

CLI must implement and review these estimator/completeness boundaries in the existing evaluator; this addendum is a specification correction, not a second comparator or an implemented statistics claim.

## Diagnostic provenance correction

| Field in e57cd8e6 | What the evidence actually establishes |
|---|---|
| v2 input SHA256 | Worker-side input evidence |
| v4 input SHA256 | Page-side hash immediately before transcribe; not a worker-consumption hash |
| v4 assetDigest | Digest of configured committed pins; separate cache-byte hashes support byte identity |
| Runtime version | Installed package metadata; not an introspected worker version |
| Runtime model revisions | Null in both observed identities |
| Immutable HF revision | README assertion only; not independently bound by the raw verification/transport receipt |
| v4 acquisition | Partial, out-of-scope requests and unknown network bytes; cache transfer is not public-network cold-load evidence |
| Diagnostic gain | 16/80 versus8/80 normalized lexical errors; clear slice2/62 identical; entire gain is fixture-003, one synthetic speaker |

Do not retroactively invent missing worker receipts, revision attestations, natural annotations, human ratings or device results. Future execution should bind immutable download URL/revision and response digests contemporaneously. The historical packet stays bounded and accepted as diagnostic evidence only.

## What can proceed and what actually needs PO policy

| Item | Work now | Remaining decision/dependency |
|---|---|---|
| Corpus integrity | Audit retained manifests and local assets, validate observed source identity; preserve all600 rows | Actual600 audio-byte/archive verification and rights/annotation evidence remain absent; no new acquisition is authorized here |
| Required slices | Produce annotation/admission worksheet and coverage gaps without inferring accent/noise from test-other | Admitted natural material, annotations and reviewers |
| Statistics / validator | CLI fixes malformed containers and exact paired completeness; review the estimator contract above | Published integrated source and executed evidence; not blocked by margin approval |
| Blind review | Prepare anchored worksheet and development calibration ledger | Actual admitted material, independent ratings and calibrated agreement evidence |
| Device / product | Prepare separate supported-device cells and full Open Mic/full+partial Focus observation rows | Authorized served candidate, named humans/hardware and actual observations |
| Numeric selection policy | Present a versioned proposal with defined estimands, bounds and all unset budgets | PO accepts/amends/rejects the proposal before it is a selection gate |

The precise PO proposal is **not yet approved**: maximum one-sided upper normalized-WER delta +0.5 percentage points pooled and+1.0 point per required annotated slice; maximum5% paired relative latency regression under a defined latency estimator; critical-content hard-control rule; and a chosen confidence/multiplicity convention. Absolute WER/filler/usefulness, first-partial/load/Stop-to-review, memory/reliability and per-device budgets remain UNSET. PO must approve concrete values and scope in a versioned policy; do not ask for a vague “lift HOLD” approval or silently infer these values from the three-clip run.

Full qualification is held by several independent evidence gaps even if numeric margins are approved. No numeric decision is needed to finish this correction or CLI's validator repair. No new provider, model/corpus download, live execution, migration, merge, deployment or activation is performed or authorized by this addendum.
