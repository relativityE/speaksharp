import { ENV } from '@/config/TestFlags';
import { MetricsEngine } from './MetricsEngine';
import { getSessionTelemetryBus } from './sessionTelemetryBus';
import type { TelemetryMode } from './contracts';
import { TranscriptProcessor } from './processors/TranscriptProcessor';
import { NativeLifecycleProcessor } from './processors/NativeLifecycleProcessor';
import { FillerProcessor } from './processors/FillerProcessor';
import { PaceProcessor } from './processors/PaceProcessor';
import { PauseProcessor } from './processors/PauseProcessor';
import { AudioQualityProcessor } from './processors/AudioQualityProcessor';
import { SessionProcessor } from './processors/SessionProcessor';
import { ClarityProcessor } from './processors/ClarityProcessor';
import { ScoreProcessor } from './processors/ScoreProcessor';

/**
 * Phase 5.6 — shadow MetricsEngine wiring gate.
 *
 * OFF in production (only DEV builds / tests). When enabled, an engine subscribes to the session
 * telemetry bus and composes the shadow snapshot from live events; NOTHING consumes that snapshot
 * (no UI/analytics/score/PDF cutover). High-volume `audio.frame` publishing is gated on the SAME flag
 * so production pays zero cost. Low-volume transcript/session.tick events stay additive (like the
 * existing Native transcript publishing) and are harmless with no subscriber.
 */
export function isShadowMetricsEngineEnabled(): boolean {
  return import.meta.env.DEV === true || ENV.isTest;
}

/** Map the app's TranscriptionMode-ish value to a bus TelemetryMode, or null if not a real engine mode. */
export function toTelemetryMode(mode: string | null | undefined): TelemetryMode | null {
  return mode === 'native' || mode === 'private' || mode === 'cloud' ? mode : null;
}

/**
 * Build the full-stack shadow engine (all tier-1 processors + tier-2 derivers), subscribed to the
 * session bus. Returns null in production so callers do no work. Caller owns dispose().
 */
export function createShadowMetricsEngine(sessionId: string, mode: TelemetryMode): MetricsEngine | null {
  if (!isShadowMetricsEngineEnabled()) return null;
  return new MetricsEngine(
    getSessionTelemetryBus(),
    [
      new TranscriptProcessor(),
      new NativeLifecycleProcessor(),
      new FillerProcessor(),
      new PaceProcessor(),
      new PauseProcessor(),
      new AudioQualityProcessor(),
      new SessionProcessor(),
    ],
    sessionId,
    mode,
    [new ClarityProcessor(), new ScoreProcessor()],
  );
}
