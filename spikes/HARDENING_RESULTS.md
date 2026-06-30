# Segmentation HARDENING results (Branch B, #891) — 2026-06-30

Pause-aligned boundaries (20s target / 30s hard cap), decode-during-recording, tail-only Stop, across
6 clips (5 varied real + a ~3.3min varied 5-min proxy). Real whisper-base.en, node. Scripts:
`spikes/seg_hardening.mjs`, `spikes/seg_wer.mjs`.

## TIMING — solved
Stop-to-final (tail-only decode) per clip: **1.1–3.8s, incl. 1.7s on the 200s 5-min proxy.** Bounded by
the last segment regardless of total length. Pause-snapping works (most boundaries snap to silence:
ss_utt_0 2snap/0cap, proxy 8snap/1cap). No loops introduced. Openings preserved.

## ACCURACY — segmentation is DRAMATICALLY better than the current whole-utterance path (the big finding)
The initial hardening table showed alarming "WER vs whole" (washington 146.8%, harvard 180%). Investigation
INVERTED it: the **whole-utterance baseline is broken** — transformers.js whisper long-form mis-stitches and
**silently drops 1/2–2/3 of long-clip content**. Segmentation captures it.

| washington (66s), WER vs GROUND TRUTH | words | WER |
|---|---|---|
| Whole-utterance decode (current prod path) | 79 / 191 | **58.6%** (drops 2/3) |
| Segmented decode | 195 / 191 | **2.6%** |

Harvard (35s): whole captured 35 words (last third only); segmented captured all 97 (full Harvard list).
=> **Segmentation fixes a decode-side content-drop bug** as a side effect of bounded per-segment decode —
on top of the latency win. The "vs whole" metric is meaningless where whole is broken; use ground truth.

## SECONDARY DEFECT — seam reconciliation needs Phase-2 hardening (real but minor)
Harvard assembled showed one garbled seam: "...He is a writer and writer. entails to frighten him..." — the
naive exact-match overlap dedup didn't cleanly reconcile one boundary (~5–8 words). Small, not catastrophic,
but the reconciliation must be hardened (better overlap alignment / fuzzy match, still under-trim-never-delete).

## Disposition
- Timing: SOLVED (tail-only, 1–4s).
- Accuracy: segmentation BEATS the current path (fixes content drop); 2.6% WER vs ground truth on washington.
- Seam reconciliation: needs Phase-2 hardening (minor seam dup observed).
- Still open: a real continuous 5-min take (proxy used); in-browser absolute timing (node here); broader-corpus
  WER with references; tight immediate-start re-gate; the production single-transcript wiring (visible==saved + analytics/PDF).
