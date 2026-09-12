import { beforeEach, describe, expect, it, vi } from 'vitest';
import posthog from 'posthog-js';
import {
    PRIVATE_TELEMETRY_EVENTS,
    buildEngineVersion,
    clearPrivateRecordingIdentity,
    emitPrivateTelemetry,
    getLastPrivateIdentity,
    resolvePrivateAssignment,
    sanitizePrivateTelemetryProps,
    setPrivateTelemetryContext,
} from '../privateTelemetry';

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));

// The GOVERNED SEAM. Private telemetry now goes through `analyticsBuffer.push` rather than calling
// posthog directly, so the #1259 envelope (candidate_id / traffic_type / release_sha) rides these
// events. Spying here is what proves it takes that route.
const bufferPush = vi.fn();
vi.mock('@/services/AnalyticsBuffer', () => ({
    analyticsBuffer: { push: (...a: unknown[]) => bufferPush(...a) },
}));

describe('content-free Private telemetry', () => {
    beforeEach(() => {
        vi.mocked(posthog.capture).mockClear();
        bufferPush.mockClear();
        (window as unknown as { __SS_PRIVATE_EVENTS__?: unknown[] }).__SS_PRIVATE_EVENTS__ = [];
    });

    it('contains no retired offer, usage, or exhaustion events', () => {
        expect(Object.values(PRIVATE_TELEMETRY_EVENTS)).toEqual([
            'private_setup_started',
            'private_setup_succeeded',
            'private_setup_failed',
            'private_error',
            'report_issue_submitted',
        ]);
    });

    it('drops content and nested containers at the build-time boundary', () => {
        expect(sanitizePrivateTelemetryProps({
            error_code: 'SetupError',
            transcript: 'sensitive',
            audio: 'raw',
            nested: { email: 'user@example.com' },
        })).toEqual({ error_code: 'SetupError' });
    });

    it('CASUALTY: a RAW session id is dropped — only the link boolean survives', () => {
        // The session UUID used to be allowlisted, so every Private event and every Report Issue
        // carried a stable per-session identifier into an analytics vendor. The DATABASE keeps that
        // relationship; the browser only needs to answer whether a link exists. A boolean cannot
        // re-identify a session, and it is the same UUID that sits in the saved row.
        expect(sanitizePrivateTelemetryProps({
            session_id: 's1',
            report_linked_to_session: true,
            error_code: 'SetupError',
        })).toEqual({ report_linked_to_session: true, error_code: 'SetupError' });
    });

    it('CASUALTY: emits through the GOVERNED seam, never straight to the vendor', () => {
        // Calling posthog directly is what kept these events outside the envelope: a Private session's
        // own telemetry could not say which model produced it.
        setPrivateTelemetryContext({ session_id: 's1', engine_variant: 'private_v2' });
        emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.ERROR, {
            error_code: 'SetupError',
            transcript: 'must not leave',
        });

        expect(posthog.capture, 'must not bypass the buffer').not.toHaveBeenCalled();
        expect(bufferPush).toHaveBeenCalledTimes(1);
        const [name, props] = bufferPush.mock.calls[0] as [string, Record<string, unknown>];
        expect(name).toBe('private_error');
        expect(props).toEqual({ engine_variant: 'private_v2', error_code: 'SetupError' });
        // and the raw session id from the CONTEXT is gone too, not just from the call props
        expect(props).not.toHaveProperty('session_id');
    });

    it('the browser mirror carries the same content-free projection', () => {
        setPrivateTelemetryContext({ session_id: 's1', engine_variant: 'private_v2' });
        emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.ERROR, {
            error_code: 'SetupError',
            transcript: 'must not leave',
        });
        const mirror = (window as unknown as { __SS_PRIVATE_EVENTS__: unknown[] }).__SS_PRIVATE_EVENTS__;
        expect(mirror).toEqual([
            expect.objectContaining({ event: 'private_error', engine_variant: 'private_v2' }),
        ]);
        expect(JSON.stringify(mirror)).not.toContain('must not leave');
        expect(JSON.stringify(mirror)).not.toContain('s1');
    });

    it('preserves deterministic engine-version attribution without product-tier semantics', () => {
        const v4 = resolvePrivateAssignment({
            resolvedEngineType: 'transformers-js-v4',
            overrideActive: false,
            allowlisted: false,
            rolloutEnabled: true,
        });
        expect(v4.engine_variant).toBe('private_v4');
        expect(v4.assignment_source).toBe('posthog_flag');
        expect(buildEngineVersion(v4.engine_variant, 'base_q4')).toBe('private_v4:base_q4');
        expect(buildEngineVersion('private_v2', 'whisper-base.en')).toBe('private_v2:whisper-base.en');
    });

    it('clears stale session correlation at each take and binds only the newly persisted row', () => {
        setPrivateTelemetryContext({ session_id: 'session-old', engine_variant: 'private_v2' });
        clearPrivateRecordingIdentity();
        expect(getLastPrivateIdentity()).toMatchObject({ session_id: null, engine_variant: 'private_v2' });

        setPrivateTelemetryContext({ session_id: 'session-first' });
        expect(getLastPrivateIdentity().session_id).toBe('session-first');
        clearPrivateRecordingIdentity();
        expect(getLastPrivateIdentity().session_id).toBeNull();
        setPrivateTelemetryContext({ session_id: 'session-second' });
        expect(getLastPrivateIdentity().session_id).toBe('session-second');
    });
});
