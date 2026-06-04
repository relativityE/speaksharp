# Cloud STT Release Evidence — Current

**Updated:** 2026-06-04T15:28Z
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
| Local baseline contract/timing proof | `44/44` passed: Cloud engine tail/termination, AssemblyAI provider parsing/auth/request contract, baseline URL builder, and `readCloudStreamTiming` |
| Current-head deployed Cloud app-path smoke | GitHub Actions run `26960691857`, job `79549905302`, commit `4216b2d1`: `1 passed` in `46.2s`; artifact `live-cloud-artifacts` ID `7415247192`. |
| Cloud provider/session behavior in that smoke | Provider emitted partials, finals, and `terminated`; stop selected transcript length `362`, duration `25.062s`, final word count `67`, filler count `6`, `willSave=true`, and analytics history rendered. |
| New finding from that smoke | Visible transcript evidence was contaminated by glued trust-copy text: `Draft transcriptText may change...`, but this smoke ran on pre-fix commit `4216b2d1`. Current `main` includes trust-spacing fix `cd4b677d` and clean scrape surface `data-transcript-text-only`; re-proof should scrape that surface before treating this as an active bug. |

Artifacts previously used for baseline context:

```text
/private/tmp/speaksharp-cloud-harvard10-app.json
/private/tmp/assemblyai-ab-26776256219/assemblyai-streaming-ab-proof.json
```

## Open Proof

| Priority | Blocker | Owner |
| --- | --- | --- |
| P1 | Full baseline release proof with structured timing/readability/tail/WER fields is still needed before Cloud is fully green. The current deployed smoke proves app-path viability but not the full metric table. | test-release-agent / Codex |
| P1 | If Cloud is revisited, re-proof current `main` using `data-transcript-text-only` so visible trust labels do not contaminate transcript evidence. | test-release-agent / Codex |

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

Completed cross-cutting proof is recorded in the canonical matrix: session-to-analytics coherence, browser UX sweep, Cloud local contract proof, and report hygiene.

Remaining Cloud action:

```text
Cloud app-path smoke has passed on current head. Keep Cloud baseline-only for launch, but do not spend more release oxygen here until Native/Private blockers are fixed. Later, run a richer Cloud baseline proof that exports structured timeline/tail/readability/WER fields and clean transcript-only evidence.
```

## Dev Boundary

No Cloud-provider dev work is requested. The latest smoke's trust-label glue was captured on pre-fix commit `4216b2d1`; current `main` should be re-proofed with `data-transcript-text-only` before assigning any new dev work.

Coordination protocol: do work on a temporary branch; when complete and verified, merge to `main`, delete the temp branch, and keep reports/backlog updated with the merge commit. Do not leave release fixes stranded on long-lived branches.
