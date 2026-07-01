# Wiring acceptance criterion: flagged-seam metadata-carry (#891)

**Bar: same as "no silent mutation."** The seam reconciliation is flag-only — it must NEVER alter transcript text.
When the assembled transcript becomes the saved-path input, each seam's reconciliation metadata must persist
*with* the saved record (like the verified `detectRepetitionRisk` metadata path), and be readable back.

## Per-seam metadata (recorded for EVERY seam, not just flagged ones)
- `seamId` / segment boundary (which two segments, boundary time).
- `resolution`: one of `exact_overlap_trim` | `asym_splice_partial` | `fuzzy_anchor_splice_full` | `kept_both_flag` | `coverage_aborted` | `no_bounded_match`.
- `overlap`: the wall-clock interval `[t_lo, t_hi]` used for the coverage check.
- `droppedCovered`: text removed because it was coverage-certified shared audio (with span time-range).
- `retainedFlagged`: text KEPT despite being a candidate for removal, because it could not prove coverage
  (with span time-range).
- `reason`: why retained rather than removed — `out_of_window` | `no_anchor` | `coverage_uncertifiable`.
- `flagged`: boolean (true iff any span was kept-but-flagged = visible residual with provenance).

## Acceptance tests (concrete, testable — not aspirational)
1. **History/detail read-back.** A saved History record whose assembled transcript contains a flagged seam
   MUST expose that seam's metadata on read-back. Concretely: harvard's `"He's a dragon-chimp."` residual in a
   saved record is queryable as `{resolution: asym_splice_partial, retainedFlagged: "He's a dragon-chimp.",
   reason: out_of_window, overlap: [19.3,20.8]}` — NOT visible duplication with no provenance. If you cannot
   read back *why* a flagged span is in a saved transcript, wiring FAILS this criterion.
2. **All four consuming surfaces (the extension).** The flagged residual is IN the assembled transcript, so it
   flows to analytics/WPM/filler/PDF as well as History. The metadata-carry must make the flag available AT THE
   POINT where WPM / filler / score / PDF consume the transcript — so the deterministic score model CAN see that
   `"He's a dragon-chimp."` is flagged residual and decide whether to count it. NOTE: whether those surfaces act
   on the flag is a SEPARATE scoring-model decision (silently excluding it would be its own mutation); the wiring
   requirement is only that they CAN see it. Acceptance = a test asserting the flag is visible to each of the four
   consumers, not that they exclude it.

## Hard rules carried into production
- Flag-only: transcript text is never altered by reconciliation metadata.
- `DROPPED-OUT-OF-WINDOW = 0` invariant holds in the production reconciler, same as the spike.
- Boundary-hallucination removal is OUT OF SCOPE (no quality-heuristic deleter). Flagged residual is the correct
  end state; a span that can't prove coverage stays visible + flagged + provenance-carried.
