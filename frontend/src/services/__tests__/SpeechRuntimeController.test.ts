// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';
import { sessionManager } from '@/services/transcription/SessionManager';
import { getSessionRecoveryDraft } from '@/services/sessionRecoveryDraft';

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

vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } })
        }
    }))
}));

describe('SpeechRuntimeController FSM Expansion (Steps 1-4)', () => {
    let controller: SpeechRuntimeController;

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        // Reset singleton private state
        (controller as unknown as { state: string }).state = 'IDLE';
        (controller as unknown as { initialized: boolean }).initialized = true;
        const stubService = {
            updatePolicy: vi.fn().mockResolvedValue(undefined),
            warmUp: vi.fn().mockResolvedValue(undefined),
            getMode: vi.fn().mockReturnValue('native'),
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
        store.setActiveEngine('native');

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

    it('preserves an allowed explicit Cloud selection during late Pro policy sync', async () => {
        const store = useSessionStore.getState();
        store.setSTTMode('cloud');

        controller.updatePolicy({
            allowNative: true,
            allowCloud: true,
            allowPrivate: true,
            preferredMode: 'private',
            allowFallback: true,
            executionIntent: 'prod-pro-default',
        });
        await controller.whenStable();

        const service = (controller as unknown as { service: { updatePolicy: ReturnType<typeof vi.fn> } }).service;
        expect(service.updatePolicy).toHaveBeenCalledWith(expect.objectContaining({
            preferredMode: 'cloud',
            allowFallback: false,
            executionIntent: 'prod-pro-default-cloud-preserved',
        }));
    });

    it('does not preserve Cloud when the effective policy disallows it', async () => {
        const store = useSessionStore.getState();
        store.setSTTMode('cloud');

        controller.updatePolicy({
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'prod-free',
        });
        await controller.whenStable();

        const service = (controller as unknown as { service: { updatePolicy: ReturnType<typeof vi.fn> } }).service;
        expect(service.updatePolicy).toHaveBeenCalledWith(expect.objectContaining({
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'prod-free',
        }));
    });

    it('delegates policy changes once and avoids duplicate warm-up loops', async () => {
        controller.updatePolicy({
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
            preferredMode: 'native',
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
        store.setSTTMode('native');
        (controller as unknown as { policy: unknown }).policy = {
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'prod-free',
        };

        (controller as unknown as { handleModeChange: (mode: string) => void }).handleModeChange('private');

        expect(useSessionStore.getState().sttMode).toBe('native');
    });

    it('applies the requested warm-up mode to the service policy before readiness checks', async () => {
        (controller as unknown as { policy: unknown }).policy = {
            allowNative: true,
            allowCloud: true,
            allowPrivate: true,
            preferredMode: 'native',
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

    it.each(['native', 'private', 'cloud'] as const)(
        'preserves visible partial transcript through stop/save for %s',
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
            expect(normalizeForAssertion(completionPayload?.transcript)).toContain('today i expect live transcript text');
            expect(normalizeForAssertion(useSessionStore.getState().transcript.transcript)).toContain('today i expect live transcript text');
            expect(useSessionStore.getState().transcript.partial).toBe('');
        }
    );

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
        // window.__SPEECH_RUNTIME_DEBUG__().saveCandidate), independent of any env gating.
        const saveCandidate = (controller as unknown as { lastSaveCandidateDebug: Record<string, unknown> | null }).lastSaveCandidateDebug;

        // (1) The detector FLAGS the loop on the saved candidate...
        expect(saveCandidate?.repetitionRisk, `saveCandidate=${JSON.stringify(saveCandidate)}`).toBe(true);
        expect(saveCandidate?.repetitionRiskReason).toBeTruthy();

        // (2) ...but the saved transcript is NOT altered — the repeated content is preserved (never deleted).
        const saved = String(saveCandidate?.selectedForSave ?? '').toLowerCase();
        expect((saved.match(/literally/g) ?? []).length, `saved="${saved}"`).toBeGreaterThanOrEqual(2);
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
            getMode: vi.fn().mockReturnValue('native'),
            getMetadata: vi.fn().mockReturnValue({ engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }),
            setSessionId: vi.fn(),
            isServiceDestroyed: () => false,
            fsm: { is: vi.fn((state: string) => state === 'RECORDING') },
        } as unknown as ITranscriptionService;

        const getOrCreateSpy = vi.spyOn(sessionManager, 'getOrCreateService').mockImplementation((options) => {
            capturedOptions = options as typeof capturedOptions;
            return service as never;
        });

        await controller.startRecording({ preferredMode: 'native' } as never);
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
        const store = useSessionStore.getState();
        // setSTTMode resets the visible session (incl. startTime/transcript) when the mode
        // changes, so set the mode FIRST, then seed startTime + transcript.
        store.setSTTMode('private');
        store.setStartTime(Date.now() - 5000);
        store.updateTranscript(transcript, partial);
    };

    it('writes a recovery draft from the live transcript while RECORDING', () => {
        arrangeRecording('sess-nav-1', 'the quick brown fox');

        controller.persistActiveRecoveryDraft();

        const draft = getSessionRecoveryDraft();
        expect(draft?.sessionId).toBe('sess-nav-1');
        expect((draft?.transcript ?? '').toLowerCase()).toContain('the quick brown fox');
        expect(draft?.mode).toBe('private');
        expect(draft?.durationSeconds).toBeGreaterThanOrEqual(4);
    });

    it('includes the partial tail so an in-progress utterance is not lost', () => {
        arrangeRecording('sess-nav-2', 'committed words', 'and the partial tail');

        controller.persistActiveRecoveryDraft();

        const text = (getSessionRecoveryDraft()?.transcript ?? '').toLowerCase();
        expect(text).toContain('committed words');
        expect(text).toContain('and the partial tail');
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
