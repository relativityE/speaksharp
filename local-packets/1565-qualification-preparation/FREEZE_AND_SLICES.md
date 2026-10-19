# Corpus freeze readiness and slice annotations

**Checklist and reference-metadata preparation complete; actual acoustic annotation/admission is NOT complete.** No unknown label is replaced by absent/clean. See generated reference-annotation-ledger.json for every one of the600 retained rows and supplemental-admission-reservations.json for240 proposed slots which are explicitly not recordings.

## Executed reference inventory

Manifest SHA256706b61053c3c4aa9976099d8eb490f64e6d8b0e2ff86529f59b9982abd59453b; source Git blob e0ed9307d0e482c06f1f36565e6033b21f7f788b. Generator records actual observed HEAD and verifies consumed bytes belong to it, then verifies HEAD stayed stable.

600 unique rows/73 speakers/159 chapter proxies; test-clean300/40speakers/5742 whitespace reference words; test-other300/33speakers/5014 words.107 lexical marker candidates, **zero literal um/uh reference tokens**. These are text-only counts, not the official normalized WER denominator or acoustic/contextual labels.600 reference SHA256 values and declared audio SHA256 values are individually linked in the ledger. The previously audited seven WAVs remain distinct from unverified600 FLAC bytes.

Retain the full selection digest755487e8de185857e956bbf8d63c8af051ecae55086076a1cd47a2ae96497eba and proposed speaker-fold assignment digestf7f1c856867cbd98981ba9e9032c3c9d8e94b1ba6870fdef2e63ec335f0114f3. Folds remain proposals:485development/115held-out, no shared speaker IDs. Do not turn115 into completion of the retained600 requirement. Prior use/tuning exposure must be audited; this public selection cannot be claimed untouched merely because a new fold was calculated.

## Freeze checklist

| Field | State / exact next evidence |
|---|---|
| Existing selection, unique IDs, per-row reference identity and declared audio digest | DONE reference metadata; source manifest unchanged. |
| Publisher rights | Publisher CC BY4.0 declaration checked; attribution retained. Per-supplement consent/licence remains pending. Synthetic TTS redistribution authority is not newly established. |
|600 actual raw files/archive chain/declared byte counts | NOT VERIFIED here. Use retained archive verifier and input hashes; no silent new selection or download. |
| Canonical PCM conversion and start/end | PENDING for full panel: freeze converter/version,16kHz mono, sample format/exact frames, raw-to-PCM hash mapping and boundary offsets. Both arms consume identical PCM. |
| Duplicate/source-speaker/session grouping | IDs verified; cross-source audio duplicates and true recording-session provenance require actual bytes/metadata. Chapter is a proxy only. |
| Required slice membership and acoustic labels | OPEN. Partitions are not measured noise/accent. Unknown=NULL, not false. |
| Ground truth/reference treatment | Exact UTF-8 hash retained; official Track-A normalization version must be bound separately; fillers/silence retain their own truth. |
| Rater and adjudication provenance |24control specs/48blank rows ready. No named/qualified raters or human judgments invented. |
| Dataset leakage/development exposure | PENDING actual prior-use review and custodian split. No candidate-driven annotation or selected-easy-case removal. |
| Expected arm/trial/device grid | Define from the fully admitted manifest and declared protocol, independent of either output. A reserved slot cannot be converted to a successful observed row. |
| Freeze seal | PENDING all foregoing admission fields and approved policy; record manifest/schema/tool/tree/annotation/license/split/device/policy digests, date and custodian signature before candidate outputs. |

## Required annotation contract

An admitted annotation carries clip/reference/raw/PCM digests; annotator and adjudicator IDs/time/rubric; recording-session identity; language and consented self-described accent (no guessed ethnicity/location); source conditions; channel/sample rate/frames; speech and pause intervals; contextual filler spans and intended tier/explicit opt-ins; lexical negative spans; Focus target/proposition set and expected full/partial membership; opening/tail required phrase alignment; expected silence/non-speech; relevant critical facts; confidence/disagreement and admission decision. Timestamp alignment requires listening/inspection of actual audio. Source text alone cannot complete it.

Each span stores start/end **sample indexes in canonical PCM**, optional seconds derived from rate, token/reference association, label, reason and agreement. Use separate speech_duration_seconds and total_clip_duration_seconds. Noise labels record actual noise-source licence/hash, mixing procedure and achieved SNR under a frozen measurement convention; test-other is never substituted. Long takes must be natural continuous recordings with true boundaries, not a repeated37.9-second fixture.

## Proposed supplement —240 reserved IDs, no media acquired

| Panel | Proposed acquisition/admission design | Primary missing truth |
|---|---|---|
|120 natural short tasks |30 consented speakers x4 clips: clear narrative; real filler + lexical distractors; full Focus; partial Focus. Preserve all attempted recordings and predefined inclusion rules. | Actual audio/references/spans/targets;30 speakers are a coverage target, not proven power. |
|30 controlled-noise counterparts |One fixed narrative per speaker, add one licensed noise source under a predeclared fixed condition; keep paired originals and achieved SNR. | Rights/hash/conversion/SNR; variants are not new independent speakers. |
|30 long |10 speakers x continuous120/300/600-second takes, with opening/tail and repeat-loop references. | New natural recordings/consent/boundaries; ten blocks may be statistically inadequate and must undergo baseline-only adequacy. |
|60 silence/non-speech |20 independent recording environments/sessions x10/30/60 seconds, include quiet and real ambient non-speech with no spoken background content. | Actual positive duration, acoustic verification and environment identity; three segments are one source block, not three independent environments. |

The840-clip plan is proposed and not frozen. If baseline-only precision is inadequate, select a larger licensed panel before opening candidate outputs or HOLD. No category has acoustic membership just because a reservation ID exists. Empty/reference-only placeholder media must never qualify.

## Diagnostic script annotation already prepared

fixture003 reference um positions1/7 and uh position4 (zero-based script tokens); so at0 is a discourse marker excluded from the default coachable total. diagnostic-reference-annotation.json links exact audio/reference hashes and leaves acoustic timestamps/assessor NULL. This is a script annotation, not proof the TTS waveform audibly contained three natural hesitations.

## Reproduce preparation

From the existing source checkout, no installs/downloads:
```sh
python local-packets/1565-qualification-preparation/generate_preparation.py
node --import tsx local-packets/1565-qualification-preparation/diagnose_filler_counts.ts
```
The generator reads reference metadata and produces worksheets only. It does not score candidates, implement bootstrap or run another evaluator.

