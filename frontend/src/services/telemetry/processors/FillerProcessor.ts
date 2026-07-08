import type { MetricProcessor, MetricsSnapshotPatch, TelemetryEvent } from '../contracts';
import { countFillerWords } from '@/utils/fillerWordUtils';
import { countWords } from './textMetrics';

/**
 * Phase 5.3 — FillerProcessor (shadow).
 *
 * Owns delivery.fillerCount + delivery.fillerRate. Reuses the existing pure `countFillerWords`
 * (same patterns as today) so fillerCount is byte-identical; fillerRate mirrors the existing
 * (fillerCount / wordCount) × 100 convention. Single source = only this processor calls it.
 */
export class FillerProcessor implements MetricProcessor {
  readonly name = 'filler';
  private finalText = '';

  onEvent(event: TelemetryEvent): void {
    if (event.type === 'transcript.final') {
      this.finalText = event.replacesRollingTranscript
        ? event.text
        : (this.finalText ? `${this.finalText} ${event.text}`.replace(/\s+/g, ' ').trim() : event.text);
    }
  }

  getSnapshot(): MetricsSnapshotPatch {
    const fillerCount = countFillerWords(this.finalText).total.count;
    const words = countWords(this.finalText);
    const fillerRate = words > 0 ? (fillerCount / words) * 100 : 0;
    return { delivery: { fillerCount, fillerRate } };
  }

  reset(): void {
    this.finalText = '';
  }
}
