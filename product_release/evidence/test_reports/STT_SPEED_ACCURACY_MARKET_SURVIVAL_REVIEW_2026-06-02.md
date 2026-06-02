# STT Speed, Accuracy, And Market Survival Review

**Date:** 2026-06-02  
**Last updated:** 2026-06-02T21:05:00Z  
**Owner:** STT test/release agent  
**Audience:** dev agent, product reviewer, test agent, launch decision maker  
**Status:** Current snapshot and approach request

## Executive Position

SpeakSharp's market survival depends on STT feeling normal or better than what
customers already expect:

```text
Fast visible feedback.
Accurate final transcript.
Credible punctuation/casing.
No embarrassing duplication, truncation, or late surprise text.
Analytics and score based on the transcript the user actually trusts.
```

For launch, the bar should be:

| Mode | Market role | Required standard |
| --- | --- | --- |
| Cloud | Best quality and full-speech path | Close first. It should be the STT we can brag about if credentialed proof passes. |
| Private | Privacy-preserving Pro value path | Must be at or near Native customer-expectation speed/quality, and must not degrade the Whisper/drop-in path. |
| Native | Zero-setup customer expectation baseline | Must work well enough in real Chrome mic to avoid embarrassing first impressions. |

The project is no longer blocked by "nothing works." It is blocked by whether
we can make at least one path feel excellent, and make the others honest about
their tradeoffs.

## Two-Step Operating Model

Optimization is now the process rule. Every STT path is handled in a straight
line:

| Step | Name | What must be true |
| --- | --- | --- |
| 1 | Setup | Account/tier, build mode, STT mode, model/provider/runtime, mic/input route, and instrumentation are correct. |
| 2 | Proof | Runtime, timing, accuracy, and journey metrics meet the product gate. |

If Step 1 fails, the run is `INVALID_SETUP` and must not be interpreted as an
STT quality result. If Step 2 fails, the run is `PROOF_FAIL` and must name
the first broken product phase/gate. Reports must use the exact gate names,
not vague labels such as "setup failed" or "execution failed." This
replaces layered preflight/proof language for release triage.

Setup gates:

| Gate | Meaning |
| --- | --- |
| `setup.build_env` | Build mode, app URL, secrets, test/live mode |
| `setup.auth_tier` | Sign-in and effective Free/Pro entitlement |
| `setup.stt_mode` | Intended STT mode selected and machine-readable |
| `setup.model_provider` | Model/provider ready or explicitly downloading |
| `setup.runtime_telemetry` | Runtime/provider/device/thread/fallback telemetry populated |
| `setup.mic_input` | Mic/audio route and constraints valid |
| `setup.artifact_schema` | Logs, timing fields, transcript states, artifact writers populated |

Proof phases and gates:

| Phase | Gate |
| --- | --- |
| runtime | `proof.runtime.provider_selected` |
| timing | `proof.timing.first_progress` |
| timing | `proof.timing.first_text` |
| timing | `proof.timing.finalization_wait` |
| accuracy | `proof.accuracy.final_completeness` |
| accuracy | `proof.accuracy.fillers` |
| accuracy | `proof.accuracy.readability` |
| journey | `proof.journey.stop_save_detail` |

Current application of the rule:

| STT | Step 1 Setup | Step 2 Proof | Current action |
| --- | --- | --- | --- |
| Cloud baseline | Passing with real credentials | Strong candidate; baseline safer than keyterms | Close Cloud baseline proof first |
| Cloud keyterms | Passing after request/session fix | accuracy phase, `proof.accuracy.fillers`: filler improves, h1_6 accuracy regresses | Dev must fix/narrow/disable keyterms |
| Private v2 browser | Passing auth, Pro, setup, provider ready, recording, and saveCandidate | timing + accuracy phases: first visible text gate saw only 2 words before Stop; authoritative final saved 60 words but only 37.93% accuracy | Debug browser-path accuracy/timing. The old 8/87 DOM read is superseded. |
| Private v4 browser | setup/runtime phase, `setup.model_provider`: v4 worker failed WebGPU adapter/backend acquisition and Start stayed disabled | Not scoreable | Fix CPU fallback or classify WebGPU adapter failure as setup invalid before STT claims |
| Native human mic | Passing real-human input route | accuracy + journey phases, `proof.accuracy.readability` and `proof.journey.stop_save_detail` | Fix formatting/stop-save, then rerun |

