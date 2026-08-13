import posthog from 'posthog-js';
import logger from '@/lib/logger';
import { V4_FLAG_KEYS } from './privateV4Flags';

export const PRIVATE_TELEMETRY_EVENTS = {
    SETUP_STARTED: 'private_setup_started',
    SETUP_SUCCEEDED: 'private_setup_succeeded',
    SETUP_FAILED: 'private_setup_failed',
    ERROR: 'private_error',
    REPORT_ISSUE_SUBMITTED: 'report_issue_submitted',
} as const;

export type PrivateTelemetryEvent = typeof PRIVATE_TELEMETRY_EVENTS[keyof typeof PRIVATE_TELEMETRY_EVENTS];
export type EngineVariant = 'private_v2' | 'private_v4';
export type AssignmentSource = 'default' | 'posthog_flag' | 'allowlist' | 'deterministic_override';

export const PRIVATE_TELEMETRY_ALLOWED_PROPS = [
    'session_id',
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
] as const;

export type PrivateTelemetryProp = typeof PRIVATE_TELEMETRY_ALLOWED_PROPS[number];
export type PrivateTelemetryProps = Partial<Record<PrivateTelemetryProp, string | number | boolean | null>>;
const ALLOWED = new Set<string>(PRIVATE_TELEMETRY_ALLOWED_PROPS);

/** Two-boundary content-free projection for Private engineering telemetry. */
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

export function resolvePrivateAssignment(input: {
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
    const engine_variant: EngineVariant = input.resolvedEngineType === 'transformers-js-v4'
        ? 'private_v4'
        : 'private_v2';
    const assignment_source: AssignmentSource = input.overrideActive
        ? 'deterministic_override'
        : input.allowlisted
            ? 'allowlist'
            : input.rolloutEnabled
                ? 'posthog_flag'
                : 'default';
    return {
        engine_variant,
        assignment_source,
        posthog_flag_key: V4_FLAG_KEYS.ENABLED,
        posthog_flag_value: input.rolloutEnabled,
    };
}

export function buildEngineVersion(engineVariant: EngineVariant, model?: string | null): string {
    return model ? `${engineVariant}:${model}` : engineVariant;
}

export function buildPrivateEnvProps(): PrivateTelemetryProps {
    if (typeof navigator === 'undefined') return {};
    const ua = navigator.userAgent || '';
    const browser = /\bEdg\//.test(ua) ? 'edge'
        : /\bOPR\/|\bOpera\b/.test(ua) ? 'opera'
            : /\bChrome\//.test(ua) ? 'chrome'
                : /\bFirefox\//.test(ua) ? 'firefox'
                    : /\bSafari\//.test(ua) ? 'safari' : 'other';
    const deviceMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    return { browser, device_memory_gb: typeof deviceMemory === 'number' ? deviceMemory : null };
}

export interface PrivateTelemetryContext {
    session_id?: string | null;
    engine_variant?: EngineVariant | null;
    assignment_source?: AssignmentSource | null;
    posthog_flag_key?: string | null;
    posthog_flag_value?: boolean | null;
    model?: string | null;
    release_sha?: string | null;
}

interface LastPrivateIdentity {
    engine_variant?: EngineVariant | null;
    model?: string | null;
    release_sha?: string | null;
    session_id?: string | null;
}

let activeContext: PrivateTelemetryContext = {};
const lastPrivateIdentity: LastPrivateIdentity = {};

export function setPrivateTelemetryContext(ctx: PrivateTelemetryContext): void {
    activeContext = { ...activeContext, ...ctx };
    if (ctx.engine_variant != null) lastPrivateIdentity.engine_variant = ctx.engine_variant;
    if (ctx.model != null) lastPrivateIdentity.model = ctx.model;
    if (ctx.release_sha != null) lastPrivateIdentity.release_sha = ctx.release_sha;
    if (ctx.session_id != null) lastPrivateIdentity.session_id = ctx.session_id;
}

export function getLastPrivateIdentity(): LastPrivateIdentity {
    return { ...lastPrivateIdentity };
}

export function emitPrivateTelemetry(event: PrivateTelemetryEvent, props?: Record<string, unknown>): void {
    try {
        const safe = sanitizePrivateTelemetryProps({ ...activeContext, ...(props ?? {}) });
        logger.info({ ...safe, event }, '[PRIVATE_TELEMETRY]');
        // Second independent projection immediately before the wire.
        const wireSafe = sanitizePrivateTelemetryProps(safe as Record<string, unknown>);
        posthog?.capture?.(event, wireSafe);
        if (typeof window !== 'undefined') {
            const target = window as unknown as { __SS_PRIVATE_EVENTS__?: Array<Record<string, unknown>> };
            if (!Array.isArray(target.__SS_PRIVATE_EVENTS__)) target.__SS_PRIVATE_EVENTS__ = [];
            target.__SS_PRIVATE_EVENTS__.push({ event, ts: Date.now(), ...wireSafe });
            if (target.__SS_PRIVATE_EVENTS__.length > 200) target.__SS_PRIVATE_EVENTS__.splice(0, target.__SS_PRIVATE_EVENTS__.length - 200);
        }
    } catch {
        // Telemetry never affects the Private recording path.
    }
}
