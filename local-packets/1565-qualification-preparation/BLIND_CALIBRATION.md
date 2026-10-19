# Blind rubric and calibration preparation

Rubric v1 extends accepted017c1974 anchors; no new human results are claimed. calibration-control-register.json contains24 specified development controls; blind-rating-worksheet.csv has48 blank two-assessor rows. Their recording/reference bindings and opaque arm labels are intentionally unfilled until real material is admitted.

## Custody and blinding

A custodian who does not rate keeps the model/runtime/asset key and raw timing private. Freeze reference, context/target, slice applicability and severity before candidate output. Derive opaque pair/arm IDs with a private seed; counterbalance output order. Export only clip hash, approved source context, opaque output and applicable dimension to raters. Hide runtime/backend/model names, timing and hypotheses. Keep the key and private speech outside public GitHub. Hash both independent locked rating exports before adjudication; retain original disagreements and all rationale. Unblind only after ratings/adjudication lock. A public development-control specification is not a blind held-out model trial.

##0–3 anchored dimensions

| Dimension |3|2|1|0|
|---|---|---|---|---|
| Lexical/critical meaning |Required meaning and facts preserved|Localized noncritical repair|Substantial repair, target recoverable|Missing/inverted/invented essential meaning|
| Opening/tail/repetition |Required boundaries present, no invented repeat|Small nonessential boundary error|Important loss/repeated passage|Essential loss or dominated by invented repeat|
| Contextual filler treatment |Annotated opportunities/negatives treated correctly|Isolated low-impact omission/insertion|Repeated material miscount|Cannot support truthful filler advice|
| Focus/product usefulness |Correct target, supported concrete usable next action|Relevant with minor clarification|Generic/incomplete or substantial rewrite|Wrong target, invented support or no usable action|

Separate flags: invented spoken fact; polarity/number/named-fact inversion changing essential meaning; wrong target/person; unsupported coaching; privacy/engine attribution failure. No mean/majority erases a critical failure. N/A requires frozen source-established applicability; missing output, unknown labels, unreviewed material, failed execution or unknown identity is not N/A.

##24 development controls, two variants per group

| Group |Predeclared manipulation and expected sensitivity|
|---|---|
|Tie|Identical faithful outputs; equal ratings and zero delta expected, not proof of model quality.|
|Noncritical word|One locally repairable wording error; distinguish minor from meaning-changing.|
|Critical number|Change a frozen required number, e.g.9→10 in a specified meeting time; critical flag regardless of otherwise fluent text.|
|Critical polarity|Invert frozen required yes/no meaning; critical flag.|
|Opening/tail|Delete source-annotated required opening or ending; boundary dimension and criticality as frozen.|
|Invented repetition|Append a non-source repeated passage; detect loop rather than rewarding token presence.|
|True-filler omission|Remove annotated natural um/uh opportunities while lexical words remain; filler metric must worsen.|
|Lexical negative|Preserve ordinary lexical like/so usage; avoid turning a regex marker candidate into contextual truth or default coachable count.|
|Focus target|Swap to an explicitly different source target; wrong-target flag even if generally useful prose.|
|Unsupported coaching|Attribute a fact/action not supported by the take; independent critical flag.|
|Silence hallucination|Insert speech into an acoustically verified expected-empty recording; separate hallucination metric, no WER division.|
|Empty speech output|Successful empty decode on actual speech; full deletion and reliability/usefulness failure, never N/A or omitted row.|

These are control specifications, not completed stimulus bindings/ratings. The custodian selects development material only after audio/annotations are admitted. Do not generate synthetic audio and call it real hesitation/phone acceptance. Fixed transformations and expected sensitivities are locked before outputs; CLI owns implementation/test integration.

## Proposed calibration acceptance before held-out ratings

Two named assessors independently rate all24 development items on applicable dimensions, with a rationale and critical flags. Proposal: raw exact ordinal agreement>=85%, quadratic-weighted kappa>=0.70 on nondegenerate applicable ratings, all critical controls detected, every critical disagreement adjudicated. Report contingency tables, raw agreement, weighted agreement and cluster-bootstrap uncertainty; no kappa when categories have no variation. These are proposed calibration thresholds, not achieved statistics.

If calibration fails, clarify ambiguous anchors using development examples, version the rubric and rerate a fresh development set. Keep all initial ratings; never edit held-out ratings to improve agreement or drop a hard control. A small high point estimate is not precise agreement evidence. Use real clip/speaker blocks for uncertainty and explicitly report adequacy; do not call48 assessor rows48 independent speakers.

No model output is released for held-out rating until numeric policy and custodian split are locked. Actual useful Open Mic/full Focus/partial Focus needs its own served review and observer; model-only transcripts cannot supply that rating by implication.

## Calibration is separate from power

Identical baseline outputs test zero-delta logic and rating consistency. Known degraded outputs test sensitivity to specified faults. Neither estimates the probability that a real v4/v2 comparison will satisfy a noninferiority margin. A/A repeats estimate baseline/runtime repeatability only; they do not supply candidate-minus-baseline speaker variance or correlation. Preregister external/pilot assumptions or an explicitly assumption-only sensitivity grid, effect, margin, alpha family, weighting and dependent unit; report power NOT ESTABLISHED until that analysis is justified. Do not relabel an all-tie bootstrap's zero-width interval as precision evidence.

All-success ratings/control detections still need uncertainty. With independent Bernoulli items, use the exact one-sided lower bound alpha_cell^(1/n), not a bootstrap interval[1,1]. Multiple variants/ratings from one source remain clustered. If the independence/common-probability assumptions are not defensible, retain the finite-panel count and HOLD its population claim pending a suitable method. No new model run is needed to correct these declarations.