## Canonical Reviewer Path To Release

This file is the home for the reviewer path-to-release. It should be read with
the shared release matrix:

```text
product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.md
product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json
```

Current reviewer framing:

| Product path | Release posture | Why |
| --- | --- | --- |
| Cloud | Close first; candidate brag path | Best architecture for long/full speeches if credentialed app proof passes |
| Private | Local/privacy value path; caveated until v2/v4 browser proof and readability close | Current v2 browser proof is much improved, but v4 app proof and punctuation/readability gates remain open |
| Native | Quick-start/browser-dependent; backlog until current human Chrome mic proof | Fake/say/injected routes are not release proof for Web Speech |
| Score/Analytics | Confidence-gated | Transcript quality must affect how strongly scores and analysis are presented |

Release rule:

```text
At least one STT path must be strong enough to sell or brag about.
Every visible STT path must either meet its drop-in/customer baseline or be
caveated/de-emphasized.
Scores and analytics must not imply speaking weakness when transcript quality is
the limiting factor.
```

Current 24-hour direction:

| Priority | Action | Owner | Release decision unlocked |
| --- | --- | --- | --- |
| 1 | Fix/validate Cloud credentialed baseline and A/B invalid sessions | Dev if provider/request bug; test after fix | Whether Cloud can be the quality/full-speech launch anchor |
| 2 | Run Private v4 browser proof on the same Washington + guard-row matrix as v2 | Test/release; dev only if selector/instrumentation blocks | Whether Private can be promoted beyond caveated local path |
| 3 | Resolve Private readability/punctuation on long speech | Dev + test | Whether Private final transcript is visually usable enough for users |
| 4 | Run Native human Chrome mic proof | Test/release with user/human mic | Whether Native is visible quick-start or hidden/backlog |
| 5 | Gate Score/Analytics by transcript quality fields | Dev + product/reviewer | Whether analysis is safe to show when STT confidence is weak |

Current 48-hour direction:

| Track | Exit criterion |
| --- | --- |
| Cloud | Baseline and selected tuning variant produce non-empty transcripts, preserve tail, pass save/history/detail, and show good filler/readability metrics |
| Private | v2 and v4 browser app proof collected equally; final transcript at or above drop-in/customer baseline or product copy is explicitly caveated |
| Native | Human Chrome mic proof has live text, no duplicate-on-stop, save/history/detail pass, and acceptable punctuation/casing strategy |
| Score/Analytics | Transcript Quality is a first-class guardrail for score confidence and report interpretation |

## User Request Coverage Checklist

This report is intended to answer each requested point explicitly:

| Requested point | Where addressed |
| --- | --- |
| Write up findings and update test reports | See the updated Private, Native, and Cloud reports under `product_release/evidence/test_reports/` plus this summary packet |
| Provide a separate detailed report on accuracy and speed/timing | This document |
| Treat speed/accuracy as app-survival critical | Executive Position, Accuracy And Timing Approach, 24/48-hour roadmap |
| Frame Private STT value around optimal/parity performance versus Native STT | Native-As-Parity-Baseline Policy, Current Snapshot, Accuracy And Timing Approach |
| Use Native vendor/customer performance as Private parity target when Private vendor curves do not exist | Native-As-Parity-Baseline Policy and Vendor Baseline Status |
| Discuss SpeakSharp Score generation | SpeakSharp Score: How It Is Generated |
| Ask for feedback on Score improvements/blindspots | SpeakSharp Score review questions and Open Questions below 75% confidence |
| Share analytics-page tools grouped by objective | Analytics Page: Tools Grouped By Objective |
| Identify issues/questions below 75% confidence | Open Questions Below 75% Confidence |
| Snapshot current state | Current Snapshot and Evidence Snapshot |
| Tentative 24/48-hour roadmap for wider use | 24-Hour Roadmap and 48-Hour Roadmap |

