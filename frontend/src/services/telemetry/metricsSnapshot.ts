import type { MetricsSnapshot, MetricsSnapshotPatch, TelemetryMode } from './contracts';

/** Complete zero-value audio section — used to backfill required fields when a processor patches only some. */
const EMPTY_AUDIO: NonNullable<MetricsSnapshot['audio']> = {
  rms: 0,
  peak: 0,
  micLevel: 0,
  clipping: false,
  lowVolume: false,
  noiseWarning: false,
};

/**
 * Phase 5 — canonical MetricsSnapshot factory + merge.
 *
 * The Metrics Engine composes one snapshot from many processors, each contributing a
 * Partial<MetricsSnapshot>. These helpers give a complete zero-value base and a deterministic,
 * section-aware merge so processors can own disjoint slices without clobbering each other.
 */
export function createEmptyMetricsSnapshot(sessionId: string, mode: TelemetryMode): MetricsSnapshot {
  return {
    sessionId,
    mode,
    updatedAt: 0,
    elapsedSeconds: 0,
    transcript: {
      finalText: '',
      interimText: '',
      wordCount: 0,
      finalWordCount: 0,
      partialWordCount: 0,
      maxRunOnWords: 0,
      confidence: 'low',
      trusted: false,
    },
    delivery: {
      wpm: 0,
      fillerCount: 0,
      fillerRate: 0,
      clarityScore: 0,
    },
    engine: {
      resultCount: 0,
      finalCount: 0,
      interimCount: 0,
      errorCount: 0,
      restartCount: 0,
    },
    score: {
      value: 0,
      label: '',
      confidence: 'warming-up',
      breakdown: {
        messageStructure: 0,
        deliveryControl: 0,
        languageClarity: 0,
        audienceImpact: 0,
      },
      qualityNote: null,
    },
  };
}

/**
 * Section-aware merge of a processor's partial into a base snapshot. Nested sections are shallow-merged
 * so a processor that owns (say) only `delivery.wpm` does not blank the rest of `delivery`.
 */
export function mergeMetricsSnapshot(base: MetricsSnapshot, partial: MetricsSnapshotPatch): MetricsSnapshot {
  return {
    ...base,
    ...partial,
    transcript: { ...base.transcript, ...partial.transcript },
    delivery: {
      ...base.delivery,
      ...partial.delivery,
      // pauseMetrics is an optional nested object — take the incoming one whole if present.
      pauseMetrics: partial.delivery?.pauseMetrics ?? base.delivery.pauseMetrics,
    },
    engine: { ...base.engine, ...partial.engine },
    // audio is optional + all-required-fields: backfill from EMPTY_AUDIO so a partial patch still yields a complete section.
    audio: partial.audio || base.audio ? { ...EMPTY_AUDIO, ...base.audio, ...partial.audio } : undefined,
    score: {
      ...base.score,
      ...partial.score,
      breakdown: { ...base.score.breakdown, ...partial.score?.breakdown },
    },
  };
}
