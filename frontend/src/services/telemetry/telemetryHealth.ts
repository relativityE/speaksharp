/**
 * #1259 F12 — TELEMETRY ABOUT TELEMETRY.
 *
 * A live Production session produced roughly ninety analytics ingests, every one HTTP 200, and not a
 * single decodable event name or property. Nothing in the app could have told us that: property drops
 * were `logger.warn` only, flush outcomes were `logger.debug`, and the only self-report was an identity
 * probe on `window` that says which FUNCTIONS RAN. A hook reporting that it installed is not evidence
 * that anything arrived.
 *
 * So this module publishes two different kinds of fact, and they are deliberately not the same event:
 *
 *   `telemetry_positive_control` — one controlled event per boot, carrying a nonce minted in this tab.
 *       It is the thing you DECODE AT THE WIRE. Its value is entirely in being externally verifiable:
 *       finding this nonce in a decoded request body proves the transport works end to end for a payload
 *       whose expected contents were known in advance. Nothing the client says about itself can prove
 *       that, which is why the client does not try — there is no `boundary_accepted` field here, because
 *       `posthog.capture` is fire-and-forget and any such flag would be a guess wearing a measurement's
 *       clothes.
 *
 *   `telemetry_health` — what the client genuinely does know: how many properties its own boundary
 *       dropped, whether the event was governed at all, and how the queue drained.
 *
 * RECURSION IS THE OBVIOUS WAY TO GET THIS WRONG. A health event that reports its own drops emits
 * another health event, and a telemetry outage becomes a telemetry flood. Health events therefore never
 * report on health events — they are counted and nothing more.
 */
import type { AnalyticsPriority } from '../AnalyticsBuffer';

/**
 * Bumped when the emitted contract changes, so a Production readback can tell "this build did not send
 * it" from "this build sent an older shape". Without it every gap looks like an outage.
 */
export const INSTRUMENTATION_VERSION = '1259.1';

export type SchemaValidationResult = 'ok' | 'dropped_fields' | 'ungoverned';
export type FlushOutcome = 'drained' | 'backpressure_dropped' | 'pagehide_drained';

/** Emitter injected to avoid a cycle: AnalyticsBuffer owns the boundary and calls into this module. */
type Emit = (event: string, props: Record<string, unknown>, priority: AnalyticsPriority) => void;
let emit: Emit | null = null;
export function setTelemetryHealthEmitter(fn: Emit | null): void { emit = fn; }

/** Health never reports on health. See the module note. */
export function isHealthEvent(event: string): boolean {
    return event === 'telemetry_health' || event === 'telemetry_positive_control';
}

let controlNonce: string | null = null;
let suppressedHealthEvents = 0;

/** The nonce this boot's controlled event carries, or null before it is emitted. */
export function positiveControlNonce(): string | null { return controlNonce; }

/** Count of health events that were themselves dropped or suppressed — reported, never re-emitted. */
export function suppressedHealthCount(): number { return suppressedHealthEvents; }

function mintNonce(): string {
    try {
        const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
        if (typeof c?.randomUUID === 'function') return `pc-${c.randomUUID()}`;
    } catch { /* fall through */ }
    return `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Emit the controlled event. CRITICAL priority so it leaves the buffer immediately rather than waiting
 * on an idle callback — a proof that only arrives when the browser happens to be idle is a proof that
 * fails exactly when the tab is busy, which is when telemetry problems actually happen.
 */
export function emitPositiveControl(transportInitialized: boolean): string {
    controlNonce = mintNonce();
    emit?.('telemetry_positive_control', {
        control_nonce: controlNonce,
        instrumentation_version: INSTRUMENTATION_VERSION,
        transport_initialized: transportInitialized,
    }, 'CRITICAL');
    return controlNonce;
}

/**
 * Report that the boundary dropped properties from an event.
 *
 * The dropped KEYS are not sent — only how many, and the name of the event they were dropped from. The
 * keys are attacker- and author-controlled strings; the count and the event name answer the question
 * ("is our schema wrong, or is a producer wrong?") without carrying anything a key name could smuggle.
 */
export function recordDrop(event: string, droppedCount: number, governed: boolean): void {
    if (isHealthEvent(event)) { suppressedHealthEvents += 1; return; }
    if (droppedCount <= 0 && governed) return;
    emit?.('telemetry_health', {
        instrumentation_version: INSTRUMENTATION_VERSION,
        source_event: event,
        schema_validation_result: (governed ? 'dropped_fields' : 'ungoverned') as SchemaValidationResult,
        dropped_count: droppedCount,
        suppressed_health_events: suppressedHealthEvents,
    }, 'LOW');
}

/**
 * Report how the queue drained. `queue_depth_band` rather than the depth: the exact number changes on
 * every flush and would make this the highest-cardinality event we emit, for a question ("is the queue
 * backing up?") that a band answers just as well.
 */
export function recordFlush(outcome: FlushOutcome, queueDepth: number, droppedCount = 0): void {
    emit?.('telemetry_health', {
        instrumentation_version: INSTRUMENTATION_VERSION,
        flush_outcome: outcome,
        queue_depth_band: depthBand(queueDepth),
        // How many events backpressure discarded since the last report. Zero is a real answer and is
        // sent: "we dropped none" is the fact that makes a gap in the data attributable elsewhere.
        dropped_count: droppedCount,
        suppressed_health_events: suppressedHealthEvents,
    }, 'LOW');
}

export function depthBand(depth: number): string {
    if (depth <= 0) return '0';
    if (depth <= 10) return '1-10';
    if (depth <= 100) return '11-100';
    if (depth <= 500) return '101-500';
    return '500+';
}

/** Test seam. */
export function __resetTelemetryHealthForTests(): void {
    controlNonce = null;
    suppressedHealthEvents = 0;
}
