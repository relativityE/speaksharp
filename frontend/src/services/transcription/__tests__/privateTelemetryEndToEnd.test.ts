/**
 * #1392 — PRODUCER -> BUFFER -> WIRE, in one pass.
 *
 * `privateTelemetry.test.ts` stops at the buffer boundary: it proves `emitPrivateTelemetry` hands the
 * event to `analyticsBuffer.push` and stops there. That cannot show what actually reaches PostHog, and
 * the whole point of routing through the seam is what the seam ADDS — the #1259 envelope.
 *
 * Proving it in two halves would leave the join untested, which is the same gap that let a Private
 * session's telemetry carry no model attribution for as long as it did. So this drives the REAL
 * producer through the REAL buffer and asserts the final `posthog.capture` payload.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import posthog from 'posthog-js';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { emitPrivateTelemetry, PRIVATE_TELEMETRY_EVENTS, setPrivateTelemetryContext } from '../privateTelemetry';
import { recordResolvedEngine, clearResolvedEngine } from '@/services/telemetry/runtimeAttribution';

vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(), identify: vi.fn(), reset: vi.fn(),
        reloadFeatureFlags: vi.fn(), _isIdentified: vi.fn(),
    },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn() }));

const captured = () => (posthog.capture as ReturnType<typeof vi.fn>).mock.calls
    .find((c: unknown[]) => c[0] === 'private_error')?.[1] as Record<string, unknown> | undefined;

const RELEASE = 'a19324610634b9e05a375fff8838f2bbbae3a4f1';

describe('private telemetry reaches the wire through the governed seam', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        clearResolvedEngine();
        (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ = RELEASE;
        analyticsBuffer.queue = [];
        analyticsBuffer.isFlushing = false;
        analyticsBuffer.ready = true;
    });
    afterEach(() => {
        vi.useRealTimers();
        clearResolvedEngine();
        delete (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__;
    });

    async function drain() {
        analyticsBuffer.flush();
        await vi.runAllTimersAsync();
    }

    it('CASUALTY: the ENVELOPE rides a Private event — the reason the seam exists', async () => {
        // Before this routing, a Private session's own telemetry carried no candidate_id: it could not
        // say which model produced the session it was reporting on.
        recordResolvedEngine({
            candidateId: 'v4:base:int8',
            modelIdentity: { engine: 'transformers-js-v4', configuredRuntime: { version: '3.7.5' } },
        });
        emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.ERROR, { error_code: 'SetupError' });
        await drain();

        const props = captured();
        expect(props, 'the event must reach the wire').toBeTruthy();
        expect(props?.candidate_id).toBe('v4:base:int8');
        expect(props?.engine).toBe('transformers-js-v4');
        expect(props?.release_sha).toBe(RELEASE);
        expect(props?.traffic_type).toBeTruthy();
    });

    it('CASUALTY: content is dropped at the WIRE, not merely at the producer', async () => {
        // The buffer re-applies the private projection, so the guarantee holds even if a future caller
        // hands it something unsanitized.
        emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.ERROR, {
            error_code: 'SetupError',
            transcript: 'must not leave',
            email: 'user@example.com',
        });
        await drain();

        const props = captured();
        expect(props?.error_code).toBe('SetupError');
        expect(JSON.stringify(props)).not.toContain('must not leave');
        expect(JSON.stringify(props)).not.toContain('user@example.com');
    });

    it('CASUALTY: no raw session id reaches the wire, even from the producer CONTEXT', async () => {
        setPrivateTelemetryContext({ session_id: 'sess-abc-123', engine_variant: 'private_v2' });
        emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.ERROR, { error_code: 'SetupError' });
        await drain();

        const props = captured();
        expect(props).not.toHaveProperty('session_id');
        expect(JSON.stringify(props)).not.toContain('sess-abc-123');
        // and the field that replaced it is expressible
        expect(props?.engine_variant).toBe('private_v2');
    });

    it('an unresolved engine yields NULL attribution rather than a guess', async () => {
        emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.ERROR, { error_code: 'SetupError' });
        await drain();
        expect(captured()?.candidate_id).toBeNull();
    });
});
