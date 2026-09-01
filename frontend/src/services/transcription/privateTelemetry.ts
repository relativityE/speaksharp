import logger from '@/lib/logger';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { sanitizePrivateTelemetryProps, type PrivateTelemetryProps } from './privateTelemetrySanitizer';
import { V4_FLAG_KEYS } from './privateV4Flags';

export const PRIVATE_TELEMETRY_EVENTS = {
    SETUP_STARTED: 'private_setup_started',
    SETUP_SUCCEEDED: 'private_setup_succeeded',
    SETUP_FAILED: 'private_setup_failed',
    ERROR: 'private_error',
    REPORT_ISSUE_SUBMITTED: 'report_issue_submitted',
} as const;

export type PrivateTelemetryEvent = typeof PRIVATE_TELEMETRY_EVENTS[keyof typeof PRIVATE_TELEMETRY_EVENTS];
/**
 * The arm a session ran under. `private_moonshine` exists because the alternative — folding a third
 * engine into a two-value union — forces every consumer into a binary that quietly resolves the unknown
 * case to `private_v2`, which is how Moonshine sessions were being saved under Whisper's name.
 */
export type EngineVariant = 'private_v2' | 'private_v4' | 'private_moonshine';
export type AssignmentSource = 'default' | 'posthog_flag' | 'allowlist' | 'deterministic_override';

// The projection moved to `privateTelemetrySanitizer` so the governed seam can import it without a
// cycle. Re-exported here because existing call sites import it from this module.
export {
    PRIVATE_TELEMETRY_ALLOWED_PROPS,
    sanitizePrivateTelemetryProps,
    type PrivateTelemetryProp,
    type PrivateTelemetryProps,
} from './privateTelemetrySanitizer';

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
    // THE SAME TWO-WAY BOOLEAN AS getMetadata HAD, in the DURABLE path. Correcting only the metadata
    // left this one: `resolvedPrivateEngineVersion` is built from here and persisted at stop, so a
    // Moonshine session was still saved as `private_v2:...` on the row that outlives the tab. The
    // in-memory label was right and the stored one was wrong, which is the worse half to get wrong.
    const engine_variant: EngineVariant =
        input.resolvedEngineType === 'transformers-js-v4' ? 'private_v4'
            : input.resolvedEngineType === 'moonshine-streaming' ? 'private_moonshine'
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
    if (Object.prototype.hasOwnProperty.call(ctx, 'session_id')) lastPrivateIdentity.session_id = ctx.session_id ?? null;
}

/** Recording boundary: a report must never inherit the previous take's persisted session identity. */
export function clearPrivateRecordingIdentity(): void {
    setPrivateTelemetryContext({ session_id: null });
}

export function getLastPrivateIdentity(): LastPrivateIdentity {
    return { ...lastPrivateIdentity };
}

export function emitPrivateTelemetry(event: PrivateTelemetryEvent, props?: Record<string, unknown>): void {
    try {
        const safe = sanitizePrivateTelemetryProps({ ...activeContext, ...(props ?? {}) });
        logger.info({ ...safe, event }, '[PRIVATE_TELEMETRY]');

        // THROUGH THE GOVERNED BOUNDARY, NOT AROUND IT.
        //
        // This called `posthog.capture` directly, so `private_*` events — and the Report Issue event —
        // reached the vendor without passing `AnalyticsBuffer`, which is where the #1259 envelope is
        // applied. Every one of them therefore carried no `candidate_id`, no `traffic_type` and no
        // `release_sha` from the seam: a Private session's own telemetry could not say which model
        // produced it, which is precisely what the attribution work exists to establish. It also
        // hand-rolled two of those fields from its own context, which is the producer-supplied pattern
        // the envelope replaces.
        //
        // The buffer re-applies `sanitizePrivateTelemetryProps` on the way out, so the content-free
        // guarantee is unchanged — it is now enforced at both ends rather than only here.
        analyticsBuffer.push(event as Parameters<typeof analyticsBuffer.push>[0], safe, 'LOW');

        if (typeof window !== 'undefined') {
            const target = window as unknown as { __SS_PRIVATE_EVENTS__?: Array<Record<string, unknown>> };
            if (!Array.isArray(target.__SS_PRIVATE_EVENTS__)) target.__SS_PRIVATE_EVENTS__ = [];
            target.__SS_PRIVATE_EVENTS__.push({ event, ts: Date.now(), ...safe });
            if (target.__SS_PRIVATE_EVENTS__.length > 200) target.__SS_PRIVATE_EVENTS__.splice(0, target.__SS_PRIVATE_EVENTS__.length - 200);
        }
    } catch {
        // Telemetry never affects the Private recording path.
    }
}
