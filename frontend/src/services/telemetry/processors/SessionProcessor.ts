import type { MetricProcessor, MetricsSnapshotPatch, TelemetryEvent } from '../contracts';

/**
 * Phase 5.5 — SessionProcessor (shadow, tier-1).
 *
 * Publishes the authoritative session duration into the snapshot from `session.tick` events, so tier-2
 * derivers (clarity, score) share the exact elapsedSeconds basis the legacy elapsedTime timer uses.
 */
export class SessionProcessor implements MetricProcessor {
  readonly name = 'session';
  private elapsedSeconds = 0;
  private seen = false;

  onEvent(event: TelemetryEvent): void {
    if (event.type === 'session.tick') {
      this.elapsedSeconds = event.elapsedSeconds;
      this.seen = true;
    }
  }

  getSnapshot(): MetricsSnapshotPatch {
    if (!this.seen) return {};
    return { elapsedSeconds: this.elapsedSeconds };
  }

  reset(): void {
    this.elapsedSeconds = 0;
    this.seen = false;
  }
}
