// @vitest-environment jsdom
/**
 * #1421 P1 — A FILLER MEASUREMENT FROM A FAILED TAKE MUST NOT READ AS CONFIRMED ATTRIBUTION.
 *
 * `emitFillerMeasurement` runs inside `stopRecording()` at the point the save-selected transcript is
 * known. Tracing the method: the emit sits at the transcript-selection block, the first
 * `completeSession()` call comes later, and `attestSessionEngine()` later still. So the row is
 * published carrying the candidate the ENGINE had resolved, before any persistence or attestation
 * result exists. A take whose completion then failed had already emitted a row naming that candidate,
 * and nothing on the wire distinguished it from a confirmed one.
 *
 * `attribution_state` is the bounded field that closes that gap, and these cases prove it AT THE FINAL
 * CONSUMER — the payload `posthog.capture` receives, after the real governed projection — driving the
 * REAL controller stop with persistence deliberately rejecting. An assertion at the call site would
 * prove nothing about what a reader of the wire can conclude, and a hand-built payload would prove
 * nothing about what the stop path actually supplies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import posthog from 'posthog-js';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { beginJourney, __resetJourneyIdentityForTests } from '@/services/telemetry/journeyIdentity';
import { markIdentitySettled, __resetAcquisitionTelemetry } from '@/services/transcription/modelAcquisitionTelemetry';
import { completeSession } from '@/lib/storage';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';

vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn(),
        get_distinct_id: vi.fn(() => 'anon'), __loaded: true,
    },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn(), withScope: vi.fn() }));
vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    // Persistence FAILS. This is the condition the finding is about.
    completeSession: vi.fn().mockRejectedValue(new Error('persistence rejected')),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u' } } } }) },
    })),
}));

const TRANSCRIPT = 'um so this is a real take with um some uh fillers in it';

const fillerRows = () => (posthog.capture as unknown as {
    mock: { calls: Array<[string, Record<string, unknown>]> };
}).mock.calls.filter((c) => c[0] === 'filler_measurement').map((c) => c[1]);

describe('#1421 filler attribution state at the wire', () => {
    let controller: SpeechRuntimeController;

    beforeEach(() => {
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        (controller as unknown as Record<string, unknown>).state = 'RECORDING';
        (controller as unknown as Record<string, unknown>).initialized = true;
        (controller as unknown as Record<string, unknown>).isEngineReady = true;
        (controller as unknown as Record<string, unknown>).isEmissionsSafe = true;
        (controller as unknown as Record<string, unknown>).sessionId = 'test-sess';
        (controller as unknown as Record<string, unknown>).service = {
            getMode: vi.fn().mockReturnValue('private'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - 60_000),
            stopTranscription: vi.fn().mockResolvedValue({ transcript: TRANSCRIPT }),
            destroy: vi.fn().mockResolvedValue(undefined),
            isServiceDestroyed: () => false,
            getState: vi.fn().mockReturnValue('RECORDING'),
            subscribe: vi.fn(() => vi.fn()),
            fsm: { is: vi.fn().mockReturnValue(false) },
        } as unknown as ITranscriptionService;

        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().updateTranscript(TRANSCRIPT, '');

        // The buffer must be armed and identity settled, or nothing reaches the consumer at all and
        // every assertion below would pass vacuously against an empty capture list.
        analyticsBuffer.queue.length = 0;
        analyticsBuffer.ready = true;
        __resetJourneyIdentityForTests();
        beginJourney();
        __resetAcquisitionTelemetry();
        markIdentitySettled('u');
        vi.clearAllMocks();
    });

    afterEach(() => { analyticsBuffer.queue.length = 0; });

    const stopAndDrain = async () => {
        await controller.stopRecording().catch(() => { /* persistence rejects; that is the point */ });
        for (let i = 0; i < 80 && analyticsBuffer.queue.length > 0; i += 1) {
            await new Promise((r) => setTimeout(r, 0));
        }
    };

    it('CASUALTY: a take whose persistence FAILS still publishes only a PENDING attribution', async () => {
        await stopAndDrain();

        // The precondition, asserted rather than assumed: the row exists, so this is not a vacuous pass.
        const rows = fillerRows();
        expect(rows.length, 'the real stop path published a filler measurement').toBeGreaterThan(0);
        expect(vi.mocked(completeSession), 'and persistence really was exercised and really failed')
            .toHaveBeenCalled();

        for (const row of rows) {
            expect(row.attribution_state,
                'persistence failed, so nothing may present this candidate as confirmed')
                .toBe('pending');
        }
        // The measurement itself is still real — the guard is about attribution, not the numbers.
        expect(rows[0].detector_input_fillers,
            'the detector input is genuine; only its attribution is unconfirmed')
            .toBeGreaterThan(0);
    });

    it('CASUALTY: the row never claims verified on any stop path', async () => {
        /**
         * The discriminating half. Flipping the producer's literal to `'verified'` fails here, which is
         * what binds these cases to the stop path rather than to a hand-built payload. `verified` is
         * reserved for an attestation-driven producer that does not exist yet; until it does, no stop
         * can emit it.
         */
        await stopAndDrain();

        const states = fillerRows().map((r) => r.attribution_state);
        expect(states.length).toBeGreaterThan(0);
        expect(states.includes('verified'),
            'no stop path may assert confirmed attribution — attestation is the only authority for that')
            .toBe(false);
    });
});
