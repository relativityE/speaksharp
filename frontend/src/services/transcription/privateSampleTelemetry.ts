/**
 * privateSampleTelemetry.ts — Private 5-minute sample A/B telemetry spine (v2 vs v4).
 *
 * Unified, cross-engine event stream for the free-user Private sample. EVERY event
 * carries the resolved `engine_variant` (private_v2 | private_v4) and the
 * `assignment_source` (how that arm was chosen), so the two arms are comparable and a
 * v4 user's path is attributable to override / allowlist / rollout / default. This is
 * the A/B MEASUREMENT spine; the older `private_stt_v4_*` events stay as v4
 * engine-internal diagnostics.
 *
 * PRIVACY (the load-bearing guarantee): a STRICT allowlist. Only the enumerated non-PII
 * keys below ever leave the client — transcript text, audio, raw model output,
 * segments, or tokens can NEVER ride along, even by accident, because anything not on
 * the list is dropped. `user_id`/`distinct_id` ride PostHog `identify()`, never a
 * property here. Emission NEVER throws into the app/STT path.
 *
 * DURABLE MIRROR: the saved session row's `engine_version` independently records the
 * arm (`private_v2:<model>` / `private_v4:<model>`), so the variant is reconstructable
 * even if PostHog drops the event (do not rely on analytics alone for attribution).
 */
import posthog from 'posthog-js';
import logger from '@/lib/logger';
import { V4_FLAG_KEYS } from './privateV4Flags';

/** The approved Private-sample event stream. Renames are costly once beta data flows. */
export const PRIVATE_SAMPLE_EVENTS = {
    /** Free user first SELECTS/opens Private mode with the sample available (intent, not render). */
    SELECTED: 'private_sample_selected',
    SETUP_STARTED: 'private_sample_setup_started',
    SETUP_SUCCEEDED: 'private_sample_setup_succeeded',
    SETUP_FAILED: 'private_sample_setup_failed',
    RECORDING_STARTED: 'private_sample_recording_started',
    FIRST_TRANSCRIPT_SEEN: 'private_sample_first_transcript_seen',
    RECORDING_STOPPED: 'private_sample_recording_stopped',
    SAVED: 'private_sample_saved',
    /** Recording started but the user left/navigated without saving. */
    ABANDONED_UNSAVED: 'private_sample_abandoned_unsaved',
    USAGE_UPDATED: 'private_sample_usage_updated',
    EXHAUSTED: 'private_sample_exhausted',
    ERROR: 'private_sample_error',
    REPORT_ISSUE_SUBMITTED: 'report_issue_submitted',
} as const;

export type PrivateSampleEvent = typeof PRIVATE_SAMPLE_EVENTS[keyof typeof PRIVATE_SAMPLE_EVENTS];

export type EngineVariant = 'private_v2' | 'private_v4';
export type AssignmentSource = 'default' | 'posthog_flag' | 'allowlist' | 'deterministic_override';

/**
 * The ONLY property keys allowed to leave the client. Every key is non-PII
 * engineering/outcome metadata or a numeric summary. NOTE: `time_to_first_text_ms` is a
 * numeric duration summary (allowed), NOT transcript text — the strict privacy test
 * exempts it explicitly while still forbidding a bare `text`/`transcript` payload key.
 */
export const PRIVATE_SAMPLE_ALLOWED_PROPS = [
    'session_id',
    'release_sha',
    'engine_variant',
    'assignment_source',
    'posthog_flag_key',
    'posthog_flag_value',
    'model',
    'sample_limit_seconds',
    'sample_seconds_used',
    'sample_seconds_remaining',
    'browser',
    'device_memory_gb',
    'setup_duration_ms',
    'time_to_first_text_ms',
    'recording_duration_seconds',
    'word_count',
    'save_success',
    'error_code',
    'fallback_reason',
    'resolved_device',
    'webgpu_available',
    // report_issue_submitted context (safe enums, no free text / no PII).
    'issue_category',
    'issue_severity',
] as const;

export type PrivateSampleProp = typeof PRIVATE_SAMPLE_ALLOWED_PROPS[number];
export type PrivateSampleProps = Partial<Record<PrivateSampleProp, string | number | boolean | null>>;

const ALLOWED = new Set<string>(PRIVATE_SAMPLE_ALLOWED_PROPS);

/**
 * Project arbitrary input down to the allowlist. Anything not enumerated — transcript,
 * text, audio, wav, blob, base64, raw, segments, tokens, email, stack, … — is DROPPED.
 * `undefined` is omitted; `null` is preserved (meaningful "absent"). Only primitives
 * survive, so a nested PII blob can never ride along.
 */
