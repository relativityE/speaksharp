import type { MetricDeriver, MetricsSnapshot, MetricsSnapshotPatch } from '../contracts';
import { calculateSpeakingScore } from '@/utils/speakingScore';

/**
 * Phase 5.5 — ScoreProcessor (shadow, tier-2 deriver).
 *
 * Owns the score section. The SpeakSharp Score is a function of every other derived metric, so it derives
 * from the accumulated base snapshot and reuses the exact pure `calculateSpeakingScore` with the SAME
 * inputs the live LiveCoachingScoreCard assembles (transcript, wordCount, wpm, clarityScore, fillerCount,
 * elapsedSeconds, pauseMetrics, engine) → byte-identical score. Runs after ClarityProcessor so it reads
 * the freshly-derived clarityScore.
 */
export class ScoreProcessor implements MetricDeriver {
  readonly name = 'score';

  derive(base: MetricsSnapshot): MetricsSnapshotPatch {
    const result = calculateSpeakingScore({
      transcript: base.transcript.finalText,
      wordCount: base.transcript.finalWordCount,
      wpm: base.delivery.wpm,
      clarityScore: base.delivery.clarityScore,
      fillerCount: base.delivery.fillerCount,
      elapsedSeconds: base.elapsedSeconds,
      pauseMetrics: base.delivery.pauseMetrics,
      engine: base.mode,
    });
    return {
      score: {
        value: result.score,
        label: result.label,
        confidence: result.confidence,
        breakdown: result.breakdown,
        qualityNote: result.qualityNote,
      },
    };
  }

  reset(): void {
    /* stateless — derives purely from the base snapshot */
  }
}
