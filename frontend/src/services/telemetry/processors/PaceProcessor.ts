import type { MetricProcessor, MetricsSnapshotPatch, TelemetryEvent } from '../contracts';
import { calculateWpm } from '@/utils/sessionAnalysis';
import { countWords } from './textMetrics';

/**
 * Phase 5.3 — PaceProcessor (shadow).
 *
 * Owns delivery.wpm. Reuses the existing pure `calculateWpm` (words ÷ seconds × 60) so the snapshot
 * value is byte-identical to today's number — the "single source" comes from ONLY this processor
 * calling it once, not from a new formula. Word count uses the app-wide convention.
 */
export class PaceProcessor implements MetricProcessor {
  readonly name = 'pace';
  private finalText = '';
  private firstT: number | null = null;
  private lastT: number | null = null;

  onEvent(event: TelemetryEvent): void {
    if (this.firstT === null) this.firstT = event.t;
    this.lastT = event.t;
    if (event.type === 'transcript.final') {
      this.finalText = event.replacesRollingTranscript
        ? event.text
        : (this.finalText ? `${this.finalText} ${event.text}`.replace(/\s+/g, ' ').trim() : event.text);
    }
  }

  getSnapshot(): MetricsSnapshotPatch {
    const durationSeconds = this.firstT !== null && this.lastT !== null ? (this.lastT - this.firstT) / 1000 : 0;
    return { delivery: { wpm: calculateWpm(countWords(this.finalText), durationSeconds) } };
  }

  reset(): void {
    this.finalText = '';
    this.firstT = null;
    this.lastT = null;
  }
}
