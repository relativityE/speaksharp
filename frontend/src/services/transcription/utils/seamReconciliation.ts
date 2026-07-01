/**
 * Seam reconciliation — #891 segmented Private finalization.
 * ============================================================================
 * When Private STT decodes a long recording as bounded overlapping segments (instead of one
 * whole-utterance decode at Stop), adjacent segments share a small OVERLAP region that both
 * decode. Reconciliation removes that duplication when joining segment(i-1) to segment(i) —
 * but it must NEVER delete unique speech. Validated in `spikes/seg_verify.mjs` across
 * washington/harvard/concat before this port.
 *
 * The load-bearing safety property is TEMPORAL COVERAGE, not token count:
 *   every token removed on EITHER side must have its audio timespan fall entirely within the
 *   overlap interval [tLo, tHi] = [curr.audioStart, prev.audioEnd] that BOTH segments decoded.
 *   A removed span outside it would be deleting audio the other segment never saw. Token count
 *   is blast-radius; time-range is coverage. Word timestamps come from return_timestamps:'word'.
 *
 * Policy (in order):
 *   1. exact bounded overlap trim of curr's head (<= maxExactTrim), if coverage-certified;
 *   2. bounded fuzzy ANCHOR SPLICE (anchor = longest common run in the overlap windows), applied
 *      ASYMMETRICALLY — each side's span is dropped IFF it is coverage-certified; an out-of-window
 *      span is KEPT and FLAGGED, never dropped;
 *   3. otherwise keep both + flag.
 *
 * Hard invariant: DROPPED-OUT-OF-WINDOW = 0. We only ever remove provably-shared audio. Boundary
 * hallucinations (whisper's garbage, non-monotonic timestamps at segment ends) can never prove
 * coverage, so they are always kept + flagged — NOT deleted by any quality heuristic (that would be
 * the banned sanitizer). Flag-only: reconciliation never alters the text of a retained span.
 */

/** A decoded word with its audio timespan (seconds, wall-clock in the full recording). */
export interface TimedToken {
  readonly w: string;
  readonly ts: number;
  readonly te: number;
}

/**
 * Result of a single SEGMENT decode (#891 segmented finalization): transcript text plus per-word
 * timings. Word timings are the input the coverage-gated seam reconciler needs to certify/splice
 * overlaps. Homed here (next to TimedToken) so engines, the facade, and the reconciler share one type
 * without a contracts→engine dependency.
 */
export interface SegmentTranscription {
  readonly text: string;
  readonly wordTimings: TimedToken[];
}

export type SeamResolution =
  | 'exact_overlap_trim'
  | 'fuzzy_anchor_splice_full'
  | 'asym_splice_partial'
  | 'kept_both_flag'
  | 'no_bounded_match';

export type RetainReason = 'out_of_window' | 'no_anchor' | 'coverage_uncertifiable';

/** One span considered for removal at a seam, with its coverage verdict and what happened to it. */
export interface SeamSpan {
  readonly side: 'prev' | 'curr';
  readonly text: string;
  readonly ts: number | null;
  readonly te: number | null;
  readonly covered: boolean;
  readonly action: 'dropped' | 'kept';
}

/**
 * Per-seam metadata that MUST ride with the saved transcript (WIRING_METADATA_SPEC.md).
 * Flag-only: this records what happened; it never alters retained text.
 */
export interface SeamMetadata {
  readonly resolution: SeamResolution;
  readonly overlap: readonly [number, number];
  readonly anchor: string | null;
  /** Spans removed because they were coverage-certified shared audio. */
  readonly droppedCovered: readonly SeamSpan[];
  /** Spans KEPT (visible residual) because they could not prove coverage. */
  readonly retainedFlagged: readonly SeamSpan[];
  readonly reasonRetained: RetainReason | null;
  readonly flagged: boolean;
}

export interface ReconcileResult {
  /** Tokens to drop from the END of the accumulated transcript (prev). */
  readonly trimPrev: number;
  /** curr tokens to append after the trim. */
  readonly curr: readonly TimedToken[];
  readonly metadata: SeamMetadata;
}

export interface SeamReconcileParams {
  readonly maxExactTrim: number;
  readonly fuzzyWindow: number;
  readonly minAnchor: number;
  readonly dropCap: number;
  /** Timestamp-jitter tolerance (seconds) applied to the coverage check. */
  readonly coverageEps: number;
}

export const DEFAULT_SEAM_PARAMS: SeamReconcileParams = {
  maxExactTrim: 6,
  fuzzyWindow: 10,
  minAnchor: 2,
  dropCap: 8,
  coverageEps: 0.2,
};

