/**
 * #1392 — the Private telemetry projection, extracted so the governed seam can use it.
 *
 * WHY IT MOVED. `AnalyticsBuffer` imports this projection to sanitize `private_*` events at the single
 * capture boundary. Routing `emitPrivateTelemetry` through that same boundary — which is the whole
 * point of #1392 — would otherwise create a cycle: privateTelemetry -> AnalyticsBuffer ->
 * privateTelemetry. Keeping the projection in its own dependency-free module breaks it, and leaves one
 * definition rather than two that can drift.
 *
 * SESSION_ID IS DELIBERATELY ABSENT from the allowlist. It used to ride here as a raw session UUID, so
 * every Private event and every Report Issue carried a stable per-session identifier into an analytics
 * vendor. The DATABASE keeps that relationship — `user_issue_reports.session_id` is a real column and a
 * real foreign key — but the browser payload only needs to answer whether a report is linked at all, so
 * it now carries `report_linked_to_session: true|false`. A boolean cannot re-identify a session; a UUID
 * can, and it is the same UUID present in the saved row.
 */

export const PRIVATE_TELEMETRY_ALLOWED_PROPS = [
    'release_sha',
    'engine_variant',
    'assignment_source',
    'posthog_flag_key',
    'posthog_flag_value',
    'model',
    'browser',
    'device_memory_gb',
    'setup_duration_ms',
    'error_code',
    'fallback_reason',
    'resolved_device',
    'webgpu_available',
    'issue_category',
    'issue_severity',
    /** Whether the report/session pair is linked. NOT the identifier — see the module note. */
    'report_linked_to_session',
    // Says whether the engine identity on this event belongs to the SESSION the report is linked to,
    // rather than to whatever last resolved in the tab. Without it a null arm is indistinguishable from
    // an unrecorded one, and a populated arm is indistinguishable from a borrowed one.
    'model_attribution_verified',

    // ── #1259s MODEL ACQUISITION ──────────────────────────────────────────────────────────────────
    //
    // Every acquisition event is named `private_*`, so it passes through this projection on its way to
    // PostHog. Without these entries the sanitizer silently dropped ALL of them and only `error_code`
    // survived: the events would have arrived carrying nothing that answers the question they exist to
    // answer. The unit tests mocked the buffer, so nothing saw the loss.
    //
    // Every field below is a measurement or an identity, never content. No URL, no asset path, no raw
    // user id, no free-form error text.
    'candidate_id',
    'acquired_candidate_id', 'model_identity',
    // #1259: bounded completeness signal. `measurement_reason_code` is a closed vocabulary; the
    // free-form `unobservableReason` is deliberately NOT here and must never be emitted.
    'measurement_completeness', 'measurement_reason_code', 'out_of_scope_count',
    'partial_network_bytes', 'partial_download_ms',
    'asset_pin_digest',
    'release_id',
    'trigger',
    /** From the real Cache Storage boundary: hit | miss | partial | unobservable. Never inferred. */
    'cache_result',
    'network_used',
    'network_bytes',
    'asset_count',
    /** Kept separate from init: a cached load still initialises, and conflating them is unusable. */
    'download_ms',
    'init_ms',
    'total_ms',
    'outcome',
] as const;

export type PrivateTelemetryProp = typeof PRIVATE_TELEMETRY_ALLOWED_PROPS[number];
export type PrivateTelemetryProps = Partial<Record<PrivateTelemetryProp, string | number | boolean | null>>;

const ALLOWED = new Set<string>(PRIVATE_TELEMETRY_ALLOWED_PROPS);

/**
 * Two-boundary content-free projection for Private engineering telemetry.
 *
 * Unknown keys are DROPPED rather than coerced: a key nobody contracted is a key nobody reviewed, and
 * the failure this guards against is free text (an error message, a transcript excerpt) arriving under
 * a plausible-looking name.
 */
export function sanitizePrivateTelemetryProps(input?: Record<string, unknown>): PrivateTelemetryProps {
    const out: PrivateTelemetryProps = {};
    if (!input) return out;
    for (const key of Object.keys(input)) {
        if (!ALLOWED.has(key)) continue;
        const value = input[key];
        if (value === undefined) continue;
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            out[key as PrivateTelemetryProp] = value;
        }
    }
    return out;
}