## Native-As-Parity-Baseline Policy

The user's product standard is accepted:

```text
Private STT must feel at least as good as the Native STT experience customers
already expect from Chrome/browser speech recognition, unless Private is clearly
positioned as slower-but-private and proves better final accuracy.
```

Important nuance:

```text
I did not find stable vendor-published Chrome Web Speech WER/speed numbers for
our scripts and devices. Therefore, until a reliable published Native benchmark
is identified, the practical Native parity target is our own real Chrome
human-mic measurement: first text timing, final transcript quality,
punctuation/casing, stop/save/history/detail, and no duplication.
```

Private parity target:

| Native/customer expectation | Private must achieve |
| --- | --- |
| User sees activity quickly | Immediate local progress state; no idle blank panel during recording |
| User sees useful live text | Draft text may be provisional, but must be labeled and should not be wildly misleading for long |
| Final transcript is credible | Final selected Private transcript must meet or beat Native on the same speech, or the product must explain the privacy tradeoff |
| Formatting looks normal | Final text should have credible casing/punctuation; Native currently needs a formatter decision |
| Longer speech does not disappear | Private must prove `return_timestamps:true` browser long-form behavior before claiming page-length viability |

If an official browser/vendor Native benchmark is later found, it should replace
or augment our measured Native proxy. Until then, real Chrome human-mic evidence
is the fairest customer-expectation comparator.

## Current Snapshot

| STT | Current state | What moved in the right direction | Remaining blocker |
| --- | --- | --- | --- |
| Cloud | Closest to release/brag candidate | Baseline AssemblyAI path is the strongest architecture for long speeches because it streams/finalizes turns | Credentialed A/B, filler recall, tail preservation, and trace-complete app proof are still required |
| Private | Technically plausible but not release-green | Save/history/detail and runtime telemetry improved; Washington 65.8s Node fixture shows v4 ties v2 accuracy and is faster; latest workflow confirms saveCandidate instrumentation works | Current browser workflow v2 final accuracy is only 37.93% and first useful text is too sparse; v4 setup/runtime fails before transcription |
| Native | Useful comparator for customer expectation, not yet green | Duplicate-stop class has unit coverage; human run proved Chrome can produce strong transcript | Fresh human real-mic proof and punctuation/casing strategy still open |

## Evidence Snapshot

### Private Short Corpus

Previous dev-agent Node full-WAV result on Harvard h1_1-h1_10:

| Variant | Avg accuracy | Avg error | Avg decode/row | Corpus |
| --- | ---: | ---: | ---: | --- |
| v2 | 93.89% | 6.11% | 859 ms | Harvard h1_1-h1_10 |
| v4 | 96.39% | 3.61% | 401 ms | Harvard h1_1-h1_10 |

Interpretation:

```text
On byte-identical short WAV input, v4 is better and faster than v2. This is
engine/model evidence, not browser app-path proof.
```

### Private Medium/Long Fixture

New Washington 65.8s fixture:

| Engine | Package version | Accuracy | Error | Decode ms | RTF | Words emitted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| v2 | 2.17.2 | 98.95% | 1.05% | 10869 | 0.1652 | 190 |
| v3 | 3.8.1 | 93.19% | 6.81% | 5004 | 0.0760 | 181 |
| v4 | 4.2.0 | 98.95% | 1.05% | 6324 | 0.0961 | 192 |

Interpretation:

