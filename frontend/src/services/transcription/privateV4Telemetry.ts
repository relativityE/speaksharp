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
 * transcription path. This module has no side effects beyond an optional
 * `posthog.capture` + a structured internal log.
 *
 * Stage gating: this is wired into the v4 lifecycle ONLY after v4 lands inert on
 * main (task #84). The module itself is inert until its emitters are called.
 */
import posthog from 'posthog-js';
import logger from '@/lib/logger';

export const V4_TELEMETRY_EVENTS = {
    ATTEMPT: 'private_stt_v4_attempt',
    READY: 'private_stt_v4_ready',
    DECODE_COMPLETE: 'private_stt_v4_decode_complete',
    FALLBACK: 'private_stt_v4_fallback',
    SESSION_SAVED: 'private_stt_v4_session_saved',
    ERROR: 'private_stt_v4_error',
} as const;

export type V4TelemetryEvent = typeof V4_TELEMETRY_EVENTS[keyof typeof V4_TELEMETRY_EVENTS];

/**
 * The ONLY property keys allowed to leave the client. Every key here is non-PII
 * engineering/outcome metadata. Anything not in this list is dropped by
 * `sanitizeV4TelemetryProps` before it can reach PostHog or the logs.
 */
export const V4_TELEMETRY_ALLOWED_PROPS = [
    'engine',
    'variant',
    'model',
    'dtype',
    'requestedDevice',
    'resolvedDevice',
    'webgpuAvailable',
    'fallbackAttempted',
    'fallbackReason',
    'loadMs',
    'decodeMs',
    'rtf',
    'recordStarted',
    'stopSucceeded',
    'saved',
    'historyOpened',
    'errorClass',
] as const;

export type V4TelemetryProp = typeof V4_TELEMETRY_ALLOWED_PROPS[number];
export type V4TelemetryProps = Partial<Record<V4TelemetryProp, string | number | boolean | null>>;

const ALLOWED = new Set<string>(V4_TELEMETRY_ALLOWED_PROPS);

/**
 * Project arbitrary input down to the allowlist. Anything not enumerated (email,
 * transcript, audio, stack, provider payload, secrets, …) is DROPPED. `undefined`
 * values are omitted; `null` is preserved (meaningful "absent"). Only primitives
 * survive — objects/arrays are dropped so a nested PII blob can never ride along.
 */
export function sanitizeV4TelemetryProps(input?: Record<string, unknown>): V4TelemetryProps {
    const out: V4TelemetryProps = {};
    if (!input) return out;
    for (const key of Object.keys(input)) {
        if (!ALLOWED.has(key)) continue; // allowlist: silently drop everything else
        const value = input[key];
        if (value === undefined) continue;
        if (
            value === null ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            out[key as V4TelemetryProp] = value;
        }
        // objects/arrays/functions are intentionally dropped (potential PII containers).
    }
    return out;
}

/**
 * Emit a v4 telemetry event with allowlisted props. Never throws. `userId` is NOT a
 * property — PostHog associates the event with the identified user's `distinct_id`.
 */
export function emitV4Telemetry(event: V4TelemetryEvent, props?: Record<string, unknown>): void {
    try {
        const safe = sanitizeV4TelemetryProps(props);
        logger.info({ ...safe, event }, '[V4_TELEMETRY]');
        try {
            posthog?.capture?.(event, safe);
        } catch {
            /* posthog optional — never let analytics break the STT path */
        }
    } catch {
        /* sanitize/log must never throw into the transcription path */
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
