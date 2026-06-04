# Cloud STT Release Evidence — Current

**Updated:** 2026-06-04T12:44Z  
**Scope:** AssemblyAI Cloud STT baseline, app journey, timing, tail/readability proof  
**Canonical matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Verdict

```text
Cloud STT: CLOSEST TO RELEASE-GREEN
```

Cloud baseline is the paid quality path. It remains lower priority than Private/Native fixes for cost/positioning, but it is still the strongest STT candidate.

## Current Policy

```text
Cloud A = baseline only.
Stop standard-filler keyterms work.
```

Do not keep testing keyterms for default fillers (`uh`, `um`, `like`, `basically`). Keyterms/custom-word boosting is backlog/custom-word experimentation only, not launch-default Cloud.

## Current Evidence

| Evidence | Result |
| --- | --- |
| Corrected AssemblyAI streaming target | ~`91.86%` accuracy |
| Preserved Cloud app corpus | ~`91.53%` accuracy |
| Latest subset after request/session fixes | baseline valid and safest; keyterms valid but not better as launch default |
| Known policy | baseline only for launch |

Artifacts previously used for baseline context:

```text
/private/tmp/speaksharp-cloud-harvard10-app.json
/private/tmp/assemblyai-ab-26776256219/assemblyai-streaming-ab-proof.json
```

## Open Proof

| Priority | Blocker | Owner |
| --- | --- | --- |
| P1 | Current-head app-path baseline proof with timeline/readability/tail fields is still needed before Cloud is fully green. | test-release-agent / Codex |

Required proof fields:

```text
__CLOUD_STT_TIMELINE__
stopToTerminationMs
first partial/final timing
tail words preserved
WER / accuracy
filler recall and false filler insertion
punctuation/readability metrics
save/history/detail equality
```

## Test-Release Agent / Codex Owned Work

| # | Task |
| --- | --- |
| 4 | Session-to-Analytics coherence for Cloud-derived score/quality signals. |
| 5 | Browser UX bug hunt covering Cloud mode selection, save/history/detail, and generic trust copy. |
| 6 | Cloud baseline-only current-head app-path proof with timeline, tail, readability, filler, and save/history/detail. |
| 7 | Keep this report pruned to current artifacts, owners, and proof requirements. |

## Dev Boundary

No current Cloud dev work is requested unless the baseline proof fails with provider invalid rows, tail loss, save/detail mismatch, or timing regression.

Coordination protocol: do work on a temporary branch; when complete and verified, merge to `main`, delete the temp branch, and keep reports/backlog updated with the merge commit. Do not leave release fixes stranded on long-lived branches.