```text
On this 65.8s novel speech, v2 and v4 tie on accuracy. v4 is faster than v2.
v3 is faster than v2 but loses too much accuracy. v4 should be prioritized
over v3 for browser proof.
```

### Vendor Baseline Status

| Baseline | What exists | What is missing |
| --- | --- | --- |
| Whisper tiny.en | Hugging Face/OpenAI model card reports model-level public ASR dataset WER and RTFx | No vendor WER-by-duration table for Transformers.js v2/v3/v4 packages |
| Transformers.js v2/v3/v4 | npm/package versions and docs exist | No official short/medium/long accuracy table per package |
| Native Web Speech | Browser API exists as platform/service path | No stable Chrome vendor WER target for our exact scripts/devices |
| AssemblyAI Cloud | Streaming docs describe turn/final behavior and tunable end-of-turn | Our credentialed A/B and long-form trace proof still need to run |

Conclusion:

```text
We cannot satisfy "vendor published performance per v2/v3/v4 time span" literally
because the vendors do not publish that matrix. We must keep our own reproducible
time-span benchmark and compare it to published model/service behavior.
```

Primary references:

- Hugging Face `openai/whisper-tiny.en`: https://huggingface.co/openai/whisper-tiny.en
- Hugging Face Whisper docs: https://huggingface.co/docs/transformers/model_doc/whisper
- MDN Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
- AssemblyAI Universal Streaming: https://www.assemblyai.com/docs/streaming/universal-streaming
- AssemblyAI turn detection: https://www.assemblyai.com/docs/universal-streaming/turn-detection

## Accuracy And Timing Approach We Need Reviewed

### Objective 1: Prove We Do Not Degrade The Vendor/Drop-In Path

For Private:

```text
Same audio -> same model -> same decode options -> app final transcript should
not be worse than drop-in/Node ceiling.
```

Required matrix:

| Span | Fixture | Required comparison |
| --- | --- | --- |
| Short | Harvard h1_1-h1_10 | v2 vs v4 Node, app vs drop-in browser |
| Medium | `washington_01` 65.8s | v2/v3/v4 Node, then browser app path |
| Long | 90-120s distinct speech | v2/v4 browser with `return_timestamps:true` |
| Page | 2-4 min speech | Decide whether Private remains viable or Cloud becomes required |

For Native:

```text
Real Chrome human mic is the effective vendor/customer baseline. Fake-audio WER
is diagnostic only.
```

For Cloud:

```text
AssemblyAI baseline must pass first. Prompt/keyterms only ship if A/B proves
better filler recall without blank sessions or tail loss.
```

### Objective 2: Measure User-Perceived Timing, Not Just Model RTF

RTF is necessary but not enough. User-perceived timing needs:

| Timing field | Why it matters |
| --- | --- |
| firstProgressMs | Prevents blank-screen trust failure |
| firstDraftMs | Shows when text first appears |
| firstDraftText | Detects misleading early draft |
| finalAtMs | Measures convergence delay |
| stopFinalizationMs | Measures post-stop wait |
| decodeInputDurationMs | Explains decode workload |
| decodeMs | Raw model processing time |
| RTF | Normalized processing speed |

Current issue:

```text
Private can have excellent raw RTF and still feel broken if the user sees no
progress or bad draft text for 20-30 seconds.
```

### Objective 3: Make Transcript Trust State Explicit

Private UI must follow trust, not source:

| State | User sees |
| --- | --- |
| Recording/no text | Listening locally... or Processing speech locally... |
| Provisional text | Draft transcript |
| Stop/finalizing | Finalizing local transcript... |
| Final selected | Final transcript, no draft badge |
| Saved/history/detail | Final only |

This is not cosmetic. It prevents users from trusting unstable local draft text.

## SpeakSharp Score: How It Is Generated

Implementation source of truth:

```text
frontend/src/utils/speakingScore.ts
product_release/SPEAKSHARP_SESSION_SCORE.operational.md
```

