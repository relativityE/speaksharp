# Segmentation HARDENING results (Branch B, #891) — 2026-06-30

Pause-aligned boundaries (20s target / 30s hard cap), decode-during-recording, tail-only Stop, across
6 clips (5 varied real + a ~3.3min varied 5-min proxy). Real whisper-base.en, node. Scripts:
`spikes/seg_hardening.mjs`, `spikes/seg_wer.mjs`.

## TIMING — solved
Stop-to-final (tail-only decode) per clip: **1.1–3.8s, incl. 1.7s on the 200s 5-min proxy.** Bounded by
the last segment regardless of total length. Pause-snapping works (most boundaries snap to silence:
ss_utt_0 2snap/0cap, proxy 8snap/1cap). No loops introduced. Openings preserved.

## ACCURACY — APPROVED claim: segmentation recovers content the whole long-form path can drop
The initial hardening table showed alarming "WER vs whole" (washington 146.8%, harvard 180%). Investigation
INVERTED it: the **whole-utterance baseline is broken** — transformers.js whisper long-form mis-stitches and
silently drops part of long-clip content. The "vs whole" metric is meaningless where whole is broken — use
ground truth, bounded to the clip.

**Reproducible measurement** (Phase 1.5 `seg_verify.mjs`, repo-relative, authoritative references bounded to
each clip, conservative 6-token reconciliation). Harvard fixture mapping VERIFIED: `harvard_benchmark_16k.wav`
= `HARVARD_SENTENCES` h1_1..h1_10 in order (fillers included in ref), 34.5s (>30s = exercises long-form stitch).

| WER vs authoritative ground truth | GT words | Whole-utterance (prod path) | Segmented |
|---|---|---|---|
| washington_01 (66s) | 191 | 79w, **58.6%** (dropped) | 195w, **2.6%** (1 seam-flag) |
| harvard_benchmark (34.5s) | 87 | 35w, **60.9%** (dropped) | 97w, **12.6%** (1 seam-flag) |

Long-form content-drop CONFIRMED on 2 clips (whole drops ~60% on both; segmentation recovers on both).
This is **limited fixture evidence (2 clips), NOT corpus-level validation** — do not broaden the accuracy claim.

### Harvard WER decomposition (`seg_verify.mjs` A2 — backtrace the edit-distance matrix; one-clip diagnostic)
Settles task-one's real floor by attribution, not assumption. Harvard's 11 errors decompose as:
- **10 insertions in ONE contiguous run `[50-59]@seam`** = the garble "to frighten him. He is a writer and
  writer. entails" → 100% seam-attributable (task-one fixable).
- **1 substitution `[34] "parked"->"park"`** = the only content error. **D=0; zero errors on any filler.**
- => seam-attributable: 10; content floor: 1 → **harvard post-fix floor ≈ 1.1% WER** (below washington's 2.6%).

**The harvard↔washington gap is ENTIRELY the seam defect.** The suspected base-model/filler content errors are
NOT present on this clip (fillers transcribed correctly). **Task-one success criterion on harvard = remove the
seam run, reaching the ~1.1% content floor — NOT "hit 2.6%."** (Guardrail: one 87-word clip's decomposition;
not a general base.en filler-error rate. NB a first ±4-window classifier wrongly split the contiguous run as
5/6 (6.9%) — corrected to contiguous-run-touching-seam to match the artifact.)

### Task-one RESULT: bounded fuzzy anchor splice — both pass conditions met
When exact overlap-trim fails, `seg_verify.mjs` now runs a bounded FUZZY ANCHOR SPLICE inside the overlap
window: anchor = longest common run (>=2 tok) between prev-tail-window and curr-head-window; keep prev thru
the anchor + curr after it (drop prev's post-anchor tail + curr's pre-anchor head — both redundant overlap
decodes or hallucination); per-side drop cap 8; else keep-both+FLAG.

- **(a) WER reached the content floor:** washington 2.6%->**0.5%** (191w==191 ref); harvard 12.6%->**1.1%**
  (87w==87 ref; decomposition now I=0 D=0 S=1 — the 10-insertion seam run GONE, only "parked"->"park" remains).
- **(b) Seam audit (post-fix, all 3 clips):** washington seam1->2 splice anchor "his own deficiencies."
  (drop-prev 1 `[BLANK_AUDIO]` + drop-curr 3 dup); harvard seam0->1 splice anchor "to frighten him."
  (drop-prev 6 "He is a writer and writer." hallucination + drop-curr 4 "entails to frighten him," garble+dup);
  **concat's 4 seams STILL exact_overlap_trim (fuzzy did NOT widen the already-clean clips)**; all drops within
  per-side cap 8; no out-of-window; no dropped span was a loop; PATH-3 liveness PASS (no-anchor -> keep-both+flag).
  WER hitting the floor confirms no UNIQUE speech over-trimmed.

Caveats: validated on the 2 flagged seams + verified not to touch clean seams (3 clips). The real continuous
5-min take is still the key gate (concat seams are join artifacts). A hallucination >8 tok would FLAG
(keep-both), not over-trim — the safe failure mode.
- **APPROVED framing:** "Segmentation recovers content that the whole long-form path can drop, and materially improves tail latency."
- **NOT a headline:** "2.6% WER / 22× improvement." The figures above are a SINGLE-CLIP reproducible measurement
  (supporting data, bounded to washington_01) — a quantitative accuracy claim needs a broader corpus.

## TOP DATA-INTEGRITY RISK — seam reconciliation (now constrained + instrumented)
The old reconcile trimmed up to 25 tokens on a normalized match — too permissive (can delete legitimate repeated
speech). REPLACED in `seg_verify.mjs` with the conservative policy (`spikes/README.md`): trim only an EXACT
overlap match inside the window, bounded to **≤6 tokens (overlap-derived)**; else **keep both + FLAG**; never
global de-dup; never out-of-window; under-trim over deletion. Seam audit (washington + harvard + concat):

- All trims ≤4 tokens, exact-match, logged (e.g. seg0→1 removed 4tok `"On the other hand,"`).
- Unmatched overlaps → `NO_BOUNDED_MATCH__kept_both__FLAG` (harvard seam, washington seam1→2) = residual
  duplication is VISIBLE/flagged, not silently mutated. Harvard is **not** the only flagged seam.
- No removed span was itself a loop; no assembled transcript looped.
=> data-integrity-safe, but the flagged under-trim seams are the Phase-2 work (better bounded alignment).

## Disposition
- Timing: SOLVED (tail-only, 1–4s).
- Accuracy: APPROVED qualitative claim (recovers dropped content + improves tail latency); washington reproducible
  single-clip data 2.6% vs 58.6%; broader corpus needed before any quantitative headline.
- Seam reconciliation: TOP risk, now conservative + instrumented (≤6-tok bounded, flag-don't-delete); flagged
  under-trim seams = Phase-2 alignment work.
- Still open: a real continuous 5-min take (proxy used); in-browser absolute timing (node here); broader-corpus
  WER with bounded references; tight immediate-start re-gate; the production single-transcript wiring
  (visible-final == saved History AND analytics/WPM/filler/PDF from the one assembled transcript).
