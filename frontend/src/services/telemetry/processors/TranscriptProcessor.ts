import type { MetricProcessor, MetricsSnapshot, TelemetryEvent } from '../contracts';
import { appendCommittedFinal, countWords, maxRunOnWords, transcriptConfidence } from './textMetrics';

/**
 * Phase 5.2 — TranscriptProcessor.
 *
 * Owns the `transcript` slice of the MetricsSnapshot, derived purely from transcript.partial /
 * transcript.final events. Mirrors the existing append-only model: a final with
 * `replacesRollingTranscript` IS the accumulated final transcript; a final clears the pending interim.
 * No scoring, no engine counts — those belong to other processors.
 */
export class TranscriptProcessor implements MetricProcessor {
  readonly name = 'transcript';
  private finalText = '';
  private interimText = '';

  onEvent(event: TelemetryEvent): void {
    if (event.type === 'transcript.final') {
      this.finalText = appendCommittedFinal(this.finalText, event.text, event.replacesRollingTranscript);
      this.interimText = ''; // a committed final supersedes the pending interim window
    } else if (event.type === 'transcript.partial') {
      this.interimText = event.text;
    }
  }

  getSnapshot(): Partial<MetricsSnapshot> {
    const finalWordCount = countWords(this.finalText);
    const partialWordCount = countWords(this.interimText);
    return {
      transcript: {
        finalText: this.finalText,
        interimText: this.interimText,
        wordCount: finalWordCount + partialWordCount,
        finalWordCount,
        partialWordCount,
        maxRunOnWords: maxRunOnWords(this.finalText),
        confidence: transcriptConfidence(finalWordCount),
        trusted: finalWordCount > 0,
      },
    };
  }

  reset(): void {
    this.finalText = '';
    this.interimText = '';
  }
}
