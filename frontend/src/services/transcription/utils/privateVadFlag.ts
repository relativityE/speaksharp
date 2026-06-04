/**
 * Private VAD prototype flag + telemetry contract (Phase 2).
 *
 * The flag is OFF by default. When off, the Private pipeline uses its existing RMS
 * energy gating unchanged. When on, Silero VAD (lazy-loaded `@ricky0123/vad-web`)
 * decides speech onset / silence-end instead of RMS thresholds.
 *
 * Enable for an A/B run via either:
 *   - `window.__PRIVATE_VAD_PROTOTYPE__ = true`
 *   - URL `?privateVad=1`
 *
 * This module is intentionally side-effect-free and dependency-free so it can be
 * imported anywhere (including the worker) without pulling in the Silero runtime.
 */

declare global {
  interface Window {
    __PRIVATE_VAD_PROTOTYPE__?: boolean;
    /** Published per Private session for the RMS-vs-VAD A/B harness (test-only). */
    __PRIVATE_VAD_TELEMETRY__?: PrivateVadTelemetry;
  }
}

/** Telemetry the RMS-vs-VAD A/B reads. Field names are a stable contract for TEST. */
export interface PrivateVadTelemetry {
  /** Whether the VAD prototype path was active for this session. */
  vadEnabled: boolean;
  /** Runtime/model identifiers (so the report records what actually ran). */
  vadModel: string;
  vadRuntime: string;
  /** Resolved version of @ricky0123/vad-web at runtime (null until loaded). */
  vadRuntimeVersion: string | null;
  /** Offset (ms from stream start) at which VAD confirmed speech onset. */
  vadOnsetMs: number | null;
  /** Mean Silero speech probability across processed frames (0..1). */
  vadMeanSpeechProb: number | null;
  /** VAD-decided speech segments [{ startMs, endMs }]. */
  vadSpeechSegments: Array<{ startMs: number; endMs: number }>;
  /** True if Silero failed to load and the pipeline fell back to RMS. */
  vadFellBackToRms: boolean;
}

/** True when the Private VAD prototype is explicitly enabled for this session. */
export function isPrivateVadPrototypeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__PRIVATE_VAD_PROTOTYPE__ === true) return true;
  try {
    return new URLSearchParams(window.location.search).get('privateVad') === '1';
  } catch {
    return false;
  }
}

/** Publish the A/B telemetry snapshot (test-only; no behavior impact). */
export function publishPrivateVadTelemetry(telemetry: PrivateVadTelemetry): void {
  if (typeof window === 'undefined') return;
  window.__PRIVATE_VAD_TELEMETRY__ = telemetry;
}
