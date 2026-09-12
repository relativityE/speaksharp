/**
 * privateV4Telemetry.ts — Stage-B v4 rollout telemetry (lifecycle events).
 *
 * Centralizes the v4 PostHog event NAMES plus a STRICT non-PII property ALLOWLIST.
 * The allowlist is the privacy guarantee: only the enumerated keys are ever sent, so
 * no caller can leak `email`, transcript text, audio, raw stack traces, provider
 * payloads, or Stripe secrets — even by accident. `userId` rides PostHog's
 * `distinct_id` (set via `identify(userId)`); it is NEVER a property here.
 *
 * These events are emitted only when v4 is the selected engine (callers gate on the
 * flag / resolved variant). Emission NEVER throws — telemetry must not affect the
 * transcription path. Analytics leaves through the ONE governed boundary
 * (`AnalyticsBuffer`), never a direct `posthog.capture`; a structured internal log
 * is the module's only other side effect.
 *
 * Stage gating: this is wired into the v4 lifecycle ONLY after v4 lands inert on
 * main (task #84). The module itself is inert until its emitters are called.
 */
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import logger from '@/lib/logger';
import { sanitizeV4TelemetryProps, type V4TelemetryProps } from './privateV4TelemetrySanitizer';

export const V4_TELEMETRY_EVENTS = {
    ATTEMPT: 'private_stt_v4_attempt',
    READY: 'private_stt_v4_ready',
    DECODE_COMPLETE: 'private_stt_v4_decode_complete',
    FALLBACK: 'private_stt_v4_fallback',
    SESSION_SAVED: 'private_stt_v4_session_saved',
    ERROR: 'private_stt_v4_error',
} as const;

export type V4TelemetryEvent = typeof V4_TELEMETRY_EVENTS[keyof typeof V4_TELEMETRY_EVENTS];

// The allowlist and its projection moved to `privateV4TelemetrySanitizer` so the governed capture
// boundary can import them without a cycle. Re-exported here because existing call sites and tests
// import them from this module.
export {
    V4_TELEMETRY_ALLOWED_PROPS,
    isV4TelemetryEvent,
    type V4TelemetryProp,
    type V4TelemetryProps,
} from './privateV4TelemetrySanitizer';
export { sanitizeV4TelemetryProps };

/**
 * Emit a v4 telemetry event with allowlisted props. Never throws. `userId` is NOT a
 * property — PostHog associates the event with the identified user's `distinct_id`.
 */
export function emitV4Telemetry(event: V4TelemetryEvent, props?: Record<string, unknown>): void {
    try {
        // The LOG keeps its local projection: it is a different sink with a different lifetime, and it
        // must stay content-free on its own terms rather than by trusting the analytics path.
        logger.info({ ...sanitizeV4TelemetryProps(props), event }, '[V4_TELEMETRY]');
        // ANALYTICS GOES THROUGH THE ONE BOUNDARY. Not `posthog.capture` — that bypassed the envelope,
        // so these three live events carried no release, no traffic type, no model attribution and no
        // correlation identity, and were invisible to the schema registry. The buffer re-projects
        // `private_stt_v4_*` through this same allowlist at send time, so the projection is applied at
        // the boundary rather than only here, where a caller could skip it.
        analyticsBuffer.push(event, props, 'LOW');
    } catch {
        /* telemetry must never throw into the transcription path */
    }
}

/**
 * Pure mapper: build the allowlisted lifecycle property bag from the v4 runtime
 * decision + outcome. Keeps the call sites thin and testable, and routes through
 * `sanitizeV4TelemetryProps` so only non-PII keys survive. `fallbackAttempted` is
 * derived (true iff a fallback reason is present).
 */
export function buildV4LifecycleProps(input: {
    finalEngine?: string | null;
    variant?: string | null;
    model?: string | null;
    dtype?: string | null;
    requestedDevice?: string | null;
    resolvedDevice?: string | null;
    webgpuAvailable?: boolean;
    fallbackReason?: string | null;
    loadMs?: number | null;
    decodeMs?: number | null;
    rtf?: number | null;
}): V4TelemetryProps {
    // Pass inputs through as-is: sanitize omits `undefined`, keeps `null`/values. The
    // caller decides which fields to force-present (by passing `?? null`); fields it
    // does not know yet (e.g. decodeMs on a ready event) are simply omitted.
    return sanitizeV4TelemetryProps({
        engine: input.finalEngine,
        variant: input.variant,
        model: input.model,
        dtype: input.dtype,
        requestedDevice: input.requestedDevice,
        resolvedDevice: input.resolvedDevice,
        webgpuAvailable: input.webgpuAvailable,
        fallbackAttempted: input.fallbackReason != null,
        fallbackReason: input.fallbackReason,
        loadMs: input.loadMs,
        decodeMs: input.decodeMs,
        rtf: input.rtf,
    });
}

export const emitV4Ready = (props?: Record<string, unknown>): void =>
    emitV4Telemetry(V4_TELEMETRY_EVENTS.READY, props);
export const emitV4DecodeComplete = (props?: Record<string, unknown>): void =>
    emitV4Telemetry(V4_TELEMETRY_EVENTS.DECODE_COMPLETE, props);
export const emitV4Fallback = (props?: Record<string, unknown>): void =>
    emitV4Telemetry(V4_TELEMETRY_EVENTS.FALLBACK, props);
export const emitV4SessionSaved = (props?: Record<string, unknown>): void =>
    emitV4Telemetry(V4_TELEMETRY_EVENTS.SESSION_SAVED, props);
export const emitV4Error = (props?: Record<string, unknown>): void =>
    emitV4Telemetry(V4_TELEMETRY_EVENTS.ERROR, props);
