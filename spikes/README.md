# Segmentation spikes (#891) — how to run + claim discipline

## Canonical reproducible harness
**`seg_verify.mjs`** (Phase 1.5) is the reproducible verification harness — repo-relative paths, repo fixtures,
authoritative references, and the conservative seam-reconciliation policy. Run from the repo root:

```
node spikes/seg_verify.mjs              # or:  SS_ROOT=/path/to/repo node spikes/seg_verify.mjs
```
Requires `node_modules` installed and the Whisper model at `frontend/public/models/whisper-base.en/`.
It prints (A) Washington WER vs the authoritative 191-word fixture (`washington-speeches.ts`), and
(B) a per-seam audit (segment ids, overlap window, removed text + token count, reason, loop check).

> The earlier exploratory scripts (`seg_p1_sim.mjs`, `seg_hardening.mjs`, `seg_wer.mjs`) used absolute paths
> and a too-permissive 25-token reconcile; they are SUPERSEDED by `seg_verify.mjs`. Keep for history only.

## Conservative seam reconciliation = the PRODUCTION spec (top data-integrity risk)
Overlap reconciliation must be **bounded to the known overlap window and instrumented**. No global de-dup,
no out-of-window trim, under-trim over deletion.

| Case | Behavior |
|---|---|
| Exact match inside the overlap window | Trim ONLY the overlap text. Log it. |
| Fuzzy match, high confidence | Trim ONLY if bounded to overlap duration + token count. Log it. (Phase-2) |
| Low confidence / mismatch | **Keep both. Flag.** (never silent delete) |
| Repeated user phrase near boundary | Keep both unless clearly duplicated from the overlap. |
| More than a small token trim | Do NOT silently trim; flag. |
| Any trim outside the boundary window | **Forbidden.** |

Trim cap is **derived from overlap duration**: `min(10, ceil(overlapSec × ~4 wps))` ≈ **6 tokens for a 1.5s overlap**
(NOT 25). A 1.5–2.0s overlap must not justify deleting many words. Every seam removal is logged
(segment ids, window, removed text + token count, reason) and repetition-risk is run on each removed span +
the assembled transcript — flag-only, never alter.

## Claim discipline (do not victory-lap)
- **APPROVED:** "Segmentation recovers content that the whole long-form path can drop, and materially improves tail latency."
- **NOT a headline:** "2.6% WER / 22× accuracy improvement." The 2.6%/58.6% Washington figures are a single-clip
  reproducible *measurement* (cite as supporting data, bounded to that clip) — not a generalized accuracy claim.
  A quantitative accuracy claim needs a broader corpus with bounded references.
