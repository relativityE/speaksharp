# STT Speed, Accuracy, And Market Survival — Current

**Updated:** 2026-06-04T13:18Z  
**Purpose:** Keep the release decision focused on product survival: fast visible feedback, accurate final transcript, credible punctuation, and trustworthy analytics.

## Product Position

| STT | Role | Current release posture |
| --- | --- | --- |
| Native | Free/conversion funnel | Not green. Must be quick and credible or clearly caveated. |
| Private | Strategic local/privacy differentiator | Not green. Consent is proven; accuracy/detail/live progress are not. |
| Cloud | Paid quality accelerator | Closest to green. Baseline only; keyterms are not launch work. |

## Current Blocking Truth

```text
We do not yet have an STT path that is both product-positioned correctly and
fully release-green.
```

Cloud is the strongest quality path, but product strategy prioritizes getting Native/Private trustworthy because they control cost, conversion, and the privacy value proposition.

## Non-Negotiable Gates

| Gate | Meaning |
| --- | --- |
| First progress | User sees the system is alive quickly. |
| First useful text | Draft/provisional text appears without long blank silence. |
| Final accuracy | Saved transcript is at or near customer/drop-in expectation. |
| Filler recall | Coaching-critical fillers are captured; missed fillers reduce confidence. |
| Readability | Punctuation/casing/run-on quality is usable. |
| Trust labels | Draft/final/local claims are truthful per engine. |
| Journey | Save, history, detail, score, and analytics agree on the same transcript. |

## Current Actions

| STT | Immediate action |
| --- | --- |
| Native | @dev-agent fixes detail-empty, formatter truecasing/readability, and trust-label spacing; test reruns real mic. |
| Private | @dev-agent investigates content loss/substitution, first-visible draft gate, and detail-empty; test reruns same human script. |
| Cloud | Keep baseline only; run current-head app-path tail/readability/timeline proof after higher-priority Native/Private work. |
| Score / Analytics | Coherence proof passed. Continue treating transcript quality as confidence/caveat input; do not use analytics success to excuse weak STT source quality. |

## Test-Release Agent / Codex Owned Tasks

These seven items are assigned to **test-release-agent / Codex**. Dev agent should not pick them up unless explicitly asked or unless a proof isolates a dev-owned product bug.

| # | Task | Output expected |
| --- | --- | --- |
| 1 | Private decode-parameter A/B | Browser-worker proof comparing current config vs reversible anti-hallucination/long-form config on guard rows, Washington, and latest human Private script. |
| 2 | Native raw-first async formatter verification | Real/browser proof separating raw-save timing, formatter-complete timing, formatted detail text, `wordPreserving`, latency, and general truecasing such as `Starts Now`. |
| 3 | Private VAD prototype test plan | RMS-vs-neural-VAD proof plan and metrics; execute once dev provides a flagged prototype. |
| 4 | Session-to-Analytics coherence pass | **Complete 2026-06-04:** targeted analytics/score Vitest `66/66`, user-facing browser regression `9/9`, analytics suite/truth browser proof `13/13`. Session score, transcript-quality caveats, filler/readability signals, detail navigation, reload/export, and analytics outputs agree under automation. |
| 5 | Browser UX bug hunt | Serial user-like browser testing across signup, session, save/history/detail, analytics, pricing/conversion, and error recovery; document reproducible bugs only. |
| 6 | Cloud baseline proof | Baseline-only current-head app-path proof with timeline, tail, readability, filler, and save/history/detail. No standard-filler keyterms work. |
| 7 | Report/backlog hygiene | Keep active STT reports current and pruned; remove stale chatter and preserve only actionable blockers, owners, artifacts, and proof requirements. |

Coordination protocol: do work on a temporary branch; when complete and verified, merge to `main`, delete the temp branch, and update the relevant report/backlog entry with the merge commit. Do not leave release fixes stranded on long-lived branches.

## Formatter Strategy

| Engine | Formatter rule |
| --- | --- |
| Native | Gemini/server formatter is allowed, but must be raw-first/async, word-preserving, cost-guarded, and actually improve readability. |
| Private | No Gemini/server formatter by default. Any formatter must be browser-local and must not hide semantic STT substitutions. |
| Cloud | Use provider baseline formatting unless product reopens a separate custom-word/formatter experiment. |

## Trust-Copy Strategy

| Engine | Copy rule |
| --- | --- |
| Private | May say `locally` only for actual local processing states. |
| Native/Cloud | Generic draft/processing/final language only; never claim local processing. |

## Current Evidence Files

```text
product_release/evidence/test_reports/NATIVE_STT_RELEASE_EVIDENCE_2026-06-02.md
product_release/evidence/test_reports/PRIVATE_STT_RELEASE_EVIDENCE_2026-06-02.md
product_release/evidence/test_reports/CLOUD_STT_RELEASE_EVIDENCE_2026-06-02.md
product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.md
product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json
```
