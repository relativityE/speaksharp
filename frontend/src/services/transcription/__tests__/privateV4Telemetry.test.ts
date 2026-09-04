import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1259 — the seam moved. `emitV4Telemetry` used to call `posthog.capture` directly, which is exactly
// the second capture boundary this change retires, so asserting on a posthog mock here would keep
// testing the defect. The emitter's contract is now "hand this event to the ONE governed boundary";
// that the boundary then projects `private_stt_v4_*` through the v4 allowlist is proved at the
// boundary itself, in AnalyticsBuffer.test.ts, where the real projection runs.
const pushMock = vi.fn();
vi.mock('@/services/AnalyticsBuffer', () => ({
    analyticsBuffer: { push: (...args: unknown[]) => pushMock(...args) },
}));
vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
    sanitizeV4TelemetryProps,
    emitV4Telemetry,
    emitV4Ready,
    emitV4DecodeComplete,
    emitV4Fallback,
    emitV4SessionSaved,
    emitV4Error,
    buildV4LifecycleProps,
    V4_TELEMETRY_EVENTS,
    V4_TELEMETRY_ALLOWED_PROPS,
} from '../privateV4Telemetry';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('sanitizeV4TelemetryProps — privacy allowlist', () => {
    it('keeps every allowlisted non-PII property', () => {
        const input = {
            engine: 'transformers-js-v4',
            variant: 'base_q4',
            model: 'onnx-community/whisper-base.en',
            dtype: 'encoder_model=fp32,decoder_model_merged=q4',
            requestedDevice: 'webgpu',
            resolvedDevice: 'webgpu',
            webgpuAvailable: true,
            fallbackAttempted: false,
            fallbackReason: null,
            loadMs: 1200,
            decodeMs: 800,
            rtf: 0.4,
            recordStarted: true,
            stopSucceeded: true,
            saved: true,
            historyOpened: false,
            errorClass: 'TimeoutError',
            // #1259 — the `private_stt_v4_attempt` fields. That event was captured directly with its
            // RAW payload, so these five reached PostHog without passing through any allowlist. They
            // are enumerated now that the event goes through the governed boundary; this assertion
            // fails if one is added to the allowlist without a stated reason, or dropped from it.
            selectionSource: 'config',
            selectedVariant: 'base_q4',
            attemptedProvider: 'transformers-js-v4',
            finalProvider: 'transformers-js-v4',
            fallbackProvider: null,
        };
        const out = sanitizeV4TelemetryProps(input);
        expect(out).toEqual(input);
        expect(Object.keys(out).sort()).toEqual([...V4_TELEMETRY_ALLOWED_PROPS].sort());
    });

    it('DROPS PII / unsafe keys (email, transcript, audio, raw stack, secrets, provider payload)', () => {
        const out = sanitizeV4TelemetryProps({
            variant: 'base_q4',
            email: 'user@example.com',
            transcript: 'the user said something private',
            audio: new Float32Array(16000),
            stack: 'Error: boom\n at foo (x.ts:1:1)',
            errorStack: 'Error: boom\n at bar',
            sk_live: 'sk_live_abc123',
            providerPayload: { nested: 'secret' },
            userId: 'user-uuid-123',
            distinctId: 'abc',
        });
        expect(out).toEqual({ variant: 'base_q4' });
        for (const banned of ['email', 'transcript', 'audio', 'stack', 'errorStack', 'sk_live', 'providerPayload', 'userId', 'distinctId']) {
            expect(out).not.toHaveProperty(banned);
        }
    });

    it('drops objects/arrays even under an allowlisted key (no nested PII can ride along)', () => {
        const out = sanitizeV4TelemetryProps({
            variant: { evil: 'object' } as unknown as string,
            model: ['array'] as unknown as string,
            loadMs: 10,
        });
        expect(out).toEqual({ loadMs: 10 });
    });

    it('omits undefined but preserves null', () => {
        const out = sanitizeV4TelemetryProps({ variant: undefined, fallbackReason: null, loadMs: 0 });
        expect(out).toEqual({ fallbackReason: null, loadMs: 0 });
        expect(out).not.toHaveProperty('variant');
    });

    it('returns empty object for undefined/empty input', () => {
        expect(sanitizeV4TelemetryProps(undefined)).toEqual({});
        expect(sanitizeV4TelemetryProps({})).toEqual({});
    });

    it('allowlist contains no obviously-PII keys', () => {
        for (const banned of ['email', 'transcript', 'audio', 'stack', 'userId', 'token', 'secret']) {
            expect(V4_TELEMETRY_ALLOWED_PROPS as readonly string[]).not.toContain(banned);
        }
    });
});

