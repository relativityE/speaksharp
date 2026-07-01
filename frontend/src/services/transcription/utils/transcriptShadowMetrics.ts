/**
 * Transcript shadow metrics — #891 segmented finalization (shadow comparison).
 * ============================================================================
 * SAFE, TEXT-FREE comparison of the ASSEMBLED segmented transcript against the canonical
 * whole-utterance transcript. Returns ONLY summary numbers (counts, delta, a 0..1 similarity score) —
 * never the transcript text — so the segmented path's cutover-readiness can be measured in telemetry
 * without logging private speech content.
 *
 * `similarity` is the Sørensen–Dice coefficient over normalized word MULTISETS: 2·|A∩B| / (|A|+|B|).
 * 1.0 = identical word bags; lower = divergence (missing/extra/altered words). A multiset (not set)
 * so repeated words and duplication at seams are reflected, not collapsed.
 */

export interface ShadowComparison {
  readonly assembledTokenCount: number;
  readonly wholeUtteranceTokenCount: number;
  /** assembled − whole-utterance (positive = segmented produced more words). */
  readonly tokenCountDelta: number;
  /** Sørensen–Dice similarity over normalized word multisets, 0..1 (1 = identical bag of words). */
  readonly similarity: number;
}

const normalize = (w: string): string => w.toLowerCase().replace(/[^a-z0-9']/g, '');

const tokenize = (text: string): string[] =>
  text.split(/\s+/).map(normalize).filter((w) => w.length > 0);

function multisetDice(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const countA = new Map<string, number>();
  for (const w of a) countA.set(w, (countA.get(w) ?? 0) + 1);
  let intersection = 0;
  const countB = new Map<string, number>();
  for (const w of b) countB.set(w, (countB.get(w) ?? 0) + 1);
  for (const [w, ca] of countA) intersection += Math.min(ca, countB.get(w) ?? 0);
  return (2 * intersection) / (a.length + b.length);
}

/** Compare assembled vs whole-utterance transcripts. Pure; returns counts + a similarity score only. */
export function compareTranscripts(assembled: string, wholeUtterance: string): ShadowComparison {
  const a = tokenize(assembled);
  const w = tokenize(wholeUtterance);
  return {
    assembledTokenCount: a.length,
    wholeUtteranceTokenCount: w.length,
    tokenCountDelta: a.length - w.length,
    similarity: Number(multisetDice(a, w).toFixed(4)),
  };
}
