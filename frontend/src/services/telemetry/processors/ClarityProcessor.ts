import type { MetricDeriver, MetricsSnapshot, MetricsSnapshotPatch } from '../contracts';
import { calculateClarityScore, countErrorMarkers, ANALYTICS_THRESHOLDS } from '@/utils/sessionAnalysis';

/**
 * Phase 5.5 — ClarityProcessor (shadow, tier-2 deriver).
 *
 * Owns delivery.clarityScore. Clarity is a function of OTHER derived metrics (word count, filler count,
 * error markers, wpm), so it derives from the accumulated base snapshot and reuses the exact pure
 * `calculateClarityScore` — byte-identical to the legacy value. Below the reliable-scoring word floor it
 * yields 0, matching `calculateCoreSessionMetrics` (isClarityScorable gate).
 */
export class ClarityProcessor implements MetricDeriver {
  readonly name = 'clarity';

  derive(base: MetricsSnapshot): MetricsSnapshotPatch {
    // Committed-transcript basis (matches the legacy metrics + the persisted save path); interim excluded.
    const wordCount = base.transcript.finalWordCount;
    if (wordCount < ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS) {
      return { delivery: { clarityScore: 0 } };
    }
    const clarityScore = calculateClarityScore({
      wordCount,
      fillerCount: base.delivery.fillerCount,
      errorCount: countErrorMarkers(base.transcript.finalText),
      wpm: base.delivery.wpm,
    });
    return { delivery: { clarityScore } };
  }

  reset(): void {
    /* stateless — derives purely from the base snapshot */
  }
}
