/**
 * Word-timing mapping — #891 segmented Private finalization.
 * ============================================================================
 * Maps transformers.js word-level chunks (produced by `return_timestamps: 'word'`) into the
 * reconciler's `TimedToken` shape. Only segment decodes request word timestamps; the whole-utterance
 * path is untouched.
 *
 * Missing or non-finite timestamps map to NaN — deliberately. Whisper assigns garbage / non-monotonic
 * timestamps to boundary hallucinations, and its final word can carry a null end. A NaN timestamp is
 * UNCOVERABLE: the seam coverage check (`ts >= tLo`, `te <= tHi`) is false for NaN, so such a token can
 * never be certified as shared overlap audio — it is kept + flagged, never dropped. We keep the word's
 * text regardless; we never silently drop a token just because its timing is unknown.
 */

import type { TimedToken } from './seamReconciliation';

const finiteOrNaN = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN);

/** Map raw transformers.js `chunks` ([{ text, timestamp: [start, end] }]) to TimedToken[]. */
export function mapWordChunks(chunks: unknown): TimedToken[] {
  if (!Array.isArray(chunks)) return [];
  const out: TimedToken[] = [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') continue;
    const text = (chunk as { text?: unknown }).text;
    if (typeof text !== 'string' || text.trim().length === 0) continue;
    const stamp = (chunk as { timestamp?: unknown }).timestamp;
    const arr = Array.isArray(stamp) ? stamp : [];
    out.push({ w: text.trim(), ts: finiteOrNaN(arr[0]), te: finiteOrNaN(arr[1]) });
  }
  return out;
}
