import { describe, it, expect, beforeEach, vi } from 'vitest';
import posthog from 'posthog-js';
import {
    PRIVATE_SAMPLE_EVENTS,
    PRIVATE_SAMPLE_ALLOWED_PROPS,
    sanitizePrivateSampleProps,
    resolveSampleAssignment,
    buildEngineVersion,
    emitPrivateSample,
    setPrivateSampleContext,
    clearPrivateSampleContext,
} from '../privateSampleTelemetry';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn() },
}));

const captureMock = posthog.capture as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
    captureMock.mockClear();
    clearPrivateSampleContext();
});

describe('private sample telemetry — event contract', () => {
    it('emits exactly the approved event stream (no more, no fewer)', () => {
        expect(new Set(Object.values(PRIVATE_SAMPLE_EVENTS))).toEqual(new Set([
            // #1047 conversion funnel — top of the Free→Private nudge funnel (offer shown / offer taken).
            'private_sample_nudge_viewed',
            'private_sample_nudge_selected',
            'private_sample_selected',
            'private_sample_setup_started',
            'private_sample_setup_succeeded',
            'private_sample_setup_failed',
            'private_sample_recording_started',
            'private_sample_first_transcript_seen',
            'private_sample_recording_stopped',
            'private_sample_saved',
            'private_sample_abandoned_unsaved',
            'private_sample_usage_updated',
            'private_sample_exhausted',
            'private_sample_error',
            'report_issue_submitted',
        ]));
    });
});

describe('private sample telemetry — STRICT privacy guard', () => {
    // Raw-payload keys that must NEVER leave the client.
    const FORBIDDEN_KEYS = ['transcript', 'text', 'audio', 'wav', 'blob', 'base64', 'raw', 'segments', 'tokens'];
    // Numeric summaries that ARE allowed (note time_to_first_text_ms contains "text").
    const ALLOWED_NUMERIC = [
        'word_count',
        'recording_duration_seconds',
        'time_to_first_text_ms',
        'sample_seconds_used',
        'sample_seconds_remaining',
    ];

    it('the allowlist itself contains no raw-payload key', () => {
        for (const forbidden of FORBIDDEN_KEYS) {
            // a bare payload key is never allowlisted (time_to_first_text_ms is a distinct key)
            expect(PRIVATE_SAMPLE_ALLOWED_PROPS as readonly string[]).not.toContain(forbidden);
        }
    });

    it('drops every forbidden payload key', () => {
        const dirty: Record<string, unknown> = {};
        for (const k of FORBIDDEN_KEYS) dirty[k] = 'leaked-secret-value';
        dirty.email = 'user@example.com';
        dirty.stack = 'Error: at foo';
        const safe = sanitizePrivateSampleProps(dirty);
        expect(Object.keys(safe)).toHaveLength(0);
    });

    it('keeps the allowed numeric summaries (incl. time_to_first_text_ms)', () => {
        const input = Object.fromEntries(ALLOWED_NUMERIC.map((k) => [k, 1234]));
        const safe = sanitizePrivateSampleProps(input);
        for (const k of ALLOWED_NUMERIC) expect(safe[k as keyof typeof safe]).toBe(1234);
    });

    it('drops nested objects/arrays (potential PII containers)', () => {
        const safe = sanitizePrivateSampleProps({
            engine_variant: 'private_v4',
            segments: [{ text: 'hello world' }],
            payload: { transcript: 'secret' },
        });
        expect(safe.engine_variant).toBe('private_v4');
        expect(Object.keys(safe)).toEqual(['engine_variant']);
    });

    it('emitted PostHog payload never contains a forbidden key', () => {
        setPrivateSampleContext({ engine_variant: 'private_v2', assignment_source: 'default', session_id: 'sess-1' });
        emitPrivateSample(PRIVATE_SAMPLE_EVENTS.FIRST_TRANSCRIPT_SEEN, {
            time_to_first_text_ms: 820,
            transcript: 'this should never be sent',
            text: 'nor this',
            audio: 'nor this blob',
        });
        expect(captureMock).toHaveBeenCalledTimes(1);
        const [eventName, payload] = captureMock.mock.calls[0];
        expect(eventName).toBe('private_sample_first_transcript_seen');
        for (const forbidden of FORBIDDEN_KEYS) {
            expect(payload).not.toHaveProperty(forbidden);
        }
        expect(payload.time_to_first_text_ms).toBe(820);
        expect(payload.engine_variant).toBe('private_v2');
        expect(payload.session_id).toBe('sess-1');
    });
});

