/**
 * #892 transcript-fidelity contract (engine-version agnostic).
 *
 * Replaces the old one-keyword-anywhere release gate. A saved Private/Cloud transcript is acceptable
 * only when (a) an OPENING ANCHOR appears near the start (so a clipped opening clause — the #891
 * manual failure — fails loudly) AND (b) it covers enough of the fixture's expected phrases (so a
 * truncated/degraded transcript fails). It normalizes text and matches phrase anchors, so it is NOT
 * brittle to punctuation/casing and does NOT require a perfect transcript. It reads the persisted
 * text only, so it passes for ANY engine that produces an acceptable final transcript and fails for
 * any engine that clips the opening.
 */

export function normalizeForFidelity(text: string | null | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // drop punctuation; keep word boundaries
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TranscriptFidelitySpec {
  /** At least one must appear within the first `openingWithinWords` normalized words. */
  openingAnchors: string[];
  openingWithinWords: number;
  /** At least `minCoverage` must appear anywhere in the normalized transcript. */
  coverageAnchors: string[];
  minCoverage: number;
}

export interface TranscriptFidelityResult {
  ok: boolean;
  openingFound: boolean;
  coverageHits: string[];
  firstWords: string;
  reasons: string[];
}

export function evaluateTranscriptFidelity(
  text: string | null | undefined,
  spec: TranscriptFidelitySpec,
): TranscriptFidelityResult {
  const normalized = normalizeForFidelity(text);
  const words = normalized.length > 0 ? normalized.split(' ') : [];
  const head = words.slice(0, spec.openingWithinWords).join(' ');

  const openingFound = spec.openingAnchors.some((a) => head.includes(normalizeForFidelity(a)));
  const coverageHits = spec.coverageAnchors.filter((a) => normalized.includes(normalizeForFidelity(a)));

  const reasons: string[] = [];
  if (!openingFound) {
    reasons.push(`opening anchor [${spec.openingAnchors.join(', ')}] not within first ${spec.openingWithinWords} words (head="${head}")`);
  }
  if (coverageHits.length < spec.minCoverage) {
    reasons.push(`coverage ${coverageHits.length}/${spec.minCoverage} (hits: ${coverageHits.join(', ') || 'none'})`);
  }

  return {
    ok: openingFound && coverageHits.length >= spec.minCoverage,
    openingFound,
    coverageHits,
    firstWords: head,
    reasons,
  };
}

/**
 * Harvard benchmark fixture spec. The fixture's clean transcription opens "The stale smell of old
 * beer lingers…"; `stale` is the first content word, so a clipped opening drops it from the head.
 * Coverage anchors are the known fixture vocabulary (a short live recording reaches the early
 * phrases). minCoverage=3 is well above the old "1 keyword anywhere" without demanding a perfect
 * transcript. CALIBRATION NOTE: anchors verified against observed live Cloud/Private transcripts of
 * this fixture; the live re-gate confirms end-to-end.
 */
export const HARVARD_FIXTURE_FIDELITY: TranscriptFidelitySpec = {
  openingAnchors: ['stale'],
  openingWithinWords: 12,
  coverageAnchors: ['stale', 'beer', 'pepper', 'beef', 'swan', 'park', 'twister', 'wild', 'puppy', 'quick', 'brown', 'fox'],
  minCoverage: 3,
};
