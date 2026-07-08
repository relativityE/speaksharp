import type { MetricsSnapshot } from './contracts';
import type { PauseMetrics } from '@/services/audio/pauseDetector';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import { calculateCoreSessionMetrics } from '@/utils/sessionAnalysis';
import { calculateSpeakingScore } from '@/utils/speakingScore';

/**
 * Phase 5.7 — shadow ↔ legacy parity instrumentation.
 *
 * Compares the shadow MetricsSnapshot's derived values against the legacy product calculations for the
 * SAME raw session inputs. This is the evidence gate BEFORE any consumer cutover or duplicate-writer
 * deletion — it does not change behavior and nothing consumes the snapshot.
 *
 * PRIVACY: the report contains NUMBERS ONLY (metric names + values + deltas). No transcript text, no
 * partials, no PII — safe to log or send to analytics.
 */

/** Raw session inputs, exactly as the legacy live/save path reads them from the store. */
export interface LegacyMetricInputs {
  transcript: string;
  elapsedSeconds: number;
  /** The live store filler counts (useFillerWords). Omit/undefined → legacy recounts from the transcript. */
  fillerData?: FillerCounts | null;
  pauseMetrics?: PauseMetrics;
  engine?: string;
  /** Session custom filler words — same basis the snapshot FillerProcessor uses (parity). */
  userWords?: string[];
}

export interface LegacyMetrics {
  wordCount: number;
  wpm: number;
  fillerCount: number;
  clarityScore: number;
  scoreValue: number;
}

export interface ParityField {
  name: 'wordCount' | 'wpm' | 'fillerCount' | 'clarityScore' | 'scoreValue';
  shadow: number;
  legacy: number;
  equal: boolean;
  delta: number;
}

export interface ParityReport {
  fields: ParityField[];
  allEqual: boolean;
  divergentCount: number;
}

/** Compute the legacy product metrics for the given raw inputs (the numbers today's UI/save/PDF use). */
export function computeLegacyMetrics(inputs: LegacyMetricInputs): LegacyMetrics {
  const core = calculateCoreSessionMetrics({
    transcript: inputs.transcript,
    durationSeconds: inputs.elapsedSeconds,
    fillerData: inputs.fillerData ?? undefined,
    userWords: inputs.userWords ?? [],
  });
  const score = calculateSpeakingScore({
    transcript: inputs.transcript,
    wordCount: core.wordCount,
    wpm: core.wpm,
    clarityScore: core.clarityScore,
    fillerCount: core.fillerCount,
    elapsedSeconds: inputs.elapsedSeconds,
    pauseMetrics: inputs.pauseMetrics,
    engine: inputs.engine,
  });
  return {
    wordCount: core.wordCount,
    wpm: core.wpm,
    fillerCount: core.fillerCount,
    clarityScore: core.clarityScore,
    scoreValue: score.score,
  };
}

// Integer metrics compare exactly; the score is a float, so allow a tiny epsilon.
const EPS = 1e-6;
function field(name: ParityField['name'], shadow: number, legacy: number): ParityField {
  const delta = shadow - legacy;
  return { name, shadow, legacy, equal: Math.abs(delta) <= EPS, delta };
}

/** Compare a shadow snapshot's derived metrics against legacy values. Numbers only — no transcript text. */
export function compareSnapshotToLegacy(snapshot: MetricsSnapshot, legacy: LegacyMetrics): ParityReport {
  const fields: ParityField[] = [
    field('wordCount', snapshot.transcript.finalWordCount, legacy.wordCount),
    field('wpm', snapshot.delivery.wpm, legacy.wpm),
    field('fillerCount', snapshot.delivery.fillerCount, legacy.fillerCount),
    field('clarityScore', snapshot.delivery.clarityScore, legacy.clarityScore),
    field('scoreValue', snapshot.score.value, legacy.scoreValue),
  ];
  const divergentCount = fields.filter((f) => !f.equal).length;
  return { fields, allEqual: divergentCount === 0, divergentCount };
}
