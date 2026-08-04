// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { buildPolicyForUser, TranscriptionPolicy, type TranscriptionMode } from '../transcription/TranscriptionPolicy';
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
    wireProgressEvaluationOnSave: vi.fn().mockResolvedValue(undefined),
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

    // #1033: one recording = one engine → finalization persists a VERIFIED identity tuple +
    // attribution_status atomically (row is 'pending' by DB default until then).
    const driveStopWithService = async (svc: Record<string, unknown>, sessionId: string, mode: TranscriptionMode) => {
        (controller as unknown as { service: unknown }).service = svc;
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { sessionId: string }).sessionId = sessionId;
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
        .map((c) => (c[1] as { body?: { sessionId?: string; runtimeEvidence?: Record<string, unknown> } } | undefined)?.body);
    const lastBody = () => { const b = attestBodies(); return b[b.length - 1]; };
    const lastEvidence = () => lastBody()?.runtimeEvidence;

    it.each(['native', 'private'] as const)(
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

    it('#1161: a CLOUD session is NOT attested (no trusted local identity → no authority, no Progress)', async () => {
        attestInvoke.mockClear();
        (controller as unknown as { resolvedPrivateEngineVersion: string | null }).resolvedPrivateEngineVersion = null;
        await driveStopWithService(mkService('cloud', { engineVersion: 'v-c', modelName: 'm-c', deviceType: 'd-c' }), 'sess-attr-cloud', 'cloud');
        expect(attestInvoke).not.toHaveBeenCalled();
    });

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
    ])('#1033/#1161: $label → NO trusted identity → NOT attested (no authority)', async ({ svc }) => {
        attestInvoke.mockClear();
        const base = mkService('native', { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' });
        await driveStopWithService({ ...base, ...svc }, 'sess-attr-unv', 'native');
        // An unverifiable local identity produces no evidence → the client never calls the producer (fail-closed).
        expect(attestInvoke).not.toHaveBeenCalled();
    });

    it('#1033/#1161: an engine token outside the allowlist → NOT attested (no authority)', async () => {
        attestInvoke.mockClear();
        const svc = { ...mkService('native', { engineVersion: 'x', modelName: 'y', deviceType: 'z' }), getMode: vi.fn().mockReturnValue('some-unknown-engine') };
        await driveStopWithService(svc, 'sess-attr-badtoken', 'native');
        expect(attestInvoke).not.toHaveBeenCalled();
    });

    it('#1033: identity is snapshotted BEFORE stopTranscription()', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.updateSession).mockClear();
        const order: string[] = [];
        const svc = mkService('native', { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' });
        svc.getMetadata = vi.fn(() => { order.push('getMetadata'); return { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }; });
        svc.stopTranscription = vi.fn(async () => { order.push('stopTranscription'); return { success: true, transcript: '', stats: { total_words: 0, filler_words: {}, speaking_rate: 0, duration: 10, accuracy: 1 } }; });
        await driveStopWithService(svc, 'sess-attr-order', 'native');
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
        await expect(driveStopWithService(mkService('native', { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }), 'sess-attr-retry', 'native')).resolves.not.toThrow();
        // transcript survived the attribution failure
        expect(storage.completeSession).toHaveBeenCalledWith('sess-attr-retry', expect.objectContaining({ status: 'completed' }));
        // now Retry Save re-attests the SAME session (no new saveSession/duplicate)
        attestInvoke.mockClear();
        attestInvoke.mockResolvedValue({ data: { attributed: true }, error: null });
        await expect((controller as unknown as { retryPendingAttribution: () => Promise<boolean> }).retryPendingAttribution()).resolves.toBe(true);
        const retryCall = attestInvoke.mock.calls.find(c => (c[1] as { body?: { sessionId?: string } })?.body?.sessionId === 'sess-attr-retry');
        expect(retryCall).toBeTruthy();
        expect((retryCall![1] as { body: { runtimeEvidence: Record<string, unknown> } }).body.runtimeEvidence).toMatchObject({ provider: 'web-speech', engine: 'native' });
        expect(vi.mocked(storage.saveSession).mock.calls.length).toBe(saveCallsBefore); // no duplicate session created
    });

    // #1033 Part 2 — runtime enforcement (controller-level, not UI-only).
    it('#1033: switchToNative is REJECTED while a recording is active (no engine change)', async () => {
        const updatePolicySpy = vi.spyOn(controller, 'updatePolicy');
        const startSpy = vi.spyOn(controller, 'startRecording');
        (controller as unknown as { state: string }).state = 'RECORDING';
        expect(controller.isEngineSelectionLocked()).toBe(true);
        await controller.switchToNative();
        await controller.whenStable();
        expect(updatePolicySpy).not.toHaveBeenCalled(); // engine unchanged while locked
        expect(startSpy).not.toHaveBeenCalled();
        updatePolicySpy.mockRestore();
        startSpy.mockRestore();
    });

    it('#1033: switchToNative does NOT auto-start the microphone — selecting Browser only sets the NEXT-recording engine (item 6)', async () => {
        (controller as unknown as { state: string }).state = 'READY';
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = false;
        (controller as unknown as { engineSelectionIntentLocked: boolean }).engineSelectionIntentLocked = false;
        expect(controller.isEngineSelectionLocked()).toBe(false);
        const updatePolicySpy = vi.spyOn(controller, 'updatePolicy');
        const startSpy = vi.spyOn(controller, 'startRecording');
        await controller.switchToNative();
        await controller.whenStable();
        expect(startSpy).not.toHaveBeenCalled(); // selecting an engine ≠ Start
        expect(updatePolicySpy).toHaveBeenCalledWith(expect.objectContaining({ preferredMode: 'native' }));
        updatePolicySpy.mockRestore();
        startSpy.mockRestore();
    });

    it('#1033: startRecording is BLOCKED while a prior attribution retry is pending', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.saveSession).mockClear();
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'sess-A', patch: { attribution_status: 'verified' } };
        (controller as unknown as { state: string }).state = 'IDLE';
        await controller.startRecording(buildPolicyForUser(false, 'native', { allowCloud: false }));
        await controller.whenStable();
        expect(storage.saveSession).not.toHaveBeenCalled();
        expect(useSessionStore.getState().sttStatus).toEqual(expect.objectContaining({ type: 'error' }));
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
    });

    it('#1033: a later recording does NOT clear an earlier session pending retry', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.updateSession).mockResolvedValue({ success: true });
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'sess-A', patch: { attribution_status: 'verified' } };
        await driveStopWithService(mkService('native', { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }), 'sess-B', 'native');
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
        const p = controller.startRecording(buildPolicyForUser(true, 'private', { allowCloud: false })); // not awaited
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
    it('#1036: record-time authority — startRecording overwrites a stored tier-only policy with the capability policy', async () => {
        setLock(false, 'IDLE', null);
        // Provider/hook path stored first: TIER-ONLY policy for a free-user-with-sample → DENIES Private.
        const tierOnlyPolicy = buildPolicyForUser(false, 'private', { allowCloud: false });
        controller.updatePolicy(tierOnlyPolicy);
        expect((controller as unknown as { policy: TranscriptionPolicy | null }).policy?.allowPrivate).toBe(false);

        // Lifecycle path: the CAPABILITY (sample-aware) policy GRANTS Private and is what startRecording receives.
        const capabilityPolicy = buildPolicyForUser(true, 'private', { allowCloud: false });
        const p = controller.startRecording(capabilityPolicy); // not awaited — this.policy is assigned synchronously
        const stored = (controller as unknown as { policy: TranscriptionPolicy | null }).policy;
        expect(stored).toBe(capabilityPolicy);        // tier-only policy overwritten at record time
        expect(stored?.allowPrivate).toBe(true);      // the record authority GRANTS Private to the sample user

        await controller.whenStable().catch(() => undefined);
        await p.catch(() => undefined);
        setLock(false, 'IDLE', null);
    });

    it.each(['INITIATING', 'ENGINE_INITIALIZING', 'RECORDING', 'STOPPING'] as const)(
        '#1033: switchToNative is rejected in locked lifecycle state %s (no engine change)',
        async (st) => {
            const updatePolicySpy = vi.spyOn(controller, 'updatePolicy');
            setLock(false, st, null);
            await controller.switchToNative();
            await controller.whenStable();
            expect(updatePolicySpy).not.toHaveBeenCalled();
            updatePolicySpy.mockRestore();
        }
    );

    it('#1033: switchToNative is rejected while an attribution retry is pending (even at READY)', async () => {
        const updatePolicySpy = vi.spyOn(controller, 'updatePolicy');
        setLock(false, 'READY', { sessionId: 'A', patch: { attribution_status: 'verified' } });
        expect(controller.isEngineSelectionLocked()).toBe(true);
        await controller.switchToNative();
        await controller.whenStable();
        expect(updatePolicySpy).not.toHaveBeenCalled();
        updatePolicySpy.mockRestore();
        setLock(false, 'READY', null);
    });

    it('#1033: a FAILED session-B write does NOT overwrite pending session A', async () => {
        const storage = await import('../../lib/storage');
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'sess-A', patch: { attribution_status: 'verified', engine: 'private' } };
        vi.mocked(storage.updateSession).mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
            if (patch && Object.prototype.hasOwnProperty.call(patch, 'attribution_status')) throw new Error('DB down');
            return { success: true };
        });
        await driveStopWithService(mkService('native', { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }), 'sess-B', 'native');
        expect((controller as unknown as { pendingAttributionRetry: { sessionId: string } }).pendingAttributionRetry).toMatchObject({ sessionId: 'sess-A' }); // A preserved
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        vi.mocked(storage.updateSession).mockResolvedValue({ success: true });
    });

    it('#1033: retry of session A does not clear a pending that changed to session B mid-flight (compare-and-clear)', async () => {
        const ev = { provider: 'web-speech', engine: 'native', fallback_occurred: false, cloud_used: false };
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
    ])('#1033 (B): POST-start failure ($from → $term) with RECOVERABLE work STAYS locked + arms a full-save retry', async ({ from, term }) => {
        clearDraft();
        setLock(false, from, null);
        setUnresolved(true); // recording had begun and is not durably resolved
        (controller as unknown as { sessionId: string | null }).sessionId = 'sess-postfail';
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        useSessionStore.getState().updateTranscript('recoverable words captured before the failure', '');
        await doTransition(term);
        expect(controller.isEngineSelectionLocked()).toBe(true); // locked because there IS unsaved work
        expect(controller.pendingResolutionKind()).toBe('full_save'); // ...and an actionable recovery exists (B4)
        setUnresolved(false);
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        useSessionStore.getState().updateTranscript('', '');
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
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-hb', userId: 'user-1', transcript: 'words spoken before the engine died', durationSeconds: 42, mode: 'private' });
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
        const pending = (controller as unknown as { pendingFullSaveRetry: { sessionId: string; completeArgs: { transcript: string; duration: number }; attributionEvidence: unknown } | null }).pendingFullSaveRetry;
        expect(pending).toMatchObject({ sessionId: 'sess-hb' });
        expect(pending?.completeArgs.transcript).toContain('engine died');
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
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-disc', userId: 'user-1', transcript: 'unsaved words', durationSeconds: 10, mode: 'private' });
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
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-otherA', userId: 'user-OTHER', transcript: 'another accounts private words', durationSeconds: 30, mode: 'private' });
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
    ])('#1033 (3): $label recording is recoverable — never classified as empty', async ({ arrange }) => {
        clearDraft();
        resetLifecycle();
        setLock(false, 'RECORDING', null);
        setUnresolved(true);
        (controller as unknown as { sessionId: string | null }).sessionId = 'sess-src';
        setOwner('user-1');
        useSessionStore.getState().setChunks([]);
        arrange();
        await doTransition('FAILED');
        expect(controller.pendingResolutionKind()).toBe('full_save'); // recoverable → actionable, still locked
        expect(controller.isEngineSelectionLocked()).toBe(true);
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
        expect(controller.pendingResolutionKind()).toBe('initial_save');
        expect(controller.isEngineSelectionLocked()).toBe(true); // early speech is NOT lost
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false); setInitialCtx(null);
        useSessionStore.getState().updateTranscript('', '');
    });

    it('#1033 (1): PARTIAL-ONLY speech in the pre-session window is still recoverable', async () => {
        clearDraft(); resetLifecycle();
        setLock(false, 'RECORDING', null); setUnresolved(true);
        (controller as unknown as { sessionId: string | null }).sessionId = null;
        setOwner('user-early'); setInitialCtx({ userId: 'user-early', recordingId: 'rec-p', mode: 'native' });
        useSessionStore.getState().setChunks([]);
        useSessionStore.getState().updateTranscript('', 'only a partial utterance so far');
        await doTransition('FAILED');
        expect(controller.pendingResolutionKind()).toBe('initial_save');
        expect(controller.isEngineSelectionLocked()).toBe(true);
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
            completeArgs: { status: 'completed', transcript: 'early speech', duration: 11 },
            attributionEvidence: null,   // #1161: recovered pre-session work has no trusted identity
        };
        setUnresolved(true);
        expect(controller.pendingResolutionKind()).toBe('initial_save');
        await expect((controller as unknown as { retryRecordingSave: () => Promise<boolean> }).retryRecordingSave()).resolves.toBe(true);
        // created ONCE, with the recording id as the idempotency key → no duplicate session
        expect(storage.saveSession).toHaveBeenCalledTimes(1);
        expect(vi.mocked(storage.saveSession).mock.calls[0][3]).toBe('rec-idem-1');
        expect(storage.completeSession).toHaveBeenCalledWith('new-row-1', expect.objectContaining({ status: 'completed' }));
        // #1161: null evidence ⇒ no attestation call (no authority), but the row is durably saved + completed
        expect(attestInvoke).not.toHaveBeenCalled();
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
        { latched: 'private', reported: 'native' },
        { latched: 'private', reported: 'cloud' },
        { latched: 'native', reported: 'private' },
    ] as const)('#1033 (2): $latched → $reported callback terminates the recording and forces unverified', async ({ latched, reported }) => {
        clearDraft(); resetLifecycle();
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
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, reported, { allowCloud: true });

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
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'native', { allowCloud: true });
        (controller as unknown as { handleModeChange: (m: string) => void }).handleModeChange('native');
        await (controller as unknown as { producerIntegrityTeardown: Promise<void> | null }).producerIntegrityTeardown;
        // after the fatal handling the latch is released with the recording; a stale repeat is inert
        const callsAfterFirst = stop.mock.calls.length;
        (controller as unknown as { handleModeChange: (m: string) => void }).handleModeChange('native');
        await (controller as unknown as { producerIntegrityTeardown: Promise<void> | null }).producerIntegrityTeardown;
        expect(stop.mock.calls.length).toBeLessThanOrEqual(callsAfterFirst + 1);
        (controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised = false;
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = null;
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
        setUnresolved(false);
    });

    // (3) The queued producer policy is applied COHERENTLY across store + controller + service.
    it.each([
        { from: 'cloud', policy: () => buildPolicyForUser(true, 'cloud', { allowCloud: false }), label: 'Cloud revoked' },
        { from: 'private', policy: () => buildPolicyForUser(false, 'private', { allowCloud: false }), label: 'Private revoked' },
    ])('#1033 (3): $label — store, controller policy, and service agree after resolution', async ({ from, policy }) => {
        const svcUpdate = vi.fn().mockResolvedValue(undefined);
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, updatePolicy: svcUpdate, warmUp: vi.fn() };
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, from as TranscriptionMode, { allowCloud: true });
        useSessionStore.getState().setSTTMode(from as TranscriptionMode);
        setLock(false, 'RECORDING', null);
        setUnresolved(true);
        // entitlement change arrives mid-recording → rejected + queued
        controller.updatePolicy(policy());
        expect((controller as unknown as { policy: TranscriptionPolicy }).policy.preferredMode).toBe(from);
        // resolve → apply coherently
        (controller as unknown as { state: string }).state = 'READY';
        (controller as unknown as { markRecordingResolved: () => void }).markRecordingResolved();
        await (controller as unknown as { queuedPolicyApplication: Promise<void> | null }).queuedPolicyApplication;
        const ctrl = (controller as unknown as { policy: TranscriptionPolicy }).policy;
        expect(ctrl.preferredMode).not.toBe(from);                     // stale selection cannot survive revocation
        expect(useSessionStore.getState().sttMode).toBe(ctrl.preferredMode); // UI agrees with the controller
        const svcCalls = svcUpdate.mock.calls;
        expect(svcCalls.length).toBeGreaterThan(0); // the service WAS reconfigured at the boundary
        const lastServicePolicy = svcCalls[svcCalls.length - 1][0] as TranscriptionPolicy;
        expect(lastServicePolicy.preferredMode).toBe(ctrl.preferredMode); // service agrees with store + controller
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
        await controller.startRecording(buildPolicyForUser(true, 'private', { allowCloud: false })).catch(() => undefined);
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
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'native', { allowCloud: true });
        const hmc = (controller as unknown as { handleModeChange: (m: string) => void }).handleModeChange.bind(controller);
        // three CONCURRENT duplicates before the teardown settles
        hmc('native'); hmc('native'); hmc('cloud');
        await (controller as unknown as { producerIntegrityTeardown: Promise<void> | null }).producerIntegrityTeardown;
        // ...and a stale one AFTER completion
        hmc('native');
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
    it('#1033 (3-final): a service-rejected queued policy restores prior state, RETAINS the queue, and surfaces an error', async () => {
        const svcUpdate = vi.fn().mockRejectedValue(new Error('service refused policy'));
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, updatePolicy: svcUpdate, warmUp: vi.fn() };
        const prior = buildPolicyForUser(true, 'private', { allowCloud: true });
        (controller as unknown as { policy: TranscriptionPolicy }).policy = prior;
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'RECORDING', null); setUnresolved(true);
        controller.updatePolicy(buildPolicyForUser(false, 'native', { allowCloud: false })); // queued while locked
        expect((controller as unknown as { queuedProducerPolicy: unknown }).queuedProducerPolicy).not.toBeNull();
        (controller as unknown as { state: string }).state = 'READY';
        (controller as unknown as { markRecordingResolved: () => void }).markRecordingResolved();
        await (controller as unknown as { queuedPolicyApplication: Promise<void> | null }).queuedPolicyApplication;
        // service refused → prior coherent state restored, queue KEPT for retry, user told it did not apply
        expect((controller as unknown as { policy: TranscriptionPolicy }).policy.preferredMode).toBe('private');
        expect(useSessionStore.getState().sttMode).toBe('private');
        expect((controller as unknown as { queuedProducerPolicy: unknown }).queuedProducerPolicy).not.toBeNull();
        expect(useSessionStore.getState().sttStatus.type).toBe('error');
        (controller as unknown as { queuedProducerPolicy: unknown }).queuedProducerPolicy = null;
        setLock(false, 'IDLE', null); setUnresolved(false);
    });

    // Finding 4 — the producing engine is latched; a mid-recording service callback cannot change identity.
    it.each(['native', 'private', 'cloud'] as const)('#1033 (4): a mid-recording callback reporting another engine NEVER silently continues (latched %s)', async (latched) => {
        const stop = vi.fn().mockResolvedValue(undefined);
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, stopTranscription: stop, getMode: () => latched };
        (controller as unknown as { recordingEngineMode: string | null }).recordingEngineMode = latched;
        (controller as unknown as { producerIntegrityCompromised: boolean }).producerIntegrityCompromised = false;
        (controller as unknown as { producerIntegrityTeardown: unknown }).producerIntegrityTeardown = null;
        (controller as unknown as { state: string }).state = 'RECORDING';
        useSessionStore.getState().setSTTMode(latched);
        const other = latched === 'native' ? 'private' : 'native';
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, other, { allowCloud: true }); // even if policy would allow it
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
            .captureFinalizingIdentity({ getMetadata: () => ({ engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }) }, 'native');
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
        (controller as unknown as { policy: TranscriptionPolicy }).policy = { ...buildPolicyForUser(true, 'private', { allowCloud: false }), allowFallback: false };
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'RECORDING', null);
        setUnresolved(true);
        controller.updatePolicy({ ...buildPolicyForUser(true, 'private', { allowCloud: false }), allowFallback: true });
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
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-dbdown', userId: 'user-1', transcript: 'the only copy of my words', durationSeconds: 12, mode: 'private' });
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
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-retryd', userId: 'user-1', transcript: 'words', durationSeconds: 9, mode: 'private' });
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
        await driveStopWithService(mkService('native', { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }), 'sess-unlock', 'native');
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
        await controller.startRecording(buildPolicyForUser(false, 'native', { allowCloud: false }));
        await controller.whenStable();
        expect(storage.saveSession).not.toHaveBeenCalled();
        setUnresolved(false);
    });

    // #1033 item 1 — updatePolicy is the single authoritative engine-selection gate. Every preferred-engine
    // writer (UI setMode, profile/entitlement sync, __E2E_SET_MODE__, native selection) funnels through it.
    it('#1033: updatePolicy REJECTS a preferredMode engine change while locked (active engine unchanged)', () => {
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private', { allowCloud: false });
        setLock(false, 'RECORDING', null); // locked via recording lifecycle
        controller.updatePolicy(buildPolicyForUser(true, 'native', { allowCloud: false }));
        expect((controller as unknown as { policy: TranscriptionPolicy }).policy.preferredMode).toBe('private');
        setLock(false, 'IDLE', null);
    });

    it('#1033: updatePolicy ALLOWS a preferredMode change when unlocked', () => {
        setLock(false, 'READY', null);
        setUnresolved(false);
        (controller as unknown as { engineSelectionIntentLocked: boolean }).engineSelectionIntentLocked = false;
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private', { allowCloud: false });
        expect(controller.isEngineSelectionLocked()).toBe(false);
        controller.updatePolicy(buildPolicyForUser(true, 'native', { allowCloud: false }));
        expect((controller as unknown as { policy: TranscriptionPolicy }).policy.preferredMode).toBe('native');
    });

    // #1033 (A) — the engine-selection bypass is closed on EVERY writer. While locked, the store mode, the
    // controller policy (engine + all allow-flags), and the service policy must ALL stay on the active engine.
    const readPolicyA = () => (controller as unknown as { policy: TranscriptionPolicy }).policy;
    const armLockedPrivate = (svcUpdate?: ReturnType<typeof vi.fn>) => {
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private', { allowCloud: true });
        (controller as unknown as { service: unknown }).service = svcUpdate
            ? { isServiceDestroyed: () => false, updatePolicy: svcUpdate, warmUp: vi.fn().mockResolvedValue(undefined) }
            : null;
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'RECORDING', null); // locked via active recording
    };
    const producerOf = (p: TranscriptionPolicy) => ({ preferredMode: p.preferredMode, allowNative: p.allowNative, allowCloud: p.allowCloud, allowPrivate: p.allowPrivate });

    it('#1033 (A): requestModeChange REJECTS while locked WITHOUT mutating the store, controller, or service', () => {
        const svcUpdate = vi.fn().mockResolvedValue(undefined);
        armLockedPrivate(svcUpdate);
        const before = producerOf(readPolicyA());
        const res = controller.requestModeChange('native', buildPolicyForUser(true, 'native', { allowCloud: true }));
        expect(res.accepted).toBe(false);
        expect(res.reason).toBe('engine_selection_locked');
        expect(useSessionStore.getState().sttMode).toBe('private'); // store NOT mutated
        expect(producerOf(readPolicyA())).toEqual(before); // controller producer unchanged
        expect(svcUpdate).not.toHaveBeenCalled(); // service policy untouched
        setLock(false, 'IDLE', null);
    });

    it('#1033 (A): requestModeChange ACCEPTS when unlocked and applies store + policy', () => {
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private', { allowCloud: true });
        (controller as unknown as { service: unknown }).service = null;
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'READY', null);
        const res = controller.requestModeChange('native', buildPolicyForUser(true, 'native', { allowCloud: true }));
        expect(res.accepted).toBe(true);
        expect(useSessionStore.getState().sttMode).toBe('native');
        expect(readPolicyA().preferredMode).toBe('native');
    });

    it('#1033 (A): Cloud-preservation CANNOT restore a rejected engine while locked (the exact bypass)', () => {
        // The historical bypass: the store mode was flipped to cloud first, then preserveAllowedCloudSelection
        // read it and forced preferredMode back to cloud after the gate. Simulate that residual store state.
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private', { allowCloud: true });
        useSessionStore.getState().setSTTMode('cloud'); // hostile/residual store state
        setLock(false, 'RECORDING', null);
        controller.updatePolicy(buildPolicyForUser(true, 'private', { allowCloud: true })); // any policy w/ allowCloud
        expect(readPolicyA().preferredMode).toBe('private'); // NOT restored to cloud
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'IDLE', null);
    });

    it('#1033 (A): updatePolicy preserves ALL producer allow-flags while locked (entitlement/profile sync)', () => {
        armLockedPrivate();
        const before = producerOf(readPolicyA());
        // an entitlement/profile sync that would drop Private and switch to native
        controller.updatePolicy(buildPolicyForUser(false, 'native', { allowCloud: false }));
        expect(producerOf(readPolicyA())).toEqual(before); // engine + allowPrivate/allowCloud/allowNative all kept
        setLock(false, 'IDLE', null);
    });

    it('#1033 (A): __E2E_SET_MODE__ path cannot change the engine while locked', () => {
        armLockedPrivate();
        const cur = readPolicyA();
        // __E2E_SET_MODE__ is exactly `updatePolicy({ ...this.policy, preferredMode: mode })` — exercise it.
        controller.updatePolicy({ ...cur, preferredMode: 'native' });
        expect(readPolicyA().preferredMode).toBe('private');
        setLock(false, 'IDLE', null);
    });

    it('#1033 (A): warmUp cannot change the active engine while locked', async () => {
        const svcWarm = vi.fn().mockResolvedValue(undefined);
        (controller as unknown as { policy: TranscriptionPolicy }).policy = buildPolicyForUser(true, 'private', { allowCloud: true });
        (controller as unknown as { service: unknown }).service = { isServiceDestroyed: () => false, warmUp: svcWarm, updatePolicy: vi.fn() };
        (controller as unknown as { readyPromise: Promise<void> }).readyPromise = Promise.resolve();
        useSessionStore.getState().setSTTMode('private');
        setLock(false, 'RECORDING', null);
        await controller.warmUp('native');
        expect(readPolicyA().preferredMode).toBe('private');
        setLock(false, 'IDLE', null);
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
        await controller.startRecording(buildPolicyForUser(true, 'private', { allowCloud: false }));
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
        const svc = mkService('native', { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' });
        (controller as unknown as { service: unknown }).service = svc;
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { sessionId: string }).sessionId = 'sess-fullsave';
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true; // recording had begun
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().setSTTMode('native');
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
            sessionId: 'sess-fs', completeArgs: { status: 'completed', transcript: 'hello world', duration: 12 },
            attributionEvidence: { provider: 'web-speech', engine: 'native', fallback_occurred: false, cloud_used: false },
        };
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;
        expect(controller.isEngineSelectionLocked()).toBe(true);
        await expect((controller as unknown as { retryRecordingSave: () => Promise<boolean> }).retryRecordingSave()).resolves.toBe(true);
        expect(storage.completeSession).toHaveBeenCalledWith('sess-fs', expect.objectContaining({ status: 'completed', transcript: 'hello world' }));
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
        await controller.startRecording(buildPolicyForUser(false, 'native', { allowCloud: false }));
        await controller.whenStable();
        expect(storage.saveSession).not.toHaveBeenCalled();
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
    });

    it('#1033 item 3: a recording with nothing to save (no-speech) RESOLVES at the normal stop terminal and UNLOCKS', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockClear();
        vi.mocked(storage.completeSession).mockResolvedValue({ success: true });
        const svc = {
            getMode: vi.fn().mockReturnValue('native'),
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
        useSessionStore.getState().setSTTMode('native');
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
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-soft', userId: 'user-1', transcript: 'unsaved', durationSeconds: 8, mode: 'private' });
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
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-reload', userId: 'user-1', transcript: 'work that survived the reload', durationSeconds: 30, mode: 'private' });
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
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-userA', userId: 'user-A', transcript: 'user A private words', durationSeconds: 20, mode: 'private' });
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
    it.each(['native', 'private', 'cloud'] as const)(
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

describe('SpeechRuntimeController — policy-writer divergence (P2 regression guard)', () => {
    // Locks the controller-level invariant behind the P2 "policy-writer divergence" thread:
    // the tier-only writer (TranscriptionProvider) can write a FREE policy (allowPrivate=false) for a
    // free user who actually holds a valid private sample, while the Session lifecycle writes the
    // sample-aware CAPABILITY policy (allowPrivate=true). Both target this singleton. This guard proves
    // the lifecycle's policy governs (last-writer-wins) and that updatePolicy never downgrades Private —
    // so the free-sample user stays Private-capable. `policy` is set synchronously in updatePolicy
    // (before the async service enqueue), so these assertions are deterministic without timer flushing.
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

    it('free-sample user stays Private-capable after provider(free) -> lifecycle(sample) writes', () => {
        // 1) Provider resync: TIER-ONLY free policy (the free-sample user is not Pro) -> allowPrivate=false
        controller.updatePolicy(buildPolicyForUser(false, null, { allowCloud: false }));
        expect(readPolicy().allowPrivate).toBe(false); // transient idle state, pre-selection

        // 2) Session lifecycle: sample-aware CAPABILITY policy -> allowPrivate=true (governs at select/record)
        controller.updatePolicy(buildPolicyForUser(true, 'private', { allowCloud: false }));
        expect(readPolicy().allowPrivate).toBe(true);
        expect(readPolicy().preferredMode).toBe('private');
    });

    it('updatePolicy never downgrades allowPrivate (Cloud-preservation only touches Cloud)', () => {
        controller.updatePolicy(buildPolicyForUser(true, 'private', { allowCloud: false }));
        expect(readPolicy().allowPrivate).toBe(true);
        expect(readPolicy().allowCloud).toBe(false);
    });
});
