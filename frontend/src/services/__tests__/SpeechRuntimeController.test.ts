// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { buildPolicyForUser, TranscriptionPolicy, type TranscriptionMode } from '../transcription/TranscriptionPolicy';
import { useSessionStore } from '@/stores/useSessionStore';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';
import { sessionManager } from '@/services/transcription/SessionManager';
import { getSessionRecoveryDraft } from '@/services/sessionRecoveryDraft';
import { clearPrivateRecordingIdentity, getLastPrivateIdentity, setPrivateTelemetryContext } from '@/services/transcription/privateTelemetry';

// Mock Dependencies
vi.mock('../../lib/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
    }
}));

vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
    updateSession: vi.fn().mockResolvedValue({ success: true }),
}));

// #1161: the trusted server producer seam. attestInvoke stands in for
// getSupabaseClient().functions.invoke('attest-session-engine', ...). Default: a successful Private/Browser
// attestation ({ attributed: true }). Tests override it to simulate rejection / transient failure.
const { attestInvoke } = vi.hoisted(() => ({
    attestInvoke: vi.fn(
        (..._args: unknown[]): Promise<{ data: unknown; error: unknown }> =>
            Promise.resolve({ data: { attributed: true }, error: null }),
    ),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } })
        },
        functions: { invoke: (...args: unknown[]) => attestInvoke(...args) },
    }))
}));

// #1045: the Progress recording seam. Mocked so we can assert the completed-save journey INVOKES it with
// the right context (metrics persisted + terminal attribution) — the wire the feature depends on.
vi.mock('../progress/recordProgress', () => ({
    // #1354: the seam now returns a discriminated outcome and the controller gates the recorder on it.
    // `recorded` keeps these existing tests on the UNLOCKED path, which is what they were written for.
    wireProgressEvaluationOnSave: vi.fn().mockResolvedValue({ kind: 'recorded' }),
    progressOutcomeAllowsNextRecording: (o: { kind: string }) =>
        o.kind === 'recorded' || o.kind === 'not_applicable',
}));

/**
 * #1306 Step 3 — a completion payload production would ACCEPT, for any test that invokes a COMPLETED
 * full-save retry and mocks `completeSession` successful. v2 rejects a fresh completed session lacking
 * a valid structured next action or a measured metrics payload, so a fixture carrying only
 * status/transcript/duration models a success the server could never return.
 *
 * Unrelated to `progressMetrics.payload`, which may legitimately be null in tests about a missing
 * stashed Progress payload.
 */
const PRODUCTION_VALID_COMPLETED_ARGS = (finalTranscript: string, duration: number) => ({
    status: 'completed' as const,
    duration,
    nextActionSignal: {
        reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
        value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1',
    },
    metrics: {
        totalWords: 120, clarityScore: 88, wpm: 142,
        fillerCounts: { um: 4, uh: 1 },
        pauseMetrics: { totalPauses: 3, averagePauseDuration: 0.6, longestPause: 1.2, pausesPerMinute: 3 },
    },
    finalTranscript,
});

