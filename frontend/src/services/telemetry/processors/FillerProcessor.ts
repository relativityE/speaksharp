import type { MetricProcessor, MetricsSnapshotPatch, TelemetryEvent } from '../contracts';
import { countFillerWords } from '@/utils/fillerWordUtils';
import { appendCommittedFinal, countWords } from './textMetrics';

/**
 * Phase 5.3/5.7 — FillerProcessor (shadow).
 *
 * Owns delivery.fillerCount + delivery.fillerRate. Reuses the existing pure `countFillerWords` WITH the
 * session's custom filler words (`userWords`) so the count matches the live/save paths, which also honor
 * user words. fillerRate mirrors the existing (fillerCount / wordCount) × 100 convention.
 */
export class FillerProcessor implements MetricProcessor {
  readonly name = 'filler';
  private finalText = '';

  constructor(private readonly userWords: string[] = []) {}

  onEvent(event: TelemetryEvent): void {
    if (event.type === 'transcript.final') {
      this.finalText = appendCommittedFinal(this.finalText, event.text, event.replacesRollingTranscript);
    }
  }

  getSnapshot(): MetricsSnapshotPatch {
    const fillerCount = countFillerWords(this.finalText, this.userWords).total.count;
    const words = countWords(this.finalText);
    const fillerRate = words > 0 ? (fillerCount / words) * 100 : 0;
    return { delivery: { fillerCount, fillerRate } };
  }

  reset(): void {
    this.finalText = '';
  }
}
