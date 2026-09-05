/**
 * #1259 — the v4 projection, extracted so the single governed boundary can apply it.
 *
 * WHY IT MOVED. `privateV4Telemetry` called `posthog.capture` DIRECTLY. That was a second capture
 * boundary: it bypassed `AnalyticsBuffer`, and with it the event envelope (no release, no traffic
 * type, no model attribution, and — once #1259 adds it — no correlation identity) and the governed
 * schema registry. Three live events shipped that way, so the comments describing `AnalyticsBuffer`
 * as *the* boundary were not true of the deployed app.
 *
 * Routing those events through the buffer creates the same import cycle #1392 already hit
 * (privateV4Telemetry -> AnalyticsBuffer -> privateV4Telemetry), and the fix is the same one that
 * worked there: the projection lives in its own dependency-free module, with one definition rather
 * than two that can drift.
 */

/**
 * The ONLY property keys allowed to leave the client on a v4 event. Every key is non-PII
 * engineering/outcome metadata. Anything not listed is dropped before it can reach PostHog or the logs.
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
    // #1259 — the `private_stt_v4_attempt` fields. They existed in Production but had never passed
    // through ANY allowlist: that event was captured directly with its raw payload, so these five rode
    // to PostHog unreviewed. They are bounded engine identifiers, and they are enumerated here so that
    // the event keeps its diagnostic value now that it goes through the governed boundary.
    'selectionSource',
    'selectedVariant',
    'attemptedProvider',
    'finalProvider',
    'fallbackProvider',
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
 * Project arbitrary input down to the allowlist. Anything not enumerated (email, transcript, audio,
 * stack, provider payload, secrets, …) is DROPPED. `undefined` is omitted; `null` is preserved
 * (meaningful "absent"). Only primitives survive — objects/arrays are dropped so a nested PII blob
 * can never ride along.
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

/** Does this event name belong to the v4 engineering namespace? Used by the capture boundary. */
export function isV4TelemetryEvent(event: string): boolean {
    return event.startsWith('private_stt_v4_');
}
