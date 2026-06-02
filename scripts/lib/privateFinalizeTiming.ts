/**
 * Pure helper to decompose the Private post-Stop finalize wait from the engine's
 * own timeline (`window.__PRIVATE_STT_TIMELINE__`). Harness/data-gathering support
 * only — no runtime behavior, safe to import from proofs and tests.
 *
 * Why: the post-Stop "finalization wait" the harness measures from its own clock
 * is ~98% the whole-utterance model decode (see PRIVATE report, 2026-06-02). The
 * engine already emits the pieces; this maps them to the matrix timing fields so
 * each harness does not re-derive them by hand.
 *
 * Timeline event shape (from PrivateWhisper.pushPrivateTimeline):
 *   { event, createdAt, epochMs, perfMs, payload: {...} }
 * Relevant events:
 *   - 'stop_whole_utterance_decode_start'   -> finalize phase entry (perfMs)
 *   - 'whole_utterance_commit_start'        -> payload.decodeInputDurationMs (perfMs)
 *   - 'whole_utterance_commit_accept'       -> payload.decodeMs (perfMs)
 */
export interface PrivateTimelineEvent {
  event: string;
  createdAt?: string;
  epochMs?: number;
  perfMs?: number;
  payload?: Record<string, unknown>;
}

export interface PrivateFinalizeTiming {
  /** whole_utterance_commit_accept was observed (a real final decode completed). */
  committed: boolean;
  /** Model decode wall-clock for the whole-utterance final pass (decodeMs). */
  finalInferenceDurationMs: number | null;
  /** Audio duration fed to the final decode (ms). */
  decodeInputDurationMs: number | null;
  /** perfMs span from finalize entry (decode_start) to commit_accept. */
  finalizePhaseWallMs: number | null;
  /** perfMs span from commit_start to commit_accept (sanity-check vs decodeMs). */
  decodeWallMs: number | null;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function findLast(timeline: PrivateTimelineEvent[], event: string): PrivateTimelineEvent | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i]?.event === event) return timeline[i];
  }
  return null;
}

// Some emitters flatten payload; read from payload first, then the event root.
function field(ev: PrivateTimelineEvent | null, key: string): unknown {
  if (!ev) return undefined;
  return ev.payload?.[key] ?? (ev as unknown as Record<string, unknown>)[key];
}

/** Derive the finalize decomposition that is computable from the timeline alone. */
export function readPrivateFinalizeTiming(
  timeline: PrivateTimelineEvent[] | null | undefined,
): PrivateFinalizeTiming {
  const tl = Array.isArray(timeline) ? timeline : [];
  const decodeStart = findLast(tl, 'stop_whole_utterance_decode_start');
  const commitStart = findLast(tl, 'whole_utterance_commit_start');
  const commitAccept = findLast(tl, 'whole_utterance_commit_accept');

  const startPerf = num(commitStart?.perfMs);
  const acceptPerf = num(commitAccept?.perfMs);
  const decodeStartPerf = num(decodeStart?.perfMs);

  return {
    committed: commitAccept !== null,
    finalInferenceDurationMs: num(field(commitAccept, 'decodeMs')),
    decodeInputDurationMs: num(field(commitStart, 'decodeInputDurationMs')),
    finalizePhaseWallMs:
      acceptPerf !== null && decodeStartPerf !== null
        ? Number((acceptPerf - decodeStartPerf).toFixed(1))
        : null,
    decodeWallMs:
      acceptPerf !== null && startPerf !== null
        ? Number((acceptPerf - startPerf).toFixed(1))
        : null,
  };
}

export interface FinalizeWaitBreakdown {
  finalizationWaitMs: number;
  /** Model decode portion (≈ the whole wait for long speech). */
  decodeMs: number | null;
  /** finalizationWaitMs − decodeMs: queue + sanitize + store + save. */
  appOverheadMs: number | null;
  /** decodeMs / finalizationWaitMs, 0..1. */
  decodeShare: number | null;
}

/**
 * Combine the harness's own measured `finalizationWaitMs` (Stop → final visible)
 * with the timeline-derived decode time to attribute the wait.
 */
export function decomposeFinalizeWait(
  finalizationWaitMs: number,
  timing: PrivateFinalizeTiming,
): FinalizeWaitBreakdown {
  const decodeMs = timing.finalInferenceDurationMs;
  const appOverheadMs = decodeMs !== null ? Number((finalizationWaitMs - decodeMs).toFixed(1)) : null;
  const decodeShare =
    decodeMs !== null && finalizationWaitMs > 0
      ? Number((decodeMs / finalizationWaitMs).toFixed(3))
      : null;
  return { finalizationWaitMs, decodeMs, appOverheadMs, decodeShare };
}
