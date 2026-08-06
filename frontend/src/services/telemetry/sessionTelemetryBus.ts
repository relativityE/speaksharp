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
 * Clear buffered events only when the bus still belongs to the expected session.
 * This lets short-lived isolated clients discard their own raw evidence without
 * erasing a successor recording that has already rebound the process-wide bus.
 */
export function safeResetSessionTelemetryIfCurrent(
  expectedSessionId: string,
  replacementSessionId = 'unset',
): boolean {
  try {
    const telemetryBus = getSessionTelemetryBus();
    if (telemetryBus.currentSessionId !== expectedSessionId) return false;
    telemetryBus.reset(replacementSessionId);
    return true;
  } catch {
    return false;
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
