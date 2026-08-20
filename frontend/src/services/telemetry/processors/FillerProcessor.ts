import type { MetricProcessor, MetricsSnapshotPatch, TelemetryEvent } from '../contracts';
import { countFillerWords } from '@/utils/fillerWordUtils';
import { countedFillerTotal } from '@/utils/fillerTiers';
import { appendCommittedFinal, countWords } from './textMetrics';

/**
 * Phase 5.3/5.7 — FillerProcessor (shadow).
 *
 * Owns delivery.fillerCount + delivery.fillerRate. Reuses the existing pure `countFillerWords` WITH the
 * session's custom filler words (`userWords`) so the count matches the live/save paths, which also honor
 * user words. fillerRate mirrors the existing (fillerCount / wordCount) × 100 convention.
 *
 * #1231 slice 2: the headline is the TRUE-filler tier (um/uh/ah + the user's custom words), derived from the
 * per-key breakdown — the SAME re-tier the legacy metrics path (`calculateCoreSessionMetrics`) now applies.
 * Keeping both on `countedFillerTotal` preserves the #1052 shadow↔legacy parity contract byte-for-byte.
 * (The discourse-marker opt-in is a read-time display preference; the shadow uses the default tier, which is
 * what the parity comparison runs against.)
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
    const fillerData = countFillerWords(this.finalText, this.userWords);
    const fillerCount = countedFillerTotal(fillerData, { userWords: this.userWords }) ?? fillerData.total.count;
    const words = countWords(this.finalText);
    const fillerRate = words > 0 ? (fillerCount / words) * 100 : 0;
    return { delivery: { fillerCount, fillerRate } };
  }

  reset(): void {
    this.finalText = '';
  }
}
