// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { completeSession, wireProgressEvaluationOnSave, finalizeObjectiveSessionOnSave, attestInvoke } = vi.hoisted(() => ({
    completeSession: vi.fn(),
    wireProgressEvaluationOnSave: vi.fn(),
    finalizeObjectiveSessionOnSave: vi.fn(),
    attestInvoke: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));
vi.mock('@/lib/storage', () => ({
    saveSession: vi.fn(),
    completeSession,
    heartbeatSession: vi.fn(),
    updateSession: vi.fn(),
}));
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        functions: { invoke: (...args: unknown[]) => attestInvoke(...args) },
        auth: { getSession: vi.fn() },
    }),
}));
vi.mock('@/services/progress/recordProgress', () => ({ wireProgressEvaluationOnSave }));
vi.mock('@/services/objective/finalizeObjectiveSessionOnSave', () => ({ finalizeObjectiveSessionOnSave }));

import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';

const ORIGINAL_BRIEF = { projectId: 'project-original', briefId: 'brief-original', points: ['price'] };
const LATER_BRIEF = { projectId: 'project-later', briefId: 'brief-later', points: ['timeline'] };
const FOCUS_CONTEXT = {
    mode: 'focus_points' as const,
    brief: ORIGINAL_BRIEF,
    segments: [{ text: 'price', startSec: 1 }],
    durationSeconds: 42,
};
const EVIDENCE = { provider: 'transformers-js', engine: 'private', fallback_occurred: false, cloud_used: false };

type RetryController = {
    capturedUserId: string | null;
    recordingStartedUnresolved: boolean;
    recordingProgressMode: unknown;
    pendingAttributionRetry: unknown;
    pendingFullSaveRetry: unknown;
    snapshotProgressModeAtRecordingBoundary: () => unknown;
    buildProgressCompletionContext: (durationSeconds?: number) => unknown;
    retryPendingAttribution: () => Promise<boolean>;
    retryRecordingSave: () => Promise<boolean>;
};

describe('#1265 mode-aware Progress completion — retry paths', () => {
    let controller: SpeechRuntimeController;
    let retry: RetryController;

    beforeEach(() => {
        controller = SpeechRuntimeController.getInstance();
        retry = controller as unknown as RetryController;
        retry.capturedUserId = 'user-1';
        retry.recordingStartedUnresolved = true;
        retry.pendingAttributionRetry = null;
        retry.pendingFullSaveRetry = null;
        useSessionStore.getState().setActiveObjectiveBrief(null);
        useSessionStore.getState().setCompletedObjectiveBrief(null);
        completeSession.mockReset().mockResolvedValue({ success: true });
        wireProgressEvaluationOnSave.mockReset().mockResolvedValue(undefined);
        finalizeObjectiveSessionOnSave.mockReset().mockResolvedValue({
            ok: true, registered: true, objectiveSessionId: 'objective-1', evidenceCount: 1, coverage: [],
        });
        attestInvoke.mockReset().mockResolvedValue({ data: { attributed: true }, error: null });
    });

    it('attribution retry uses the original Focus Points context and evaluates only after registration', async () => {
        useSessionStore.getState().setActiveObjectiveBrief(LATER_BRIEF);
        retry.pendingAttributionRetry = { sessionId: 'session-attribution', evidence: EVIDENCE, progressContext: FOCUS_CONTEXT };

        await expect(retry.retryPendingAttribution()).resolves.toBe(true);

        expect(finalizeObjectiveSessionOnSave).toHaveBeenCalledWith(expect.objectContaining({
            projectId: ORIGINAL_BRIEF.projectId,
            briefId: ORIGINAL_BRIEF.briefId,
            sourceSessionId: 'session-attribution',
        }));
        expect(finalizeObjectiveSessionOnSave.mock.invocationCallOrder[0])
            .toBeLessThan(wireProgressEvaluationOnSave.mock.invocationCallOrder[0]);
        expect(wireProgressEvaluationOnSave).toHaveBeenCalledTimes(1);
        expect(useSessionStore.getState().activeObjectiveBrief).toEqual(LATER_BRIEF);
    });

    it('snapshots Focus Points at the recording boundary instead of reading a later live brief', () => {
        useSessionStore.getState().setActiveObjectiveBrief(ORIGINAL_BRIEF);
        retry.recordingProgressMode = retry.snapshotProgressModeAtRecordingBoundary();
        useSessionStore.getState().setActiveObjectiveBrief(LATER_BRIEF);

        expect(retry.buildProgressCompletionContext(42)).toMatchObject({
            mode: 'focus_points',
            brief: ORIGINAL_BRIEF,
            durationSeconds: 42,
        });
    });

    it('attribution retry with failed Focus Points registration writes no evaluation', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, registered: false, stage: 'register', reason: 'error' });
        retry.pendingAttributionRetry = { sessionId: 'session-register-failed', evidence: EVIDENCE, progressContext: FOCUS_CONTEXT };

        await expect(retry.retryPendingAttribution()).resolves.toBe(true);

        expect(finalizeObjectiveSessionOnSave).toHaveBeenCalledTimes(1);
        expect(wireProgressEvaluationOnSave).not.toHaveBeenCalled();
    });

    it('full-save retry passes through the same Focus Points registration gate', async () => {
        retry.pendingFullSaveRetry = {
            sessionId: 'session-full-save',
            completeArgs: { status: 'completed', transcript: 'price timeline', duration: 42 },
            attributionEvidence: EVIDENCE,
            progressContext: FOCUS_CONTEXT,
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(completeSession).toHaveBeenCalledTimes(1);
        expect(finalizeObjectiveSessionOnSave).toHaveBeenCalledWith(expect.objectContaining({ sourceSessionId: 'session-full-save' }));
        expect(wireProgressEvaluationOnSave).toHaveBeenCalledTimes(1);
    });

    it('full-save retry with failed Focus Points registration writes no evaluation', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, registered: false, stage: 'register', reason: 'error' });
        retry.pendingFullSaveRetry = {
            sessionId: 'session-full-save-register-failed',
            completeArgs: { status: 'completed', transcript: 'price timeline', duration: 42 },
            attributionEvidence: EVIDENCE,
            progressContext: FOCUS_CONTEXT,
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(completeSession).toHaveBeenCalledTimes(1);
        expect(finalizeObjectiveSessionOnSave).toHaveBeenCalledTimes(1);
        expect(wireProgressEvaluationOnSave).not.toHaveBeenCalled();
    });

    it('unknown legacy/reloaded retry context fails closed instead of defaulting to Open Mic', async () => {
        retry.pendingFullSaveRetry = {
            sessionId: 'session-unknown',
            completeArgs: { status: 'completed', transcript: 'saved words', duration: 42 },
            attributionEvidence: null,
            progressContext: { mode: 'unknown' },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).not.toHaveBeenCalled();
    });

    it('Open Mic retry evaluates immediately without objective registration', async () => {
        retry.pendingAttributionRetry = {
            sessionId: 'session-open-mic', evidence: EVIDENCE, progressContext: { mode: 'open_mic' },
        };

        await expect(retry.retryPendingAttribution()).resolves.toBe(true);

        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).toHaveBeenCalledTimes(1);
    });
});
