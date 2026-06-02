# STT Product Metrics Release Matrix

**Date:** 2026-06-02  
**Scope:** Private v2, Private v4, Native, Cloud  
**Location:** `product_release/evidence/` because this is temporary release evidence, not a canonical product-release artifact.  

## Executive Position

v3 is removed from the release-candidate comparison set.

Reason:

```text
On washington_01, v3 was faster than v2 but materially less accurate than v2/v4.
No current evidence suggests v3 is a better release candidate than v4.
```

Active STT candidates:

| Candidate | Status |
| --- | --- |
| Private v2 | Keep as current/legacy Private baseline |
| Private v4 | Prioritize for browser proof; strongest Private candidate so far |
| Native | Keep as customer-expectation baseline / quick-start path |
| Cloud | Keep as quality/full-speech launch candidate |
| Private v3 | Retired from release-candidate comparison unless new evidence reverses this |

## Release Gate

Release gate:

```text
Each visible STT path must match or exceed its corresponding drop-in/customer
baseline on the product metrics below, or it must be caveated/de-emphasized.
```

Drop-in/customer baselines:

| Candidate | Baseline to match or exceed |
| --- | --- |
| Private v2 | Private v2 full-WAV/drop-in ceiling and current browser app path |
| Private v4 | Private v4 full-WAV/drop-in ceiling and Private v2 where v2 is current default |
| Native | Real Chrome human-mic customer expectation |
| Cloud | AssemblyAI baseline streaming behavior; prompt/keyterms only if A/B proves safe |

## Product Metric Contract

| Metric | Required value | Why it is a product metric |
| --- | --- | --- |
| Accuracy/error | Not materially worse than drop-in/customer baseline | Engineering quality guardrail |
| Filler recall | Expected fillers recognized | SpeakSharp coaching depends on fillers |
| False filler insertion | 0 target | Prevents bad coaching feedback |
| Terminal punctuation | true | Users expect readable final text |
| Sentence count | roughly matches expected sentence count | Detects run-on text and missing sentence boundaries |
| Max run-on words | <=45 target; <=35 preferred | Wall-of-text transcripts drive users away |
| Capitalization errors | 0 obvious errors target | Random caps such as "Starts Now" look amateurish |
| Duplicate sentence/speech | false | Duplicate transcript is launch-blocking |
| Readability verdict | pass/fail | Captures punctuation/casing/duplication quality |
| First progress | <=1s target; <=2s hard limit | Prevents blank/frozen UI |
| First draft | <=5s target; <=8s hard limit for Private CPU | Shows the app is working |
| Finalization wait | short <=8s target / <=12s hard; 60s speech <=20s target / <=30s hard | Measures post-stop frustration |
| Transcript confidence | high/medium/low | Prevents overconfident score/analytics from weak STT |
| Save/history/detail | pass required | Proves the product journey |

## Current Values

Legend:

```text
MEASURED_NODE = measured in Node/drop-in-style full-WAV path.
MEASURED_PRIOR_APP = older app-path evidence; must be refreshed before release.
NOT_CAPTURED_CURRENT_RUN = no defensible current value yet.
BLOCKER = missing value blocks green classification.
```

### Short Corpus: Harvard h1_1-h1_10

| Candidate | Evidence | Accuracy | Error | Filler recall | False filler insertion | Terminal punctuation | Readability | First progress | Finalization wait | Save/history/detail | Release status |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| Private v2 | MEASURED_NODE full-WAV | 93.89% | 6.11% | 90.9% (10/11) | 0 | 9/10 rows | 9/10 rows | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | Not browser-green |
| Private v4 | MEASURED_NODE full-WAV | 96.39% | 3.61% | 90.9% (10/11) | 0 | 10/10 rows | 10/10 rows | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | Best Private candidate; needs browser proof |
| Native | Human real-mic required | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | BLOCKER |
| Cloud | MEASURED_PRIOR_APP | 91.53% | 8.47% | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | prior proof exists but current trace proof needed | Strongest path, not closed |

### Medium Speech: `washington_01` 65.8s

| Candidate | Evidence | Accuracy | Error | RTF | Words emitted | Terminal punctuation | Sentence count | Max run-on words | Duplicate detected | Readability verdict | Release status |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | --- | --- |
| Private v2 | MEASURED_NODE full-WAV | 98.95% | 1.05% | 0.1652 | 190 | true | 4 | 104 | false | fail | Accuracy strong, punctuation/run-on fails |
| Private v4 | MEASURED_NODE full-WAV | 98.95% | 1.05% | 0.0961 | 192 | true | 4 | 56 | false | fail | Accuracy strong, faster than v2, punctuation/run-on fails |
| Native | Human real-mic required | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | n/a | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | BLOCKER if Native is positioned beyond quick-start |
| Cloud | Credentialed long-form proof required | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | streaming | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | BLOCKER before Cloud brag path |

## Punctuation Quality Metric

Current scoring rule:

| Field | Pass target |
| --- | --- |
| `terminalPunctuationPresent` | final transcript ends with `.`, `?`, or `!` |
| `sentenceCount` | roughly matches expected script sentence count |
| `maxRunOnWords` | no sentence-like span over 45 words; 35 preferred |
| `capitalizationErrors` | no obvious mid-sentence random caps |
| `duplicateSentenceDetected` | false |
| `readabilityVerdict` | pass if punctuation/casing/duplication all pass |

Current finding:

```text
Private v4 is clean on short Harvard readability, but both v2 and v4 fail the
Washington medium-speech readability gate because sentence spans are too long.
This proves punctuation/readability must be measured as a sales-critical metric
instead of treated as polish.
```

## Technical Changes Required To Reach Sales-Quality

| Product need | Technical change | Owner |
| --- | --- | --- |
| Credible transcript readability | Add punctuation/readability scoring to every STT run and artifact | Test/release agent; dev if harness fields missing |
| Native text looks usable | Add approved Native-only final transcript formatter after selected final and before persistence | Product decision + dev |
| Private final text stays usable | Verify Whisper punctuation on short/medium/long scripts; add formatter only if final text remains run-on | Test first; dev only if proven |
| Cloud remains sales path | Verify AssemblyAI baseline punctuation/casing on long scripts; do not ship prompt/keyterms if they break transcripts | Test first |
| Score does not lie | Include transcript confidence/readability/punctuation in score confidence gating | Dev + test |
| Analytics tells the truth | Make Transcript Quality prominent enough to separate STT capture issues from speaking issues | Dev/design + test |

## Next Measurement Work

Required next table:

| Candidate | Must run next |
| --- | --- |
| Private v2 | Browser app path on h1_6 and `washington_01` with timing/readability |
| Private v4 | Browser app path on Harvard h1_1-h1_10 and `washington_01`; compare to v2 and v4 Node ceiling |
| Native | Human real-mic scripts with timing, punctuation/readability, no duplicate, save/history/detail |
| Cloud | Credentialed baseline long-form proof with filler recall, punctuation/readability, tail preservation, save/history/detail |

Green classification requires:

```text
Accuracy at or above drop-in/customer baseline.
Filler recall acceptable and false filler insertion near zero.
Punctuation/readability pass.
First progress and finalization timing within budget.
Transcript confidence high enough for scoring.
Save/history/detail pass.
```
