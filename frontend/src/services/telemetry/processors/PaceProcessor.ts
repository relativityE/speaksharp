import type { MetricProcessor, MetricsSnapshotPatch, TelemetryEvent } from '../contracts';
import { calculateWpm } from '@/utils/sessionAnalysis';
import { appendCommittedFinal, countWords } from './textMetrics';

/**
 * Phase 5.3/5.5 — PaceProcessor (shadow).
 *
 * Owns delivery.wpm. Reuses the existing pure `calculateWpm` (words ÷ seconds × 60) so the snapshot
 * value is byte-identical to today's number. Duration is the authoritative session clock from
 * `session.tick` (matching the legacy elapsedTime basis); before any tick arrives it falls back to the
 * transcript event-timestamp span so pure-shadow runs still produce a sensible value.
 */
export class PaceProcessor implements MetricProcessor {
  readonly name = 'pace';
  private finalText = '';
  private firstT: number | null = null;
  private lastT: number | null = null;
  private elapsedSeconds: number | null = null;

  onEvent(event: TelemetryEvent): void {
    if (this.firstT === null) this.firstT = event.t;
    this.lastT = event.t;
    if (event.type === 'session.tick') {
      this.elapsedSeconds = event.elapsedSeconds;
    } else if (event.type === 'transcript.final') {
      this.finalText = appendCommittedFinal(this.finalText, event.text, event.replacesRollingTranscript);
    }
  }

  getSnapshot(): MetricsSnapshotPatch {
    const durationSeconds = this.elapsedSeconds !== null
      ? this.elapsedSeconds
      : this.firstT !== null && this.lastT !== null ? (this.lastT - this.firstT) / 1000 : 0;
    return { delivery: { wpm: calculateWpm(countWords(this.finalText), durationSeconds) } };
  }

  reset(): void {
    this.finalText = '';
    this.firstT = null;
    this.lastT = null;
    this.elapsedSeconds = null;
  }
}
