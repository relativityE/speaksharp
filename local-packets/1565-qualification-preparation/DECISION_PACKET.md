# #1565 qualification preparation — one decision packet, version 1

Browser PM, 19 October 2026. **PREPARATION DELIVERED; numeric policy PROPOSED/UNAPPROVED; full model qualification HOLD.** This extends accepted corrections017c1974 rather than recommissioning the accepted plan. CLI remains the sole evaluator implementation owner. No new model inference/download, provider use, product dispatch, promotion or baseline replacement occurred.

## Decision requested

Sam/PO: accept or replace the **whole proposed v1 policy below** before a blinded candidate qualification is opened: supported device cells, required admission panels, relative and absolute limits, confidence/multiplicity/adequacy convention and hard failures. A field-level replacement must be frozen before measurement. This packet does not activate any gate or change the v2 MVP release queue. Every number below is an engineering proposal, not a measured capability, universal standard, or previously approved promise. Neither the 20%/10% diagnostic WER nor its measured latency was used to choose these limits.

Accepted inputs: [complete receiving contract](https://github.com/relativityE/speaksharp/issues/1565#issuecomment-6249149563), [prior corrections](../evaluator-1565-corrections/CORRECTIONS.md), preserved runner6846c01e and diagnostic e57cd8e6. Latest Research6bab65f is still a required exact portable-source handoff in CLI's latest verified receipt; the older source cannot be relabelled latest.

## Proposed quality and relative budgets

WER is the **speech lexical Track-A** ratio of pooled edit counts to frozen reference words, with um/uh removal explicitly labelled. Raw/contextual filler outcomes and expected silence are separately governed.

| Endpoint | Proposed relative limit, candidate minus baseline | Proposed absolute floor/ceiling for each arm | Rationale |
|---|---|---|---|
| Pooled lexical speech WER | Upper one-sided family-adjusted confidence bound <= +0.005 (0.5 percentage point) | Upper bound <=0.10 pooled | Prevent small overall degradation and reject an equally poor pair. This is a proposed usable-English floor, not a product accuracy guarantee. |
| Required lexical slices: clear, controlled noise, self-described accent coverage, long/opening/tail, natural Focus speech | Upper bound <=+0.01 per frozen slice | Upper WER bound <=0.08 clear; <=0.15 for each other named slice | Tougher clean floor; bounded tolerance for difficult speech. No publisher partition is itself a noise/accent label. |
| Contextual true-filler opportunities, frozen default tier; explicit user opt-ins separate | Recall lower delta bound >=-0.02; precision lower delta >=-0.01; count-MAE upper delta <=+0.2 fillers/min | Recall lower bound >=0.90; precision lower bound >=0.95; count-MAE upper bound <=0.5/min | Dropping all fillers cannot look good through lexical WER. Preserve lexical negatives and no-filler controls. Regex candidates alone do not supply these labels. |
| Focus proposition coverage against frozen full/partial targets | Recall/precision lower delta bounds >=-0.02 | Both lower bounds >=0.95; no invented/inverted required fact | Lexical accuracy must preserve the intended point; partial Focus must remain honestly partial. |
| Blinded useful same-target review | Usable-rating proportion lower delta >=-0.05 | At least90% usable (score2/3) with lower confidence bound >=0.90; no score0 or critical flag | Model transcript score cannot qualify coaching/product usefulness. Full and partial Focus are separate panels. |
| Expected silence, pure hallucination controls | No new hallucinated content relative to baseline | Zero nonempty decoded speech across the frozen silence panel; tokens/min and raw counts retained | Finite-panel hard control, not a population zero-risk claim. Ambient non-speech must not become a flattering WER0. |
| Critical meaning/identity/privacy/loop failures | No new or shared unresolved critical failure | Zero adjudicated invented facts/wrong-target/polarity-or-number inversion that changes required meaning; no silent provider/engine fallback, output loop, lost required opening/tail or second-take contamination | An average cannot conceal a critical failure. Failure in either arm prevents declaring that arm qualified. |

Precision with no predicted positives and recall with no reference positives are **not** set to1. Source-established no-opportunity rows contribute their false-positive/count information to the appropriate negative panel; a required positive panel without opportunities is HOLD. A hypothetical new contextual classifier is not commissioned: CLI must retain the shipped detector result and independently compare it to frozen annotations.

## Proposed device and absolute performance budgets

Four proposed required cells for the declared cross-platform claim: (D1) Apple M1/8GB macOS + actual stable Chrome, WASM; (D2) Intel i5/8GB Windows + actual stable Chrome, WASM; (M1) actual midrange Android/6GB + Chrome, WASM; (M2) iPhone12 + Safari, WASM. These are **requested test classes, not observed available hardware**. Operators freeze exact model/CPU/RAM/OS/browser build/power/thermal state before measurement. Unavailable or unsupported required cells HOLD that support claim; narrowing supported scope needs explicit decision.

WebGPU is a separate optional promotion claim on a real supported Mac/Chrome and Android/Chrome adapter, with actual vendor/backend/precision verified. Headless GPU emulation, a successful adapter probe or WASM cannot qualify that claim. Candidate precision/assets must be pinned separately if a backend changes them.

| Observable endpoint | Desktop proposed absolute p95 | Mobile proposed absolute p95 | Relative condition and measurement |
|---|---:|---:|---|
| Cold intent-to-ready, fixed25Mbps/50ms RTT, no model cache |90s|120s|Candidate <=+5% paired relative regression; distinguish transfer, verification and initialization phases. |
| Verified-cache intent-to-ready |10s|20s|Upper paired relative regression <=5%; do not rename browser-launch/hash time pure model initialization. |
| Warm Start-to-first real captured frame |1s|2s|<=5% regression; no false recording UI before real frames. Slow-start/retry correctness still required. |
| First useful partial after actual speech onset |3s|5s|<=5%; no partial or timestamp observability is HOLD, not0. |
| Stop-to-visible finalized transcript, <=60s take |8s|15s|<=5%; adapter decode/finalize is a different endpoint. |
| Stop-to-visible useful Practice Loop |15s|25s|<=5%; external coaching scope/permission remains separate from model-only runs. |
| Long-take real-time factor |p95<1.0|p95<1.0|<=5%; retain per-length results through the approved10-minute cap. |
| Peak whole inference worker/process increment above idle browser |1024MiB|512MiB|<=10% regression; record measurement scope; unknown JS-only/GPU memory is not complete process memory. |
| Cold model+tokenizer+runtime transfer |<=150MiB|<=150MiB|<=25% growth against baseline; hash actual bodies and distinguish logical asset bytes from network/compression/cache transfer. |
| Disposal/next-take |Old engine/mic actually released before one new producer; no stale completion/ownership crossover|Same|Zero unresolved disposal failures, crashes, timeouts or lost recording outcomes in the required finite panel. No probabilistic zero-failure claim. |

These limits are proposed responsiveness/resource tradeoffs for constrained browser use. Cold transfer is measured only under the declared network profile; uncontrolled Internet timings are descriptive. The retained product source already distinguishes first-use setup, the ten-minute cap and truthful slow-start recovery; it does not establish these new numeric budgets. If the baseline fails an absolute limit, hold selection and return the failing cell/metric instead of relaxing a limit after observing v4.

## Statistical rules to freeze

1. Freeze expected **clip x arm x trial x device x cache-state** identities independently of observed output. Successful empty speech is full deletion against nonempty reference and an explicit missing-speech failure; crash/timeout/acquisition failure is a typed reliability FAIL. Missing data/identity/annotation is HOLD where appropriate, never a smaller passing denominator. No failed row becomes successful empty silence.
2. Use3 declared warm paired trials. Within each clip/arm, average S/D/I counts over these3 trials, then pool those mean errors and reference words once. No mean of clip WERs and no independent-speaker credit for repeated trials. Report counts/point estimates before rounded display.
3. Resample **whole speaker blocks**, both arms and all trials together, with matched multiplicities. Use actual recording-session grouping for sensitivity where known; chapter IDs are only proxies. Silence uses its independent source/environment-session blocks. Pool speaker-level trials before sampling. Never sample decoder trials as speakers.
4. Pre-register the complete finite list K of inferential gate endpoints/cells after final slice/device admission, before candidate unblinding. Proposal: family alpha0.05, Bonferroni alpha_cell=0.05/K for one-sided bounds. B=max(20,000,ceil(100/alpha_cell)) seeded resamples, seed speaksharp-1565-qualification-v1. This supplies at least100 expected tail draws; it is Monte Carlo resolution, not sample adequacy. Descriptive two-sided95% intervals use2.5/97.5 percentiles and are explicitly not the one-sided decision bound. The retained legacy2000/utterance-bootstrap settings are not silently called equivalent.
5. Compute paired delta/ratio anew in each block sample. For a relative latency limit, bootstrap candidate/baseline-1 on matched observed endpoints with positive baseline time; absent/zero/invalid timing is HOLD, not epsilon division. Quantiles and counts are predeclared in CLI's implementation/readme and verified with fixed controls.
6. Minimum2 independent applicable blocks permits computing an exploratory interval, not qualification. With fewer, no CI. Before candidate opening, perform a **baseline-only** paired-repeat precision/power simulation for each panel, with the declared margins and target>=80% noninferiority acceptance under a true tie. Report cluster counts, interval width, effective strata and sensitivity. If the available sample is inadequate, freeze a larger admitted panel before opening candidate outputs, or HOLD; do not claim73 speakers or a minimum count alone is statistical power.
7. An observed valid outside-margin or critical/reliability failure is FAIL even if some other evidence is missing. A complete, within-limit point estimate with an interval crossing the boundary is HOLD. Missing unsupported measurements are HOLD, not imputed passes. Every mandatory arm/device/slice gate must pass; no pooled improvement overrides a failing slice.
8. Baseline-versus-baseline calibration and deterministic known-degradation controls precede qualification. Detect omissions, tail deletion, invented repeat, filler removal/insertion, critical-number/polarity changes, wrong Focus target, silence hallucination, latency inflation, missing/duplicate/same-omission-both-arm rows, identity/backend drift, disposal failure and next-take contamination. CLI owns the single implementation; this packet adds specifications/worksheets only.

## Zero-reference-word bootstrap handling — explicit

Classify from **frozen source truth**, not model output:
- Expected-empty silence/non-speech: lexical WER N/A; retain token count, decoded-nonempty flag, duration and source-session identity in the separate hallucination panel.
- Real filler-only speech whose Track-A normalized reference becomes empty: also lexical WER N/A, **not silence**. It remains required contextual-filler and usefulness evidence. Never discard its output or set WER0.
- Lexical panel: include only frozen clips with positive Track-A reference-word count. Resample its speaker blocks; every included block must have at least one such reference. For every replicate compute pooled errors divided by the positive pooled reference count.
- Therefore ordinary lexical replicates cannot have a zero denominator under a correctly frozen panel. If any replicate nevertheless has N=0, retain a named invalid-replicate/invariant failure and HOLD the interval/qualification. **Do not discard, redraw, add epsilon, set0 or report a percentile over only surviving replicates.**
- A required slice containing only zero-reference rows has no lexical interval; its source-declared silence/filler metrics must still qualify. This is not permission to mark a required lexical slice satisfied without speech.
- Silence resampling divides insertions by observed positive silence minutes, not reference words. Zero/unknown duration invalidates that estimate; no silent-row removal. All-zero observed counts can be reported as a finite-panel result, but a degenerate bootstrap is not a population no-hallucination guarantee. Where independent Bernoulli units are defensible, report the one-sided exact zero-event bound1-(alpha_cell)^(1/n); never substitute repeated trials/segments for independent units.

JiWER4 documents an alternative empty-reference insertion convention; this proposal deliberately keeps SpeakSharp lexical WER N/A and governs hallucination separately. The convention is versioned, never selected after seeing outcomes.

## Exact full-evaluation execution plan and stop conditions

See [freeze/slice checklist](FREEZE_AND_SLICES.md) and [blind/calibration preparation](BLIND_CALIBRATION.md). The proposed panel is600 retained LibriSpeech rows +120 natural short tasks +30 controlled-noise counterparts +30 continuous long takes +60 silence/non-speech recordings =840 planned clip identities. Reserved IDs are not recordings and cannot enter results. No legacy600 requirement is replaced by a115-row fold. Synthetic setup controls stay separately labelled.

1. CLI receives latest Research source with exact base/tree/patch hash and integrates its single runner with actual main and accepted0e1be5a5 validator. Publish exact integrated source and reviewed shared-engine seam. No reopen/reimplementation of accepted fixes.
2. Custodian admits actual840 input/reference/annotation records and verifies raw and canonical16kHz/mono/PCM boundaries and digests. Freeze policy, device manifests, trial/order seed, slice memberships, expected grid and rights/private artifact paths. Prior-exposure audit determines whether a genuine held-out claim is possible; public reading-corpus contamination is unknown.
3. CLI executes fixture-only fault controls and24 development calibration specifications; two named assessors independently rate48 worksheet rows after binding real material/opaque arms. No human result is claimed by the blank worksheet.
4. On each required cell, execute baseline-only repeat/adequacy calibration before candidate opening. Use the same frozen baseline bytes/runtime/backend/precision and declare any need for expansion before unblinding.
5. Warm model-only evaluation:3 complete paired trials per840 clips, both arms =5040 decodes per required cell (20,160 over4 cells), serially. Counterbalance arm order by (frozen clip index+trial) mod2, so even/odd clips reverse which arm goes first. Dispose one arm before opening the other. No concurrent inference/shared-host benchmarking.
6. Cold/warm setup measurements:20 fresh paired boot sessions per cell, ten AB and ten BA; cache state and actual response/worker bodies observed. Separate immutable cache reuse from truly cold transfer. These boot runs are not additional independent speech speakers.
7. Independently retain raw results/failures, actual input/asset/runtime/backend identity, acquisition completeness, timings, memory scope, cancellation/disposal and next-take controls. CLI's single comparator applies the accepted policy; no automatic baseline promotion.
8. Under separately scoped product authority, App executes useful Open Mic, full Focus, partial Focus, persistence/reopen and repeat/cancel/retry on a single verified served release. Six human/device worksheets require actual named observations. Corpus scores never close these rows.
9. Independent source/evidence review then Sam's model/device/product verdict. Model promotion, runtime integration/deployment, and primary/fallback activation remain separate PO decisions.

**Command truth:** the preserved6846c01e source implements pnpm model:evaluate with --baseline/--candidate/--corpus/--device/[--policy]/--out; this is not asserted to be available on main or sufficient for the corrected full protocol. Its current model-only acceptance intentionally HOLDs missing product evidence. CLI must publish the exact runnable invocation and compatible versioned manifests from its reviewed integrated head. The schema below is a proposal, not something to pass into an incompatible historical policy parser. No fictional full-evaluation command or unavailable file is presented as executable.

Resource proposal: reuse verified caches, one writer/inference slot, maximum2GiB additional staging, no copied worktrees/model snapshots, no public private-audio/transcript artifacts. Verify capacity before acquisition. If the actual bytes exceed the preflight budget, return the measured requirement before changing scope.

## What genuinely needs permission, versus missing work/evidence

| Item | Current action/status |
|---|---|
| Source reading, reference metadata, worksheets, policy proposal, offline deterministic detector/normalizer controls | Authorized and progressed here; no further permission requested. |
| Full integrated runner/latest Research export, real input bytes/annotations, baseline adequacy, available named devices/raters | Implementation/data/hardware/evidence dependencies. These are not Bash, GitHub or user-credential permission requests. |
| Numeric margins/absolute budgets/devices/statistical policy | Sam/PO acceptance decision before qualification; no fabricated approval. |
| New model/corpus acquisition and full resource-consuming run beyond prior tiny diagnostic | Need one bounded execution/resource scope if not already granted by the owning workflow. This instruction prepares the plan; it does not infer new download/inference authority from HOLD. Do not ask separate permissions for harmless reference inspection. |
| Private natural speech | Consent/licence and restricted artifact access before collection/use; do not solicit speech publicly or put it in GitHub. Availability of public LibriSpeech is not natural-user consent. |
| Live RWT/accounts/provider effects | App's exact release/config/account/budget/window approval; prior expired/different-release authority is not reused. Use approved credential injection, never request secret values. |
| Merge/migration/deploy/model activation | Explicit separate authority at the relevant future step; none requested or exercised by preparation. |
| Slack/local approval review | Earlier actions were explicitly unexecuted. This turn's diagnostic Slack send and readback and local preparation commands succeeded. That does not retroactively deliver old posts or guarantee future approval. |

## Supporting sources and execution receipts

- LibriSpeech's publisher describes16kHz read English speech and CC BY4.0: https://www.openslr.org/12/ (checked19 Oct2026). This does not supply natural filler/accent/noise annotations.
- Empty-reference conventions: https://github.com/jitsi/jiwer (checked19 Oct2026); no dependency change is requested.
- Speech dependence/block resampling: Liu et al., Modeling Dependent Structure for Utterances in ASR Evaluation, Interspeech2023: https://www.isca-archive.org/interspeech_2023/liu23_interspeech.html . The proposed exact procedure still needs CLI controls/acceptance; literature is rationale, not measured qualification.
- Exact one-sided binomial bounds: https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/exacbino.htm .
- [Preparation validation](preparation-validation.json), [actual existing detector controls](filler-diagnostic-controls.json), [generator](generate_preparation.py), [control runner](diagnose_filler_counts.ts).