const norm = (w: string): string => w.toLowerCase().replace(/[^a-z0-9']/g, '');

interface Coverage {
  readonly ts: number | null;
  readonly te: number | null;
  readonly covered: boolean;
}

/** A span is covered iff every token lies inside [tLo, tHi] within the jitter tolerance. */
function spanCoverage(span: readonly TimedToken[], tLo: number, tHi: number, eps: number): Coverage {
  if (span.length === 0) return { ts: null, te: null, covered: true };
  const ts = Math.min(...span.map((t) => t.ts));
  const te = Math.max(...span.map((t) => t.te));
  const covered = span.every((t) => t.ts >= tLo - eps && t.te <= tHi + eps);
  return { ts, te, covered };
}

const asSpan = (span: readonly TimedToken[], side: 'prev' | 'curr', cov: Coverage, action: 'dropped' | 'kept'): SeamSpan => ({
  side,
  text: span.map((t) => t.w).join(' '),
  ts: cov.ts,
  te: cov.te,
  covered: cov.covered,
  action,
});

function meta(
  resolution: SeamResolution,
  tLo: number,
  tHi: number,
  anchor: string | null,
  spans: readonly SeamSpan[],
): SeamMetadata {
  const droppedCovered = spans.filter((s) => s.action === 'dropped');
  const retainedFlagged = spans.filter((s) => s.action === 'kept');
  // A seam is flagged (visible residual duplication) unless it was fully, cleanly resolved.
  const flagged = resolution !== 'exact_overlap_trim' && resolution !== 'fuzzy_anchor_splice_full';
  const reasonRetained: RetainReason | null = !flagged
    ? null
    : anchor === null
      ? 'no_anchor'
      : retainedFlagged.some((s) => !s.covered)
        ? 'out_of_window'
        : 'coverage_uncertifiable';
  return { resolution, overlap: [tLo, tHi], anchor, droppedCovered, retainedFlagged, reasonRetained, flagged };
}

/**
 * Reconcile the seam joining the accumulated transcript `prev` to the next segment `curr`.
 * `tLo` = curr's audio start; `tHi` = prev's audio end (the shared overlap interval).
 */
export function reconcileSeam(
  prev: readonly TimedToken[],
  curr: readonly TimedToken[],
  tLo: number,
  tHi: number,
  params: SeamReconcileParams = DEFAULT_SEAM_PARAMS,
): ReconcileResult {
  const { maxExactTrim, fuzzyWindow, minAnchor, dropCap, coverageEps } = params;

  // 1) clean overlap: exact bounded trim of curr's head, coverage-checked.
  const cap = Math.min(maxExactTrim, prev.length, curr.length);
  for (let k = cap; k >= 1; k--) {
    let match = true;
    for (let i = 0; i < k; i++) {
      if (norm(prev[prev.length - k + i].w) !== norm(curr[i].w)) {
        match = false;
        break;
      }
    }
    if (match) {
      const dropped = curr.slice(0, k);
      const cov = spanCoverage(dropped, tLo, tHi, coverageEps);
      if (cov.covered) {
        return { trimPrev: 0, curr: curr.slice(k), metadata: meta('exact_overlap_trim', tLo, tHi, null, [asSpan(dropped, 'curr', cov, 'dropped')]) };
      }
      break; // exact but not covered — fall through to fuzzy/flag
    }
  }

  // 2) garbled overlap: bounded fuzzy anchor splice, applied asymmetrically + coverage-gated.
  const pStart = Math.max(0, prev.length - fuzzyWindow);
  const pWin = prev.slice(pStart);
  const cWin = curr.slice(0, fuzzyWindow);
  let best: { i: number; j: number; len: number } | null = null;
  for (let i = 0; i < pWin.length; i++) {
    for (let j = 0; j < cWin.length; j++) {
      let len = 0;
      while (i + len < pWin.length && j + len < cWin.length && norm(pWin[i + len].w) === norm(cWin[j + len].w)) len++;
      if (len >= minAnchor && (best === null || len > best.len)) best = { i, j, len };
    }
  }
  if (best !== null) {
    const dropPrevN = pWin.length - (best.i + best.len);
    const dropCurrN = best.j + best.len;
    if (dropPrevN <= dropCap && dropCurrN <= dropCap) {
      const dp = prev.slice(prev.length - dropPrevN);
      const dc = curr.slice(0, dropCurrN);
      const cp = spanCoverage(dp, tLo, tHi, coverageEps);
      const cc = spanCoverage(dc, tLo, tHi, coverageEps);
      const anchor = pWin.slice(best.i, best.i + best.len).map((t) => t.w).join(' ');
      // ASYMMETRIC: drop each side IFF coverage-certified; keep + flag an out-of-window span. Never drop out-of-window.
      const doPrev = dp.length > 0 && cp.covered;
      const doCurr = dc.length > 0 && cc.covered;
      const spans: SeamSpan[] = [];
      if (dp.length > 0) spans.push(asSpan(dp, 'prev', cp, doPrev ? 'dropped' : 'kept'));
      if (dc.length > 0) spans.push(asSpan(dc, 'curr', cc, doCurr ? 'dropped' : 'kept'));
      const resolution: SeamResolution = doPrev && doCurr ? 'fuzzy_anchor_splice_full' : doPrev || doCurr ? 'asym_splice_partial' : 'kept_both_flag';
      return { trimPrev: doPrev ? dropPrevN : 0, curr: doCurr ? curr.slice(dropCurrN) : curr, metadata: meta(resolution, tLo, tHi, anchor, spans) };
    }
  }

  // 3) no confident bounded anchor -> keep both + flag.
  return { trimPrev: 0, curr, metadata: meta('no_bounded_match', tLo, tHi, null, []) };
}