describe('private sample telemetry — variant & assignment resolution', () => {
    it('maps the resolved engine to the durable variant', () => {
        expect(resolveSampleAssignment({ resolvedEngineType: 'transformers-js-v4', overrideActive: false, allowlisted: false, rolloutEnabled: true }).engine_variant).toBe('private_v4');
        expect(resolveSampleAssignment({ resolvedEngineType: 'transformers-js', overrideActive: false, allowlisted: false, rolloutEnabled: false }).engine_variant).toBe('private_v2');
        expect(resolveSampleAssignment({ resolvedEngineType: null, overrideActive: false, allowlisted: false, rolloutEnabled: false }).engine_variant).toBe('private_v2');
    });

    it('attributes assignment_source by precedence: override > allowlist > rollout > default', () => {
        const base = { resolvedEngineType: 'transformers-js-v4' };
        expect(resolveSampleAssignment({ ...base, overrideActive: true, allowlisted: true, rolloutEnabled: true }).assignment_source).toBe('deterministic_override');
        expect(resolveSampleAssignment({ ...base, overrideActive: false, allowlisted: true, rolloutEnabled: true }).assignment_source).toBe('allowlist');
        expect(resolveSampleAssignment({ ...base, overrideActive: false, allowlisted: false, rolloutEnabled: true }).assignment_source).toBe('posthog_flag');
        expect(resolveSampleAssignment({ resolvedEngineType: 'transformers-js', overrideActive: false, allowlisted: false, rolloutEnabled: false }).assignment_source).toBe('default');
    });

    it('always reports the rollout flag key + value for attribution', () => {
        const r = resolveSampleAssignment({ resolvedEngineType: 'transformers-js', overrideActive: false, allowlisted: false, rolloutEnabled: false });
        expect(r.posthog_flag_key).toBe('private_stt_v4_enabled');
        expect(r.posthog_flag_value).toBe(false);
    });

    it('builds the durable engine_version string for the saved session row', () => {
        expect(buildEngineVersion('private_v4', 'base_q4')).toBe('private_v4:base_q4');
        expect(buildEngineVersion('private_v2', 'whisper-base.en')).toBe('private_v2:whisper-base.en');
        expect(buildEngineVersion('private_v2', null)).toBe('private_v2');
    });
});

describe('private sample telemetry — session context + safety', () => {
    it('merges the active context into every event', () => {
        setPrivateSampleContext({ engine_variant: 'private_v4', assignment_source: 'allowlist', session_id: 'abc', model: 'base_q4' });
        emitPrivateSample(PRIVATE_SAMPLE_EVENTS.RECORDING_STARTED);
        const [, payload] = captureMock.mock.calls[0];
        expect(payload).toMatchObject({ engine_variant: 'private_v4', assignment_source: 'allowlist', session_id: 'abc', model: 'base_q4' });
    });

    it('never throws even if posthog.capture throws', () => {
        captureMock.mockImplementationOnce(() => { throw new Error('posthog boom'); });
        expect(() => emitPrivateSample(PRIVATE_SAMPLE_EVENTS.ERROR, { error_code: 'X' })).not.toThrow();
    });

    // #1259 P2 — the SECOND redaction boundary must sit on the REAL emit path. emitPrivateSample captures
    // directly to PostHog (it does NOT route through AnalyticsBuffer), so this asserts the actual wire
    // payload handed to posthog.capture — not a mirror or an alternate buffer path — is content-free even
    // when a caller passes prohibited fields (transcript/audio/email/nested/array/raw ids).
    it('the wire payload to posthog.capture is content-free on the real emit path', () => {
        setPrivateSampleContext({ engine_variant: 'private_v4', assignment_source: 'allowlist', session_id: 's9' });
        emitPrivateSample(PRIVATE_SAMPLE_EVENTS.RECORDING_STARTED, {
            time_to_first_text_ms: 700, // allowlisted → survives
            transcript: 'raw spoken words that must never leave the device',
            audio: 'BASE64AUDIO',
            email: 'user@example.com',
            user_id: 'auth-uuid-should-not-ride-along',
            segments: [{ text: 'x' }],
            nested: { blob: 'y' },
        });
        expect(captureMock).toHaveBeenCalledTimes(1);
        const [eventName, payload] = captureMock.mock.calls[0] as [string, Record<string, unknown>];
        expect(eventName).toBe('private_sample_recording_started');
        // Allowlisted primitives (context + explicit) survive to the wire…
        expect(payload).toMatchObject({ engine_variant: 'private_v4', session_id: 's9', time_to_first_text_ms: 700 });
        // …and NOTHING outside the allowlist reaches posthog.capture.
        for (const forbidden of ['transcript', 'audio', 'email', 'user_id', 'segments', 'nested', 'text', 'raw', 'tokens']) {
            expect(payload).not.toHaveProperty(forbidden);
        }
        // Every surviving key is on the Private allowlist (no field slipped past the send boundary).
        for (const key of Object.keys(payload)) {
            expect(PRIVATE_SAMPLE_ALLOWED_PROPS as readonly string[]).toContain(key);
        }
    });

    it('mirrors only sanitized (non-PII) events to window for the live e2e to read', () => {
        const w = window as unknown as { __SS_PRIVATE_SAMPLE_EVENTS__?: Array<Record<string, unknown>> };
        w.__SS_PRIVATE_SAMPLE_EVENTS__ = [];
        setPrivateSampleContext({ engine_variant: 'private_v4', assignment_source: 'allowlist', session_id: 's1' });
        emitPrivateSample(PRIVATE_SAMPLE_EVENTS.RECORDING_STARTED, { transcript: 'LEAK', audio: 'LEAK', time_to_first_text_ms: 700 });
        const mirror = w.__SS_PRIVATE_SAMPLE_EVENTS__!;
        expect(mirror).toHaveLength(1);
        expect(mirror[0]).toMatchObject({ event: 'private_sample_recording_started', engine_variant: 'private_v4', session_id: 's1' });
        for (const forbidden of ['transcript', 'audio', 'text', 'raw', 'segments', 'tokens']) {
            expect(mirror[0]).not.toHaveProperty(forbidden);
        }
    });
});
