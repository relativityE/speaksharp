import type { MetricProcessor, MetricsSnapshotPatch, TelemetryEvent } from '../contracts';
import { PauseDetector } from '@/services/audio/pauseDetector';

/**
 * Phase 5.4/5.7 — PauseProcessor (shadow).
 *
 * Owns delivery.pauseMetrics. Consumes `audio.frame` events (app-mic modes: private/cloud) and runs the
 * exact same `PauseDetector` the live `useVocalAnalysis` hook uses, driven by the event timestamp so the
 * result is deterministic and byte-identical to legacy for the same frame stream. Native emits no
 * production audio frames by default, so for Native this stays at the zero-value pause metrics.
 *
 * #5.7 timing parity: the detector's session clock is anchored to the SESSION/recording start
 * (`sessionStartT`, when the shadow engine was created — the analog of when legacy useVocalAnalysis
 * constructs its detector), NOT the first frame. A delayed first frame (mic warm-up) must not shrink the
 * session window and inflate pausesPerMinute/silencePercentage. Falls back to the first frame timestamp
 * only when no session start is provided (pure-shadow unit tests).
 */
export class PauseProcessor implements MetricProcessor {
  readonly name = 'pause';
  private detector: PauseDetector | null = null;
  private lastT = 0;

  constructor(private readonly sessionStartT?: number) {}

  onEvent(event: TelemetryEvent): void {
    if (event.type !== 'audio.frame') return;
    if (this.detector === null) {
      this.detector = new PauseDetector(undefined, undefined, this.sessionStartT ?? event.t);
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