describe('emitV4Telemetry — events + capture', () => {
    it('exposes exactly the six Stage-B event names', () => {
        expect(V4_TELEMETRY_EVENTS).toEqual({
            ATTEMPT: 'private_stt_v4_attempt',
            READY: 'private_stt_v4_ready',
            DECODE_COMPLETE: 'private_stt_v4_decode_complete',
            FALLBACK: 'private_stt_v4_fallback',
            SESSION_SAVED: 'private_stt_v4_session_saved',
            ERROR: 'private_stt_v4_error',
        });
    });

    it('hands the event to the single governed boundary, not to posthog directly', () => {
        emitV4Telemetry(V4_TELEMETRY_EVENTS.READY, {
            variant: 'base_q4',
            loadMs: 900,
            email: 'leak@example.com',
            transcript: 'secret words',
        });
        expect(pushMock).toHaveBeenCalledTimes(1);
        const [event, props, priority] = pushMock.mock.calls[0];
        expect(event).toBe('private_stt_v4_ready');
        expect(priority).toBe('LOW');
        // The RAW props are handed over deliberately: projecting here as well would mean a caller who
        // reaches the buffer another way is unprotected, and it would hide a boundary regression behind
        // a producer that happened to sanitize first.
        expect(props).toMatchObject({ variant: 'base_q4', loadMs: 900 });
    });

    it('convenience emitters fire the correct event names', () => {
        emitV4Ready({ variant: 'base_q4' });
        emitV4DecodeComplete({ decodeMs: 700, rtf: 0.3 });
        emitV4Fallback({ fallbackAttempted: true, fallbackReason: 'v4_init_failed' });
        emitV4SessionSaved({ saved: true });
        emitV4Error({ errorClass: 'LoadError' });
        const events = pushMock.mock.calls.map((c) => c[0]);
        expect(events).toEqual([
            'private_stt_v4_ready',
            'private_stt_v4_decode_complete',
            'private_stt_v4_fallback',
            'private_stt_v4_session_saved',
            'private_stt_v4_error',
        ]);
    });

    it('never throws when the analytics boundary throws (telemetry must not break the STT path)', () => {
        pushMock.mockImplementationOnce(() => { throw new Error('analytics down'); });
        expect(() => emitV4Ready({ variant: 'base_q4' })).not.toThrow();
    });
});

describe('buildV4LifecycleProps — pure mapper (allowlisted, fallbackAttempted derived)', () => {
    it('maps a successful v4 decision to allowlisted props (fallbackAttempted=false)', () => {
        const props = buildV4LifecycleProps({
            finalEngine: 'transformers-js-v4',
            variant: 'base_q4',
            model: 'onnx-community/whisper-base.en',
            dtype: '{"encoder_model":"fp32","decoder_model_merged":"q4"}',
            requestedDevice: 'webgpu',
            resolvedDevice: 'webgpu',
            webgpuAvailable: true,
            fallbackReason: null,
            loadMs: 1200,
        });
        expect(props).toEqual({
            engine: 'transformers-js-v4',
            variant: 'base_q4',
            model: 'onnx-community/whisper-base.en',
            dtype: '{"encoder_model":"fp32","decoder_model_merged":"q4"}',
            requestedDevice: 'webgpu',
            resolvedDevice: 'webgpu',
            webgpuAvailable: true,
            fallbackAttempted: false,
            fallbackReason: null,
            loadMs: 1200,
        });
    });

    it('derives fallbackAttempted=true when a fallback reason is present', () => {
        const props = buildV4LifecycleProps({
            finalEngine: 'transformers-js',
            variant: 'base_q4',
            fallbackReason: 'v4_init_failed',
            loadMs: 50,
        });
        expect(props.fallbackAttempted).toBe(true);
        expect(props.fallbackReason).toBe('v4_init_failed');
        expect(props.engine).toBe('transformers-js');
    });

    it('omits undefined inputs and carries no key outside the allowlist', () => {
        const props = buildV4LifecycleProps({ variant: 'base_q4' });
        for (const key of Object.keys(props)) {
            expect(V4_TELEMETRY_ALLOWED_PROPS as readonly string[]).toContain(key);
        }
        expect(props).not.toHaveProperty('requestedDevice'); // undefined input dropped
    });
});