export function sanitizePrivateSampleProps(input?: Record<string, unknown>): PrivateSampleProps {
    const out: PrivateSampleProps = {};
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
            out[key as PrivateSampleProp] = value;
        }
        // objects/arrays/functions intentionally dropped (potential PII containers).
    }
    return out;
}

/**
 * Map the actual resolved Private engine + the flag/override inputs to the durable
 * `engine_variant` and the attributable `assignment_source`. Pure + testable.
 *
 * `engine_variant` reflects the engine ACTUALLY selected for the session
 * (`PrivateSTT.getEngineType()`); `assignment_source` explains WHY that arm was offered.
 * Precedence: a dev/test/E2E override wins, then a named allowlist, then the % rollout
 * flag, else the safe default (v2).
 */
export function resolveSampleAssignment(input: {
    resolvedEngineType: string | null | undefined;
    overrideActive: boolean;
    allowlisted: boolean;
    rolloutEnabled: boolean;
}): {
    engine_variant: EngineVariant;
    assignment_source: AssignmentSource;
    posthog_flag_key: string;
    posthog_flag_value: boolean;
} {
    const engine_variant: EngineVariant =
        input.resolvedEngineType === 'transformers-js-v4' ? 'private_v4' : 'private_v2';

    let assignment_source: AssignmentSource = 'default';
    if (input.overrideActive) assignment_source = 'deterministic_override';
    else if (input.allowlisted) assignment_source = 'allowlist';
    else if (input.rolloutEnabled) assignment_source = 'posthog_flag';

    return {
        engine_variant,
        assignment_source,
        posthog_flag_key: V4_FLAG_KEYS.ENABLED,
        posthog_flag_value: input.rolloutEnabled,
    };
}

/** Build the durable `engine_version` string persisted on the saved session row. */
export function buildEngineVersion(engineVariant: EngineVariant, model?: string | null): string {
    return model ? `${engineVariant}:${model}` : engineVariant;
}

/** Non-PII environment props (browser family + coarse device memory). Best-effort. */
export function buildSampleEnvProps(): PrivateSampleProps {
    if (typeof navigator === 'undefined') return {};
    const ua = navigator.userAgent || '';
    const browser =
        /\bEdg\//.test(ua) ? 'edge' :
        /\bOPR\/|\bOpera\b/.test(ua) ? 'opera' :
        /\bChrome\//.test(ua) ? 'chrome' :
        /\bFirefox\//.test(ua) ? 'firefox' :
        /\bSafari\//.test(ua) ? 'safari' : 'other';
    const deviceMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    return {
        browser,
        device_memory_gb: typeof deviceMemory === 'number' ? deviceMemory : null,
    };
}

/**
 * Session-scoped assignment context, set once at session start (when the engine is
 * resolved) and merged into every emitted event so all emitters — across the lifecycle,
 * transcript, usage, and save layers — report a consistent arm/source WITHOUT threading
 * params through each call. Cleared on session end.
 */
export interface PrivateSampleContext {
    session_id?: string | null;
    engine_variant?: EngineVariant | null;
    assignment_source?: AssignmentSource | null;
    posthog_flag_key?: string | null;
    posthog_flag_value?: boolean | null;
    model?: string | null;
    release_sha?: string | null;
    sample_limit_seconds?: number | null;
}

let activeContext: PrivateSampleContext = {};

export function setPrivateSampleContext(ctx: PrivateSampleContext): void {
    activeContext = { ...activeContext, ...ctx };
}

export function getPrivateSampleContext(): PrivateSampleContext {
    return { ...activeContext };
}

export function clearPrivateSampleContext(): void {
    activeContext = {};
}

/**
 * Emit a Private-sample event. Merges the active session context, applies the strict
 * allowlist, mirrors a structured internal log, and (best-effort) captures to PostHog.
 * NEVER throws — telemetry must not affect the sample/STT path. `userId` is NOT a
 * property; PostHog ties the event to the identified `distinct_id`.
 */
export function emitPrivateSample(event: PrivateSampleEvent, props?: Record<string, unknown>): void {
    try {
        const merged = { ...activeContext, ...(props ?? {}) };
        const safe = sanitizePrivateSampleProps(merged);
        logger.info({ ...safe, event }, '[PRIVATE_SAMPLE]');
        try {
            posthog?.capture?.(event, safe);
        } catch {
            /* posthog optional — never let analytics break the sample path */
        }
    } catch {
        /* sanitize/log must never throw into the transcription path */
    }
}
