/**
 * Segmented finalization CANDIDATE — #891 Slice 1 (additive assembly layer, NOT a cutover).
 * ============================================================================
 * Wraps the pure {@link assembleSegments} fold into the single structured object the segmented path
 * WOULD eventually save instead of the whole-utterance decode — but in Slice 1 this candidate is
 * produced for measurement/proof ONLY. It is never shown, never saved, never scored; the whole-utterance
 * decode remains the canonical transcript. The point of this layer is to answer, before any product
 * behavior changes, one question: can we reliably assemble a COMPLETE, DETERMINISTIC segmented final
 * transcript from the per-segment decodes (including the tail), and can we detect — not silently hide —
 * the case where that candidate is unusable and a whole-utterance fallback is required?
 *
 * FALLBACK HONESTY: `fallbackUsed` marks a candidate that could NOT stand in as a final transcript
 * (no segments handed in, no segment decoded, or the fold produced no text). Slice 1 always keeps the
 * whole-utterance decode canonical, so a fallback candidate never degrades output — but it must be
 * flagged and logged so the eventual cutover can gate on it instead of shipping an empty transcript.
 *
 * SEAM/FLAG METADATA is passed through untouched from the coverage-gated reconciler: coverage-certified
 * overlap may be dropped, but out-of-window / uncoverable spans (boundary hallucinations) are KEPT and
 * FLAGGED, never deleted. `flaggedSeams` surfaces the residual so the candidate's fidelity is visible.
 *
 * Pure + deterministic (timing is an optional session-runtime echo, not computed here) so the whole
 * candidate — including fallback detection and coverage — is unit-tested in isolation.
 */

import { assembleSegments, type SegmentForAssembly } from './assembleSegments';
import type { SeamMetadata, TimedToken } from './seamReconciliation';

/** Per-segment fold summary. No transcript text beyond the word count — safe to carry in telemetry. */
export interface CandidateSegmentSummary {
  readonly index: number;
  /** Word timings this segment contributed to the fold. */
  readonly wordCount: number;
  /** False when the segment produced no tokens (failed or silent decode) — folded as a no-op. */
  readonly decoded: boolean;
}

/** Coverage summary of the fold — how many of the handed-in segments actually contributed speech. */
export interface CandidateCoverage {
  /** Segments handed to assembly (confirmed segments + the Stop tail; includes failed decodes). */
  readonly segmentCount: number;
  /** Segments that contributed >=1 token. */
  readonly decodedSegmentCount: number;
  /** Segments that contributed no tokens (failed or silent) — folded as no-ops. */
  readonly emptySegmentCount: number;
  /** Total assembled tokens after seam reconciliation. */
  readonly tokenCount: number;
}

/**
 * Session-runtime timing echoed into the candidate. Optional + injected (never read from a clock here)
 * so the builder stays pure/deterministic for unit tests. Null fields = not measured.
 */
export interface CandidateTiming {
  /** Stop -> assembled-candidate-ready (ms). */
  readonly stopToCandidateMs: number | null;
  /** Tail (final unconfirmed segment) decode time at Stop (ms). */
  readonly tailDecodeMs: number | null;
}

export type CandidateFallbackReason =
  | 'no_segments'
  | 'no_decoded_segments'
  | 'empty_transcript';

/** The structured segmented final-transcript candidate (Slice 1: measurement/proof only). */
export interface SegmentedFinalizationCandidate {
  /** Assembled transcript text. */
  readonly text: string;
  /** Reconciled token stream (global utterance timebase). */
  readonly tokens: readonly TimedToken[];
  /** Per-segment fold summary (index / wordCount / decoded), ascending by index. */
  readonly segments: readonly CandidateSegmentSummary[];
  /** One entry per folded seam, with full coverage/flag metadata. */
  readonly seams: readonly SeamMetadata[];
  /** Seams left flagged (residual duplication the coverage check could not certify away). */
  readonly flaggedSeams: number;
  /** True when this candidate is NOT usable as a final transcript (a whole-utterance fallback is required). */
  readonly fallbackUsed: boolean;
  /** Why the candidate is a fallback (null when usable). */
  readonly fallbackReason: CandidateFallbackReason | null;
  readonly coverage: CandidateCoverage;
  readonly timing: CandidateTiming;
}

const NO_TIMING: CandidateTiming = { stopToCandidateMs: null, tailDecodeMs: null };

/**
 * Build the structured segmented finalization candidate from the per-segment decodes (confirmed + tail).
 * Folds via the coverage-gated {@link assembleSegments}, then adds explicit fallback detection + a
 * coverage summary + a per-segment summary. Pure/deterministic; `timing` is echoed through as given.
 *
 * A candidate is a FALLBACK (unusable as a final transcript) when: no segments were handed in
 * (`no_segments` — e.g. the Stop drain timed out), none decoded (`no_decoded_segments`), or the fold
 * produced no text (`empty_transcript`). In all three cases the caller must keep the whole-utterance
 * decode canonical — and Slice 1 always does.
 */
export function buildSegmentedFinalizationCandidate(
  segments: readonly SegmentForAssembly[],
  timing: CandidateTiming = NO_TIMING,
): SegmentedFinalizationCandidate {
  const assembled = assembleSegments(segments);

  const perSegment: CandidateSegmentSummary[] = [...segments]
    .sort((a, b) => a.index - b.index)
    .map((s) => ({ index: s.index, wordCount: s.wordTimings.length, decoded: s.wordTimings.length > 0 }));

  const decodedSegmentCount = perSegment.filter((s) => s.decoded).length;

  // FALLBACK DETECTION (Slice 1 acceptance: empty/failed candidate is DETECTED + logged, not hidden).
  const fallbackReason: CandidateFallbackReason | null =
    segments.length === 0
      ? 'no_segments'
      : decodedSegmentCount === 0
        ? 'no_decoded_segments'
        : assembled.transcript.trim().length === 0
          ? 'empty_transcript'
          : null;

  return {
    text: assembled.transcript,
    tokens: assembled.tokens,
    segments: perSegment,
    seams: assembled.seams,
    flaggedSeams: assembled.flaggedSeams,
    fallbackUsed: fallbackReason !== null,
    fallbackReason,
    coverage: {
      segmentCount: segments.length,
      decodedSegmentCount,
      emptySegmentCount: segments.length - decodedSegmentCount,
      tokenCount: assembled.tokens.length,
    },
    timing,
  };
}
