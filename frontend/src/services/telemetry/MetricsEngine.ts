import type { MetricProcessor, MetricsSnapshot, MetricsSnapshotPatch, TelemetryBus, TelemetryEvent, TelemetryMode } from './contracts';
import { createEmptyMetricsSnapshot, mergeMetricsSnapshot } from './metricsSnapshot';

/**
 * Phase 5 — Metrics Engine (SKELETON).
 *
 * The ONLY place derived metrics are composed. It subscribes to the Telemetry Bus, fans each raw event
 * to every registered MetricProcessor, then recomposes the canonical MetricsSnapshot by merging each
 * processor's slice. It owns NO scoring/business logic itself — that lives in the processors.
 *
 * SKELETON note: with zero processors it is a pure no-op (empty snapshot), so wiring it up changes no
 * product behavior. Processors are added in subsequent Phase-5 slices, shadow-compared before any UI
 * consumes the snapshot. A throwing processor can never break the engine or the other processors.
 */
export class MetricsEngine {
  private snapshot: MetricsSnapshot;
  private readonly listeners = new Set<(snapshot: MetricsSnapshot) => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    bus: TelemetryBus,
    private readonly processors: MetricProcessor[],
    private sessionId: string,
    private mode: TelemetryMode,
  ) {
    this.snapshot = createEmptyMetricsSnapshot(sessionId, mode);
    this.unsubscribe = bus.subscribe((event) => this.handleEvent(event));
  }

  private handleEvent(event: TelemetryEvent): void {
    for (const p of this.processors) {
      try {
        p.onEvent(event);
      } catch {
        /* a bad processor must never break the engine or the other processors */
      }
    }
    this.recompute(event.t);
  }

  private recompute(updatedAt: number): void {
    let merged = createEmptyMetricsSnapshot(this.sessionId, this.mode);
    for (const p of this.processors) {
      let partial: MetricsSnapshotPatch = {};
      try {
        partial = p.getSnapshot() ?? {};
      } catch {
        partial = {};
      }
      merged = mergeMetricsSnapshot(merged, partial);
    }
    // The engine owns identity + timestamp; processors cannot override them.
    merged.sessionId = this.sessionId;
    merged.mode = this.mode;
    merged.updatedAt = updatedAt;
    this.snapshot = merged;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        /* a bad snapshot subscriber must not break the engine */
      }
    }
  }

  /** Current canonical snapshot. */
  getSnapshot(): MetricsSnapshot {
    return this.snapshot;
  }

  /** Subscribe to snapshot changes. Returns an unsubscribe fn. */
  subscribe(listener: (snapshot: MetricsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Start a new session: reset every processor + the snapshot. Subscribers persist. */
  reset(sessionId: string, mode?: TelemetryMode): void {
    this.sessionId = sessionId;
    if (mode) this.mode = mode;
    for (const p of this.processors) {
      try {
        p.reset(sessionId);
      } catch {
        /* ignore */
      }
    }
    this.snapshot = createEmptyMetricsSnapshot(this.sessionId, this.mode);
    this.emit();
  }

  /** Detach from the bus. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
  }
}
