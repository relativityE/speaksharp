# STT Speed, Accuracy, And Market Survival — Current

**Updated:** 2026-06-04T11:40Z  
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
