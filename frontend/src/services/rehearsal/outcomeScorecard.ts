/**
 * Executive Outcome Rehearsal — post-session Outcome Scorecard: coverage + attributable evidence.
 *
 * This module computes talking-point COVERAGE (Covered / Partially covered / Missing) and, for every
 * result, the supporting transcript EVIDENCE (an exact quote + its timestamp) using a purely LOCAL,
 * deterministic keyword-overlap heuristic. It performs NO network I/O and sends NO transcript or brief
 * text to any cloud service.
 *
 * Why local-first: the rehearsal must work in Private mode without breaking the "audio + text stays
 * local" guarantee, and every coverage result must be backed by attributable transcript evidence.
 * Optional semantic (LLM) refinement is a SEPARATE, consent-gated, default-OFF capability layered on
 * top of this — it must never be the source of a coverage result that lacks a local transcript quote.
 *
 * This module deliberately does NOT compute or touch the SpeakSharp Score; the Outcome Scorecard is a
 * separate assessment.
 */

export type CoverageStatus = 'covered' | 'partial' | 'missing';

export interface CoverageEvidence {
  /** Exact transcript quote supporting the coverage result. */
  quote: string;
  /** Timestamp (seconds from session start) of the supporting segment. */
  timestampSec: number;
}

export interface TalkingPointCoverage {
  /** The brief talking point being assessed. */
  point: string;
  status: CoverageStatus;
  /** Present for 'covered' and 'partial'; absent for 'missing'. Never fabricated. */
  evidence?: CoverageEvidence;
  /** Fraction of the point's keywords found in the best-matching segment (0..1), for transparency. */
  matchRatio: number;
}

/** A timestamped transcript segment (adapter layer maps real session chunks to this shape). */
export interface TranscriptSegment {
  text: string;
  startSec: number;
}

// Small, conservative English stopword set — keeps keyword overlap meaningful without a dependency.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its',
  'we', 'our', 'you', 'your', 'i', 'me', 'my', 'they', 'them', 'their', 'as', 'so', 'if', 'then',
  'will', 'would', 'can', 'could', 'should', 'about', 'into', 'over', 'than', 'too', 'very', 'just',
]);

// INTERNAL, non-authoritative thresholds for the deterministic keyword-overlap evidence heuristic.
// These are NOT a validated user score and are NOT surfaced to testers as authoritative scoring — the
// heuristic only proposes where transcript evidence exists; semantic validation is a separate, gated
// future step. `matchRatio` is likewise an internal transparency value, not a user-facing grade.
const COVERED_RATIO = 0.7; // >= 70% of a point's keywords co-occur in one segment => Covered (evidence-strong).
const PARTIAL_RATIO = 0.34; // >= ~1/3 => Partial (some evidence).

/** Extract significant, de-duplicated lowercase keywords from a talking point. */
export function extractKeywords(point: string): string[] {
  const tokens = (point.toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return Array.from(new Set(tokens));
}

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9']+/g) ?? []);
}

/**
 * Map each talking point to a coverage status with attributable evidence, using local keyword
 * overlap only. Deterministic and side-effect-free. When a point has no usable keywords (e.g. all
 * stopwords), it is reported 'missing' with matchRatio 0 rather than guessed.
 */
export function mapTalkingPointCoverage(
  talkingPoints: string[],
  segments: TranscriptSegment[],
): TalkingPointCoverage[] {
  const preppedSegments = segments
    .filter((s) => typeof s?.text === 'string' && s.text.trim().length > 0)
    .map((s) => ({ ...s, tokens: tokenSet(s.text) }));

  return talkingPoints.map((point) => {
    const keywords = extractKeywords(point);
    if (keywords.length === 0) {
      return { point, status: 'missing' as const, matchRatio: 0 };
    }

    let best: { ratio: number; segment: TranscriptSegment } | null = null;
    for (const seg of preppedSegments) {
      const hits = keywords.reduce((n, kw) => (seg.tokens.has(kw) ? n + 1 : n), 0);
      const ratio = hits / keywords.length;
      if (!best || ratio > best.ratio) best = { ratio, segment: { text: seg.text, startSec: seg.startSec } };
    }

    const ratio = best?.ratio ?? 0;
    let status: CoverageStatus = 'missing';
    if (ratio >= COVERED_RATIO) status = 'covered';
    else if (ratio >= PARTIAL_RATIO) status = 'partial';

    if (status === 'missing' || !best) {
      return { point, status: 'missing' as const, matchRatio: ratio };
    }
    return {
      point,
      status,
      matchRatio: ratio,
      evidence: { quote: best.segment.text.trim(), timestampSec: best.segment.startSec },
    };
  });
}

/** Convenience roll-up for the scorecard header. */
export function summarizeCoverage(results: TalkingPointCoverage[]): {
  covered: number;
  partial: number;
  missing: number;
  total: number;
} {
  return {
    covered: results.filter((r) => r.status === 'covered').length,
    partial: results.filter((r) => r.status === 'partial').length,
    missing: results.filter((r) => r.status === 'missing').length,
    total: results.length,
  };
}
