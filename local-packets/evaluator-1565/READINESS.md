# Correction notice — 19 October 2026

The historical preparation below is retained for provenance. Use [the correction addendum](../evaluator-1565-corrections/CORRECTIONS.md) for row states, rating anchors, statistical definitions and diagnostic provenance. Run `local-packets/evaluator-1565-corrections/audit_corpus.py` for the source-aware audit; the original script below used a hardcoded sourceHead. See [full PM queue accounting](../evaluator-1565-corrections/QUEUE.md). Numeric proposals remain unapproved and full model qualification remains HOLD.

# #1565 corpus, blind review and calibration reconciliation

Browser PM, 19 October 2026. This is an executed inventory and preparation delta to the already accepted plan, not another evaluator plan, new release gate, model run or implementation assignment. CLI Dev remains the sole evaluator implementation owner. No weights, corpus archives or dependencies were acquired.

Authority: [accepted plan](https://github.com/relativityE/speaksharp/issues/1565#issuecomment-6233865706), [acceptance](https://github.com/relativityE/speaksharp/issues/1565#issuecomment-6234300811), [receiving contract](https://github.com/relativityE/speaksharp/issues/1565#issuecomment-6249149563), and Sam's later released preparation queue in Slack. The historical post-MVP ordering was subsequently changed for preparation/integration; model promotion, paid execution and live product authority were not granted by that change. v2 may finish MVP.

## Delivered, verified and still missing

The read-only `audit_corpus.py` executes against the retained files and writes `corpus-readiness.json`; it preserves IDs, audio/reference digests and proposed folds without copying transcripts into this report. The source corpus/manifests and retained policy are unchanged between main ecce3e8d and the #1663 head used for local audit.

| Retained material | Executed observation | Appropriate use / missing proof |
|---|---|---|
| `tests/fixtures/corpus-manifest.json` | 600 unique nonempty-reference rows:300 test-clean +300 test-other;73 speaker IDs;159 speaker/chapter proxies;74,756,427 declared selected FLAC bytes. Manifest SHA256 `706b61053c3c4aa9976099d8eb490f64e6d8b0e2ff86529f59b9982abd59453b`. | Existing selection is frozen, not a new acquisition. Manifest declares CC BY4.0 and attribution. The600 actual FLAC files/archive chain were NOT verified here; archives are deliberately out of git. The chapter proxy is not a verified recording-session identity. |
| Three controlled synthetic smoke WAVs | All3 audio and reference hashes match;16kHz/mono/PCM16; durations5.166938,4.110375 and2.8125 seconds (exact frames in JSON). | Tiny single-voice controls, not accent diversity, natural contextual fillers or human usefulness. Origin is declared macOS Samantha TTS; this audit does not establish a new redistribution/consent right. |
| Three synthetic RWT WAVs | All3 audio hashes and PCM format verified. | Full/partial Focus and Open Mic flow material can seed known-content controls. Manifest explicitly reports TTS “uh” limitation (0/3 in its historical local v2 baseline); not natural filler acceptance or a fresh v2 measurement. |
| Derived long-01 WAV/reference | Both checksums verified;16kHz/mono/PCM16;37.865063 seconds. PROVENANCE declares six concatenated LibriSpeech utterances. | Useful opening/tail/repetition regression fixture, not a ten-minute take, natural continuous recording, broad speaker coverage or actual device resource proof. |

Seven local WAVs were verified, with zero local verification errors. This does not mean600 corpus files passed verification. Synthetic setup controls and manifest integrity are separate from any real-model comparison.

## Deterministic review folds, proposed before new measurements

`corpus-readiness.json` binds the full600-row source manifest and its selection digest, with all73 deterministic speaker assignments. The script derives each row's proposed fold from those assignments and computes the assignment digest; it does not duplicate the existing600 reference strings or the source manifest. No source corpus entries or their selection were changed.

Rule: SHA256(`speaksharp-1565-speaker-review-v1` + `:` + public speaker ID), integer modulo5; bucket0 held-out, buckets1–4 development. Executed result:

| Proposed fold | Clips | Speakers | test-clean / test-other |
|---|---:|---:|---:|
| Development |485|58|239 /246|
| Held-out |115|15|61 /54|
| Overlap |0 shared speaker IDs|0|No cross-fold clip IDs|

Assignment digest `f7f1c856867cbd98981ba9e9032c3c9d8e94b1ba6870fdef2e63ec335f0114f3`; retained full selection digest `755487e8de185857e956bbf8d63c8af051ecae55086076a1cd47a2ae96497eba`.

This proposal is not accepted policy and does not certify a previously untouched hold-out: prior evaluator-tuning exposure must be checked, and public-corpus model-training contamination is unknown. The existing policy requires all600 rows; a115-row result cannot satisfy it. Keep all600 qualification rows and any exploratory fold outputs separately labelled. If the PO selects a held-out qualification protocol, version the policy and its sample-adequacy decision before measurement; never quietly change600 to115. Speaker grouping prevents the obvious development/test overlap but is not a power calculation.

## Required-slice and annotation ledger

`test-other` is a publisher partition, not proof of a measured noise level or named accent. No inferred accent labels or demographic attributes are generated.

| Required dimension | Retained evidence | Remaining admission evidence |
|---|---|---|
| Clear speech | test-clean membership;600 human reference strings overall | Per-clip audio byte verification and annotation of actual relevant conditions |
| Noisy/accented speech | test-other membership only | Audited noise/accent coverage and consented human labels; do not relabel a partition as both slices |
| Contextual fillers | Three-word smoke category and TTS flow scripts | Human-annotated filler spans, lexical distractors (ordinary “like”, “well”), omission/insertion truth; no regex-only substitute |
| Pauses | Waveforms and trailing silence on RWT flows | Pause interval references; distinguish intentional trailing silence from a standalone hallucination test |
| Silence/hallucination | Not a blank-reference corpus row; all600 references are nonempty | Explicit silence clips, expected-empty scoring contract and retained hallucinated-token count/rate; ordinary WER has a zero denominator here |
| Long takes/repetition/opening/tail |37.865s derived long-01 and short flow fixtures | Natural long-take coverage, boundaries and repeated-take lifecycle controls; no600s capacity claim |
| Focus semantics | Synthetic full/partial/absent point fixtures | Natural recordings, independently adjudicated point coverage and same-target intent preservation |
| Product usefulness | No new human/device verdict | Complete useful Open Mic AND Focus, persisted/reopened review and real-device observations under separate authority |

No complete expanded licensed/consented natural corpus is frozen by this packet. The concrete missing proof is now enumerated instead of presenting the three-clip smoke as sufficient.

## Blind review worksheet to use with admitted material

Before exposing model outputs, lock clip/reference/context annotations and expected failure/absence states. A custodian creates opaque arm labels and keeps the arm-to-model key private; assessors see paired outputs in counterbalanced order with model/runtime names and timing hidden. Record assessor ID, rubric version, clip hash, decision and reason; do not publish private recordings/transcripts or the unblinding key. Lock both independent ratings before adjudication and unblind only afterward.

For model-output review, score each dimension0–3:0=wrong/missing or invented meaning;1=major repair needed;2=minor repair;3=faithful usable result. Apply separately to lexical/critical facts, opening/tail retention, contextual filler treatment, and Focus-point meaning. Flag invented content and wrong-target content independently; a mean score cannot erase them. Missing annotations or failed/empty/timed-out output remains a visible unscored failure/HOLD row, never an omitted row. Preserve disagreements and adjudication.

For complete product usefulness, add separate same-target relevance, concrete next action and practical usefulness ratings against the actual served review/coaching. Model-only transcription scores do not qualify that rubric. Full Focus and partial Focus require separate observations. These worksheet fields operationalize the accepted contract; they are not completed human observations or an accepted new numeric policy.

## Calibration and predeclaration delta

Reuse `tests/evidence/certification/selectionPolicy.ts`: policy_v1 requires600/600 with no failures, p95 RTF<1.0,95% confidence,2000 resamples and seed speaksharp-1304-policy-v1. These are retained code settings, not proof that every #1565 numeric requirement is approved. Its current pairedBootstrapInterval resamples individual utterances, so it is not speaker/session-cluster uncertainty even though results are paired. CLI must reconcile that boundary with the accepted plan; PM is not writing a second comparator.

Before real v2 BASE/v4 BASE measurements, prepare:

1. **Baseline versus baseline:** same immutable model/assets/runtime/backend, identical audio/reference bytes and counterbalanced cold/warm protocol. Repeat runs must expose real variance, not fabricate different IDs for identical cached output. Exact identical synthetic scores should yield a zero-centred tie; that only calibrates comparator math.
2. **Known degradation:** fixed opening/tail deletion, repeated output, critical Focus fact removal, contextual filler insertion/omission and hallucinated speech on silence. The relevant metric/slice must detect each fault; preserve all mutations and labels. Missing/duplicated rows, wrong asset identity, backend drift, latency regression, failed disposal and next-take contamination must remain in negative controls. Do not use a candidate's observed output to choose the mutation or margin.
3. **Uncertainty proposal:** retain95% intervals and declared deterministic seed; resample paired speaker clusters (session/chapter sensitivity separately), reporting pooled and required-slice intervals. Propose sample adequacy from a declared minimally relevant difference and baseline-only variance before opening candidate results. Fifteen proposed held-out speakers are not automatically sufficient. Never bootstrap repeated trials as independent speakers.
4. **Numeric proposal for PO review, NOT accepted gates:** candidate-minus-baseline upper95% WER delta at most+0.5 percentage points pooled and+1.0 point for each required annotated slice; no invented-content/critical-fact regression on the adjudicated hard-control set; max5% paired relative latency regression. Keep absolute WER, contextual filler FP/FN/count, Focus/usefulness, load/first-partial/Stop-to-review, memory and failure budgets explicitly UNSET until accepted for each device/backend. These example margins are premeasurement proposals, not sourced product promises; no policy is activated by this document. A relative tie cannot clear an unset absolute quality floor or both-poor baseline.

Use matched WASM cells first; actual supported-device WebGPU is separate. Adapter decode-plus-finalize time cannot be renamed Stop-to-visible-product-review latency. Preserve unknown bytes/memory as unknown. Source manifest pins and configured digests are not actual fetched-weight verification. Latest Research6bab65f source integration remains CLI-owned; the older53-test export is not substituted for it.

## Reproduce / handoff

```bash
python local-packets/evaluator-1565/audit_corpus.py --repo . --output /tmp/corpus-readiness.json
node scripts/host-interlock.mjs hold local -- pnpm exec vitest run \
  --config frontend/vitest.config.mjs --coverage.enabled=false --maxWorkers=1 \
  tests/evidence/__tests__/corpusManifest.test.ts \
  tests/evidence/certification/__tests__/corpusSet.test.ts \
  tests/evidence/certification/__tests__/selectionPolicy.test.ts \
  tests/evidence/__tests__/corpusLane.test.ts
```

Executed retained controls: **100/100 PASS**, four files, exit0,46.85s (corpusManifest33, corpusSet20, selectionPolicy34, corpusLane13). These exercise manifest integrity, negative corpus inputs, comparator synthetic baseline/tie/degradation rules and honest row/latency assembly; they are not model measurements or validation of the proposed new folds/rubric. The read-only inventory itself verifies seven local WAVs and references as stated above.

Audit source observations are on ecce3e8d; local execution used26e132d2, whose relevant corpus/policy files were verified unchanged. No real v2/v4 execution, baseline promotion, model activation or provider use occurred. Next concrete receiving action: CLI reconciles this coverage/calibration ledger with its single evaluator integration; Sam reviews fold/rubric suitability; PO decides numeric margins before any authorized comparison. Preparation can progress while real-data admission and operational permissions remain separate.
