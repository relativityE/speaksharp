import { vi, describe, it, expect, beforeEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import {
    INSTRUMENTATION_VERSION, emitPositiveControl, positiveControlNonce,
    isHealthEvent, depthBand, recordDrop, suppressedHealthCount, __resetTelemetryHealthForTests,
} from '../telemetryHealth';
import { fingerprintError, normalizeErrorMessage, messageLengthBand } from '@/lib/errorFingerprint';
import { projectEventProps } from '../../telemetryAllowlist';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const calls = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls;
const captured = (name: string) => calls().filter((c) => c[0] === name);

/**
 * Health events are LOW priority — they must never jump ahead of product traffic, and flooding the
 * transport is the failure mode this whole family guards against. LOW drains on an idle callback, so a
 * test that asserts immediately asserts on an empty queue. A CRITICAL push drains synchronously first,
 * which is the real production mechanism, not a test-only escape hatch.
 */
const drainQueue = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

beforeEach(() => {
    vi.clearAllMocks();
    __resetTelemetryHealthForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    analyticsBuffer.wireHealthEmitter();
});

describe('F12 — the positive control', () => {
    it('emits one controlled event carrying a nonce and the instrumentation version', () => {
        const nonce = emitPositiveControl(true);
        expect(nonce).toBe(positiveControlNonce());

        const [event] = captured('telemetry_positive_control');
        expect(event).toBeTruthy();
        const props = event[1] as Record<string, unknown>;
        expect(props.control_nonce).toBe(nonce);
        expect(props.instrumentation_version).toBe(INSTRUMENTATION_VERSION);
        expect(props.transport_initialized).toBe(true);
    });

    it('the nonce SURVIVES the allowlist — the field a wire readback looks for must not be dropped', () => {
        const nonce = emitPositiveControl(true);
        // The proof is external (decode the request body), so this is the client-side half of it: the
        // projection must not silently strip the very field the readback searches for. A nonce that is
        // dropped at the boundary looks exactly like a transport failure.
        const { props, dropped } = projectEventProps('telemetry_positive_control', {
            control_nonce: nonce,
            instrumentation_version: INSTRUMENTATION_VERSION,
            transport_initialized: true,
        });
        expect(dropped).toEqual([]);
        expect(props.control_nonce).toBe(nonce);
    });

    it('records transport_initialized=false honestly rather than assuming success', () => {
        emitPositiveControl(false);
        const props = captured('telemetry_positive_control')[0][1] as Record<string, unknown>;
        expect(props.transport_initialized).toBe(false);
    });

    it('makes NO claim about acceptance — that is not knowable from inside the client', () => {
        emitPositiveControl(true);
        const props = captured('telemetry_positive_control')[0][1] as Record<string, unknown>;
        // posthog.capture is fire-and-forget. A self-reported acceptance flag would be a guess wearing
        // a measurement's clothes, and the live session already showed what that costs.
        expect(props).not.toHaveProperty('boundary_accepted');
    });
});

describe('F12 — drops become telemetry, not just a console line', () => {
    it('reports the COUNT and source event of dropped properties, never the keys', () => {
        analyticsBuffer.push('session_started', {
            mode: 'private',
            transcript: 'um this must not leave',
            secretHeader: 'authorization: bearer x',
        }, 'CRITICAL');
        drainQueue();

        const health = captured('telemetry_health');
        expect(health.length).toBeGreaterThan(0);
        const props = health[health.length - 1][1] as Record<string, unknown>;
        expect(props.source_event).toBe('session_started');
        expect(props.schema_validation_result).toBe('dropped_fields');
        expect(props.dropped_count).toBe(2);
        // The dropped KEYS are author- and attacker-controlled strings; the count answers the question
        // without carrying anything a key name could smuggle.
        const serialized = JSON.stringify(props);
        expect(serialized).not.toContain('transcript');
        expect(serialized).not.toContain('secretHeader');
        expect(serialized).not.toContain('must not leave');
    });

    it('reports an UNGOVERNED event distinctly from a governed one that lost fields', () => {
        analyticsBuffer.push('NotInTheRegistry' as Parameters<typeof analyticsBuffer.push>[0],
            { anything: 'at all' }, 'CRITICAL');
        drainQueue();
        const props = captured('telemetry_health').slice(-1)[0][1] as Record<string, unknown>;
        expect(props.schema_validation_result).toBe('ungoverned');
    });
});

describe('F12 — NEGATIVE CONTROLS: health must not report on itself', () => {
    it('isHealthEvent covers both health events', () => {
        expect(isHealthEvent('telemetry_health')).toBe(true);
        expect(isHealthEvent('telemetry_positive_control')).toBe(true);
        expect(isHealthEvent('session_started')).toBe(false);
    });

    it('a drop ON a health event emits nothing and is counted instead', () => {
        // THE GUARD, TESTED AT THE GUARD. Asserting through the buffer proved nothing: the report is
        // LOW priority, so it sits in the queue and the count looks correct whether or not the guard
        // exists. The unbounded case is a health event that is itself ungoverned — every report is
        // dropped, which reports a drop, forever — and the only observable difference is here.
        recordDrop('telemetry_health', 3, false);
        recordDrop('telemetry_positive_control', 2, false);
        expect(captured('telemetry_health')).toHaveLength(0);
        expect(suppressedHealthCount()).toBe(2);
    });

    it('a health event with unknown fields does not cascade once the queue drains', () => {
        analyticsBuffer.push('telemetry_health', {
            instrumentation_version: INSTRUMENTATION_VERSION,
            somethingUnknown: 'x',
        }, 'CRITICAL');
        drainQueue();
        drainQueue();
        // The one event we pushed, and nothing generated by reporting on it.
        expect(captured('telemetry_health')).toHaveLength(1);
    });

    it('a full queue does not recurse: backpressure is counted, not emitted in the full branch', () => {
        analyticsBuffer.ready = false;
        for (let i = 0; i < analyticsBuffer.MAX_QUEUE_SIZE + 25; i += 1) {
            analyticsBuffer.push('session_started', { mode: 'private' });
        }
        // Emitting from inside the full-queue branch would push into the queue that is already full,
        // dropping another and emitting again — an unbounded recursion whose first symptom is a hung tab.
        expect(analyticsBuffer.queue.length).toBeLessThanOrEqual(analyticsBuffer.MAX_QUEUE_SIZE);
    });
});

describe('F12 — the error fingerprint replaces an empty schema', () => {
    it('carries class, digest and length band — and none of the message', () => {
        const message = 'duplicate key value violates unique constraint: um so basically the transcript';
        const fp = fingerprintError(new TypeError(message), message);
        expect(fp.reason_kind).toBe('error');
        expect(fp.error_name).toBe('TypeError');
        expect(fp.message_length_band).toBe('65-256');
        const serialized = JSON.stringify(fp);
        expect(serialized).not.toContain('transcript');
        expect(serialized).not.toContain('duplicate key');
    });

    it('GROUPS the same failure across occurrences that differ only by identifiers', () => {
        // Without normalization a failure carrying a fresh id each time produces a new fingerprint every
        // occurrence, and the grouping this exists to provide never happens.
        const a = fingerprintError(new Error('x'), 'session 41ab90ff not found after 3 retries');
        const b = fingerprintError(new Error('x'), 'session 7cd12e04 not found after 9 retries');
        expect(a.error_fingerprint).toBe(b.error_fingerprint);
    });

    it('SEPARATES different error classes that share generic text', () => {
        const a = fingerprintError(new TypeError('failed to fetch'), 'failed to fetch');
        const b = fingerprintError(new RangeError('failed to fetch'), 'failed to fetch');
        expect(a.error_fingerprint).not.toBe(b.error_fingerprint);
    });

    it('every fingerprint field survives the GLOBAL_UNHANDLED_REJECTION schema', () => {
        const fp = fingerprintError(new TypeError('boom'), 'boom');
        const { props, dropped } = projectEventProps('GLOBAL_UNHANDLED_REJECTION', { ...fp });
        // The schema was `{}`, so this event shipped nothing at all. Every derived field must land.
        expect(dropped).toEqual([]);
        expect(Object.keys(props).sort()).toEqual(
            ['error_fingerprint', 'error_name', 'message_length_band', 'reason_kind']);
    });

    it('a non-Error rejection is described, not guessed at', () => {
        expect(fingerprintError('just a string', 'just a string').reason_kind).toBe('string');
        expect(fingerprintError(null, 'Unknown').reason_kind).toBe('nullish');
        expect(fingerprintError(null, 'Unknown').error_name).toBeNull();
    });

    it('prose assigned to error.name is rejected by the schema, not shipped', () => {
        const fp = fingerprintError(Object.assign(new Error('x'), {
            name: 'we could not find the transcript you asked for',
        }), 'x');
        const { props, dropped } = projectEventProps('GLOBAL_UNHANDLED_REJECTION', { ...fp });
        expect(dropped).toContain('error_name');
        expect(props).not.toHaveProperty('error_name');
    });

    it('normalization and banding are stable at the edges', () => {
        expect(normalizeErrorMessage('Error 12 AT 0xDEADBEEF99')).toBe('error # at #x#');
        expect(messageLengthBand(0)).toBe('0');
        expect(messageLengthBand(64)).toBe('1-64');
        expect(messageLengthBand(65)).toBe('65-256');
        expect(depthBand(0)).toBe('0');
        expect(depthBand(1000)).toBe('500+');
    });
});