Current formula:

```text
SpeakSharp Score =
  0.35 * MessageStructure
+ 0.30 * DeliveryControl
+ 0.20 * LanguageClarity
+ 0.15 * AudienceImpact
```

Current inputs:

| Input | Used for |
| --- | --- |
| Transcript | message structure, audience impact, word count, filler derivation |
| WPM | delivery control and pace actions |
| Clarity score | language clarity |
| Filler count | delivery control and clarity penalty |
| Elapsed seconds | confidence and WPM |
| Pause metrics | delivery control |
| Engine/transcription confidence | confidence state |

Current confidence thresholds:

| Threshold | Value |
| --- | ---: |
| Minimum words for directional score | 25 |
| Minimum words for usable score | 75 |
| Minimum seconds for usable score | 30 |

Important risk:

```text
STT errors directly corrupt the score. If the transcript drops words, misses
fillers, duplicates text, or arrives late, then WPM, filler rate, clarity,
message structure, and audience impact can all be wrong.
```

Review request for SpeakSharp Score:

| Question | Confidence |
| --- | ---: |
| Are current weights credible for a public-speaking coaching score? | 70% |
| Does keyword-based structure scoring over-reward signpost words? | 60% |
| Should transcript confidence lower the displayed score or only the label/confidence state? | 65% |
| Should Native/Private/Cloud scores be comparable if STT accuracy differs? | 55% |
| Should score be persisted at save time instead of recomputed in Analytics/PDF? | 80% yes, but implementation proof still needed |

Recommended guardrail:

```text
Do not present SpeakSharp Score as a precise speaking grade until transcript
quality and score calibration are proven on real sessions.
```

## Analytics Page: Tools Grouped By Objective

Current implementation groups analytics tools around objectives in
`frontend/src/components/AnalyticsDashboard.tsx`.

| Objective group | Purpose | Included signals |
| --- | --- | --- |
| Delivery Control | Is the speaker easy to follow in real time? | pace, fillers, clarity, practice time |
| Message Clarity | Does the point land? | clarity trend, pace trend, fillers, session length |
| Habit Progress | Is practice becoming a habit? | sessions, practice time, session length, filler rate |
| Session Proof | Can the user compare attempts and export evidence? | sessions, pace, clarity, fillers |
| Transcript Quality | Is a low score a speaking issue or capture issue? | STT comparison, clarity, pace, fillers |

Review request for Analytics:

| Question | Confidence |
| --- | ---: |
| Does the current Analytics page make it obvious when a score is limited by STT quality? | 65% |
| Are objective groups understandable to non-technical users? | 70% |
| Is "Transcript Quality" prominent enough given STT volatility? | 60% |
| Should analytics separate speaking-performance errors from transcription-capture errors more aggressively? | 80% yes |
| Do PDF and Analytics reuse the same saved score payload today? | Less than 75%; needs implementation audit/proof |

## 24-Hour Roadmap To Release Candidate

This is the fastest credible path, not the broadest perfect path.

| Hour band | Work | Owner | Exit criterion |
| --- | --- | --- | --- |
| 0-4 | Commit Washington fixture + reports; confirm no stale STT tasks in reports | Test/release agent | Reports reflect current state |
| 0-8 | Cloud credentialed baseline proof with one short, one filler, one 65-120s script | Test/release agent | Cloud transcript, tail, save/history/detail pass |
| 4-12 | Private browser proof on `washington_01` with `return_timestamps:true` | Test/release + dev if instrumentation missing | final complete, RTF captured, no truncation |
| 8-16 | Native human real-mic proof with punctuation/casing evaluation | Test/release agent | visible text, stop/save/history/detail, no duplicate |
| 12-20 | Decide STT product positioning | Product/reviewer | Cloud primary, Private privacy path, Native quick-start caveated |
| 20-24 | Fix only P0 proven bugs | Dev agent | No speculative STT rewrites |

