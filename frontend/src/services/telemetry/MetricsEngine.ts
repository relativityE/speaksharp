import type { MetricDeriver, MetricProcessor, MetricsSnapshot, MetricsSnapshotPatch, TelemetryBus, TelemetryEvent, TelemetryMode } from './contracts';
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

  /**
   * #891 Phase 5.7: when false, the engine is PROVISIONAL — it captures events of ANY mode (no filter).
   * A session is created provisionally (before the negotiated/actual mode is confirmed) so early fallback-
   * mode events are never dropped; `bindMode(actualMode)` then locks the real mode and activates filtering.
   */
  private modeBound: boolean;

  constructor(
    bus: TelemetryBus,
    private readonly processors: MetricProcessor[],
    private sessionId: string,
    private mode: TelemetryMode,
    private readonly derivers: MetricDeriver[] = [],
    modeBound = true,
  ) {
    this.modeBound = modeBound;
    this.snapshot = createEmptyMetricsSnapshot(sessionId, mode);
    this.unsubscribe = bus.subscribe((event) => this.handleEvent(event));
  }

  private handleEvent(event: TelemetryEvent): void {
    // #891 Phase 5.7: the session telemetry bus is process-wide and shared. Every event carries its
    // producing `mode`; once bound, this engine only composes metrics for ITS mode, so cross-mode events
    // (e.g. a native lifecycle event landing while a private session's engine is alive) are ignored. While
    // still PROVISIONAL (mode not yet confirmed) no event is dropped, so negotiated/fallback-mode events
    // at session start are captured. Covers transcript/audio.frame/session.tick/lifecycle uniformly.
    if (this.modeBound && event.mode !== this.mode) return;
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
    // Tier 1 — event processors, each derives its slice from raw events.
    for (const p of this.processors) {
      let partial: MetricsSnapshotPatch = {};
      try {
        partial = p.getSnapshot() ?? {};
      } catch {
        partial = {};
      }
      merged = mergeMetricsSnapshot(merged, partial);
    }
    // Tier 2 — derivers, each a function of the accumulated snapshot. Order matters: a later deriver
    // (score) sees an earlier one's output (clarity). A throwing deriver is isolated.
    for (const d of this.derivers) {
      let partial: MetricsSnapshotPatch = {};
      try {
        partial = d.derive(merged) ?? {};
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

  /**
   * #891 Phase 5.7: rebind the session identity WITHOUT resetting captured processor state. Used when a
   * session is created early with a provisional id (before the DB id / negotiated mode is known) so no
   * early event is missed — the real id/mode are bound in later without discarding what was captured.
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
    this.snapshot.sessionId = sessionId;
  }

  setMode(mode: TelemetryMode): void {
    this.mode = mode;
    this.snapshot.mode = mode;
  }

  /**
   * #891 Phase 5.7: confirm the ACTUAL negotiated/service mode and ACTIVATE mode filtering. Everything
   * captured while provisional is kept; from here on, cross-mode events are dropped. Idempotent.
   */
  bindMode(mode: TelemetryMode): void {
    this.mode = mode;
    this.snapshot.mode = mode;
    this.modeBound = true;
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
    for (const d of this.derivers) {
      try {
        d.reset(sessionId);
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
