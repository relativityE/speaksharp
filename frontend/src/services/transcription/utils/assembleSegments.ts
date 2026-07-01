/**
 * Segment assembly — #891 segmented Private finalization (Item 4 core, ISOLATED).
 * ============================================================================
 * Folds the per-segment word-timing decodes into ONE transcript by reconciling each seam with the
 * coverage-gated {@link reconcileSeam}. This is the assembly the segmented path would eventually save
 * INSTEAD of the whole-utterance decode — but this module is a PURE function only. It is not wired into
 * PrivateWhisper and does not touch the canonical save path; the cutover is a separate, later step.
 *
 * TIMEBASE: each segment is decoded from an audio slice `[sliceStartSec, audioEndSec]` (a lead-in
 * overlap is prepended when slicing, so adjacent segments SHARE audio at the seam). Whisper returns
 * word timestamps relative to that slice (0-based). reconcileSeam needs `prev` and `curr` in ONE shared
 * timebase with `tLo`/`tHi` in it, so we shift each segment's timings into GLOBAL utterance time by
 * adding `sliceStartSec` before folding. NaN timings are preserved (NaN + x = NaN) so a boundary
 * hallucination stays uncoverable → kept + flagged, never silently dropped (see wordTimings.ts).
 */

import {
  reconcileSeam,
  DEFAULT_SEAM_PARAMS,
  type TimedToken,
  type SeamReconcileParams,
  type SeamMetadata,
} from './seamReconciliation';

/** One decoded segment, ready for assembly. */
export interface SegmentForAssembly {
  /** Ledger index; segments are folded in ascending order. */
  readonly index: number;
  /** Word timings RELATIVE to this segment's audio slice (0-based). Empty if the decode failed/empty. */
  readonly wordTimings: readonly TimedToken[];
  /** Global-time offset of the slice's first sample (= max(0, ledgerStartSec - overlap)). */
  readonly sliceStartSec: number;
  /** Global-time end of this segment's audio (= ledger endSec). Used as `tHi` (prev's audio end). */
  readonly audioEndSec: number;
}

export interface AssembledTranscript {
  /** The reconciled transcript text. */
  readonly transcript: string;
  /** The reconciled token stream (global timebase). */
  readonly tokens: readonly TimedToken[];
  /** One entry per seam folded (i.e. segments.length - 1 when ≥2 non-empty segments). */
  readonly seams: readonly SeamMetadata[];
  /** Seams left flagged (residual duplication the coverage check could not certify away). */
  readonly flaggedSeams: number;
}

/** Shift a segment's slice-local timings into global utterance time (NaN preserved). */
function toGlobal(wordTimings: readonly TimedToken[], offsetSec: number): TimedToken[] {
  return wordTimings.map((t) => ({ w: t.w, ts: t.ts + offsetSec, te: t.te + offsetSec }));
}

/**
 * Assemble segment decodes into one transcript via pairwise coverage-gated seam reconciliation.
 * Pure + deterministic. A failed/empty segment contributes no tokens (its seam is a no-op). With 0 or 1
 * segments there are no seams and the (single or empty) segment's text is returned as-is.
 */
export function assembleSegments(
  segments: readonly SegmentForAssembly[],
  params: SeamReconcileParams = DEFAULT_SEAM_PARAMS,
): AssembledTranscript {
  const ordered = [...segments].sort((a, b) => a.index - b.index);
  const seams: SeamMetadata[] = [];

  let acc: TimedToken[] = [];
  let accAudioEndSec = 0;
  let started = false;

  for (const seg of ordered) {
    const curr = toGlobal(seg.wordTimings, seg.sliceStartSec);

    // Empty/failed segment: contributes no tokens and creates no seam. Advance the audio end so a later
    // segment's tHi (prev's audio end) stays correct. The whole-utterance fallback covers the gap.
    if (curr.length === 0) {
      if (started) accAudioEndSec = Math.max(accAudioEndSec, seg.audioEndSec);
      continue;
    }

    if (!started) {
      acc = curr;
      accAudioEndSec = seg.audioEndSec;
      started = true;
      continue;
    }

    // tLo = curr's audio (slice) start; tHi = the accumulated transcript's audio end so far.
    const result = reconcileSeam(acc, curr, seg.sliceStartSec, accAudioEndSec, params);
    seams.push(result.metadata);
    acc = acc.slice(0, acc.length - result.trimPrev).concat(result.curr);
    // The accumulator now extends to this segment's audio end (segments fold in order).
    accAudioEndSec = Math.max(accAudioEndSec, seg.audioEndSec);
  }

  return {
    transcript: acc.map((t) => t.w).join(' '),
    tokens: acc,
    seams,
    flaggedSeams: seams.filter((s) => s.flagged).length,
  };
}