Minimum 24-hour release candidate:

```text
Cloud passes as quality/full-speech path.
Native passes as caveated quick-start or is de-emphasized.
Private passes as privacy path for short/medium speech or is caveated until
long-form browser proof lands.
```

## 48-Hour Roadmap To Wider Use

| Window | Work | Exit criterion |
| --- | --- | --- |
| 24-30h | Run Private v4 browser app path on Harvard + Washington | v4 app path no worse than v2/drop-in on measured fixtures |
| 24-36h | Add or verify score persistence contract | Session, Analytics, PDF use one saved score payload |
| 30-40h | Run Cloud long-form A/B with filler recall | No blank variants; filler recall/tail preservation quantified |
| 36-44h | Final Native formatter decision | Either approved formatter path or explicit no-format caveat |
| 40-48h | Publish release classification | Each STT has label: green, caveated, hidden, or backlog |

48-hour wide-use bar:

```text
At least one STT path is strong enough to brag about.
No visible STT path creates an embarrassing first-run experience.
Analytics/score do not overclaim when transcript confidence is weak.
```

## Open Questions Below 75% Confidence

1. Can Private browser v4 reproduce the Node Washington speed/accuracy advantage?
   - Confidence: 60%
   - Why it matters: Node evidence does not prove browser worker/cache/UI timing.

2. Does `return_timestamps:true` in the production worker preserve long-form completeness without adding unacceptable latency?
   - Confidence: 70%
   - Why it matters: It fixed truncation in dev proof, but browser app proof is still required.

3. Should Native be held to long-speech parity or only quick-start viability?
   - Confidence: 65%
   - Recommendation: scope Native to quick-start unless human proof shows reliable long speech.

4. Should Private be expected to match Native live feedback speed?
   - Confidence: 70%
   - Recommendation: yes for perceived progress, no for exact live draft text if Private labels uncertainty honestly.

5. Is the current SpeakSharp Score weighting right for user trust?
   - Confidence: 70%
   - Recommendation: use it directionally, calibrate before strong claims.

6. Are analytics objective groups the right information architecture?
   - Confidence: 70%
   - Recommendation: good current structure, but "Transcript Quality" may need stronger visibility during STT instability.

## Recommended Ask To Reviewer

Please review this proposed standard:

```text
1. Cloud is the quality/full-speech launch anchor if credentialed proof passes.
2. Private must meet Native customer expectation for speed/progress and must not
   degrade its Whisper/drop-in final transcript.
3. Native is the zero-setup baseline and needs fresh real-mic proof plus formatting.
4. SpeakSharp Score should be confidence-gated by transcript quality and sample size.
5. Analytics should clearly separate speaking-performance issues from STT capture
   quality issues.
```

Specific feedback requested:

| Topic | Feedback needed |
| --- | --- |
| Private v4 | Is v4 the correct browser proof priority over v3? |
| Native baseline | Is real Chrome mic behavior the right practical customer-expectation baseline? |
| Cloud | Is Cloud acceptable as the primary full-speech path if Private remains caveated? |
| Score | Are the score weights and confidence states credible enough for soft release? |
| Analytics | Are the objective groups clear, or should "Transcript Quality" be a first-class top-level mode? |

## DEV → TEST AGENT (2026-06-02, append-only) — confirmation of your 5 code-review findings + handoff

I read the code at every location you cited. **All 5 findings confirmed.** No production STT code was
changed in my diff (you verified `git diff frontend/src` is empty) — these are confirmations, and 1–3
are new gated fixes I have NOT shipped (awaiting go-ahead, since they touch the live engine path).

