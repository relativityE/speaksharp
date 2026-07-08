import type { MetricProcessor, MetricsSnapshotPatch, TelemetryEvent } from '../contracts';
import { PauseDetector } from '@/services/audio/pauseDetector';

/**
 * Phase 5.4 — PauseProcessor (shadow).
 *
 * Owns delivery.pauseMetrics. Consumes `audio.frame` events (app-mic modes: private/cloud) and runs the
 * exact same `PauseDetector` the live `useVocalAnalysis` hook uses, driven by the event timestamp so the
 * result is deterministic and byte-identical to legacy for the same frame stream. Native emits no
 * production audio frames by default, so for Native this stays at the zero-value pause metrics.
 */
export class PauseProcessor implements MetricProcessor {
  readonly name = 'pause';
  private detector: PauseDetector | null = null;
  private lastT = 0;

  onEvent(event: TelemetryEvent): void {
    if (event.type !== 'audio.frame') return;
    if (this.detector === null) {
      // Anchor the detector's session clock to the first frame's timestamp.
      this.detector = new PauseDetector(undefined, undefined, event.t);
    }
    this.detector.processAudioFrame(event.frame, event.t);
    this.lastT = event.t;
  }

  getSnapshot(): MetricsSnapshotPatch {
    if (this.detector === null) return {};
    return { delivery: { pauseMetrics: this.detector.getMetrics(this.lastT) } };
  }

  reset(): void {
    this.detector = null;
    this.lastT = 0;
  }
}
