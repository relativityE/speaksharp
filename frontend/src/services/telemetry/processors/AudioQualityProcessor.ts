import type { MetricProcessor, MetricsSnapshotPatch, TelemetryEvent } from '../contracts';
import { AudioQualityAnalyzer } from '@/services/audio/audioQualityAnalyzer';

/**
 * Phase 5.4 — AudioQualityProcessor (shadow).
 *
 * Owns the optional `audio` snapshot section (rms/peak/micLevel/clipping/lowVolume/noiseWarning) for
 * app-mic modes (private/cloud). Consumes `audio.frame` events and runs the headless
 * `AudioQualityAnalyzer` (a deterministic mirror of the live mic-quality checks in useVocalAnalysis).
 *
 * This is a diagnostic surface, NOT a scored/persisted metric: the live `micWarning` UX string stays
 * owned by useVocalAnalysis. Native emits no production audio frames, so it contributes no audio section.
 */
export class AudioQualityProcessor implements MetricProcessor {
  readonly name = 'audioQuality';
  private analyzer: AudioQualityAnalyzer | null = null;
  private lastT = 0;

  constructor(private readonly sessionStartT?: number) {}

  onEvent(event: TelemetryEvent): void {
    if (event.type !== 'audio.frame') return;
    if (this.analyzer === null) {
      this.analyzer = new AudioQualityAnalyzer(this.sessionStartT ?? event.t);
    }
    this.analyzer.processFrame(event.frame, event.t);
    this.lastT = event.t;
  }

  getSnapshot(): MetricsSnapshotPatch {
    if (this.analyzer === null) return {};
    const s = this.analyzer.getSample(this.lastT);
    return {
      audio: {
        rms: s.rms,
        peak: s.peak,
        micLevel: s.micLevel,
        clipping: s.clipping,
        lowVolume: s.lowVolume,
        noiseWarning: s.noiseWarning,
      },
    };
  }

  reset(): void {
    this.analyzer = null;
    this.lastT = 0;
  }
}