| # | Finding | Confirmed at | Status |
| --- | --- | --- | --- |
| 1 | Private finalizing UI arrives after the `while(isProcessing)` wait | `PrivateWhisper.ts:1602-1605` (wait) precedes the status emit at `1613-1618` | CONFIRMED — fix not yet shipped |
| 2 | Cloud app stop timeout 2s ≪ A/B 30s+close | `sttConstants.ts:132` `SOCKET_CLOSE_TIMEOUT_MS:2_000`, used at `CloudAssemblyAI.ts:619` | CONFIRMED — fix not yet shipped |
| 3 | Native promotes interim after a 1s stop cap | `sttConstants.ts:143` `STOP_TIMEOUT_MS:1_000`; promote at `NativeBrowser.ts:1054` | CONFIRMED — fix not yet shipped |
| 4 | Native formatter is seam-only (identity in prod) | `nativeTranscriptFormatter.ts` identity default; **no production `registerNativeTranscriptFormatter`** call exists (only tests) | CONFIRMED — by design until product approves a formatter |
| 5 | Cloud A/B is a harness fix, not production behavior | production `AssemblyAICloudProvider.buildWebSocketUrl:147` is baseline-only; prompt→`u3-rt-pro` is a cost decision | CONFIRMED — agree, no app prompt/keyterms claim |

