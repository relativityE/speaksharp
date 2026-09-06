// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { speechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { pendingRecordingIntent, __resetRecordingIntentForTests } from '../recordingIntent';
import {
    clearRuntimeCandidateOverride,
    registerSwitchExecutor,
    runtimeCandidateOverride,
    switchCandidate,
} from '../transcription/runtimeCandidateSwitch';
import { clearResolvedEngine, recordResolvedEngine } from '../telemetry/runtimeAttribution';

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

describe('#1426 recording authority enforces model identity', () => {
    beforeEach(async () => {
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor({
            currentState: () => 'READY',
            teardown: async () => {},
            initialize: async () => {},
            observedCandidate: () => runtimeCandidateOverride(),
        });
        __resetRecordingIntentForTests();
        (speechRuntimeController as unknown as { state: string; service: unknown }).state = 'IDLE';
        speechRuntimeController.service = null;
        useSessionStore.getState().resetSession();
        delete (window as unknown as { __SS_PRIVATE_EVENTS__?: unknown }).__SS_PRIVATE_EVENTS__;
        await switchCandidate('moonshine:streaming-medium', { VITE_INTERNAL_BUILD: 'true' });
    });

    afterEach(() => {
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor(null);
    });

    it('CASUALTY: forced mismatch refuses before service, intent, auth, mic, or transcription work', async () => {
        recordResolvedEngine({ candidateId: 'v2:base.en' } as never);

        await expect(speechRuntimeController.startRecording(PRIVATE_POLICY as never, []))
            .rejects.toThrow('RUNTIME_CANDIDATE_IDENTITY_MISMATCH:observed_mismatch');

        expect(speechRuntimeController.service).toBeNull();
        expect(pendingRecordingIntent()).toBeNull();
        expect(speechRuntimeController.getState()).toBe('IDLE');
        expect(useSessionStore.getState().sttStatus).toMatchObject({
            type: 'error',
            message: 'Model comparison identity could not be verified. Switch the model again before recording.',
        });
        const events = (window as unknown as { __SS_PRIVATE_EVENTS__?: Array<Record<string, unknown>> })
            .__SS_PRIVATE_EVENTS__ ?? [];
        expect(events[events.length - 1]).toMatchObject({
            event: 'private_error',
            error_code: 'RuntimeCandidateIdentityMismatch',
            fallback_reason: 'observed_mismatch',
            model_attribution_verified: false,
        });
        expect(JSON.stringify(events)).not.toContain('moonshine:streaming-medium');
        expect(JSON.stringify(events)).not.toContain('v2:base.en');
    });
});
