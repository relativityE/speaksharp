// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { completeSession, updateSession, wireProgressEvaluationOnSave, finalizeObjectiveSessionOnSave, attestInvoke } = vi.hoisted(() => ({
    completeSession: vi.fn(),
    updateSession: vi.fn(),
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
    updateSession,
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
const METRICS_PAYLOAD = {
    total_words: 7,
    filler_words: { total: { count: 0, instances: [] } },
    custom_words: {},
    pause_metrics: { totalPauses: 0, averagePauseDuration: 0, longestPause: 0, pauses: [] },
    wpm: 118,
    clarity_score: 91,
    accuracy: 0.98,
};

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
        updateSession.mockReset().mockResolvedValue({ success: true });
        wireProgressEvaluationOnSave.mockReset().mockResolvedValue(undefined);
        finalizeObjectiveSessionOnSave.mockReset().mockResolvedValue({
            ok: true, registered: true, objectiveSessionId: 'objective-1', evidenceCount: 1, coverage: [],
        });
        attestInvoke.mockReset().mockResolvedValue({ data: { attributed: true }, error: null });
    });

    it('attribution retry uses the original Focus Points context and evaluates only after registration', async () => {
        useSessionStore.getState().setActiveObjectiveBrief(LATER_BRIEF);
        retry.pendingAttributionRetry = {
            sessionId: 'session-attribution', evidence: EVIDENCE, progressContext: FOCUS_CONTEXT,
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: true },
        };

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
        retry.pendingAttributionRetry = {
            sessionId: 'session-register-failed', evidence: EVIDENCE, progressContext: FOCUS_CONTEXT,
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: true },
        };

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
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: false },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(completeSession).toHaveBeenCalledTimes(1);
        expect(updateSession).toHaveBeenCalledWith('session-full-save', METRICS_PAYLOAD);
        expect(finalizeObjectiveSessionOnSave).toHaveBeenCalledWith(expect.objectContaining({ sourceSessionId: 'session-full-save' }));
        expect(updateSession.mock.invocationCallOrder[0])
            .toBeLessThan(finalizeObjectiveSessionOnSave.mock.invocationCallOrder[0]);
        expect(wireProgressEvaluationOnSave).toHaveBeenCalledTimes(1);
    });

    it('full-save retry with failed Focus Points registration writes no evaluation', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, registered: false, stage: 'register', reason: 'error' });
        retry.pendingFullSaveRetry = {
            sessionId: 'session-full-save-register-failed',
            completeArgs: { status: 'completed', transcript: 'price timeline', duration: 42 },
            attributionEvidence: EVIDENCE,
            progressContext: FOCUS_CONTEXT,
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: false },
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
            progressMetrics: { payload: null, persisted: false },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).not.toHaveBeenCalled();
    });

    it('Open Mic retry evaluates immediately without objective registration', async () => {
        retry.pendingAttributionRetry = {
            sessionId: 'session-open-mic', evidence: EVIDENCE, progressContext: { mode: 'open_mic' },
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: true },
        };

        await expect(retry.retryPendingAttribution()).resolves.toBe(true);

        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).toHaveBeenCalledTimes(1);
    });

    it('Open Mic full-save retry without a trustworthy metrics payload saves but writes no Progress evaluation', async () => {
        retry.pendingFullSaveRetry = {
            sessionId: 'session-open-mic-no-metrics',
            completeArgs: { status: 'completed', transcript: 'saved words', duration: 42 },
            attributionEvidence: EVIDENCE,
            progressContext: { mode: 'open_mic' },
            progressMetrics: { payload: null, persisted: false },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(completeSession).toHaveBeenCalledTimes(1);
        expect(updateSession).not.toHaveBeenCalled();
        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).not.toHaveBeenCalled();
    });

    it('Focus Points full-save retry without a trustworthy metrics payload saves but writes no Progress evaluation', async () => {
        retry.pendingFullSaveRetry = {
            sessionId: 'session-focus-no-metrics',
            completeArgs: { status: 'completed', transcript: 'saved words', duration: 42 },
            attributionEvidence: EVIDENCE,
            progressContext: FOCUS_CONTEXT,
            progressMetrics: { payload: null, persisted: false },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(updateSession).not.toHaveBeenCalled();
        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).not.toHaveBeenCalled();
    });

    it('Focus Points full-save retry with a failed metrics write skips registration and Progress', async () => {
        updateSession.mockResolvedValue({ success: false, error: 'metrics unavailable' });
        retry.pendingFullSaveRetry = {
            sessionId: 'session-focus-metrics-failed',
            completeArgs: { status: 'completed', transcript: 'price timeline', duration: 42 },
            attributionEvidence: EVIDENCE,
            progressContext: FOCUS_CONTEXT,
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: false },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(updateSession).toHaveBeenCalledWith('session-focus-metrics-failed', METRICS_PAYLOAD);
        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).not.toHaveBeenCalled();
    });

    it('Open Mic full-save retry with a failed metrics write skips Progress', async () => {
        updateSession.mockResolvedValue({ success: false, error: 'metrics unavailable' });
        retry.pendingFullSaveRetry = {
            sessionId: 'session-open-mic-metrics-failed',
            completeArgs: { status: 'completed', transcript: 'saved words', duration: 42 },
            attributionEvidence: EVIDENCE,
            progressContext: { mode: 'open_mic' },
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: false },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(updateSession).toHaveBeenCalledWith('session-open-mic-metrics-failed', METRICS_PAYLOAD);
        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).not.toHaveBeenCalled();
    });

    it('Open Mic full-save retry with successful metrics writes exactly one evaluation', async () => {
        retry.pendingFullSaveRetry = {
            sessionId: 'session-open-mic-metrics-ok',
            completeArgs: { status: 'completed', transcript: 'saved words', duration: 42 },
            attributionEvidence: EVIDENCE,
            progressContext: { mode: 'open_mic' },
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: false },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(updateSession).toHaveBeenCalledWith('session-open-mic-metrics-ok', METRICS_PAYLOAD);
        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['Open Mic', { mode: 'open_mic' }],
        ['Focus Points', FOCUS_CONTEXT],
    ] as const)('%s attribution retry after the original metrics failure writes no evaluation', async (_label, progressContext) => {
        retry.pendingAttributionRetry = {
            sessionId: `session-attribution-metrics-failed-${progressContext.mode}`,
            evidence: EVIDENCE,
            progressContext,
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: false },
        };

        await expect(retry.retryPendingAttribution()).resolves.toBe(true);

        expect(updateSession).not.toHaveBeenCalled();
        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).not.toHaveBeenCalled();
    });
});