**Proposed fix plan for 1–3 (your priority order), pending go-ahead since they are gated engine paths:**
1. **Private finalizing order:** emit `Processing speech locally…` (and set an `isStopping` flag so
   in-flight live results can't look authoritative) BEFORE the `while(isProcessing)` wait. Add a unit
   test asserting status is emitted before the wait resolves.
2. **Cloud stop patience:** raise `SOCKET_CLOSE_TIMEOUT_MS` (measure first — capture `stopToTerminationMs`),
   and don't force-close before Termination/final unless a realistic cap is hit. Unit test for the
   wait-for-termination path.
3. **Native convergence:** event-drive / extend the stop window so a Chrome final arriving after the
   1s cap still wins over interim; trace "final-after-timeout" as a first-class failure.

If you (and the user) approve, I'll ship 1–3 with unit tests and hand them back for your browser/human
proof. I will NOT mark any of them green from unit tests — that's your call after live/human proof.

### What I need FROM the test agent next (release-gating proofs only you can run)

1. **Private v4 browser proof** on Harvard guard rows + `washington_01`, `return_timestamps:true`,
   selector `STT_PRIVATE_ENGINE=transformers-js-v4` (harness wrapper) → `?privateEngine=...`. Compare to
   the v2 browser rows and the v4 Node ceiling (96.39% Harvard / 98.95% washington). This is the
   highest-value open Private proof.
2. **Cloud credentialed A/B rerun** with the fixed script. Suggested first pass (cheap, shipping model):
   `ASSEMBLYAI_STREAMING_AB_VARIANTS=baseline,keyterms ASSEMBLYAI_STREAMING_AB_FIXTURES=h1_1,h1_6,h1_8`.
   Confirm 1008 concurrency errors are gone (settle delay) and whether keyterms now returns valid
   sessions. Only escalate to prompt/`u3-rt-pro` if keyterms is insufficient AND the cost is approved.
3. **Native human Chrome mic proof** (Scripts A–C): live text, no duplicate/erase on Stop, save/
   history/detail, punctuation/casing notes. Confirms findings 3 & 4 in the real browser.
4. **Score/Analytics gating audit (your domain, but I can help on the code side):** the reviewer asks
   whether Score is persisted at save vs recomputed in Analytics/PDF, and whether transcript
   confidence/readability gates Score. `speakingScore.ts` already takes a `transcriptionConfidence`
   input and emits a `confidence` state — tell me if you want me to (a) confirm the persist-vs-recompute
   path and (b) wire readability/run-on into the score confidence gate.

### Coordination
Report files are now committed and pushed to `main` (see SHA in my message). **They are safe for you to
resume editing.** I touched: the 3 release-evidence reports + this survival review (append-only DEV
blocks), `scripts/assemblyai-streaming-ab-proof.mts`, new `scripts/lib/assemblyaiAbUrl.ts`, new
`tests/cloud/assemblyaiAbUrl.test.ts`. No `frontend/src` changes.

## DEV → TEST AGENT (2026-06-02, append-only) — Score/Analytics confidence-gating + persistence AUDIT

Answers the reviewer's Score/Analytics questions with code evidence. **No code changed — audit +
minimal-patch proposal only.**

### Is the SpeakSharp Score persisted at save, or recomputed in Analytics/PDF?
**NEITHER. It is computed LIVE ONLY** in `LiveCoachingScoreCard.tsx` (a React `useMemo` over
`calculateSpeakingScore`). Evidence:
- `PracticeSession` (`frontend/src/types/session.ts`) has **no score field** — it persists raw inputs
  only: `transcript`, `accuracy`, `clarity_score`, `wpm`, `filler_words`, `pause_metrics`, `engine`.
- `AnalyticsDashboard.tsx` and `lib/pdfGenerator.ts` do **not** import/call `calculateSpeakingScore`.
  Analytics renders trends of the persisted RAW metrics; the composite Score is never re-shown post-session.

### Do Session / Analytics / PDF share one score payload?
**No** — there is no shared composite-score payload, because only the live session computes it.
Analytics/PDF consume the persisted RAW metrics (clarity / wpm / fillers / accuracy).
**Implication:** the "shared source of truth" risk is *moot for the composite Score* (it isn't reused).
BUT STT errors still flow into Analytics via the RAW metrics — `clarity_score`, `wpm`, and filler counts
are derived from the transcript and ARE persisted + trended. So the STT-quality risk is real for
Analytics, just through raw metrics rather than the composite Score.

### Does `speakingScore` consume transcript confidence / readability?
- **transcriptionConfidence:** accepted as input, but defaulted by engine via
  `inferTranscriptionConfidence` (cloud/private = `high`, native = `medium`); `getConfidence`
  downgrades to `directional` only when it is `low`. **The live card never passes it** → it always
  defaults by engine. So a weak transcript on a `high` engine (e.g. a Private under-capture) does
  **not** lower the displayed confidence.
- **readability / run-on:** **not consumed at all.**

### Can readability/run-on lower confidence WITHOUT changing the score formula?
**Yes, cleanly.** The numeric `score` (weights) and the `confidence` state
(`warming-up`|`directional`|`usable`) + `transcription.confidence` are independent. Minimal patch
(NO weight/formula change):
1. Pass a real `transcriptionConfidence` into `LiveCoachingScoreCard` derived from STT signals (engine
   + measured accuracy/readability/under-capture) instead of letting it default by engine.
2. Extend `getConfidence` to accept a `readabilityOk` / `captureComplete` signal and downgrade to
   `directional` (with a "transcript quality limited" note) when readability fails or capture is
   incomplete — **label/confidence only; the 0–10 score is untouched.**

### Is Transcript Quality prominent in Analytics?
**No.** It is one of FIVE equal tool groups in `AnalyticsDashboard.tsx`
(`delivery_control` [default], `message_clarity`, `habit_progress`, `session_proof`,
`transcript_quality`). Default is `delivery_control`; Transcript Quality is a non-default tab.
Proposal: auto-elevate/select the Transcript Quality group when recent sessions show low transcript
confidence.

### Net (and what I recommend, pending your/product call — nothing shipped)
- Score is live-only/ephemeral → no persist-vs-recompute consistency bug today, but ALSO a saved
  session carries **no** SpeakSharp Score for history/PDF (a product gap, not a bug).
- The confidence-gating hook EXISTS but is UNWIRED (engine-defaulted; readability ignored).
- Recommended: (a) wire `transcriptionConfidence` + readability into the confidence state (minimal
  patch above), (b) elevate Transcript Quality in Analytics under STT instability, (c) decide whether
  to persist the composite Score at save so history/Analytics/PDF can show it consistently.