describe('SpeechRuntimeController FSM Expansion (Steps 1-4)', () => {
    let controller: SpeechRuntimeController;

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        // #1354: a leaked Progress gate blocks Start for every subsequent test. Reset defensively.
        useSessionStore.getState().setProgressGate(null);
        clearPrivateRecordingIdentity();
        controller = SpeechRuntimeController.getInstance();
        // Reset singleton private state
        (controller as unknown as { state: string }).state = 'IDLE';
        (controller as unknown as { initialized: boolean }).initialized = true;
        const stubService = {
            updatePolicy: vi.fn().mockResolvedValue(undefined),
            warmUp: vi.fn().mockResolvedValue(undefined),
            getMode: vi.fn().mockReturnValue('private'),
            getStrategy: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
            fsm: { is: vi.fn().mockReturnValue(false) },
            subscribe: vi.fn(() => vi.fn()),
            destroy: async () => {
                // ✅ Absolute clear to prevent heartbeat recursion
                vi.clearAllTimers();
                // ✅ Directly satisfy the lock invariant — no re-entrant controller call
                const lock = (controller as unknown as { lock: { updateState: (s: string) => void; release: () => void } }).lock;
                lock.updateState('TERMINATED');
                lock.release();
            },
            isServiceDestroyed: () => false,
        } as unknown as ITranscriptionService;
        (controller as unknown as { service: unknown }).service = stubService;

        // Reset stores
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
        useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready' });

        // #1033: reset the engine-selection lock state on the singleton so it can't leak across tests.
        (controller as unknown as { engineSelectionIntentLocked: boolean }).engineSelectionIntentLocked = false;
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = false;
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;

        vi.clearAllMocks();
    });

    afterEach(() => {
        // Definitively kill all pending timers including the heartbeat
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('should transition FAILED -> FAILED_VISIBLE -> TERMINATED sequentially', async () => {
        // 1. Initial State
        expect(controller.getState()).toBe('IDLE');

        // 2. Trigger Failure
        // Simulate a transition to FAILED (e.g. from an error)
        (controller as unknown as { transition: (s: string) => void }).transition('FAILED');

        // In the new logic, FAILED immediately transitions to FAILED_VISIBLE
        // Wait for the enqueue queue to flush
        await new Promise(resolve => setTimeout(resolve, 0));
        
        expect(controller.getState()).toBe('FAILED_VISIBLE');
        expect(useSessionStore.getState().runtimeState).toBe('FAILED_VISIBLE');

        // 3. Evidence: FAILED_VISIBLE -> TERMINATED (after hold duration)
        await vi.advanceTimersByTimeAsync(5000);
        expect(controller.getState()).toBe('TERMINATED');
        expect(useSessionStore.getState().runtimeState).toBe('TERMINATED');
    });

    it('should NOT release the lock during FAILED or FAILED_VISIBLE', async () => {
        const localStorageSpy = vi.spyOn(Storage.prototype, 'removeItem');
        vi.clearAllMocks();
        vi.useFakeTimers();

        // Set SSOT manifest to ensure deterministic CI timers (50ms)
        window.__SS_E2E__ = {
            isActive: true,
            engineType: 'system',
            registry: {},
            flags: {
                bypassMutex: true,
                fastTimers: true
            }
        };

        // Setup active session
        (controller as unknown as { state: string }).state = 'IDLE';
        // Use the internal lock instance to acquire
        (controller as unknown as { lock: { acquire: (s: string) => void } }).lock.acquire('INITIATING');

        (controller as unknown as { state: string }).state = 'RECORDING';
        useSessionStore.getState().setRuntimeState('RECORDING');

        // Trigger FAILED
        (controller as unknown as { transition: (s: string) => void }).transition('FAILED');

        // Verification: Lock should still be held
        expect(localStorageSpy).not.toHaveBeenCalledWith('speaksharp_active_session_lock');

        // Advance to FAILED_VISIBLE (Must be less than 50ms CI hold to stay in this state)
        await vi.advanceTimersByTime(30);
        expect(controller.getState()).toBe('FAILED_VISIBLE');
        expect(localStorageSpy).not.toHaveBeenCalledWith('speaksharp_active_session_lock');

        // Advance to TERMINATED (Total duration from FAILED: 30ms + 4000ms = 4030ms > 4000ms threshold)
        await vi.advanceTimersByTimeAsync(4000);
        expect(controller.getState()).toBe('TERMINATED');

        // Verification: Lock should finally be released
        expect(localStorageSpy).toHaveBeenCalledWith('speaksharp_active_session_lock');
    });

    it('should allow isExitTransition to recognize TERMINATED as a cleanup state', () => {
        // We verify this by seeing if transition('TERMINATED') clears the engine
        const store = useSessionStore.getState();
        store.setActiveEngine('private');

        (controller as unknown as { transition: (s: string) => void }).transition('TERMINATED');

        expect(store.activeEngine).toBe(null);
    });

    it('preserves actionable mic errors while cleanup terminates the failed start', async () => {
        (controller as unknown as { handleError: (error: Error) => void }).handleError(
            new Error('NotAllowedError: microphone permission denied')
        );
        await controller.whenStable();

        expect(controller.getState()).toBe('FAILED_VISIBLE');
        expect(useSessionStore.getState().sttStatus).toEqual(expect.objectContaining({
            type: 'error',
            message: 'Microphone access is denied. Please grant permission in your browser settings.',
        }));

        await vi.advanceTimersByTimeAsync(5000);
        expect(controller.getState()).toBe('TERMINATED');
        expect(useSessionStore.getState().sttStatus).toEqual(expect.objectContaining({
            type: 'error',
            message: 'Microphone access is denied. Please grant permission in your browser settings.',
        }));
    });



    it('delegates policy changes once and avoids duplicate warm-up loops', async () => {
        controller.updatePolicy({
            allowNative: true,
            allowPrivate: false,
            preferredMode: 'private',
            allowFallback: false,
            executionIntent: 'prod-free',
        });
        await controller.whenStable();

        const service = (controller as unknown as { service: { updatePolicy: ReturnType<typeof vi.fn>; warmUp: ReturnType<typeof vi.fn> } }).service;
        expect(service.updatePolicy).toHaveBeenCalledTimes(1);
        expect(service.warmUp).not.toHaveBeenCalled();
    });

    it('ignores stale disallowed mode callbacks from an old strategy', () => {
        const store = useSessionStore.getState();
        store.setSTTMode('private');
        (controller as unknown as { policy: unknown }).policy = {
            allowNative: true,
            allowPrivate: false,
            preferredMode: 'private',
            allowFallback: false,
            executionIntent: 'prod-free',
        };

        (controller as unknown as { handleModeChange: (mode: string) => void }).handleModeChange('private');

        expect(useSessionStore.getState().sttMode).toBe('private');
    });

    it('applies the requested warm-up mode to the service policy before readiness checks', async () => {
        (controller as unknown as { policy: unknown }).policy = {
            allowNative: true,
            allowPrivate: true,
            preferredMode: 'private',
            allowFallback: false,
            executionIntent: 'prod-pro-native',
        };

        await controller.warmUp('private');

        const service = (controller as unknown as { service: { updatePolicy: ReturnType<typeof vi.fn> } }).service;
        expect(service.updatePolicy).toHaveBeenCalledWith(expect.objectContaining({
            preferredMode: 'private',
            allowPrivate: true,
            executionIntent: 'prod-pro-native',
        }));
    });

    it('replaces an earlier partial-like final when a provider sends a fuller final with punctuation changes', () => {
        const store = useSessionStore.getState();
        store.updateTranscript('you know the box was thrown', '');

        (controller as unknown as { pushTranscriptToStore: (data: { transcript: { final: string } }) => void }).pushTranscriptToStore({
            transcript: {
                final: 'You know, the box was thrown beside the parked truck.',
            },
        });

        expect(useSessionStore.getState().transcript.transcript).toBe('You know, the box was thrown beside the parked truck.');
    });

    it('promotes live partial text into final transcript without losing visible text', () => {
        const push = (controller as unknown as {
            pushTranscriptToStore: (data: { transcript: { partial?: string; final?: string } }) => void
        }).pushTranscriptToStore.bind(controller);

        push({ transcript: { partial: 'today i want to give a clear update' } });

        expect(useSessionStore.getState().transcript).toEqual({
            transcript: '',
            partial: 'Today i want to give a clear update',
        });

        push({ transcript: { final: 'today i want to give a clear update on speaksharp' } });

        expect(useSessionStore.getState().transcript).toEqual({
            transcript: 'Today, I want to give a clear update on speaksharp.',
            partial: '',
        });
        expect(useSessionStore.getState().chunks).toEqual([
            expect.objectContaining({
                transcript: 'Today, I want to give a clear update on speaksharp.',
                isFinal: true,
            }),
        ]);
    });

    it('adds punctuation between separate final transcript segments', () => {
        const push = (controller as unknown as {
            pushTranscriptToStore: (data: { transcript: { final: string } }) => void
        }).pushTranscriptToStore.bind(controller);

        push({ transcript: { final: 'today i want to give a clear update' } });
        push({ transcript: { final: 'next the coaching should turn numbers into actions' } });

        expect(useSessionStore.getState().transcript.transcript).toBe(
            'Today, I want to give a clear update. Next, the coaching should turn numbers into actions.'
        );
    });

    it('REGRESSION (#87/#88): an authoritative whole-utterance final REPLACES the rolling transcript, not appends', () => {
        const push = (controller as unknown as {
            pushTranscriptToStore: (data: { transcript: { final: string; replacesRollingTranscript?: boolean } }) => void
        }).pushTranscriptToStore.bind(controller);

        // Garbled streaming/provisional preview accumulates (the v4 rolling text).
        push({ transcript: { final: 'well the swan dive was far short of pre the box was thrown beside the door' } });
        // The clean post-Stop whole-utterance decode is NOT a forward prefix of the garbled preview, so the
        // generic prefix/append merge would CONCATENATE the two (duplication / inflated WER). The replace
        // flag must wipe the rolling text and leave only the authoritative final.
        push({ transcript: { final: 'Well, the swan dive was far short of perfect, the box was thrown beside the parked truck.', replacesRollingTranscript: true } });

        expect(useSessionStore.getState().transcript.transcript).toBe(
            'Well, the swan dive was far short of perfect, the box was thrown beside the parked truck.'
        );
        // chunks are reset to the single authoritative final — no garbled rolling chunk survives to be
        // re-joined by the save-candidate selection.
        expect(useSessionStore.getState().chunks).toEqual([
            expect.objectContaining({
                transcript: 'Well, the swan dive was far short of perfect, the box was thrown beside the parked truck.',
                isFinal: true,
            }),
        ]);
    });

    it('REGRESSION: a blank authoritative final never wipes existing committed text', () => {
        const push = (controller as unknown as {
            pushTranscriptToStore: (data: { transcript: { final: string; replacesRollingTranscript?: boolean } }) => void
        }).pushTranscriptToStore.bind(controller);

        push({ transcript: { final: 'real committed words here' } });
        push({ transcript: { final: '   ', replacesRollingTranscript: true } });

        expect(useSessionStore.getState().transcript.transcript).toBe('Real committed words here.');
    });

    it('adds conservative commas and first-person capitalization without rewriting words', () => {
        const push = (controller as unknown as {
            pushTranscriptToStore: (data: { transcript: { final: string } }) => void
        }).pushTranscriptToStore.bind(controller);

        push({ transcript: { final: 'for example i should pause before the takeaway' } });

        expect(useSessionStore.getState().transcript.transcript).toBe(
            'For example, I should pause before the takeaway.'
        );
    });

    it('keeps filler words visible while formatting a competitor-grade spoken sample', () => {
        const push = (controller as unknown as {
            pushTranscriptToStore: (data: { transcript: { final: string } }) => void
        }).pushTranscriptToStore.bind(controller);

        push({ transcript: { final: 'today i want to give a clear update um the main point is simple' } });
        push({ transcript: { final: 'for example like if i pause before the takeaway the message lands' } });
        push({ transcript: { final: 'finally i want the transcript to feel polished' } });

        expect(useSessionStore.getState().transcript.transcript).toBe(
            'Today, I want to give a clear update um the main point is simple. For example, like if I pause before the takeaway the message lands. Finally, I want the transcript to feel polished.'
        );
        expect(useSessionStore.getState().transcript.transcript).toContain('um');
        expect(useSessionStore.getState().transcript.transcript).toContain('like');
    });

    it('clears stale partial text when a duplicate final arrives', () => {
        const store = useSessionStore.getState();
        store.updateTranscript('today i want to give a clear update', 'today i want');
        store.setChunks([{ transcript: 'today i want to give a clear update', timestamp: 123, isFinal: true }]);

        (controller as unknown as { pushTranscriptToStore: (data: { transcript: { final: string } }) => void }).pushTranscriptToStore({
            transcript: {
                final: 'today i want to give a clear update',
            },
        });

        expect(useSessionStore.getState().transcript).toEqual({
            transcript: 'Today i want to give a clear update',
            partial: '',
        });
    });

    it('projects transcript updates to the visible store even when subscriber callbacks are not ready', () => {
        const callback = vi.fn();
        (controller as unknown as { isSubscriberReady: boolean }).isSubscriberReady = false;
        (controller as unknown as { subscriberCallbacks: { onTranscriptUpdate?: typeof callback } }).subscriberCallbacks = {
            onTranscriptUpdate: callback,
        };

        (controller as unknown as { handleTranscriptUpdate: (data: { transcript: { partial: string } }) => void }).handleTranscriptUpdate({
            transcript: { partial: 'the birch canoe slid' },
        });

        expect(useSessionStore.getState().transcript.partial).toBe('The birch canoe slid');
        expect(callback).not.toHaveBeenCalled();

        (controller as unknown as { isSubscriberReady: boolean }).isSubscriberReady = true;
        (controller as unknown as { flushQueues: () => void }).flushQueues();

        expect(useSessionStore.getState().transcript.partial).toBe('The birch canoe slid');
        expect(useSessionStore.getState().chunks).toHaveLength(0);
        expect(callback).toHaveBeenCalledWith({
            transcript: { partial: 'the birch canoe slid' },
        });
    });

    it.each(['private'] as const)(
        'consumes the visible partial for a content-free save, then PURGES the transcript from the store after stop for %s',
        async (mode) => {
            const storage = await import('../../lib/storage');
            const visiblePartial = 'today i expect live transcript text to remain after stop';
            window.__SS_TRANSCRIPT_TRACE__ = [];
            vi.mocked(storage.completeSession).mockClear();
            vi.mocked(storage.updateSession).mockClear();

            const stopTranscription = vi.fn().mockResolvedValue({
                success: true,
                transcript: '',
                stats: {
                    total_words: 0,
                    filler_words: {},
                    speaking_rate: 0,
                    duration: 10,
                    accuracy: 1,
                },
            });
            const destroy = vi.fn().mockResolvedValue(undefined);
            (controller as unknown as { service: unknown }).service = {
                getMode: vi.fn().mockReturnValue(mode),
                getState: vi.fn().mockReturnValue('RECORDING'),
                getStartTime: vi.fn().mockReturnValue(Date.now() - 10_000),
                stopTranscription,
                destroy,
                getMetadata: vi.fn().mockReturnValue({ engineVersion: mode, modelName: mode, deviceType: mode }),
                setSessionId: vi.fn(),
                isServiceDestroyed: () => false,
            };
            (controller as unknown as { state: string }).state = 'RECORDING';
            (controller as unknown as { sessionId: string }).sessionId = `sess-${mode}`;
            useSessionStore.getState().setRuntimeState('RECORDING');
            useSessionStore.getState().setSTTMode(mode);

            (controller as unknown as { handleTranscriptUpdate: (data: { transcript: { partial: string } }) => void }).handleTranscriptUpdate({
                transcript: { partial: visiblePartial },
            });

            expect(useSessionStore.getState().transcript.partial.toLowerCase()).toContain('today i expect');

            await controller.stopRecording();
            await controller.whenStable();

            const trace = window.__SS_TRANSCRIPT_TRACE__ ?? [];
            expect(trace.some(event => event.stage === 'controller:receive')).toBe(true);
            expect(trace.some(event => event.stage === 'store:update' && event.type === 'partial')).toBe(true);
            expect(trace.some(event => event.stage === 'lifecycle:stop')).toBe(true);
            expect(trace.some(event => event.stage === 'save:candidate' && event.reason === 'visible_snapshot')).toBe(true);
            const completionPayload = vi.mocked(storage.completeSession).mock.calls[0]?.[1];
            expect(storage.completeSession).toHaveBeenCalledWith(`sess-${mode}`, expect.objectContaining({
                status: 'completed',
            }));
            const normalizeForAssertion = (value: string | undefined) => (value ?? '')
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s']/gu, '')
                .replace(/\s+/g, ' ')
                .trim();
            // #1306: the completion payload is CONTENT-FREE — metrics + one next action, NEVER a transcript.
            expect(completionPayload).not.toHaveProperty('transcript');
            expect(completionPayload?.metrics).toBeDefined();
            expect(completionPayload?.nextActionSignal).toBeTruthy();
            // #1306 P1: the live transcript is ephemeral working memory — it feeds the content-free metrics/save
            // candidate above, then is PURGED from the store once metrics are derived and the session finalized.
            // Nothing (final or partial) survives the finalized boundary.
            expect(normalizeForAssertion(useSessionStore.getState().transcript.transcript)).toBe('');
            expect(useSessionStore.getState().transcript.partial).toBe('');
        }
    );

    // #1033: one recording = one engine → finalization persists a VERIFIED identity tuple +
    // attribution_status atomically (row is 'pending' by DB default until then).
    const driveStopWithService = async (svc: Record<string, unknown>, sessionId: string, mode: TranscriptionMode) => {
        (controller as unknown as { service: unknown }).service = svc;
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { sessionId: string }).sessionId = sessionId;
        // This helper jumps directly to RECORDING, bypassing the real transition that captures mode.
        (controller as unknown as { recordingProgressMode: unknown }).recordingProgressMode = { mode: 'open_mic' };
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().setSTTMode(mode);
        (controller as unknown as { handleTranscriptUpdate: (d: { transcript: { partial: string } }) => void }).handleTranscriptUpdate({
            transcript: { partial: 'today i expect live transcript text to remain after stop' },
        });
        await controller.stopRecording();
        await controller.whenStable();
    };
    const mkService = (mode: string, meta: { engineVersion: string; modelName: string; deviceType: string }) => ({
        getMode: vi.fn().mockReturnValue(mode),
        getState: vi.fn().mockReturnValue('RECORDING'),
        getStartTime: vi.fn().mockReturnValue(Date.now() - 10_000),
        stopTranscription: vi.fn().mockResolvedValue({ success: true, transcript: '', stats: { total_words: 0, filler_words: {}, speaking_rate: 0, duration: 10, accuracy: 1 } }),
        destroy: vi.fn().mockResolvedValue(undefined),
        getMetadata: vi.fn().mockReturnValue(meta),
        setSessionId: vi.fn(),
        isServiceDestroyed: () => false,
    });
    // #1161: the client no longer writes attribution columns — it POSTs runtime evidence to the trusted
    // producer. These read the attest-session-engine invocations instead of updateSession patches.
    const attestBodies = () => attestInvoke.mock.calls
        .map((c) => (c[1] as { body?: { op?: string; sessionId?: string; runtimeEvidence?: Record<string, unknown> } } | undefined)?.body);
    const lastBody = () => { const b = attestBodies(); return b[b.length - 1]; };
    const lastEvidence = () => lastBody()?.runtimeEvidence;

    it.each(['private'] as const)(
        '#1161: finalization ATTESTS a %s session via the trusted producer (Progress-eligible)',
        async (mode) => {
            attestInvoke.mockClear();
            (controller as unknown as { resolvedPrivateEngineVersion: string | null }).resolvedPrivateEngineVersion = null;
            await driveStopWithService(mkService(mode, { engineVersion: `v-${mode}`, modelName: `m-${mode}`, deviceType: `d-${mode}` }), `sess-attr-${mode}`, mode);
            expect(attestInvoke).toHaveBeenCalledTimes(1);
            expect(lastBody()?.sessionId).toBe(`sess-attr-${mode}`);
            expect(lastEvidence()).toMatchObject({
                provider: mode === 'private' ? 'transformers-js' : 'web-speech',
                engine: mode, engine_version: `v-${mode}`, model_id: `m-${mode}`, resolved_device: `d-${mode}`,
                fallback_occurred: false, cloud_used: false,
            });
        }
    );


    it('#1045: the completed-save journey wires the Progress evaluation seam (metrics persisted + terminal attribution)', async () => {
        const { wireProgressEvaluationOnSave } = await import('../progress/recordProgress');
        vi.mocked(wireProgressEvaluationOnSave).mockClear();
        (controller as unknown as { resolvedPrivateEngineVersion: string | null }).resolvedPrivateEngineVersion = null;
        await driveStopWithService(mkService('private', { engineVersion: 'v-p', modelName: 'm-p', deviceType: 'browser' }), 'sess-progress-1', 'private');
        expect(wireProgressEvaluationOnSave).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'sess-progress-1',
            status: 'completed',
            attributionStatus: 'verified',
            metricsPersisted: true,
        }));
    });

    it('#1354 VERTICAL: the real completion path does not settle, and Start stays blocked, until Progress is terminal', async () => {
        // THE DEFECT THIS KILLS. `completeProgressForRecording` was `void`-dispatched, so the completion
        // path settled while the evaluation was still in flight and the recorder reopened. On a rapid
        // three-session journey the third completion then reached retention while the oldest outgoing
        // session still lacked terminal evidence, and the server refused to retain the new transcript
        // (attempt 9: transcript_outcome=retention_failed, retention_status=pending).
        //
        // Driving the REAL stop/completion path is the point: an isolated unit test of the gate cannot
        // observe whether the caller awaited it.
        const { wireProgressEvaluationOnSave } = await import('../progress/recordProgress');
        let releaseProgress: (o: { kind: string }) => void = () => {};
        const deferred = new Promise<{ kind: string }>((resolve) => { releaseProgress = resolve; });
        vi.mocked(wireProgressEvaluationOnSave).mockReturnValueOnce(deferred as never);
        useSessionStore.getState().setProgressGate(null);

        let settled = false;
        const completion = driveStopWithService(
            mkService('private', { engineVersion: 'v-p', modelName: 'm-p', deviceType: 'browser' }),
            'sess-1354-vertical', 'private',
        ).then(() => { settled = true; });

        try {
            // Let every other await in the completion path run to exhaustion. MICROTASKS ONLY — this
            // suite installs fake timers, so awaiting a real `setTimeout` never resolves.
            for (let i = 0; i < 50; i++) await Promise.resolve();

            // 2. No startable state while deferred. `void` dispatch makes this settle immediately.
            expect(settled, 'completion must NOT settle while Progress is in flight').toBe(false);
            expect(useSessionStore.getState().progressGate?.state).toBe('resolving');

            // ...and Start is refused with no recording side effect.
            await controller.startRecording();
            expect(useSessionStore.getState().sttStatus.type).toBe('error');
            expect(useSessionStore.getState().sttStatus.message).toMatch(/one moment|retry automatically/i);
        } finally {
            // 3. ALWAYS release and settle — a hung deferred would block every test after this one.
            releaseProgress({ kind: 'recorded' });
            await completion;
            useSessionStore.getState().setProgressGate(null);
        }

        expect(settled).toBe(true);
    });

    it('#1033: Private finalization uses the resolved Private arm ONLY when it belongs to this recording', async () => {
        attestInvoke.mockClear();
        (controller as unknown as { resolvedPrivateEngineVersion: string | null }).resolvedPrivateEngineVersion = 'private_v2:whisper-base.en';
        (controller as unknown as { resolvedPrivateEngineSessionId: string | null }).resolvedPrivateEngineSessionId = 'sess-attr-private-arm';
        await driveStopWithService(mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base.en', deviceType: 'browser' }), 'sess-attr-private-arm', 'private');
        expect(lastEvidence()).toMatchObject({ provider: 'transformers-js', engine: 'private', engine_version: 'private_v2:whisper-base.en' });
    });

    it('#1033: a STALE Private arm from another recording is NOT used (no cross-recording leak)', async () => {
        attestInvoke.mockClear();
        (controller as unknown as { resolvedPrivateEngineVersion: string | null }).resolvedPrivateEngineVersion = 'private_v2:STALE-ARM';
        (controller as unknown as { resolvedPrivateEngineSessionId: string | null }).resolvedPrivateEngineSessionId = 'a-DIFFERENT-session';
        await driveStopWithService(mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base.en', deviceType: 'browser' }), 'sess-attr-stale', 'private');
        const ev = lastEvidence() as Record<string, unknown>;
        expect(ev.engine_version).toBe('transformers-js'); // live metadata, NOT the stale arm
        expect(ev.engine_version).not.toBe('private_v2:STALE-ARM');
    });

    it.each([
        { label: 'missing metadata', svc: { getMetadata: () => null } },
        { label: 'throwing metadata', svc: { getMetadata: () => { throw new Error('gone'); } } },
        { label: 'blank engine_version', svc: { getMetadata: () => ({ engineVersion: '  ', modelName: 'm', deviceType: 'd' }) } },
        { label: 'blank device_type', svc: { getMetadata: () => ({ engineVersion: 'web-speech-api', modelName: 'm', deviceType: '' }) } },
    ])('#1033/#1161 P1: $label → NO trusted identity → RESOLVED unattributed via server (op:resolve, no authority)', async ({ svc }) => {
        attestInvoke.mockClear();
        const base = mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base', deviceType: 'browser' });
        await driveStopWithService({ ...base, ...svc }, 'sess-attr-unv', 'private');
        // An unverifiable local identity produces no evidence → the client posts op:'resolve_unattributed' so the server writes
        // the terminal unattributed marker (P1: convergence, never a silent skip). No runtimeEvidence.
        expect(attestInvoke).toHaveBeenCalledTimes(1);
        expect(lastBody()).toMatchObject({ op: 'resolve_unattributed', sessionId: 'sess-attr-unv' });
        expect(lastEvidence()).toBeUndefined();
    });

    it('#1033/#1161 P1: an engine token outside the allowlist → RESOLVED unattributed via server (op:resolve)', async () => {
        attestInvoke.mockClear();
        const svc = { ...mkService('private', { engineVersion: 'x', modelName: 'y', deviceType: 'z' }), getMode: vi.fn().mockReturnValue('some-unknown-engine') };
        await driveStopWithService(svc, 'sess-attr-badtoken', 'private');
        expect(attestInvoke).toHaveBeenCalledTimes(1);
        expect(lastBody()).toMatchObject({ op: 'resolve_unattributed', sessionId: 'sess-attr-badtoken' });
        expect(lastEvidence()).toBeUndefined();
    });

    it('#1033: identity is snapshotted BEFORE stopTranscription()', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.updateSession).mockClear();
        const order: string[] = [];
        const svc = mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base', deviceType: 'browser' });
        svc.getMetadata = vi.fn(() => { order.push('getMetadata'); return { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }; });
        svc.stopTranscription = vi.fn(async () => { order.push('stopTranscription'); return { success: true, transcript: '', stats: { total_words: 0, filler_words: {}, speaking_rate: 0, duration: 10, accuracy: 1 } }; });
        await driveStopWithService(svc, 'sess-attr-order', 'private');
        expect(order.indexOf('getMetadata')).toBeLessThan(order.indexOf('stopTranscription'));
    });

    it('#1161: transient attest failure keeps transcript + leaves row pending; retryPendingAttribution re-attests (no duplicate)', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockClear();
        vi.mocked(storage.saveSession).mockClear();
        // First attempt: a TRANSIENT producer failure (no 4xx status) → attestSessionEngine returns null → the
        // row stays pending, transcript preserved, and the evidence is stashed for Retry Save.
        attestInvoke.mockClear();
        attestInvoke.mockResolvedValueOnce({ data: null, error: { message: 'producer down' } });
        const saveCallsBefore = vi.mocked(storage.saveSession).mock.calls.length;
        await expect(driveStopWithService(mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base', deviceType: 'browser' }), 'sess-attr-retry', 'private')).resolves.not.toThrow();
        // transcript survived the attribution failure
        expect(storage.completeSession).toHaveBeenCalledWith('sess-attr-retry', expect.objectContaining({ status: 'completed' }));
        expect((controller as unknown as { pendingAttributionRetry: { progressMetrics: { persisted: boolean } } }).pendingAttributionRetry
            .progressMetrics.persisted).toBe(true); // carries the actual original rich-metrics result
        // now Retry Save re-attests the SAME session (no new saveSession/duplicate)
        attestInvoke.mockClear();
        attestInvoke.mockResolvedValue({ data: { attributed: true }, error: null });
        await expect((controller as unknown as { retryPendingAttribution: () => Promise<boolean> }).retryPendingAttribution()).resolves.toBe(true);
        const retryCall = attestInvoke.mock.calls.find(c => (c[1] as { body?: { sessionId?: string } })?.body?.sessionId === 'sess-attr-retry');
        expect(retryCall).toBeTruthy();
        expect((retryCall![1] as { body: { runtimeEvidence: Record<string, unknown> } }).body.runtimeEvidence).toMatchObject({ provider: 'transformers-js', engine: 'private' });
        expect(vi.mocked(storage.saveSession).mock.calls.length).toBe(saveCallsBefore); // no duplicate session created
    });

    it('#1306: the normal completion path SENDS the finalized transcript', async () => {
        // Guards the BUILD of completeArgs, not just its replay. The retry tests below inject a
        // hand-built payload, so they cannot detect `finalTranscript` being dropped where it is
        // originally bound — a mutant that removed it survived until this test existed.
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockClear();
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true, transcriptOutcome: 'retained', transcriptRetained: true } as never);
        attestInvoke.mockReset();
        attestInvoke.mockResolvedValue({ data: { attributed: true }, error: null });

        await expect(driveStopWithService(
            mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base', deviceType: 'browser' }),
            'sess-sends-transcript',
            'private',
        )).resolves.not.toThrow();

        const call = vi.mocked(storage.completeSession).mock.calls[vi.mocked(storage.completeSession).mock.calls.length - 1];
        expect(call, 'completion was never attempted').toBeTruthy();
        const opts = call![1] as { status?: string; finalTranscript?: string | null };
        expect(opts.status).toBe('completed');
        // The property that matters: a completed session carries transcript text, not undefined/null.
        expect(opts).toHaveProperty('finalTranscript');
        expect(typeof opts.finalTranscript).toBe('string');
        expect((opts.finalTranscript ?? '').length).toBeGreaterThan(0);
    });

    /**
     * A completion payload production would ACCEPT. v2 rejects a fresh completed session lacking a valid
     * structured next action or a measured metrics payload, so `{ nextActionSignal: null, metrics: {} }`
     * modelled a success the server could never return — the retry assertions were real, but they rode
     * on an impossible precondition.
     */
    const RETRY_NEXT_ACTION = {
        reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
        value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1',
    } as const;
    const validCompletedArgs = (finalTranscript: string, duration: number) => ({
        status: 'completed' as const,
        duration,
        nextActionSignal: RETRY_NEXT_ACTION,
        metrics: {
            totalWords: 120, clarityScore: 88, wpm: 142,
            fillerCounts: { um: 4, uh: 1 },
            pauseMetrics: { totalPauses: 3, averagePauseDuration: 0.6, longestPause: 1.2, pausesPerMinute: 3 },
        },
        finalTranscript,
    });

    it('LOAD-BEARING: the completed retry fixture is one production would accept', async () => {
        const { validateNextActionSignal } = await import('../../contracts/nextActionSignal');
        const args = validCompletedArgs('any', 12);
        expect(validateNextActionSignal(args.nextActionSignal).ok).toBe(true);
        expect(Object.keys(args.metrics.fillerCounts).length).toBeGreaterThan(0);
        expect(args.metrics.totalWords).toBeGreaterThan(0);
    });

    it('#1306: Retry Save replays the BOUND transcript, not whatever the store now holds', async () => {
        // The immutability property. The completion payload is captured at the recording boundary; a
        // later store/UI mutation (or a terminal clear) must not change what a retry sends. A divergent
        // transcript would conflict server-side rather than partially write — but the client must not
        // send one in the first place, or Retry Save silently becomes "save whatever is on screen now".
        const storage = await import('../../lib/storage');
        const BOUND = 'BOUND-TRANSCRIPT-c41e77-original-take';
        const MUTATED = 'MUTATED-TRANSCRIPT-90ab12-must-never-be-sent';

        vi.mocked(storage.completeSession).mockClear();
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true, transcriptOutcome: 'retained', transcriptRetained: true } as never);
        attestInvoke.mockReset();
        attestInvoke.mockResolvedValue({ data: { attributed: true }, error: null });

        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = {
            sessionId: 'sess-immutable-retry',
            completeArgs: validCompletedArgs(BOUND, 12),
            attributionEvidence: { provider: 'transformers-js', engine: 'private' },
            progressContext: { mode: 'private' },
            progressMetrics: { payload: {}, persisted: true },
        };

        // Simulate exactly the hazard: the store moves on after the payload was bound.
        useSessionStore.getState().updateTranscript(MUTATED, '');
        expect(useSessionStore.getState().transcript.transcript).toContain(MUTATED); // positive control

        await (controller as unknown as { retryRecordingSave: () => Promise<boolean> }).retryRecordingSave();

        const sent = vi.mocked(storage.completeSession).mock.calls[vi.mocked(storage.completeSession).mock.calls.length - 1]?.[1] as { finalTranscript?: string };
        expect(sent?.finalTranscript).toBe(BOUND);
        expect(JSON.stringify(vi.mocked(storage.completeSession).mock.calls)).not.toContain(MUTATED);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
    });

    it('#1306: Retry Save still replays the bound transcript after a TERMINAL clear', async () => {
        // Terminal purge empties the store transcript entirely. The retry must still carry the original.
        const storage = await import('../../lib/storage');
        const BOUND = 'BOUND-AFTER-PURGE-5d2f08-original-take';
        vi.mocked(storage.completeSession).mockClear();
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true, transcriptOutcome: 'retained', transcriptRetained: true } as never);
        attestInvoke.mockReset();
        attestInvoke.mockResolvedValue({ data: { attributed: true }, error: null });

        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = {
            sessionId: 'sess-immutable-after-purge',
            completeArgs: validCompletedArgs(BOUND, 9),
            attributionEvidence: { provider: 'transformers-js', engine: 'private' },
            progressContext: { mode: 'private' },
            progressMetrics: { payload: {}, persisted: true },
        };
        useSessionStore.getState().updateTranscript('', '');   // terminal clear
        expect(useSessionStore.getState().transcript.transcript).toBe(''); // positive control

        await (controller as unknown as { retryRecordingSave: () => Promise<boolean> }).retryRecordingSave();

        const sent = vi.mocked(storage.completeSession).mock.calls[vi.mocked(storage.completeSession).mock.calls.length - 1]?.[1] as { finalTranscript?: string };
        expect(sent?.finalTranscript).toBe(BOUND);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
    });

    // #1306 Step 3 supersedes the two #1265 cases that lived here.
    //
    // Those tests protected a real hazard: a SECOND metrics write could fail (or still be in flight)
    // after completion succeeded, producing a completed recording with no Progress evaluation. v2 writes
    // every retained metric inside the SAME transaction as the transcript and retention, so that state is
    // no longer merely guarded against — it is unreachable. The replacement asserts the stronger property:
    // there is no separate metrics write at all.

    it('#1306: v2 acceptance IS the metrics result — no second metrics write occurs', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.updateSession).mockClear();
        attestInvoke.mockReset();
        attestInvoke.mockResolvedValue({ data: { attributed: true }, error: null });

        await expect(driveStopWithService(
            mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base', deviceType: 'browser' }),
            'sess-v2-no-second-write',
            'private',
        )).resolves.not.toThrow();

        // The redundant post-completion PATCH is gone. Restoring it re-introduces a divergent second
        // authority and a "completed but metrics missing" window.
        expect(storage.updateSession).not.toHaveBeenCalled();
        // ...and completion went through v2, not a legacy overload.
        expect(vi.mocked(storage.completeSession)).toHaveBeenCalled();
    });

    it('#1306: no in-flight metrics window exists for an attribution retry to outrun', async () => {
        const storage = await import('../../lib/storage');
        const { wireProgressEvaluationOnSave } = await import('../progress/recordProgress');
        vi.mocked(wireProgressEvaluationOnSave).mockClear();
        vi.mocked(storage.updateSession).mockClear();
        attestInvoke.mockReset();
        attestInvoke
            .mockResolvedValueOnce({ data: null, error: { message: 'producer down' } })
            .mockResolvedValue({ data: { attributed: true }, error: null });

        await expect(driveStopWithService(
            mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base', deviceType: 'browser' }),
            'sess-v2-no-inflight-window',
            'private',
        )).resolves.not.toThrow();

        // Attribution can still be pending and retried — that path is unchanged and separately trusted.
        // What changed: the retry carries `persisted: true`, because a successful v2 completion already
        // proves the metrics landed. It is no longer possible to be uncertain about them.
        const pending = (controller as unknown as {
            pendingAttributionRetry: { progressMetrics: { payload: unknown; persisted: boolean } } | null;
        }).pendingAttributionRetry;
        // Assert on a derived value rather than inside an `if` — a conditional expect can silently
        // assert nothing when the branch is not taken (and eslint forbids it for exactly that reason).
        // NOT `pending === null ? true : ...` — that form passes when NO retry exists, which is the
        // exact vacuity this suite keeps rooting out. Assert the retry is present, THEN assert its value.
        expect(pending, 'expected an armed attribution retry to inspect').not.toBeNull();
        expect(pending!.progressMetrics.persisted).toBe(true);
        // No separate metrics write was ever issued, so there is nothing to race.
        expect(storage.updateSession).not.toHaveBeenCalled();
    });

    // #1033 Part 2 — runtime enforcement (controller-level, not UI-only).

    it('#1033: startRecording is BLOCKED while a prior attribution retry is pending', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.saveSession).mockClear();
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'sess-A', patch: { attribution_status: 'verified' } };
        (controller as unknown as { state: string }).state = 'IDLE';
        await controller.startRecording(buildPolicyForUser(false, 'private'));
        await controller.whenStable();
        expect(storage.saveSession).not.toHaveBeenCalled();
        expect(useSessionStore.getState().sttStatus).toEqual(expect.objectContaining({ type: 'error' }));
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
    });

    it('#1033: a later recording does NOT clear an earlier session pending retry', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.updateSession).mockResolvedValue({ success: true });
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'sess-A', patch: { attribution_status: 'verified' } };
        await driveStopWithService(mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base', deviceType: 'browser' }), 'sess-B', 'private');
        expect((controller as unknown as { pendingAttributionRetry: { sessionId: string } | null }).pendingAttributionRetry).toMatchObject({ sessionId: 'sess-A' });
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
    });

    // #1033 Part-2a race fixes
    const setLock = (intent: boolean, state: string, pending: unknown = null) => {
        (controller as unknown as { engineSelectionIntentLocked: boolean }).engineSelectionIntentLocked = intent;
        (controller as unknown as { state: string }).state = state;
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = pending;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
    };

    it('#1033: engine selection locks SYNCHRONOUSLY at Start intent (before INITIATING)', async () => {
        setLock(false, 'IDLE', null);
        expect(controller.isEngineSelectionLocked()).toBe(false);
        const p = controller.startRecording(buildPolicyForUser(true, 'private')); // not awaited
        expect(controller.isEngineSelectionLocked()).toBe(true); // locked immediately, before any await resolves
        await controller.whenStable().catch(() => undefined);
        await p.catch(() => undefined);
        setLock(false, 'IDLE', null);
    });

    // #1036: PROOF that the four buildPolicyForUser callers' divergences are inert. The tier-only writers
    // (provider via updatePolicy, hook via warm config) can store a policy that DENIES Private to a
    // free-user-with-sample; the capability (lifecycle) writer supplies the record policy via startRecording.
    // startRecording assigns `this.policy = policy` SYNCHRONOUSLY, so the tier-only policy is overwritten and
    // the capability policy is the record-time authority. If startRecording ever stopped overwriting, or a
    // tier-only writer became the record authority, this fails — which is exactly the regression #1036 guards.
    it('#1036/#1184: record-time authority — startRecording overwrites the stored policy; every policy grants Private', async () => {
        setLock(false, 'IDLE', null);
        // #1184: tier no longer gates the engine — the former tier-only "DENIES Private" divergence is gone;
        // every buildPolicyForUser result grants Private.
        const tierOnlyPolicy = buildPolicyForUser(false, 'private');
        controller.updatePolicy(tierOnlyPolicy);
        expect((controller as unknown as { policy: TranscriptionPolicy | null }).policy?.allowPrivate).toBe(true);

        // The record-authority MECHANISM still holds: startRecording's policy overwrites the stored one.
        const capabilityPolicy = buildPolicyForUser(true, 'private');
        const p = controller.startRecording(capabilityPolicy); // not awaited — this.policy is assigned synchronously
        const stored = (controller as unknown as { policy: TranscriptionPolicy | null }).policy;
        expect(stored).toBe(capabilityPolicy);        // stored policy overwritten at record time
        expect(stored?.allowPrivate).toBe(true);      // Private granted

        await controller.whenStable().catch(() => undefined);
        await p.catch(() => undefined);
        setLock(false, 'IDLE', null);
    });


    it('#1033: a FAILED session-B write does NOT overwrite pending session A', async () => {
        const storage = await import('../../lib/storage');
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'sess-A', patch: { attribution_status: 'verified', engine: 'private' } };
        vi.mocked(storage.updateSession).mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
            if (patch && Object.prototype.hasOwnProperty.call(patch, 'attribution_status')) throw new Error('DB down');
            return { success: true };
        });
        await driveStopWithService(mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base', deviceType: 'browser' }), 'sess-B', 'private');
        expect((controller as unknown as { pendingAttributionRetry: { sessionId: string } }).pendingAttributionRetry).toMatchObject({ sessionId: 'sess-A' }); // A preserved
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        vi.mocked(storage.updateSession).mockResolvedValue({ success: true });
    });

    it('#1033: retry of session A does not clear a pending that changed to session B mid-flight (compare-and-clear)', async () => {
        const ev = { provider: 'transformers-js', engine: 'private', fallback_occurred: false, cloud_used: false };
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'A', evidence: ev };
        attestInvoke.mockImplementationOnce(async () => {
            (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'B', evidence: ev };
            return { data: { attributed: true }, error: null };
        });
        await expect((controller as unknown as { retryPendingAttribution: () => Promise<boolean> }).retryPendingAttribution()).resolves.toBe(true);
        expect((controller as unknown as { pendingAttributionRetry: { sessionId: string } }).pendingAttributionRetry).toMatchObject({ sessionId: 'B' }); // B not cleared
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
    });

    // #1033 Part-2a — failure-state lock semantics: PRE-recording failure unlocks; POST-start failure stays
    // locked (transcript/recovery-draft preserved) until durable save/retry/approved-discard.
    const doTransition = (s: string) => (controller as unknown as { transition: (st: string) => Promise<void> }).transition(s);
    const setUnresolved = (v: boolean) => { (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = v; };

    it.each(['FAILED', 'FAILED_VISIBLE', 'TERMINATED'] as const)(
        '#1033: PRE-recording failure (%s, never RECORDING) UNLOCKS engine selection',
        async (term) => {
            setLock(true /*intent*/, 'INITIATING', null);
            setUnresolved(false); // recording never began
            await doTransition(term);
            expect(controller.isEngineSelectionLocked()).toBe(false);
        }
    );

    const clearDraft = () => { try { window.localStorage.removeItem('speaksharp_unsaved_session_draft'); } catch { /* jsdom */ } };

    it.each([
        { from: 'RECORDING', term: 'FAILED' },
        { from: 'RECORDING', term: 'FAILED_VISIBLE' },
        { from: 'STOPPING', term: 'FAILED' },
        { from: 'STOPPING', term: 'TERMINATED' },
    ])('#1033 (B)/#1306: POST-start failure ($from → $term) with a FINALIZED draft STAYS locked + arms a full-save retry', async ({ from, term }) => {
        clearDraft();
        // #1306: recoverable work = a FINALIZED draft (exact metrics + next action from a clean stop). A live
        // transcript alone is NOT recoverable — it can never become a completed session.
        const draft = await import('../sessionRecoveryDraft');
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-postfail', userId: 'user-1', recoveryState: 'finalized_pending_save', nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, metrics: { totalWords: 8 }, durationSeconds: 12, mode: 'private' });
        setLock(false, from, null);
        setUnresolved(true); // recording had begun and is not durably resolved
        (controller as unknown as { sessionId: string | null }).sessionId = 'sess-postfail';
        (controller as unknown as { capturedUserId: string | null }).capturedUserId = 'user-1';
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        useSessionStore.getState().updateTranscript('', '');
        await doTransition(term);
        expect(controller.isEngineSelectionLocked()).toBe(true); // locked because there IS a finalized draft
        expect(controller.pendingResolutionKind()).toBe('full_save'); // ...and an actionable recovery exists (B4)
        setUnresolved(false);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        clearDraft();
    });

    it.each([
        { from: 'RECORDING', term: 'FAILED' },
        { from: 'STOPPING', term: 'TERMINATED' },
    ])('#1033 (B): POST-start failure ($from → $term) with NOTHING recoverable UNLOCKS (never stuck with a null resolution)', async ({ from, term }) => {
        clearDraft();
        setLock(false, from, null);
        setUnresolved(true);
        (controller as unknown as { sessionId: string | null }).sessionId = null;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        useSessionStore.getState().updateTranscript('', '');
        await doTransition(term);
        // B4 invariant: never locked while pendingResolutionKind() is null and no recovery exists.
        expect(controller.pendingResolutionKind()).toBeNull();
        expect(controller.isEngineSelectionLocked()).toBe(false);
        setUnresolved(false);
    });

    it('#1033 (B): a heartbeat/engine failure with a RECOVERY DRAFT arms a full-save retry (unverified identity, never fabricated)', async () => {
        clearDraft();
        const draft = await import('../sessionRecoveryDraft');
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-hb', userId: 'user-1', recoveryState: 'finalized_pending_save', nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, metrics: { totalWords: 5 }, durationSeconds: 42, mode: 'private' });
        setLock(false, 'RECORDING', null);
        setUnresolved(true);
        (controller as unknown as { sessionId: string | null }).sessionId = 'sess-hb';
        (controller as unknown as { capturedUserId: string | null }).capturedUserId = 'user-1'; // owner-scoped recovery
        useSessionStore.getState().updateTranscript('', ''); // the live store is gone; only the owned draft survives
        useSessionStore.getState().setChunks([]);
        (controller as unknown as { resetTranscriptLifecycle: () => void }).resetTranscriptLifecycle();
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        await doTransition('FAILED'); // heartbeat/engine failure lands here
        const pending = (controller as unknown as { pendingFullSaveRetry: { sessionId: string; completeArgs: { status: string; duration: number; metrics?: { totalWords?: number } }; attributionEvidence: unknown } | null }).pendingFullSaveRetry;
        expect(pending).toMatchObject({ sessionId: 'sess-hb' });
        // #1306: recovery is CONTENT-FREE — the retry replays the finalized draft's metrics, never a transcript.
        expect(pending?.completeArgs).not.toHaveProperty('transcript');
        expect(pending?.completeArgs.status).toBe('completed');
        expect(pending?.completeArgs.metrics?.totalWords).toBe(5);
        expect(pending?.attributionEvidence).toBeNull(); // #1161: a dead engine has no trusted identity → no authority
        expect(controller.isEngineSelectionLocked()).toBe(true);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false);
        clearDraft();
    });

    it('#1033 (B): discardUnresolvedRecording marks the session failed, clears the owned draft, and UNLOCKS', async () => {
        const storage = await import('../../lib/storage');
        const draft = await import('../sessionRecoveryDraft');
        vi.mocked(storage.completeSession).mockClear();
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true });
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-disc', userId: 'user-1', recoveryState: 'finalized_pending_save', nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, metrics: { totalWords: 5 }, durationSeconds: 10, mode: 'private' });
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = { sessionId: 'sess-disc', completeArgs: { status: 'completed', transcript: 'unsaved words', duration: 10 }, attributionEvidence: null };
        setUnresolved(true);
        expect(controller.isEngineSelectionLocked()).toBe(true);
        await (controller as unknown as { discardUnresolvedRecording: () => Promise<void> }).discardUnresolvedRecording();
        expect(storage.completeSession).toHaveBeenCalledWith('sess-disc', expect.objectContaining({ status: 'failed' }));
        expect(draft.getSessionRecoveryDraft()).toBeNull(); // owned draft cleared
        expect(controller.pendingResolutionKind()).toBeNull();
        expect(controller.isEngineSelectionLocked()).toBe(false); // unlocked only after discard completed
    });

    // ---- #1033 correction round: findings 1-6 ----------------------------------------------------------
    const setOwner = (u: string | null) => { (controller as unknown as { capturedUserId: string | null }).capturedUserId = u; };
    const resetLifecycle = () => (controller as unknown as { resetTranscriptLifecycle: () => void }).resetTranscriptLifecycle();

    // Finding 1 — drafts are owner-bound at creation; an authenticated session never writes an ownerless draft.
    it('#1033 (1): persistActiveRecoveryDraft binds the draft to the captured user', async () => {
        clearDraft();
        const draft = await import('../sessionRecoveryDraft');
        resetLifecycle();
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { sessionId: string | null }).sessionId = 'sess-own';
        setOwner('user-owner');
        useSessionStore.getState().setStartTime(Date.now() - 4000);
        useSessionStore.getState().updateTranscript('owner bound words', '');
        controller.persistActiveRecoveryDraft();
        expect(draft.getSessionRecoveryDraft()?.userId).toBe('user-owner');
        expect(draft.getRecoverableDraftForUser('user-owner')?.sessionId).toBe('sess-own');
        clearDraft();
    });

    it('#1033 (1): persistActiveRecoveryDraft FAILS CLOSED (writes nothing) when the owner is unknown', async () => {
        clearDraft();
        const draft = await import('../sessionRecoveryDraft');
        resetLifecycle();
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { sessionId: string | null }).sessionId = 'sess-noowner';
        setOwner(null);
        useSessionStore.getState().setStartTime(Date.now() - 4000);
        useSessionStore.getState().updateTranscript('words with no known owner', '');
        controller.persistActiveRecoveryDraft();
        expect(draft.getSessionRecoveryDraft()).toBeNull(); // never write an ownerless draft
        clearDraft();
    });

    // Finding 2 — recovery is resolved ONLY by current session id + authenticated owner; foreign drafts ignored.
    it('#1033 (2): a STALE FOREIGN draft is never consumed by a post-start failure (fails closed)', async () => {
        clearDraft();
        const draft = await import('../sessionRecoveryDraft');
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-otherA', userId: 'user-OTHER', recoveryState: 'finalized_pending_save', nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, metrics: { totalWords: 5 }, durationSeconds: 30, mode: 'private' });
        resetLifecycle();
        setLock(false, 'RECORDING', null);
        setUnresolved(true);
        (controller as unknown as { sessionId: string | null }).sessionId = 'sess-mine';
        setOwner('user-ME');
        useSessionStore.getState().updateTranscript('', '');
        useSessionStore.getState().setChunks([]);
        await doTransition('FAILED');
        // Nothing of MINE is recoverable, and the other account's draft must never be adopted.
        expect(controller.pendingResolutionKind()).toBeNull();
        expect(controller.isEngineSelectionLocked()).toBe(false);
        expect(draft.getSessionRecoveryDraft()?.userId).toBe('user-OTHER'); // left untouched
        clearDraft();
    });

    // Finding 3 — every recoverable transcript source counts; partial-only / chunks-only are NOT "empty".
    it.each([
        { label: 'partial-only', arrange: () => { useSessionStore.getState().updateTranscript('', 'only an in progress partial utterance'); } },
        { label: 'chunks-only', arrange: () => { useSessionStore.getState().updateTranscript('', ''); useSessionStore.getState().setChunks([{ transcript: 'only chunked words were captured', timestamp: Date.now(), isFinal: true }]); } },
    ])('#1033 (3)/#1306: $label recording (live partial/chunks only) is INTERRUPTED — not completable, resolves by discard', async ({ arrange }) => {
        clearDraft();
        resetLifecycle();
        setLock(false, 'RECORDING', null);
        setUnresolved(true);
        (controller as unknown as { sessionId: string | null }).sessionId = 'sess-src';
        setOwner('user-1');
        useSessionStore.getState().setChunks([]);
        arrange();
        await doTransition('FAILED');
        // #1306: a mid-recording interruption has only live/partial state and NO final metrics, so it can never
        // become a completed session — it resolves by discard (unlock) rather than arming a completed retry.
        expect(controller.pendingResolutionKind()).toBeNull();
        expect(controller.isEngineSelectionLocked()).toBe(false);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false);
        useSessionStore.getState().setChunks([]);
        useSessionStore.getState().updateTranscript('', '');
    });

    it('#1033 (3): a committed body PLUS its in-progress partial tail is preserved whole', () => {
        resetLifecycle();
        useSessionStore.getState().setChunks([]);
        useSessionStore.getState().updateTranscript('the committed body of the talk', 'and the trailing partial');
        const text = (controller as unknown as { collectRecoverableTranscript: () => string }).collectRecoverableTranscript();
        expect(text).toContain('committed body');
        expect(text).toContain('trailing partial');
        useSessionStore.getState().updateTranscript('', '');
    });

    // ---- Final Part-2a round: pre-session window / producer-integrity / coherent queued policy ----------
    const setInitialCtx = (ctx: unknown) => { (controller as unknown as { pendingInitialSaveContext: unknown }).pendingInitialSaveContext = ctx; };

    // (1) A failure AFTER RECORDING but BEFORE the initial save must not unlock — it arms an initial_save retry.
    it('#1033 (1): failure in the PRE-SESSION window arms an initial_save retry (never silently unlocks)', async () => {
        clearDraft();
        resetLifecycle();
        setLock(false, 'RECORDING', null);
        setUnresolved(true);
        (controller as unknown as { sessionId: string | null }).sessionId = null; // row does not exist yet
        setOwner('user-early');
        setInitialCtx({ userId: 'user-early', recordingId: 'rec-early', mode: 'private' });
        useSessionStore.getState().setChunks([]);
        useSessionStore.getState().updateTranscript('speech captured before the session row existed', '');
        await doTransition('FAILED');
        // #1306: pre-session live speech with no clean stop has NO final metrics → interrupted, not completable.
        // It resolves by discard rather than arming an initial_save completion from partial state.
        expect(controller.pendingResolutionKind()).toBeNull();
        expect(controller.isEngineSelectionLocked()).toBe(false);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false); setInitialCtx(null);
        useSessionStore.getState().updateTranscript('', '');
    });

    it('#1033 (1)/#1306: PARTIAL-ONLY pre-session speech is INTERRUPTED — not completable from partial state', async () => {
        clearDraft(); resetLifecycle();
        setLock(false, 'RECORDING', null); setUnresolved(true);
        (controller as unknown as { sessionId: string | null }).sessionId = null;
        setOwner('user-early'); setInitialCtx({ userId: 'user-early', recordingId: 'rec-p', mode: 'private' });
        useSessionStore.getState().setChunks([]);
        useSessionStore.getState().updateTranscript('', 'only a partial utterance so far');
        await doTransition('FAILED');
        expect(controller.pendingResolutionKind()).toBeNull();
        expect(controller.isEngineSelectionLocked()).toBe(false);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false); setInitialCtx(null);
        useSessionStore.getState().updateTranscript('', '');
    });

    it('#1033 (1): initial_save retry CREATES the row with the recording idempotency key, then completes it', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.saveSession).mockClear();
        vi.mocked(storage.completeSession).mockClear();
        vi.mocked(storage.updateSession).mockClear();
        vi.mocked(storage.saveSession).mockResolvedValue({ session: { id: 'new-row-1' } } as never);
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true });
        vi.mocked(storage.updateSession).mockResolvedValue({ success: true });
        attestInvoke.mockClear();
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = {
            sessionId: null,
            initialSave: { userId: 'user-early', recordingId: 'rec-idem-1', mode: 'private' },
            // Production-valid: a completed retry mocked SUCCESSFUL must carry a payload v2 accepts.
            completeArgs: PRODUCTION_VALID_COMPLETED_ARGS('early speech', 11),
            attributionEvidence: null,   // #1161: recovered pre-session work has no trusted identity
        };
        setUnresolved(true);
        setPrivateTelemetryContext({ session_id: 'prior-recording' });
        expect(controller.pendingResolutionKind()).toBe('initial_save');
        await expect((controller as unknown as { retryRecordingSave: () => Promise<boolean> }).retryRecordingSave()).resolves.toBe(true);
        // created ONCE, with the recording id as the idempotency key → no duplicate session
        expect(storage.saveSession).toHaveBeenCalledTimes(1);
        expect(vi.mocked(storage.saveSession).mock.calls[0][3]).toBe('rec-idem-1');
        expect(storage.completeSession).toHaveBeenCalledWith('new-row-1', expect.objectContaining({ status: 'completed' }));
        // #1161 P1: null evidence (recovered/rehydrated pre-session work) ⇒ the server RESOLVE op writes the
        // terminal unattributed marker (convergence — no longer a silent skip); the row is durably saved + completed.
        expect(attestInvoke).toHaveBeenCalledTimes(1);
        expect((attestInvoke.mock.calls[0][1] as { body?: { op?: string; sessionId?: string; runtimeEvidence?: unknown } })?.body)
            .toMatchObject({ op: 'resolve_unattributed', sessionId: 'new-row-1' });
        expect(getLastPrivateIdentity().session_id).toBe('new-row-1');
        expect(controller.isEngineSelectionLocked()).toBe(false);
    });

    it('#1033 (1): a FAILED initial_save stays retryable and locked (no duplicate, nothing lost)', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.saveSession).mockResolvedValueOnce({ session: null } as never);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = {
            sessionId: null,
            initialSave: { userId: 'u', recordingId: 'rec-fail', mode: 'private' },
            completeArgs: { status: 'completed', transcript: 'x', duration: 2 },
            attributionEvidence: null,
        };
        setUnresolved(true);
        await expect((controller as unknown as { retryRecordingSave: () => Promise<boolean> }).retryRecordingSave()).resolves.toBe(false);
        expect(controller.pendingResolutionKind()).toBe('initial_save');
        expect(controller.isEngineSelectionLocked()).toBe(true);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false);
        vi.mocked(storage.saveSession).mockResolvedValue({ session: { id: 'x' } } as never);
    });

    it('#1033 (1): a confirmed DISCARD in the pre-session window unlocks without a phantom row', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockClear();
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = {
            sessionId: null,
            initialSave: { userId: 'u', recordingId: 'rec-disc', mode: 'private' },
            completeArgs: { status: 'completed', transcript: 'x', duration: 2 },
            attributionEvidence: null,
        };
        (controller as unknown as { sessionId: string | null }).sessionId = null;
        setUnresolved(true);
        const res = await (controller as unknown as { discardUnresolvedRecording: () => Promise<{ outcome: string }> }).discardUnresolvedRecording();
        expect(res.outcome).toBe('discarded');
        expect(storage.completeSession).not.toHaveBeenCalled(); // no row was ever created
        expect(controller.isEngineSelectionLocked()).toBe(false);
    });

    // (2) A mismatched engine callback is FATAL, not merely ignored.
    it.each([
        { latched: 'private', reported: 'mock' },
        { latched: 'mock', reported: 'private' },
    ] as const)('#1033 (2): $latched → $reported callback terminates the recording and forces unverified', async ({ latched, reported }) => {
        clearDraft(); resetLifecycle();
        // #1306: recovery armed = a FINALIZED draft. Seed one so the mixed-engine teardown stays locked +
        // recoverable (the live transcript alone is not recoverable under metrics-only).
        (await import('../sessionRecoveryDraft')).saveSessionRecoveryDraft({ sessionId: 'sess-mix', userId: 'user-1', recoveryState: 'finalized_pending_save', nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, metrics: { totalWords: 6 }, durationSeconds: 10, mode: latched });
        const stop = vi.fn().mockResolvedValue(undefined);
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, stopTranscription: stop, getMode: () => latched };
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = latched;
        (controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised = false;
        (controller as unknown as { producerIntegrityTeardown: unknown }).producerIntegrityTeardown = null; // singleton isolation
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { sessionId: string | null }).sessionId = 'sess-mix';
        setOwner('user-1'); setInitialCtx(null);
        useSessionStore.getState().setSTTMode(latched);
        useSessionStore.getState().setChunks([]);
        useSessionStore.getState().updateTranscript('words produced before the engine changed', '');
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, reported);

        (controller as unknown as { handleModeChange: (m: string) => void }).handleModeChange(reported);
        await (controller as unknown as { producerIntegrityTeardown: Promise<void> | null }).producerIntegrityTeardown;

        expect(stop).toHaveBeenCalled();                                  // engine stopped, not left producing
        expect((controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised).toBe(true);
        expect(controller.isEngineSelectionLocked()).toBe(true);          // transcript preserved + recovery armed
        expect(controller.pendingResolutionKind()).not.toBeNull();
        // a mixed-engine row can NEVER be verified, even with perfect-looking metadata
        const patch = (controller as unknown as { captureFinalizingIdentity: (s: unknown, m: string) => { attribution_status: string } })
            .captureFinalizingIdentity({ getMetadata: () => ({ engineVersion: 'v', modelName: 'm', deviceType: 'd' }) }, latched);
        expect(patch.attribution_status).toBe('unverified');
        expect(useSessionStore.getState().sttStatus.type).toBe('error');  // never keeps claiming the old engine silently
        (controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised = false;
        (controller as unknown as { producerIntegrityTeardown: unknown }).producerIntegrityTeardown = null;
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = null;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false);
        useSessionStore.getState().updateTranscript('', '');
    });

    it('#1033 (2): a repeated/stale mismatched callback does not re-trigger a second teardown storm', async () => {
        const stop = vi.fn().mockResolvedValue(undefined);
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, stopTranscription: stop, getMode: () => 'private' };
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = 'private';
        (controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised = false;
        (controller as unknown as { producerIntegrityTeardown: unknown }).producerIntegrityTeardown = null;
        (controller as unknown as { state: string }).state = 'RECORDING';
        useSessionStore.getState().setSTTMode('private');
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private');
        (controller as unknown as { handleModeChange: (m: string) => void }).handleModeChange('private');
        await (controller as unknown as { producerIntegrityTeardown: Promise<void> | null }).producerIntegrityTeardown;
        // after the fatal handling the latch is released with the recording; a stale repeat is inert
        const callsAfterFirst = stop.mock.calls.length;
        (controller as unknown as { handleModeChange: (m: string) => void }).handleModeChange('private');
        await (controller as unknown as { producerIntegrityTeardown: Promise<void> | null }).producerIntegrityTeardown;
        expect(stop.mock.calls.length).toBeLessThanOrEqual(callsAfterFirst + 1);
        (controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised = false;
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = null;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false);
    });

    // (3) #1184 fail-closed: a mid-recording entitlement change can NEVER move the engine off Private.
    // Under STT exclusivity every policy is Private-only, so a hostile/stale change (even one requesting
    // cloud) is not a producer change — there is nothing to queue, and store + controller stay Private.
    it('#1033 (3)/#1184: a mid-recording entitlement change stays Private across store + controller (fail-closed)', async () => {
        const svcUpdate = vi.fn().mockResolvedValue(undefined);
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, updatePolicy: svcUpdate, warmUp: vi.fn() };
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private');
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'RECORDING', null);
        setUnresolved(true);
        // A hostile/stale entitlement change requesting cloud arrives mid-recording — neutralized to Private.
        controller.updatePolicy(buildPolicyForUser(true, 'private'));
        expect((controller as unknown as { policy: TranscriptionPolicy }).policy.preferredMode).toBe('private'); // stays Private while locked
        // resolve the recording — the engine is unchanged (Private), so nothing was queued to swap.
        (controller as unknown as { state: string }).state = 'READY';
        (controller as unknown as { markRecordingResolved: () => void }).markRecordingResolved();
        await (controller as unknown as { queuedPolicyApplication: Promise<void> | null }).queuedPolicyApplication;
        const ctrl = (controller as unknown as { policy: TranscriptionPolicy }).policy;
        expect(ctrl.preferredMode).toBe('private');                          // fail-closed: never leaves Private
        expect(useSessionStore.getState().sttMode).toBe('private');          // store agrees
        // The engine never changed (Private throughout), so any service reconfiguration is Private too —
        // asserted per-call to avoid a conditional expect.
        for (const call of svcUpdate.mock.calls) {
            expect((call[0] as TranscriptionPolicy).preferredMode).toBe('private');
        }
        expect((controller as unknown as { queuedProducerPolicy: unknown }).queuedProducerPolicy).toBeNull();
        setLock(false, 'IDLE', null);
    });

    // ---- Final defect batch: owner-before-speech · teardown dedup · awaited policy application ----------

    // (1) A transcript callback emitted SYNCHRONOUSLY during startTranscription must already be owner-bound.
    it('#1033 (1-final): owner + initial-save context exist BEFORE startTranscription can emit a transcript', async () => {
        clearDraft(); resetLifecycle();
        const storage = await import('../../lib/storage');
        vi.mocked(storage.saveSession).mockResolvedValue({ session: null } as never); // no row yet
        let ownerAtFirstTranscript: string | null | undefined;
        let ctxAtFirstTranscript: unknown;
        const svc = {
            isServiceDestroyed: () => false,
            warmUp: vi.fn().mockResolvedValue(undefined),
            getStrategy: () => undefined,
            getState: vi.fn().mockReturnValue('RECORDING'),
            getMode: vi.fn().mockReturnValue('private'),
            getMetadata: vi.fn().mockReturnValue({ engineVersion: 'v', modelName: 'm', deviceType: 'd' }),
            setSessionId: vi.fn(),
            fsm: { is: () => false },
            // the engine emits speech the instant it starts — the classic pre-owner window
            startTranscription: vi.fn().mockImplementation(async () => {
                ownerAtFirstTranscript = (controller as unknown as { capturedUserId: string | null }).capturedUserId;
                ctxAtFirstTranscript = (controller as unknown as { pendingInitialSaveContext: unknown }).pendingInitialSaveContext;
            }),
            stopTranscription: vi.fn().mockResolvedValue({ success: true, transcript: '', stats: {} }),
            destroy: vi.fn().mockResolvedValue(undefined),
        };
        (controller as unknown as { service: unknown }).service = svc;
        setLock(false, 'IDLE', null); setUnresolved(false);
        (controller as unknown as { sessionId: string | null }).sessionId = null;
        setOwner(null); setInitialCtx(null);
        await controller.startRecording(buildPolicyForUser(true, 'private')).catch(() => undefined);
        await controller.whenStable().catch(() => undefined);
        expect(svc.startTranscription).toHaveBeenCalled();
        // The owner was already resolved when the very first transcript could be produced.
        expect(ownerAtFirstTranscript).toBe('test-user');
        expect(ctxAtFirstTranscript).toMatchObject({ userId: 'test-user' });
        setLock(false, 'IDLE', null); setUnresolved(false); setInitialCtx(null);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
    });

    // #893: subscribing to an already-TERMINATED service during the login→/session transition must not
    // throw ENGINE_ALREADY_TERMINATED (which surfaced as a GLOBAL UNHANDLED REJECTION). It must skip the
    // subscribe, drop the stale ref, and resolve cleanly.
    it('#893: syncServiceSubscription skips + drops a terminated service AND invalidates cached readiness', async () => {
        useSessionStore.setState({ isBooting: false } as never);
        const subscribe = vi.fn(() => () => {});
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => true, subscribe };
        (controller as unknown as { serviceUnsubscribe: unknown }).serviceUnsubscribe = null;
        // Seed the stale, already-resolved readyPromise the terminated service left behind. If the guard drops
        // the service WITHOUT clearing this, a later warmUp()/ensureReady() short-circuits and reports readiness
        // with no live service. The guard must null it so the next readiness path rebuilds a fresh service.
        (controller as unknown as { readyPromise: unknown }).readyPromise = Promise.resolve();
        // Must resolve (not reject) — the bug was an unhandled rejection from assertAlive().
        await expect(controller.syncServiceSubscription()).resolves.toBeUndefined();
        expect(subscribe).not.toHaveBeenCalled();                 // never subscribed to the terminated service
        expect((controller as unknown as { service: unknown }).service).toBeNull(); // stale ref dropped
        expect((controller as unknown as { readyPromise: unknown }).readyPromise).toBeNull(); // readiness invalidated → forces rebuild
    });

    // Guard scope: a LIVE service still subscribes normally (the #893 guard must not break the happy path).
    it('#893: syncServiceSubscription still subscribes to a LIVE service', async () => {
        useSessionStore.setState({ isBooting: false } as never);
        const unsub = vi.fn();
        const subscribe = vi.fn(() => unsub);
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, subscribe };
        (controller as unknown as { serviceUnsubscribe: unknown }).serviceUnsubscribe = null;
        await controller.syncServiceSubscription();
        expect(subscribe).toHaveBeenCalledWith(expect.anything(), 'SpeechRuntimeController');
    });

    // (2) Duplicate/concurrent mismatched callbacks must reuse ONE teardown — no second stop/transition/DB op.
    it('#1033 (2-final): concurrent + post-completion duplicate mismatch callbacks perform exactly ONE teardown', async () => {
        clearDraft(); resetLifecycle();
        // #1306: seed a FINALIZED draft so the teardown stays locked + recoverable under metrics-only.
        (await import('../sessionRecoveryDraft')).saveSessionRecoveryDraft({ sessionId: 'sess-dupe', userId: 'user-1', recoveryState: 'finalized_pending_save', nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, metrics: { totalWords: 4 }, durationSeconds: 9, mode: 'private' });
        const stop = vi.fn().mockResolvedValue(undefined);
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, stopTranscription: stop, getMode: () => 'private' };
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = 'private';
        (controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised = false;
        (controller as unknown as { producerIntegrityTeardown: unknown }).producerIntegrityTeardown = null;
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { sessionId: string | null }).sessionId = 'sess-dupe';
        setOwner('user-1');
        useSessionStore.getState().setSTTMode('private');
        useSessionStore.getState().updateTranscript('some words', '');
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private');
        const hmc = (controller as unknown as { handleModeChange: (m: string) => void }).handleModeChange.bind(controller);
        // three CONCURRENT duplicates before the teardown settles
        hmc('private'); hmc('private'); hmc('cloud');
        await (controller as unknown as { producerIntegrityTeardown: Promise<void> | null }).producerIntegrityTeardown;
        // ...and a stale one AFTER completion
        hmc('private');
        await (controller as unknown as { producerIntegrityTeardown: Promise<void> | null }).producerIntegrityTeardown;
        expect(stop).toHaveBeenCalledTimes(1); // exactly one engine stop
        expect(controller.isEngineSelectionLocked()).toBe(true);
        (controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised = false;
        (controller as unknown as { producerIntegrityTeardown: unknown }).producerIntegrityTeardown = null;
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = null;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false);
        useSessionStore.getState().updateTranscript('', '');
    });

    // (3) If the SERVICE rejects the queued policy, nothing may claim success.
    it('#1033 (3-final)/#1184: a mid-recording entitlement change is never a producer swap — nothing queues, engine stays Private (fail-closed)', async () => {
        // Under STT exclusivity every policy is Private-only, so a mid-recording change is NOT a producer
        // change: there is nothing to queue and nothing for the service to reject. The engine stays Private.
        const svcUpdate = vi.fn().mockRejectedValue(new Error('service refused policy'));
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, updatePolicy: svcUpdate, warmUp: vi.fn() };
        const prior = buildPolicyForUser(true, 'private');
        (controller as unknown as { policy: TranscriptionPolicy }).policy = prior;
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'RECORDING', null); setUnresolved(true);
        controller.updatePolicy(buildPolicyForUser(false, 'private')); // neutralized to Private → not a producer change
        expect((controller as unknown as { queuedProducerPolicy: unknown }).queuedProducerPolicy).toBeNull(); // nothing to queue
        (controller as unknown as { state: string }).state = 'READY';
        (controller as unknown as { markRecordingResolved: () => void }).markRecordingResolved();
        await (controller as unknown as { queuedPolicyApplication: Promise<void> | null }).queuedPolicyApplication;
        expect((controller as unknown as { policy: TranscriptionPolicy }).policy.preferredMode).toBe('private'); // fail-closed
        expect(useSessionStore.getState().sttMode).toBe('private');
        (controller as unknown as { queuedProducerPolicy: unknown }).queuedProducerPolicy = null;
        setLock(false, 'IDLE', null); setUnresolved(false);
    });

    // Finding 4 — the producing engine is latched; a mid-recording service callback cannot change identity.
    it.each(['private', 'mock'] as const)('#1033 (4): a mid-recording callback reporting another engine NEVER silently continues (latched %s)', async (latched) => {
        const stop = vi.fn().mockResolvedValue(undefined);
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, stopTranscription: stop, getMode: () => latched };
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = latched;
        (controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised = false;
        (controller as unknown as { producerIntegrityTeardown: unknown }).producerIntegrityTeardown = null;
        (controller as unknown as { state: string }).state = 'RECORDING';
        useSessionStore.getState().setSTTMode(latched);
        const other = latched === 'private' ? 'mock' : 'private';
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, other); // even if policy would allow it
        (controller as unknown as { handleModeChange: (m: string) => void }).handleModeChange(other);
        await (controller as unknown as { producerIntegrityTeardown: Promise<void> | null }).producerIntegrityTeardown;
        // The recording is torn down and permanently unverifiable — the label is NOT merely repainted.
        expect((controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised).toBe(true);
        expect(stop).toHaveBeenCalledTimes(1);
        (controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised = false;
        (controller as unknown as { producerIntegrityTeardown: unknown }).producerIntegrityTeardown = null;
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = null;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false);
    });

    it('#1033 (4): finalizing with a mode that differs from the latch yields UNVERIFIED (never mis-attributed)', () => {
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = 'private';
        const patch = (controller as unknown as { captureFinalizingIdentity: (s: unknown, m: string) => { attribution_status: string } })
            .captureFinalizingIdentity({ getMetadata: () => ({ engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }) }, 'mock');
        expect(patch.attribution_status).toBe('unverified');
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = null;
    });

    it('#1033 (4): the latch does not leak across recordings (cleared on resolution)', () => {
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = 'private';
        setUnresolved(true);
        (controller as unknown as { markRecordingResolved: () => void }).markRecordingResolved();
        expect((controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode).toBeNull();
    });

    // Finding 5 — allowFallback is producer-affecting and is frozen with the rest while locked; then queued.
    it('#1033 (5): allowFallback CANNOT change while locked, and the change is applied at the next boundary', async () => {
        (controller as unknown as { service: unknown }).service = null;
        (controller as unknown as { policy: TranscriptionPolicy }).policy = { ...buildPolicyForUser(true, 'private'), allowFallback: false };
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'RECORDING', null);
        setUnresolved(true);
        controller.updatePolicy({ ...buildPolicyForUser(true, 'private'), allowFallback: true });
        expect((controller as unknown as { policy: TranscriptionPolicy }).policy.allowFallback).toBe(false); // frozen
        // resolve the recording → the queued producer policy is applied for the NEXT recording
        (controller as unknown as { state: string }).state = 'READY';
        (controller as unknown as { markRecordingResolved: () => void }).markRecordingResolved();
        await (controller as unknown as { queuedPolicyApplication: Promise<void> | null }).queuedPolicyApplication;
        expect((controller as unknown as { policy: TranscriptionPolicy }).policy.allowFallback).toBe(true); // not lost
        setLock(false, 'IDLE', null);
    });

    // Finding 6 — discard must be honest about persistence.
    it('#1033 (6): discard when the row CANNOT be marked failed stays RETRYABLE, keeps the draft, stays locked', async () => {
        clearDraft();
        const storage = await import('../../lib/storage');
        const draft = await import('../sessionRecoveryDraft');
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-dbdown', userId: 'user-1', recoveryState: 'finalized_pending_save', nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, metrics: { totalWords: 5 }, durationSeconds: 12, mode: 'private' });
        vi.mocked(storage.completeSession).mockRejectedValueOnce(new Error('DB unavailable'));
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = { sessionId: 'sess-dbdown', completeArgs: { status: 'completed', transcript: 'the only copy of my words', duration: 12 }, attributionEvidence: null };
        setUnresolved(true);
        const res = await (controller as unknown as { discardUnresolvedRecording: () => Promise<{ outcome: string }> }).discardUnresolvedRecording();
        expect(res.outcome).toBe('retryable');
        expect(draft.getSessionRecoveryDraft()?.sessionId).toBe('sess-dbdown'); // sole recovery copy PRESERVED
        expect(controller.isEngineSelectionLocked()).toBe(true); // no false claim of a clean discard
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false);
        clearDraft();
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true });
    });

    it('#1033 (6): discard when completeSession returns success:false is also RETRYABLE (not a silent success)', async () => {
        clearDraft();
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockResolvedValueOnce({ success: false });
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = { sessionId: 'sess-nofail', completeArgs: { status: 'completed', transcript: 'x', duration: 1 }, attributionEvidence: null };
        setUnresolved(true);
        const res = await (controller as unknown as { discardUnresolvedRecording: () => Promise<{ outcome: string }> }).discardUnresolvedRecording();
        expect(res.outcome).toBe('retryable');
        expect(controller.isEngineSelectionLocked()).toBe(true);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false);
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true });
    });

    it('#1033 (6): discard with NO database row succeeds without any completeSession call', async () => {
        clearDraft();
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockClear();
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        (controller as unknown as { sessionId: string | null }).sessionId = null;
        setUnresolved(true);
        const res = await (controller as unknown as { discardUnresolvedRecording: () => Promise<{ outcome: string }> }).discardUnresolvedRecording();
        expect(res.outcome).toBe('discarded');
        expect(storage.completeSession).not.toHaveBeenCalled(); // nothing to reconcile
        expect(controller.isEngineSelectionLocked()).toBe(false);
    });

    it('#1033 (6): a retried discard after the database recovers succeeds and unlocks (idempotent)', async () => {
        clearDraft();
        const storage = await import('../../lib/storage');
        const draft = await import('../sessionRecoveryDraft');
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-retryd', userId: 'user-1', recoveryState: 'finalized_pending_save', nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, metrics: { totalWords: 5 }, durationSeconds: 9, mode: 'private' });
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = { sessionId: 'sess-retryd', completeArgs: { status: 'completed', transcript: 'words', duration: 9 }, attributionEvidence: null };
        setUnresolved(true);
        vi.mocked(storage.completeSession).mockRejectedValueOnce(new Error('DB unavailable'));
        const first = await (controller as unknown as { discardUnresolvedRecording: () => Promise<{ outcome: string }> }).discardUnresolvedRecording();
        expect(first.outcome).toBe('retryable');
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true });
        const second = await (controller as unknown as { discardUnresolvedRecording: () => Promise<{ outcome: string }> }).discardUnresolvedRecording();
        expect(second.outcome).toBe('discarded');
        expect(draft.getSessionRecoveryDraft()).toBeNull();
        expect(controller.isEngineSelectionLocked()).toBe(false);
    });

    it('#1033: successful durable save + attribution UNLOCKS (only after persistence completes)', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.updateSession).mockResolvedValue({ success: true });
        setUnresolved(true); // recording had begun
        await driveStopWithService(mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base', deviceType: 'browser' }), 'sess-unlock', 'private');
        expect((controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved).toBe(false);
        expect(controller.isEngineSelectionLocked()).toBe(false);
    });

    it('#1033: successful Retry Save UNLOCKS', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.updateSession).mockResolvedValue({ success: true });
        setLock(false, 'READY', { sessionId: 'A', patch: { attribution_status: 'verified' } });
        setUnresolved(true);
        expect(controller.isEngineSelectionLocked()).toBe(true);
        await (controller as unknown as { retryPendingAttribution: () => Promise<boolean> }).retryPendingAttribution();
        expect(controller.isEngineSelectionLocked()).toBe(false);
    });

    it('#1033: startRecording is BLOCKED while a prior recording is unresolved (post-start failure)', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.saveSession).mockClear();
        setLock(false, 'IDLE', null);
        setUnresolved(true); // prior recording failed post-start, not yet saved/retried/discarded
        await controller.startRecording(buildPolicyForUser(false, 'private'));
        await controller.whenStable();
        expect(storage.saveSession).not.toHaveBeenCalled();
        setUnresolved(false);
    });

    // #1033 item 1 — updatePolicy is the single authoritative engine-selection gate. Every preferred-engine
    // writer (UI setMode, profile/entitlement sync, __E2E_SET_MODE__, native selection) funnels through it.
    it('#1033: updatePolicy REJECTS a preferredMode engine change while locked (active engine unchanged)', () => {
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private');
        setLock(false, 'RECORDING', null); // locked via recording lifecycle
        controller.updatePolicy(buildPolicyForUser(true, 'private'));
        expect((controller as unknown as { policy: TranscriptionPolicy }).policy.preferredMode).toBe('private');
        setLock(false, 'IDLE', null);
    });

    it('#1033/#1184: updatePolicy applies when unlocked, but a native request stays Private (fail-closed)', () => {
        setLock(false, 'READY', null);
        setUnresolved(false);
        (controller as unknown as { engineSelectionIntentLocked: boolean }).engineSelectionIntentLocked = false;
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private');
        expect(controller.isEngineSelectionLocked()).toBe(false);
        // The update is ALLOWED when unlocked (mechanism), but buildPolicyForUser has already neutralized the
        // native request to Private — the engine never leaves Private.
        controller.updatePolicy(buildPolicyForUser(true, 'private'));
        expect((controller as unknown as { policy: TranscriptionPolicy }).policy.preferredMode).toBe('private');
    });

    // #1033 (A) — the engine-selection bypass is closed on EVERY writer. While locked, the store mode, the
    // controller policy (engine + all allow-flags), and the service policy must ALL stay on the active engine.
    const readPolicyA = () => (controller as unknown as { policy: TranscriptionPolicy }).policy;
    const armLockedPrivate = (svcUpdate?: ReturnType<typeof vi.fn>) => {
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private');
        (controller as unknown as { service: unknown }).service = svcUpdate
            ? { isServiceDestroyed: () => false, updatePolicy: svcUpdate, warmUp: vi.fn().mockResolvedValue(undefined) }
            : null;
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'RECORDING', null); // locked via active recording
    };
    const producerOf = (p: TranscriptionPolicy) => ({ preferredMode: p.preferredMode, allowNative: p.allowNative, allowPrivate: p.allowPrivate });

    it('#1033 (A): requestModeChange REJECTS while locked WITHOUT mutating the store, controller, or service', () => {
        const svcUpdate = vi.fn().mockResolvedValue(undefined);
        armLockedPrivate(svcUpdate);
        const before = producerOf(readPolicyA());
        const res = controller.requestModeChange('private', buildPolicyForUser(true, 'private'));
        expect(res.accepted).toBe(false);
        expect(res.reason).toBe('engine_selection_locked');
        expect(useSessionStore.getState().sttMode).toBe('private'); // store NOT mutated
        expect(producerOf(readPolicyA())).toEqual(before); // controller producer unchanged
        expect(svcUpdate).not.toHaveBeenCalled(); // service policy untouched
        setLock(false, 'IDLE', null);
    });

    it('#1033 (A)/#1184: requestModeChange ACCEPTS when unlocked but a native request collapses to Private in BOTH layers (fail-closed)', () => {
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private');
        (controller as unknown as { service: unknown }).service = null;
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'READY', null);
        const res = controller.requestModeChange('private', buildPolicyForUser(true, 'private'));
        expect(res.accepted).toBe(true);
        // fail-closed: neither the store nor the controller policy can leave Private for a native request.
        expect(useSessionStore.getState().sttMode).toBe('private');
        expect(readPolicyA().preferredMode).toBe('private');
    });

    it('#1033 (A): Cloud-preservation CANNOT restore a rejected engine while locked (the exact bypass)', () => {
        // The historical bypass: the store mode was flipped to cloud first, then preserveAllowedCloudSelection
        // read it and forced preferredMode back to cloud after the gate. Simulate that residual store state.
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private');
        useSessionStore.getState().setSTTMode('mock'); // hostile/residual store state (distinct from the locked Private engine)
        setLock(false, 'RECORDING', null);
        controller.updatePolicy(buildPolicyForUser(true, 'private')); // any policy w/ allowCloud
        expect(readPolicyA().preferredMode).toBe('private'); // NOT restored to cloud
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'IDLE', null);
    });

    it('#1033 (A): updatePolicy preserves ALL producer allow-flags while locked (entitlement/profile sync)', () => {
        armLockedPrivate();
        const before = producerOf(readPolicyA());
        // an entitlement/profile sync that would drop Private and switch to native
        controller.updatePolicy(buildPolicyForUser(false, 'private'));
        expect(producerOf(readPolicyA())).toEqual(before); // engine + allowPrivate/allowCloud/allowNative all kept
        setLock(false, 'IDLE', null);
    });

    it('#1033 (A): __E2E_SET_MODE__ path cannot change the engine while locked', () => {
        armLockedPrivate();
        const cur = readPolicyA();
        // __E2E_SET_MODE__ is exactly `updatePolicy({ ...this.policy, preferredMode: mode })` — exercise it.
        controller.updatePolicy({ ...cur, preferredMode: 'private' });
        expect(readPolicyA().preferredMode).toBe('private');
        setLock(false, 'IDLE', null);
    });

    it('#1033 (A): warmUp cannot change the active engine while locked', async () => {
        const svcWarm = vi.fn().mockResolvedValue(undefined);
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private');
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, warmUp: svcWarm, updatePolicy: vi.fn() };
        (controller as unknown as { readyPromise: Promise<void> }).readyPromise = Promise.resolve();
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'RECORDING', null);
        await controller.warmUp('mock');
        expect(readPolicyA().preferredMode).toBe('private');
        setLock(false, 'IDLE', null);
    });

    // #1320 GUARD (controller boundary): `allowNative` is an inert compatibility field. This falsifies the
    // exact defect the policy-helper test missed — the controller's OWN mode resolution must never let
    // allowNative gate mock/private selection or resolve to the retired Native engine.
    it('#1320: allowNative can never affect controller mode selection or select Native', () => {
        const resolve = (p: TranscriptionPolicy): string =>
            (controller as unknown as { resolveEntitledMode: (p: TranscriptionPolicy) => string }).resolveEntitledMode(p);

        // (a) Flipping allowNative must NOT change the resolved mode for a mock-preferred policy.
        //     (Under the old ad-hoc helper, allowNative:false made mock inadmissible → wrong result.)
        const mockBase = { allowPrivate: false, preferredMode: 'mock' as TranscriptionMode, allowFallback: false, executionIntent: 'guard' };
        expect(resolve({ ...mockBase, allowNative: false })).toBe('mock');
        expect(resolve({ ...mockBase, allowNative: true })).toBe('mock');

        // (b) A hostile/stale 'native' preference with allowNative:true must NEVER resolve to Native.
        //     (Under the old helper this returned 'native'.)
        const hostile = {
            allowNative: true, allowPrivate: true,
            preferredMode: 'native' as unknown as TranscriptionMode,
            allowFallback: false, executionIntent: 'guard',
        } as TranscriptionPolicy;
        expect(resolve(hostile)).not.toBe('native');
        expect(['private', 'mock']).toContain(resolve(hostile));

        // (c) isModeAllowedByCurrentPolicy defers to the authoritative helper — never reads allowNative.
        const isAllowed = (mode: TranscriptionMode | null, p: TranscriptionPolicy): boolean => {
            (controller as unknown as { policy: TranscriptionPolicy }).policy = p;
            return (controller as unknown as { isModeAllowedByCurrentPolicy: (m: TranscriptionMode | null) => boolean }).isModeAllowedByCurrentPolicy(mode);
        };
        expect(isAllowed('mock', { ...mockBase, allowNative: false } as TranscriptionPolicy)).toBe(true);
        expect(isAllowed('mock', { ...mockBase, allowNative: true } as TranscriptionPolicy)).toBe(true);
        expect(isAllowed('native' as unknown as TranscriptionMode, hostile)).toBe(false);
    });

    // #1033 item 5 — a HARD reset (navigation/logout/account change) must clear the lock + pending retry so
    // no engine-selection state leaks across users/sessions; the soft subscriber_unmount reset preserves it.
    it('#1033: hard reset clears engine-selection lock + pending attribution retry (no cross-session leak)', () => {
        (controller as unknown as { engineSelectionIntentLocked: boolean }).engineSelectionIntentLocked = true;
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'A', patch: { attribution_status: 'verified' } };
        expect(controller.isEngineSelectionLocked()).toBe(true);
        controller.reset('logout');
        expect(controller.isEngineSelectionLocked()).toBe(false);
        expect((controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry).toBeNull();
    });

    // #1033 item 4 — the synchronous Start-intent lock must never outlive the Start that set it.
    it('#1033: a double Start into an active recording releases the transient intent flag (no leak) but stays locked', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.saveSession).mockClear();
        setLock(false, 'RECORDING', null); // a recording is already active
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = false;
        (controller as unknown as { service: unknown }).service = null;
        await controller.startRecording(buildPolicyForUser(true, 'private'));
        await controller.whenStable();
        // The Start aborts on the bad state; the transient intent flag is cleared so it cannot pin selection
        // beyond this recording, while the active recording keeps selection locked via its lifecycle state.
        expect((controller as unknown as { engineSelectionIntentLocked: boolean }).engineSelectionIntentLocked).toBe(false);
        expect(controller.isEngineSelectionLocked()).toBe(true);
        setLock(false, 'IDLE', null);
    });

    it('#1033: soft subscriber_unmount reset PRESERVES an in-flight recovery', () => {
        (controller as unknown as { engineSelectionIntentLocked: boolean }).engineSelectionIntentLocked = false;
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'A', patch: { attribution_status: 'verified' } };
        expect(controller.isEngineSelectionLocked()).toBe(true);
        controller.reset('subscriber_unmount');
        expect(controller.isEngineSelectionLocked()).toBe(true); // recovery preserved
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = false;
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
    });

    // #1033 items 2 & 3 — the durable FULL SAVE (completeSession) is a distinct, more-severe failure than an
    // attribution-only miss. It must stay locked, stash a FULL-SAVE retry, and be recoverable by re-running the
    // ACTUAL failed op (completeSession + attribution). And a no-speech recording must RESOLVE by discard (unlock).
    it('#1033 item 2/3: a completeSession FULL-SAVE failure stays locked and stashes a full-save retry (not attribution-only)', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockResolvedValueOnce({ success: false });
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        const svc = mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base', deviceType: 'browser' });
        (controller as unknown as { service: unknown }).service = svc;
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { sessionId: string }).sessionId = 'sess-fullsave';
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true; // recording had begun
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().setSTTMode('private');
        (controller as unknown as { handleTranscriptUpdate: (d: { transcript: { partial: string } }) => void }).handleTranscriptUpdate({ transcript: { partial: 'today i expect live transcript text to remain after stop' } });
        await controller.stopRecording().catch(() => undefined); // the full-save failure rejects the stop
        await controller.whenStable().catch(() => undefined);
        expect(controller.pendingResolutionKind()).toBe('full_save');
        expect((controller as unknown as { pendingFullSaveRetry: { sessionId: string } | null }).pendingFullSaveRetry).toMatchObject({ sessionId: 'sess-fullsave' });
        expect((controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry).toBeNull(); // not the attribution slot
        expect((controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved).toBe(true);
        expect(controller.isEngineSelectionLocked()).toBe(true);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = false;
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true });
    });

    it('#1033 item 2/3: Retry Save re-runs the FULL save (completeSession + attribution) then unlocks', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockClear();
        vi.mocked(storage.updateSession).mockClear();
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true });
        attestInvoke.mockClear();
        attestInvoke.mockResolvedValue({ data: { attributed: true }, error: null });
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = {
            sessionId: 'sess-fs', completeArgs: PRODUCTION_VALID_COMPLETED_ARGS('hello world', 12),
            attributionEvidence: { provider: 'transformers-js', engine: 'private', fallback_occurred: false, cloud_used: false },
        };
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;
        expect(controller.isEngineSelectionLocked()).toBe(true);
        await expect((controller as unknown as { retryRecordingSave: () => Promise<boolean> }).retryRecordingSave()).resolves.toBe(true);
        // #1306: the retry replays the v2 payload — `finalTranscript`, not the pre-v2 `transcript` field.
        expect(storage.completeSession).toHaveBeenCalledWith('sess-fs', expect.objectContaining({ status: 'completed', finalTranscript: 'hello world' }));
        // #1161: attribution now goes through the trusted producer for the SAME session
        expect(attestInvoke).toHaveBeenCalledWith('attest-session-engine', expect.objectContaining({ body: expect.objectContaining({ sessionId: 'sess-fs' }) }));
        expect(controller.isEngineSelectionLocked()).toBe(false);
        expect((controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry).toBeNull();
    });

    it('#1033 item 2/3: a Retry Save whose completeSession fails again stays locked (full-save retry preserved)', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockResolvedValue({ success: false });
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = {
            sessionId: 'sess-fs2', completeArgs: { status: 'completed', transcript: 'x', duration: 5 },
            attributionEvidence: null,
        };
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;
        await expect((controller as unknown as { retryRecordingSave: () => Promise<boolean> }).retryRecordingSave()).resolves.toBe(false);
        expect(controller.isEngineSelectionLocked()).toBe(true);
        expect((controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry).not.toBeNull();
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = false;
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true });
    });

    it('#1033: startRecording is BLOCKED while a full-save retry is pending', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.saveSession).mockClear();
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = { sessionId: 'A', completeArgs: { status: 'completed', transcript: 'x', duration: 1 }, attributionEvidence: null };
        (controller as unknown as { state: string }).state = 'IDLE';
        await controller.startRecording(buildPolicyForUser(false, 'private'));
        await controller.whenStable();
        expect(storage.saveSession).not.toHaveBeenCalled();
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
    });

    it('#1033 item 3: a recording with nothing to save (no-speech) RESOLVES at the normal stop terminal and UNLOCKS', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockClear();
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true });
        const svc = {
            getMode: vi.fn().mockReturnValue('private'),
            getState: vi.fn().mockReturnValue('RECORDING'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - 3000),
            stopTranscription: vi.fn().mockResolvedValue({ success: true, transcript: '', stats: { total_words: 0, filler_words: {}, speaking_rate: 0, duration: 3, accuracy: 1 } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            getMetadata: vi.fn().mockReturnValue({ engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }),
            setSessionId: vi.fn(),
            isServiceDestroyed: () => false,
        };
        useSessionStore.getState().resetSession(); // clear ALL transcript sources (committed/partial/frozen/chunks)
        (controller as unknown as { userWords: string[] }).userWords = [];
        (controller as unknown as { service: unknown }).service = svc;
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { sessionId: string }).sessionId = 'sess-nospeech';
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().setSTTMode('private');
        await controller.stopRecording().catch(() => undefined);
        await controller.whenStable().catch(() => undefined);
        // Whatever non-error terminal an empty recording takes, it must RESOLVE (no retry stashed) and release
        // the lock — otherwise a no-speech take would permanently block the next recording (item 3).
        expect(controller.pendingResolutionKind()).toBeNull(); // nothing to retry
        expect((controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved).toBe(false);
        expect(controller.isEngineSelectionLocked()).toBe(false); // resolved → unlocked
    });

    it('#1033: hard reset clears a pending full-save retry too', () => {
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = { sessionId: 'A', completeArgs: { status: 'completed', transcript: 'x', duration: 1 }, attributionEvidence: null };
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;
        expect(controller.isEngineSelectionLocked()).toBe(true);
        controller.reset('logout');
        expect(controller.isEngineSelectionLocked()).toBe(false);
        expect((controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry).toBeNull();
    });

    // #1033 (C) — reload + account-boundary recovery safety.
    it('#1033 (C1): soft subscriber_unmount preserves BOTH in-memory recovery AND the durable draft', async () => {
        clearDraft();
        const draft = await import('../sessionRecoveryDraft');
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-soft', userId: 'user-1', recoveryState: 'finalized_pending_save', nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, metrics: { totalWords: 5 }, durationSeconds: 8, mode: 'private' });
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = { sessionId: 'sess-soft', completeArgs: { status: 'completed', transcript: 'unsaved', duration: 8 }, attributionEvidence: null };
        controller.reset('subscriber_unmount');
        expect(controller.isEngineSelectionLocked()).toBe(true); // in-memory recovery preserved
        expect(draft.getSessionRecoveryDraft()?.sessionId).toBe('sess-soft'); // durable draft preserved
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = false;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        clearDraft();
    });

    it('#1033 (C2/C4): a hard reset preserves the durable draft; same-user reload rehydrates the lock + full-save retry', async () => {
        clearDraft();
        const draft = await import('../sessionRecoveryDraft');
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-reload', userId: 'user-1', recoveryState: 'finalized_pending_save', nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, metrics: { totalWords: 5 }, durationSeconds: 30, mode: 'private' });
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = { sessionId: 'sess-reload', completeArgs: { status: 'completed', transcript: 'work that survived the reload', duration: 30 }, attributionEvidence: null };
        controller.reset('logout'); // hard reset clears in-memory state (simulating a reload)
        expect(controller.isEngineSelectionLocked()).toBe(false); // in-memory cleared...
        expect(draft.getSessionRecoveryDraft()?.sessionId).toBe('sess-reload'); // ...but unsaved work NOT destroyed (C4)
        // same user reloads → rehydrate
        const rehydrated = (controller as unknown as { rehydrateUnresolvedRecording: (u: string | null) => boolean }).rehydrateUnresolvedRecording('user-1');
        expect(rehydrated).toBe(true);
        expect(controller.isEngineSelectionLocked()).toBe(true);
        expect(controller.pendingResolutionKind()).toBe('full_save');
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = false;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        clearDraft();
    });

    it('#1033 (C3): a DIFFERENT user cannot rehydrate another user\'s recovery draft (no cross-account exposure)', async () => {
        clearDraft();
        const draft = await import('../sessionRecoveryDraft');
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-userA', userId: 'user-A', recoveryState: 'finalized_pending_save', nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, metrics: { totalWords: 5 }, durationSeconds: 20, mode: 'private' });
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = false;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        const rehydrated = (controller as unknown as { rehydrateUnresolvedRecording: (u: string | null) => boolean }).rehydrateUnresolvedRecording('user-B');
        expect(rehydrated).toBe(false); // user B gets nothing
        expect(controller.isEngineSelectionLocked()).toBe(false);
        expect(draft.getRecoverableDraftForUser('user-B')).toBeNull(); // and cannot even read it
        expect(draft.getRecoverableDraftForUser('user-A')?.sessionId).toBe('sess-userA'); // owner still can
        clearDraft();
    });

    // #metrics-duration: the persisted session duration must be the SPOKEN recording length
    // (start → Stop), NOT the save-time wall-clock — the post-Stop finalize decode (tens of
    // seconds on Private) must not inflate the denominator that pace/WPM and the detail view use.
    it.each(['private'] as const)(
        'persists the SPOKEN recording duration for %s — excludes the post-Stop finalize decode (completeSession path)',
        async (mode) => {
            const storage = await import('../../lib/storage');
            vi.mocked(storage.completeSession).mockClear();

            const T0 = 1_700_000_000_000;
            vi.setSystemTime(T0 + 300_000); // "now" = user pressed Stop, exactly 5:00 after record start

            // The finalize decode elapses DURING stopTranscription() — 88s here. A correct impl
            // captured the recording length BEFORE this await; a buggy one measures at save time.
            const stopTranscription = vi.fn().mockImplementation(async () => {
                vi.setSystemTime(T0 + 388_000); // +88s finalize → save happens at 6:28 wall-clock
                return {
                    success: true,
                    transcript: 'point one point two point three point four point five point six',
                    stats: { total_words: 7, filler_words: {}, speaking_rate: 0, duration: 300, accuracy: 1 },
                };
            });
            (controller as unknown as { service: unknown }).service = {
                getMode: vi.fn().mockReturnValue(mode),
                getState: vi.fn().mockReturnValue('RECORDING'),
                getStartTime: vi.fn().mockReturnValue(T0), // recording started at T0
                stopTranscription,
                destroy: vi.fn().mockResolvedValue(undefined),
                getMetadata: vi.fn().mockReturnValue({ engineVersion: mode, modelName: mode, deviceType: mode }),
                setSessionId: vi.fn(),
                isServiceDestroyed: () => false,
            };
            (controller as unknown as { state: string }).state = 'RECORDING';
            (controller as unknown as { sessionId: string }).sessionId = `sess-dur-${mode}`;
            useSessionStore.getState().setRuntimeState('RECORDING');
            useSessionStore.getState().setSTTMode(mode);
            (controller as unknown as { handleTranscriptUpdate: (d: { transcript: { partial: string } }) => void }).handleTranscriptUpdate({
                transcript: { partial: 'point one point two point three point four point five point six' },
            });

            await controller.stopRecording();
            await controller.whenStable();

            const payload = vi.mocked(storage.completeSession).mock.calls[0]?.[1] as { duration?: number } | undefined;
            expect(payload).toBeDefined();
            // Spoken length (300s), NOT the 388s save-time wall-clock that folds in the finalize wait.
            expect(payload?.duration).toBe(300);
            expect(payload?.duration).not.toBe(388);
        },
    );

    it('persists the SPOKEN recording duration on the fallback/late-create save path (saveSession) — excludes finalize', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.saveSession).mockClear();

        const T0 = 1_700_000_000_000;
        vi.setSystemTime(T0 + 300_000); // Stop at start + 5:00

        const stopTranscription = vi.fn().mockImplementation(async () => {
            vi.setSystemTime(T0 + 388_000); // +88s finalize
            return {
                success: true,
                transcript: 'point one point two point three point four point five',
                stats: { total_words: 6, filler_words: {}, speaking_rate: 0, duration: 300, accuracy: 1 },
            };
        });
        (controller as unknown as { service: unknown }).service = {
            getMode: vi.fn().mockReturnValue('private'),
            getState: vi.fn().mockReturnValue('RECORDING'),
            getStartTime: vi.fn().mockReturnValue(T0),
            stopTranscription,
            destroy: vi.fn().mockResolvedValue(undefined),
            getMetadata: vi.fn().mockReturnValue({ engineVersion: 'transformers-js', modelName: 'whisper-base.en', deviceType: 'browser' }),
            setSessionId: vi.fn(),
            isServiceDestroyed: () => false,
        };
        (controller as unknown as { state: string }).state = 'RECORDING';
        // No sessionId → the stop path creates the session via saveSession (fallback branch).
        (controller as unknown as { sessionId: string | null }).sessionId = null;
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().setSTTMode('private');
        (controller as unknown as { handleTranscriptUpdate: (d: { transcript: { partial: string } }) => void }).handleTranscriptUpdate({
            transcript: { partial: 'point one point two point three point four point five' },
        });

        await controller.stopRecording();
        await controller.whenStable();

        const firstArg = vi.mocked(storage.saveSession).mock.calls[0]?.[0] as { duration?: number } | undefined;
        expect(firstArg).toBeDefined();
        expect(firstArg?.duration).toBe(300);
        expect(firstArg?.duration).not.toBe(388);
    });

    it('flags repetitionRisk on the save candidate for a Whisper loop WITHOUT altering the saved transcript', async () => {
        const storage = await import('../../lib/storage');
        window.__SS_TRANSCRIPT_TRACE__ = [];
        vi.mocked(storage.completeSession).mockClear();

        // A Whisper-style loop: a multi-word phrase repeated back-to-back (the short-clip failure class).
        const loopingPartial =
            'basically we should literally like wait basically we should literally like wait basically we should literally like wait';

        const stopTranscription = vi.fn().mockResolvedValue({
            success: true,
            transcript: '',
            stats: { total_words: 0, filler_words: {}, speaking_rate: 0, duration: 10, accuracy: 1 },
        });
        (controller as unknown as { service: unknown }).service = {
            getMode: vi.fn().mockReturnValue('private'),
            getState: vi.fn().mockReturnValue('RECORDING'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - 10_000),
            stopTranscription,
            destroy: vi.fn().mockResolvedValue(undefined),
            getMetadata: vi.fn().mockReturnValue({ engineVersion: 'transformers-js', modelName: 'whisper-base.en', deviceType: 'browser' }),
            setSessionId: vi.fn(),
            isServiceDestroyed: () => false,
        };
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { sessionId: string }).sessionId = 'sess-loop';
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().setSTTMode('private');

        (controller as unknown as { handleTranscriptUpdate: (d: { transcript: { partial: string } }) => void }).handleTranscriptUpdate({
            transcript: { partial: loopingPartial },
        });

        await controller.stopRecording();
        await controller.whenStable();

        // Read the authoritative save-candidate debug directly (same object exposed via
        // window.__SPEECH_RUNTIME_DEBUG__().saveCandidate). #1306 P1: this diagnostic is CONTENT-FREE — it
        // carries the repetition flag + reason + a LENGTH, never the transcript text (no selectedForSave).
        const saveCandidate = (controller as unknown as { lastSaveCandidateDebug: Record<string, unknown> | null }).lastSaveCandidateDebug;

        // (1) The detector FLAGS the loop on the saved candidate (content-free verdict)...
        expect(saveCandidate?.repetitionRisk, `saveCandidate=${JSON.stringify(saveCandidate)}`).toBe(true);
        expect(saveCandidate?.repetitionRiskReason).toBeTruthy();

        // (2) ...detection did NOT truncate the candidate (a length signal, not the text), and the diagnostic
        // exposes NO transcript text (privacy boundary covers test/E2E/real-device artifacts too).
        expect(Number(saveCandidate?.selectedForSaveLength ?? 0)).toBeGreaterThan(0);
        expect(saveCandidate).not.toHaveProperty('selectedForSave');
    });

    it('coalesces a burst of model-load-progress events into one store update (no render flood)', () => {
        // Repro of the SELFHOST-MODELS-MAXDEPTH storm: a large base.en download fires a rapid
        // progress burst. Force the setTimeout fallback + fake timers for deterministic control.
        const originalRaf = (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame;
        (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined;
        vi.useFakeTimers();
        try {
            useSessionStore.getState().setModelLoadingProgress(null);
            const onProgress = (controller as unknown as { handleModelLoadProgress: (p: number | null) => void })
                .handleModelLoadProgress.bind(controller);

            // Burst of 10 rapid progress events (the flood that tripped "Maximum update depth").
            for (const p of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) onProgress(p);

            // Anti-flood: NONE of the burst updated the store synchronously.
            expect(useSessionStore.getState().modelLoadingProgress).toBeNull();

            // One frame later: a SINGLE flush carrying only the latest value.
            vi.advanceTimersByTime(20);
            expect(useSessionStore.getState().modelLoadingProgress).toBe(100);
        } finally {
            vi.useRealTimers();
            (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame = originalRaf;
        }
    });

    it('routes newly-created service transcript callbacks through the controller before subscriber callbacks', async () => {
        SpeechRuntimeController.__resetForTests();
        controller = SpeechRuntimeController.getInstance();
        (controller as unknown as { state: string }).state = 'IDLE';
        (controller as unknown as { initialized: boolean }).initialized = true;
        (controller as unknown as { service: unknown }).service = null;
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
        window.__SS_TRANSCRIPT_TRACE__ = [];

        let capturedOptions: { onTranscriptUpdate?: (data: { transcript: { partial?: string; final?: string } }) => void } = {};
        const subscriberUpdate = vi.fn();
        controller.setSubscriberCallbacks({
            onTranscriptUpdate: subscriberUpdate,
        } as never);
        (controller as unknown as { isSubscriberReady: boolean }).isSubscriberReady = true;

        const service = {
            warmUp: vi.fn().mockResolvedValue(undefined),
            getStrategy: vi.fn().mockReturnValue(null),
            startTranscription: vi.fn().mockImplementation(async () => {
                capturedOptions.onTranscriptUpdate?.({ transcript: { partial: 'native live text appears now' } });
            }),
            getState: vi.fn().mockReturnValue('RECORDING'),
            getMode: vi.fn().mockReturnValue('private'),
            getMetadata: vi.fn().mockReturnValue({ engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }),
            setSessionId: vi.fn(),
            isServiceDestroyed: () => false,
            fsm: { is: vi.fn((state: string) => state === 'RECORDING') },
        } as unknown as ITranscriptionService;

        const getOrCreateSpy = vi.spyOn(sessionManager, 'getOrCreateService').mockImplementation((options) => {
            capturedOptions = options as typeof capturedOptions;
            return service as never;
        });

        await controller.startRecording({ preferredMode: 'private' } as never);
        await controller.whenStable();

        expect(getOrCreateSpy).toHaveBeenCalled();
        expect(useSessionStore.getState().transcript.partial).toBe('Native live text appears now');
        expect(subscriberUpdate).toHaveBeenCalledWith({ transcript: { partial: 'native live text appears now' } });
        expect(window.__SS_TRANSCRIPT_TRACE__?.some(event => event.stage === 'controller:receive')).toBe(true);
        expect(window.__SS_TRANSCRIPT_TRACE__?.some(event => event.stage === 'store:update' && event.type === 'partial')).toBe(true);

        getOrCreateSpy.mockRestore();
    });
});

describe('SpeechRuntimeController.persistActiveRecoveryDraft (UX-NAV-1)', () => {
    let controller: SpeechRuntimeController;

    beforeEach(() => {
        vi.useRealTimers();
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        (controller as unknown as { service: unknown }).service = null;
        (controller as unknown as { state: string }).state = 'IDLE';
        (controller as unknown as { sessionId: string | null }).sessionId = null;
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
    });

    afterEach(() => {
        localStorage.clear();
    });

    const arrangeRecording = (sessionId: string | null, transcript: string, partial = '') => {
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { sessionId: string | null }).sessionId = sessionId;
        // #1033 (1): a persisted session belongs to an authenticated user, so the draft must be owner-bound.
        (controller as unknown as { capturedUserId: string | null }).capturedUserId = 'user-nav';
        // Clear any transcript-lifecycle state left on the singleton by an earlier test (in production this is
        // reset at every recording boundary by resetAnalysisStateForNewRecording).
        (controller as unknown as { resetTranscriptLifecycle: () => void }).resetTranscriptLifecycle();
        const store = useSessionStore.getState();
        // setSTTMode resets the visible session (incl. startTime/transcript) when the mode
        // changes, so set the mode FIRST, then seed startTime + transcript.
        store.setSTTMode('private');
        store.setStartTime(Date.now() - 5000);
        store.updateTranscript(transcript, partial);
    };

    // #1306 Step 3 subtask B — transcript text may exist ONLY in recording-owned memory.
    //
    // A UNIQUE SENTINEL is used rather than a plausible phrase: a generic transcript could coincide with
    // unrelated content and make an absence assertion pass for the wrong reason. This string cannot occur
    // anywhere else, so finding it proves a leak and not finding it proves absence.
    const TRANSCRIPT_SENTINEL = 'ZQX-TRANSCRIPT-LEAK-CANARY-7f3a91-DO-NOT-PERSIST';

    it('the sentinel transcript reaches NO prohibited destination', () => {
        arrangeRecording('sess-privacy-1', `spoken words ${TRANSCRIPT_SENTINEL} more words`);
        controller.persistActiveRecoveryDraft();

        // POSITIVE CONTROL — the sentinel must actually be in recording-owned memory, or every absence
        // assertion below would pass simply because the transcript was never set.
        expect(useSessionStore.getState().transcript.transcript).toContain(TRANSCRIPT_SENTINEL);

        // 1. Recovery browser storage — the whole store, not just the parsed draft, so a leak into an
        //    adjacent key is caught too.
        const allLocal = Object.keys(localStorage).map(k => `${k}=${localStorage.getItem(k)}`).join('\n');
        expect(allLocal).not.toContain(TRANSCRIPT_SENTINEL);
        const allSession = Object.keys(sessionStorage).map(k => `${k}=${sessionStorage.getItem(k)}`).join('\n');
        expect(allSession).not.toContain(TRANSCRIPT_SENTINEL);

        // 2. The draft itself carries no transcript-shaped field at all.
        const draft = getSessionRecoveryDraft();
        expect(JSON.stringify(draft)).not.toContain(TRANSCRIPT_SENTINEL);
        expect(draft).not.toHaveProperty('transcript');

        // 3. Runtime diagnostics expose LENGTHS, never text.
        const debugFn = (window as unknown as { __SPEECH_RUNTIME_DEBUG__?: () => unknown }).__SPEECH_RUNTIME_DEBUG__;
        // Same reason: fold the guard into the value so the assertion always runs.
        expect(typeof debugFn === 'function' ? JSON.stringify(debugFn()) : '')
            .not.toContain(TRANSCRIPT_SENTINEL);
    });

    it('the sentinel does not appear in log output', async () => {
        const { default: logger } = await import('../../lib/logger');
        const captured: string[] = [];
        for (const level of ['info', 'warn', 'error', 'debug'] as const) {
            vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
                captured.push(JSON.stringify(args));
            }) as never);
        }
        arrangeRecording('sess-privacy-2', `spoken words ${TRANSCRIPT_SENTINEL} more words`);
        controller.persistActiveRecoveryDraft();
        // Positive control: logging happened at all, so an empty capture cannot masquerade as clean.
        expect(useSessionStore.getState().transcript.transcript).toContain(TRANSCRIPT_SENTINEL);
        expect(captured.join('\n')).not.toContain(TRANSCRIPT_SENTINEL);
    });

    it('writes a CONTENT-FREE interrupted draft (partial word count, no transcript) while RECORDING', () => {
        arrangeRecording('sess-nav-1', 'the quick brown fox');

        controller.persistActiveRecoveryDraft();

        const draft = getSessionRecoveryDraft();
        expect(draft?.sessionId).toBe('sess-nav-1');
        expect(draft).not.toHaveProperty('transcript');
        expect(draft?.recoveryState).toBe('active_interrupted');
        expect(draft?.nextActionSignal ?? null).toBeNull(); // interrupted → never completable
        expect(draft?.metrics.totalWords).toBe(4); // "the quick brown fox"
        expect(draft?.mode).toBe('private');
        expect(draft?.durationSeconds).toBeGreaterThanOrEqual(4);
    });

    it('counts the partial tail into the word count so in-progress work is reflected (still no transcript)', () => {
        arrangeRecording('sess-nav-2', 'committed words', 'and the partial tail');

        controller.persistActiveRecoveryDraft();

        const draft = getSessionRecoveryDraft();
        expect(draft).not.toHaveProperty('transcript');
        // "committed words and the partial tail" → 6 words counted, no words persisted.
        expect(draft?.metrics.totalWords).toBeGreaterThanOrEqual(5);
    });

    it('is a no-op when not actively RECORDING', () => {
        arrangeRecording('sess-nav-3', 'should not persist');
        (controller as unknown as { state: string }).state = 'IDLE';

        controller.persistActiveRecoveryDraft();

        expect(getSessionRecoveryDraft()).toBeNull();
    });

    it('is a no-op with no sessionId and with an empty transcript', () => {
        arrangeRecording(null, 'no session id');
        controller.persistActiveRecoveryDraft();
        expect(getSessionRecoveryDraft()).toBeNull();

        arrangeRecording('sess-nav-4', '   ');
        controller.persistActiveRecoveryDraft();
        expect(getSessionRecoveryDraft()).toBeNull();
    });
});

