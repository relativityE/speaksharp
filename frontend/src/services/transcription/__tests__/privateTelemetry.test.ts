import { beforeEach, describe, expect, it, vi } from 'vitest';
import posthog from 'posthog-js';
import {
    PRIVATE_TELEMETRY_EVENTS,
    buildEngineVersion,
    emitPrivateTelemetry,
    resolvePrivateAssignment,
    sanitizePrivateTelemetryProps,
    setPrivateTelemetryContext,
} from '../privateTelemetry';

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));

describe('content-free Private telemetry', () => {
    beforeEach(() => {
        vi.mocked(posthog.capture).mockClear();
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
            session_id: 's1',
            error_code: 'SetupError',
            transcript: 'sensitive',
            audio: 'raw',
            nested: { email: 'user@example.com' },
        })).toEqual({ session_id: 's1', error_code: 'SetupError' });
    });

    it('re-projects before the wire and mirrors only allowlisted fields', () => {
        setPrivateTelemetryContext({ session_id: 's1', engine_variant: 'private_v2' });
        emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.ERROR, {
            error_code: 'SetupError',
            transcript: 'must not leave',
        });
        expect(posthog.capture).toHaveBeenCalledWith('private_error', {
            session_id: 's1',
            engine_variant: 'private_v2',
            error_code: 'SetupError',
        });
        expect((window as unknown as { __SS_PRIVATE_EVENTS__: unknown[] }).__SS_PRIVATE_EVENTS__).toEqual([
            expect.objectContaining({ event: 'private_error', session_id: 's1', engine_variant: 'private_v2' }),
        ]);
        expect(JSON.stringify((window as unknown as { __SS_PRIVATE_EVENTS__: unknown[] }).__SS_PRIVATE_EVENTS__)).not.toContain('must not leave');
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
});
