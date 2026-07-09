import { InMemoryTelemetryBus } from './TelemetryBus';
import type { TelemetryEvent } from './contracts';

/**
 * Process-wide session Telemetry Bus (Phase 2 — SHADOW). One instance, reset at each session start.
 * In the shadow phase emitters publish here but NOTHING consumes it for UI/metrics yet, so it cannot
 * change behavior. Lazy so it is SSR-safe.
 */
let bus: InMemoryTelemetryBus | null = null;

export function getSessionTelemetryBus(): InMemoryTelemetryBus {
  if (!bus) bus = new InMemoryTelemetryBus();
  return bus;
}

export function resetSessionTelemetry(sessionId: string): void {
  getSessionTelemetryBus().reset(sessionId);
}

/**
 * Error-swallowing session reset — the Phase 2 guarantee is that shadow telemetry can NEVER affect
 * production behavior. Call sites in the production path (e.g. Native onStart) must use this, not the
 * raw resetSessionTelemetry.
 */
export function safeResetSessionTelemetry(sessionId: string): void {
  try {
    resetSessionTelemetry(sessionId);
  } catch {
    /* shadow telemetry must never affect production behavior */
  }
}

/**
 * Safe shadow-publish entry point for emitters. Swallows ALL errors so shadow telemetry can never
 * affect the production transcript/audio path. This is the only call sites should use during the
 * shadow phase.
 */
export function publishTelemetry(event: TelemetryEvent): void {
  try {
    getSessionTelemetryBus().publish(event);
  } catch {
    /* shadow telemetry must never affect production behavior */
  }
}

/** Test-only: drop the singleton so tests start clean. */
export function __resetSessionTelemetryBusForTests(): void {
  bus = null;
}