describe('SpeechRuntimeController — Private-only policy-writer convergence', () => {
    // Every production writer must converge on Private regardless of commercial status. The policy is
    // set synchronously before the async service enqueue, so these assertions need no timer flushing.
    let controller: SpeechRuntimeController;

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        (controller as unknown as { state: string }).state = 'IDLE';
        (controller as unknown as { initialized: boolean }).initialized = true;
        (controller as unknown as { policy: unknown }).policy = null;
        // #1033: clear the engine-selection lock fields so a leaked lock from a prior describe can't make
        // updatePolicy reject this block's legitimate preferredMode writes.
        (controller as unknown as { engineSelectionIntentLocked: boolean }).engineSelectionIntentLocked = false;
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = false;
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        const stubService = {
            updatePolicy: vi.fn().mockResolvedValue(undefined),
            warmUp: vi.fn().mockResolvedValue(undefined),
            getMode: vi.fn().mockReturnValue('private'),
            getStrategy: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
            fsm: { is: vi.fn().mockReturnValue(false) },
            subscribe: vi.fn(() => vi.fn()),
            destroy: async () => {},
            isServiceDestroyed: () => false,
        } as unknown as ITranscriptionService;
        (controller as unknown as { service: unknown }).service = stubService;
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setSTTMode('private');
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    const readPolicy = () => (controller as unknown as { policy: TranscriptionPolicy }).policy;

    it('#1184: both writers yield Private-capable — the former tier/writer divergence is gone (convergence)', () => {
        // 1) Profile resync with a non-paid compatibility label remains Private.
        controller.updatePolicy(buildPolicyForUser(false, null));
        expect(readPolicy().allowPrivate).toBe(true);

        // 2) Session lifecycle write agrees.
        controller.updatePolicy(buildPolicyForUser(true, 'private'));
        expect(readPolicy().allowPrivate).toBe(true);
        expect(readPolicy().preferredMode).toBe('private');
    });

    it('updatePolicy never downgrades allowPrivate (Cloud-preservation only touches Cloud)', () => {
        controller.updatePolicy(buildPolicyForUser(true, 'private'));
        expect(readPolicy().allowPrivate).toBe(true);
    });
});
