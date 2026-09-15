// @vitest-environment jsdom
/**
 * RWT-08 — an acquisition failure must leave an honest, RECOVERABLE state.
 *
 * Composition that no existing test drives: the REAL switch installer and the REAL controller, with
 * only `initiateModelDownload` stubbed. The stub models what main does when a private init fails:
 * `TranscriptionService.initializeStrategy` catches the failure, moves to INIT_FAILED and RETURNS, so
 * setup resolves but no engine ever publishes an identity.
 *
 * Production observation being reproduced: "Start stayed enabled but every press refused with identity
 * mismatch and no setup retry."
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { TranscriptionMode } from '../transcription/TranscriptionPolicy';
import { speechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { __resetRecordingIntentForTests, pendingRecordingIntent } from '../recordingIntent';
import { installRuntimeCandidateSwitch } from '../transcription/installRuntimeSwitch';
import {
    clearRuntimeCandidateOverride,
    registerSwitchExecutor,
    runtimeCandidateExpectation,
    switchCandidate,
} from '../transcription/runtimeCandidateSwitch';
import { clearResolvedEngine, resolvedEngine } from '../telemetry/runtimeAttribution';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn(), heartbeatSession: vi.fn(), completeSession: vi.fn(), updateSession: vi.fn(),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => {
        throw new Error('identity refusal reached auth/network');
    }),
}));

const PRIVATE_POLICY = {
    allowNative: false,
    allowCloud: false,
    allowPrivate: true,
    preferredMode: 'private',
    allowFallback: false,
    executionIntent: 'test',
};

describe('RWT-08 a failed Moonshine acquisition does not strand Start', () => {
    let setupSpy: MockInstance<(mode?: TranscriptionMode) => Promise<void>>;

    beforeEach(async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor(null);
        __resetRecordingIntentForTests();
        (speechRuntimeController as unknown as { state: string }).state = 'READY';
        speechRuntimeController.service = null;
        document.documentElement.setAttribute('data-runtime-state', 'READY');
        useSessionStore.getState().resetSession();
        // Setup resolves WITHOUT an identity: the caught INIT_FAILED path on main.
        setupSpy = vi.spyOn(speechRuntimeController, 'initiateModelDownload').mockImplementation(async () => {});
        await installRuntimeCandidateSwitch();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        setupSpy.mockRestore();
        registerSwitchExecutor(null);
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        speechRuntimeController.service = null;
        document.documentElement.removeAttribute('data-runtime-state');
    });

    it('PRECONDITION: the failed switch leaves the authorized candidate expected and nothing observed', async () => {
        const out = await switchCandidate('moonshine:streaming-medium');
        expect(out).toMatchObject({ ok: false, code: 'identity_mismatch' });
        expect(runtimeCandidateExpectation()).toBe('moonshine:streaming-medium');
        expect(resolvedEngine()).toBeNull();
    });

    it('CASUALTY: a Start after the failed acquisition retries setup instead of refusing identically forever', async () => {
        await switchCandidate('moonshine:streaming-medium');
        const setupCallsAfterSwitch = setupSpy.mock.calls.length;
        (speechRuntimeController as unknown as { state: string }).state = 'IDLE';

        const refusals: string[] = [];
        for (let press = 0; press < 2; press += 1) {
            try {
                await speechRuntimeController.startRecording(PRIVATE_POLICY as never, []);
            } catch (e) {
                refusals.push(e instanceof Error ? e.message : String(e));
            }
        }

        const setupRetried = setupSpy.mock.calls.length > setupCallsAfterSwitch;
        expect(setupRetried,
            `Start must drive setup for the same authorized candidate; presses refused with ${JSON.stringify(refusals)}`)
            .toBe(true);
    });

    it('CASUALTY: EVERY press re-prepares, is answered with the real cause, and leaves Start usable', async () => {
        // A single retry is not recovery. If the first unprepared attempt parks the runtime in
        // DOWNLOAD_REQUIRED, the next press is absorbed as a no-op and the page is stranded again.
        await switchCandidate('moonshine:streaming-medium');
        const setupCallsAfterSwitch = setupSpy.mock.calls.length;
        (speechRuntimeController as unknown as { state: string }).state = 'IDLE';

        for (let press = 1; press <= 2; press += 1) {
            await expect(speechRuntimeController.startRecording(PRIVATE_POLICY as never, []),
                `press ${press} must settle with the preparation outcome, not hang or resolve silently`)
                .rejects.toThrow('RUNTIME_CANDIDATE_IDENTITY_MISMATCH:observed_missing');
            await vi.waitFor(() => expect(speechRuntimeController.getState()).toBe('IDLE'));
            expect(setupSpy.mock.calls.length - setupCallsAfterSwitch).toBe(press);
        }
        expect(pendingRecordingIntent(), 'no wish may survive to auto-start later').toBeNull();
    });

    it('CONTROL: a genuinely DIFFERENT observed model is still refused before any setup work', async () => {
        await switchCandidate('moonshine:streaming-medium');
        const { recordResolvedEngine } = await import('../telemetry/runtimeAttribution');
        recordResolvedEngine({ candidateId: 'v2:base.en' } as never);
        const setupCallsAfterSwitch = setupSpy.mock.calls.length;
        (speechRuntimeController as unknown as { state: string }).state = 'IDLE';

        await expect(speechRuntimeController.startRecording(PRIVATE_POLICY as never, []))
            .rejects.toThrow('RUNTIME_CANDIDATE_IDENTITY_MISMATCH:observed_mismatch');
        expect(setupSpy.mock.calls.length).toBe(setupCallsAfterSwitch);
        expect(speechRuntimeController.service).toBeNull();
    });
});
