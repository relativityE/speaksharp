// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateNextActionSignal } from '@/contracts/nextActionSignal';

const { completeSession, updateSession, wireProgressEvaluationOnSave, finalizeObjectiveSessionOnSave, attestInvoke } = vi.hoisted(() => ({
    completeSession: vi.fn(),
    updateSession: vi.fn(),
    // #1354: must resolve to an OUTCOME — the controller now awaits this and gates on the result.
    wireProgressEvaluationOnSave: vi.fn().mockResolvedValue({ kind: 'recorded' }),
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
// #1354: the controller now gates the recorder on the seam's outcome, so the mock must expose the
// predicate too. `recorded` keeps these tests on the UNLOCKED path they were written for.
vi.mock('@/services/progress/recordProgress', () => ({
    wireProgressEvaluationOnSave,
    progressOutcomeAllowsNextRecording: (o: { kind: string }) =>
        o.kind === 'recorded' || o.kind === 'not_applicable',
}));
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
        wireProgressEvaluationOnSave.mockReset().mockResolvedValue({ kind: 'recorded' });
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

    /**
     * A completion payload production would actually ACCEPT. v2 rejects a fresh completed session that
     * lacks a valid structured next action or a measured metrics payload, so a retry fixture carrying
     * only status/transcript/duration models a success the server could never return. Every completed
     * retry that expects `completeSession` to succeed uses this.
     *
     * NOTE: this is the ATOMIC v2 payload. It is unrelated to `progressMetrics.payload`, which tests
     * about a missing stashed Progress payload may legitimately leave null.
     */
    const VALID_NEXT_ACTION = {
        reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
        value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1',
    } as const;
    const completedArgs = (finalTranscript: string) => ({
        status: 'completed' as const,
        duration: 42,
        nextActionSignal: VALID_NEXT_ACTION,
        metrics: {
            totalWords: 120, clarityScore: 88, wpm: 142,
            fillerCounts: { um: 4, uh: 1 },
            pauseMetrics: { totalPauses: 3, averagePauseDuration: 0.6, longestPause: 1.2, pausesPerMinute: 3 },
        },
        finalTranscript,
    });

    it('LOAD-BEARING: the completed retry fixture is one production would accept', () => {
        // If this fixture is fiction, every completed-retry success below is fiction too.
        const args = completedArgs('price timeline');
        expect(validateNextActionSignal(args.nextActionSignal).ok).toBe(true);
        expect(Object.keys(args.metrics.fillerCounts).length).toBeGreaterThan(0);
        expect(args.metrics.totalWords).toBeGreaterThan(0);
        expect(typeof args.finalTranscript).toBe('string');
    });

    it('full-save retry passes through the same Focus Points registration gate', async () => {
        retry.pendingFullSaveRetry = {
            sessionId: 'session-full-save',
            completeArgs: completedArgs('price timeline'),
            attributionEvidence: EVIDENCE,
            progressContext: FOCUS_CONTEXT,
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: false },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        // #1306 Step 3: metrics ride in the atomic v2 completion, so the ordering gate keys off THAT
        // call rather than a second PATCH that no longer exists.
        expect(completeSession).toHaveBeenCalledTimes(1);
        expect(updateSession).not.toHaveBeenCalled();
        expect(finalizeObjectiveSessionOnSave).toHaveBeenCalledWith(expect.objectContaining({ sourceSessionId: 'session-full-save' }));
        expect(completeSession.mock.invocationCallOrder[0])
            .toBeLessThan(finalizeObjectiveSessionOnSave.mock.invocationCallOrder[0]);
        expect(wireProgressEvaluationOnSave).toHaveBeenCalledTimes(1);
    });

    it('full-save retry with failed Focus Points registration writes no evaluation', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, registered: false, stage: 'register', reason: 'error' });
        retry.pendingFullSaveRetry = {
            sessionId: 'session-full-save-register-failed',
            completeArgs: completedArgs('price timeline'),
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
            completeArgs: completedArgs('saved words'),
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

    // #1306 Step 3: the stashed metrics payload existed ONLY to re-run the second write. With metrics
    // committed inside v2, a successful completion is itself proof they landed, so Progress proceeds
    // even when no payload was stashed. Absence of the payload is no longer evidence of missing metrics.
    it('Open Mic full-save retry writes Progress even without a stashed metrics payload (v2 proves metrics)', async () => {
        retry.pendingFullSaveRetry = {
            sessionId: 'session-open-mic-no-metrics',
            completeArgs: completedArgs('saved words'),
            attributionEvidence: EVIDENCE,
            progressContext: { mode: 'open_mic' },
            progressMetrics: { payload: null, persisted: false },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(completeSession).toHaveBeenCalledTimes(1);
        expect(updateSession).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).toHaveBeenCalledTimes(1);
    });

    it('Focus Points full-save retry writes Progress even without a stashed metrics payload (v2 proves metrics)', async () => {
        retry.pendingFullSaveRetry = {
            sessionId: 'session-focus-no-metrics',
            completeArgs: completedArgs('saved words'),
            attributionEvidence: EVIDENCE,
            progressContext: FOCUS_CONTEXT,
            progressMetrics: { payload: null, persisted: false },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(updateSession).not.toHaveBeenCalled();
        expect(finalizeObjectiveSessionOnSave).toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).toHaveBeenCalledTimes(1);
    });

    it('Focus Points full-save retry with a FAILED v2 completion skips registration and Progress', async () => {
        // A FAILING SECOND METRICS WRITE IS NO LONGER REACHABLE — v2 commits metrics with the transcript.
        // The equivalent hazard is now a failed COMPLETION, which must likewise skip Progress.
        completeSession.mockResolvedValueOnce({ success: false });
        retry.pendingFullSaveRetry = {
            sessionId: 'session-focus-metrics-failed',
            completeArgs: completedArgs('price timeline'),
            attributionEvidence: EVIDENCE,
            progressContext: FOCUS_CONTEXT,
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: false },
        };

        // A failed completion leaves the recording UNRESOLVED — the retry reports false and
        // the slot stays armed, exactly as a failed durable save must.
        await expect(retry.retryRecordingSave()).resolves.toBe(false);

        expect(updateSession).not.toHaveBeenCalled();
        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).not.toHaveBeenCalled();
    });

    it('Open Mic full-save retry with a FAILED v2 completion skips Progress', async () => {
        // A FAILING SECOND METRICS WRITE IS NO LONGER REACHABLE — v2 commits metrics with the transcript.
        // The equivalent hazard is now a failed COMPLETION, which must likewise skip Progress.
        completeSession.mockResolvedValueOnce({ success: false });
        retry.pendingFullSaveRetry = {
            sessionId: 'session-open-mic-metrics-failed',
            completeArgs: completedArgs('saved words'),
            attributionEvidence: EVIDENCE,
            progressContext: { mode: 'open_mic' },
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: false },
        };

        // A failed completion leaves the recording UNRESOLVED — the retry reports false and
        // the slot stays armed, exactly as a failed durable save must.
        await expect(retry.retryRecordingSave()).resolves.toBe(false);

        expect(updateSession).not.toHaveBeenCalled();
        expect(finalizeObjectiveSessionOnSave).not.toHaveBeenCalled();
        expect(wireProgressEvaluationOnSave).not.toHaveBeenCalled();
    });

    it('Open Mic full-save retry writes exactly one evaluation (metrics ride in the v2 completion)', async () => {
        retry.pendingFullSaveRetry = {
            sessionId: 'session-open-mic-metrics-ok',
            completeArgs: completedArgs('saved words'),
            attributionEvidence: EVIDENCE,
            progressContext: { mode: 'open_mic' },
            progressMetrics: { payload: METRICS_PAYLOAD, persisted: false },
        };

        await expect(retry.retryRecordingSave()).resolves.toBe(true);

        expect(updateSession).not.toHaveBeenCalled();
        expect(completeSession).toHaveBeenCalledTimes(1);
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

    describe('#1433 RETURN `5636795476` item 2 — Retry Save keeps the take locked until Progress settles', () => {
        // Both retry paths cleared their slot and unlocked BEFORE awaiting the Progress evaluation. Navigation
        // then saw a settled controller and applied a deferred Open Mic while objective evaluation was still
        // suspended. The slot and the lock now stay authoritative through settlement and owner-fenced brief
        // retirement; only then is the slot cleared, the saved marker published and the lock released.
        const lockPublished = () => useSessionStore.getState().engineSelectionLocked;
        const lockSeam = () => controller as unknown as { publishLockState: () => void; isEngineSelectionLocked: () => boolean };
        const flushUntil = async (predicate: () => boolean) => {
            for (let i = 0; i < 200 && !predicate(); i += 1) await Promise.resolve();
            return predicate();
        };
        const suspendObjectiveEvaluation = () => {
            let release: () => void = () => {};
            finalizeObjectiveSessionOnSave.mockImplementationOnce(() => new Promise((resolve) => {
                release = () => resolve({ ok: true, registered: true, objectiveSessionId: 'objective-suspended', evidenceCount: 1, coverage: [] });
            }));
            return () => release();
        };
        /** Records every change to the live brief, so "switches exactly once" is observed, not assumed. */
        const watchLiveBrief = () => {
            const changes: Array<string | null> = [];
            const unsubscribe = useSessionStore.subscribe((state, previous) => {
                if (state.activeObjectiveBrief !== previous.activeObjectiveBrief) {
                    changes.push(state.activeObjectiveBrief?.briefId ?? null);
                }
            });
            return { changes, unsubscribe };
        };
        const armRecovery = (path: 'full_save' | 'attribution') => {
            useSessionStore.getState().setActiveObjectiveBrief(ORIGINAL_BRIEF);
            if (path === 'full_save') {
                retry.pendingFullSaveRetry = {
                    sessionId: 'session-1433-r2-full',
                    completeArgs: completedArgs('price timeline'),
                    attributionEvidence: EVIDENCE,
                    progressContext: FOCUS_CONTEXT,
                    progressMetrics: { payload: METRICS_PAYLOAD, persisted: false },
                };
            } else {
                retry.pendingAttributionRetry = {
                    sessionId: 'session-1433-r2-attribution', evidence: EVIDENCE, progressContext: FOCUS_CONTEXT,
                    progressMetrics: { payload: METRICS_PAYLOAD, persisted: true },
                };
            }
            lockSeam().publishLockState();
        };

        for (const path of ['full_save', 'attribution'] as const) {
            it(`CASUALTY (${path} retry): while evaluation is suspended the take stays locked and Focus Points bound; then it switches once`, async () => {
                armRecovery(path);
                expect(lockPublished(), 'precondition: recovery holds the lock').toBe(true);
                const release = suspendObjectiveEvaluation();
                const watch = watchLiveBrief();
                const running = path === 'full_save' ? retry.retryRecordingSave() : retry.retryPendingAttribution();
                expect(await flushUntil(() => finalizeObjectiveSessionOnSave.mock.calls.length > 0), 'evaluation is in flight').toBe(true);

                expect(lockPublished(), 'no published unlock while Progress is still settling').toBe(true);
                expect(lockSeam().isEngineSelectionLocked(), 'and no controller unlock either').toBe(true);
                expect(useSessionStore.getState().activeObjectiveBrief?.briefId, 'the brief is not retired mid-evaluation')
                    .toBe(ORIGINAL_BRIEF.briefId);

                release();
                await expect(running).resolves.toBe(true);
                watch.unsubscribe();
                expect(lockPublished(), 'settled: unlocked').toBe(false);
                expect(useSessionStore.getState().activeObjectiveBrief, 'settled: the brief is retired').toBeNull();
                expect(watch.changes, 'the live brief changes exactly once, to none').toEqual([null]);
            });
        }

        it('a second Retry Save while the first is settling joins it instead of saving the recording again', async () => {
            armRecovery('full_save');
            const release = suspendObjectiveEvaluation();
            const first = retry.retryRecordingSave();
            expect(await flushUntil(() => finalizeObjectiveSessionOnSave.mock.calls.length > 0)).toBe(true);
            const second = retry.retryRecordingSave();
            release();
            await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
            expect(completeSession, 'the recording is completed once').toHaveBeenCalledTimes(1);
            expect(finalizeObjectiveSessionOnSave, 'and evaluated once').toHaveBeenCalledTimes(1);
            expect(wireProgressEvaluationOnSave).toHaveBeenCalledTimes(1);
        });
    });
});
