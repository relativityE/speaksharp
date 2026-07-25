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
    const attributionPatch = (storage: { updateSession: unknown }) =>
        vi.mocked(storage.updateSession as (...a: unknown[]) => unknown).mock.calls
            .map((c) => c[1])
            .find((p) => !!p && Object.prototype.hasOwnProperty.call(p, 'attribution_status'));

    it.each(['native', 'private', 'cloud'] as const)(
        '#1033: finalization persists a VERIFIED attribution tuple for %s',
        async (mode) => {
            const storage = await import('../../lib/storage');
            vi.mocked(storage.updateSession).mockClear();
            (controller as unknown as { resolvedPrivateEngineVersion: string | null }).resolvedPrivateEngineVersion = null;
            await driveStopWithService(mkService(mode, { engineVersion: `v-${mode}`, modelName: `m-${mode}`, deviceType: `d-${mode}` }), `sess-attr-${mode}`, mode);
            expect(attributionPatch(storage)).toMatchObject({
                engine: mode, engine_version: `v-${mode}`, model_name: `m-${mode}`, device_type: `d-${mode}`, attribution_status: 'verified',
            });
        }
    );

    it('#1033: Private finalization uses the resolved Private arm ONLY when it belongs to this recording', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.updateSession).mockClear();
        (controller as unknown as { resolvedPrivateEngineVersion: string | null }).resolvedPrivateEngineVersion = 'private_v2:whisper-base.en';
        (controller as unknown as { resolvedPrivateEngineSessionId: string | null }).resolvedPrivateEngineSessionId = 'sess-attr-private-arm';
        await driveStopWithService(mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base.en', deviceType: 'browser' }), 'sess-attr-private-arm', 'private');
        expect(attributionPatch(storage)).toMatchObject({ engine: 'private', engine_version: 'private_v2:whisper-base.en', attribution_status: 'verified' });
    });

    it('#1033: a STALE Private arm from another recording is NOT used (no cross-recording leak)', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.updateSession).mockClear();
        (controller as unknown as { resolvedPrivateEngineVersion: string | null }).resolvedPrivateEngineVersion = 'private_v2:STALE-ARM';
        (controller as unknown as { resolvedPrivateEngineSessionId: string | null }).resolvedPrivateEngineSessionId = 'a-DIFFERENT-session';
        await driveStopWithService(mkService('private', { engineVersion: 'transformers-js', modelName: 'whisper-base.en', deviceType: 'browser' }), 'sess-attr-stale', 'private');
        const patch = attributionPatch(storage) as Record<string, unknown>;
        expect(patch.engine_version).toBe('transformers-js'); // live metadata, NOT the stale arm
        expect(patch.engine_version).not.toBe('private_v2:STALE-ARM');
    });

    it.each([
        { label: 'missing metadata', svc: { getMetadata: () => null } },
        { label: 'throwing metadata', svc: { getMetadata: () => { throw new Error('gone'); } } },
        { label: 'blank engine_version', svc: { getMetadata: () => ({ engineVersion: '  ', modelName: 'm', deviceType: 'd' }) } },
        { label: 'blank device_type', svc: { getMetadata: () => ({ engineVersion: 'web-speech-api', modelName: 'm', deviceType: '' }) } },
    ])('#1033: $label → UNVERIFIED, never guessed/verified, no identity overwrite', async ({ svc }) => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.updateSession).mockClear();
        const base = mkService('native', { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' });
        await driveStopWithService({ ...base, ...svc }, 'sess-attr-unv', 'native');
        const patch = attributionPatch(storage) as Record<string, unknown>;
        expect(patch).toEqual({ attribution_status: 'unverified' }); // status only — no engine/version/model/device
    });

    it('#1033: an engine token outside the allowlist → UNVERIFIED (not marked verified)', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.updateSession).mockClear();
        const svc = { ...mkService('native', { engineVersion: 'x', modelName: 'y', deviceType: 'z' }), getMode: vi.fn().mockReturnValue('some-unknown-engine') };
        await driveStopWithService(svc, 'sess-attr-badtoken', 'native');
        expect(attributionPatch(storage)).toEqual({ attribution_status: 'unverified' });
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

    it('#1033: write failure keeps transcript + leaves row pending; retryPendingAttribution promotes it (no duplicate)', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockClear();
        vi.mocked(storage.saveSession).mockClear();
        let failAttribution = true;
        vi.mocked(storage.updateSession).mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
            if (failAttribution && patch && Object.prototype.hasOwnProperty.call(patch, 'attribution_status')) throw new Error('DB down');
            return { success: true };
        });
        const saveCallsBefore = vi.mocked(storage.saveSession).mock.calls.length;
        await expect(driveStopWithService(mkService('native', { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }), 'sess-attr-retry', 'native')).resolves.not.toThrow();
        // transcript survived the attribution failure
        expect(storage.completeSession).toHaveBeenCalledWith('sess-attr-retry', expect.objectContaining({ status: 'completed' }));
        // now Retry Save succeeds and promotes the SAME row via UPDATE (no new saveSession/duplicate)
        failAttribution = false;
        vi.mocked(storage.updateSession).mockClear();
        await expect((controller as unknown as { retryPendingAttribution: () => Promise<boolean> }).retryPendingAttribution()).resolves.toBe(true);
        const retryCall = vi.mocked(storage.updateSession).mock.calls.find(c => c[0] === 'sess-attr-retry' && !!c[1] && Object.prototype.hasOwnProperty.call(c[1], 'attribution_status'));
        expect(retryCall?.[1]).toMatchObject({ engine: 'native', attribution_status: 'verified' });
        expect(vi.mocked(storage.saveSession).mock.calls.length).toBe(saveCallsBefore); // no duplicate session created
        vi.mocked(storage.updateSession).mockResolvedValue({ success: true }); // restore for later tests
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
        const storage = await import('../../lib/storage');
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'A', patch: { attribution_status: 'verified' } };
        vi.mocked(storage.updateSession).mockImplementation(async () => {
            (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = { sessionId: 'B', patch: { attribution_status: 'verified' } };
            return { success: true };
        });
        await expect((controller as unknown as { retryPendingAttribution: () => Promise<boolean> }).retryPendingAttribution()).resolves.toBe(true);
        expect((controller as unknown as { pendingAttributionRetry: { sessionId: string } }).pendingAttributionRetry).toMatchObject({ sessionId: 'B' }); // B not cleared
        (controller as unknown as { pendingAttributionRetry: unknown }).pendingAttributionRetry = null;
        vi.mocked(storage.updateSession).mockResolvedValue({ success: true });
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

    it.each([
        { from: 'RECORDING', term: 'FAILED' },
        { from: 'RECORDING', term: 'FAILED_VISIBLE' },
        { from: 'STOPPING', term: 'FAILED' },
        { from: 'STOPPING', term: 'TERMINATED' },
    ])('#1033: POST-start failure ($from → $term) KEEPS engine selection locked', async ({ from, term }) => {
        setLock(false, from, null);
        setUnresolved(true); // recording had begun and is not durably resolved
        await doTransition(term);
        expect(controller.isEngineSelectionLocked()).toBe(true);
        setUnresolved(false);
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
        vi.mocked(storage.updateSession).mockResolvedValue({ success: true });
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = {
            sessionId: 'sess-fs', completeArgs: { status: 'completed', transcript: 'hello world', duration: 12 },
            attributionPatch: { attribution_status: 'verified', engine: 'native' },
        };
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;
        expect(controller.isEngineSelectionLocked()).toBe(true);
        await expect((controller as unknown as { retryRecordingSave: () => Promise<boolean> }).retryRecordingSave()).resolves.toBe(true);
        expect(storage.completeSession).toHaveBeenCalledWith('sess-fs', expect.objectContaining({ status: 'completed', transcript: 'hello world' }));
        expect(storage.updateSession).toHaveBeenCalledWith('sess-fs', expect.objectContaining({ attribution_status: 'verified' }));
        expect(controller.isEngineSelectionLocked()).toBe(false);
        expect((controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry).toBeNull();
    });

    it('#1033 item 2/3: a Retry Save whose completeSession fails again stays locked (full-save retry preserved)', async () => {
        const storage = await import('../../lib/storage');
        vi.mocked(storage.completeSession).mockResolvedValue({ success: false });
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = {
            sessionId: 'sess-fs2', completeArgs: { status: 'completed', transcript: 'x', duration: 5 },
            attributionPatch: { attribution_status: 'verified' },
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
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = { sessionId: 'A', completeArgs: { status: 'completed', transcript: 'x', duration: 1 }, attributionPatch: {} };
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
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = { sessionId: 'A', completeArgs: { status: 'completed', transcript: 'x', duration: 1 }, attributionPatch: {} };
        (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;
        expect(controller.isEngineSelectionLocked()).toBe(true);
        controller.reset('logout');
        expect(controller.isEngineSelectionLocked()).toBe(false);
        expect((controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry).toBeNull();
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
