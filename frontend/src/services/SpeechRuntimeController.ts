import logger from '@/lib/logger';
import { syncSTTReady, syncRuntimeState } from '../lib/forensicAnchors';
import TranscriptionService, { getTranscriptionService } from '@/services/transcription/TranscriptionService';
import type { TranscriptionPolicy } from '@/services/transcription/TranscriptionPolicy';
import { useReadinessStore } from '@/stores/useReadinessStore';
import { saveSession, completeSession, heartbeatSession } from '@/lib/storage';
import { useSessionStore } from '@/stores/useSessionStore';
import { getSupabaseClient } from '../lib/supabaseClient';
import type { UserProfile } from '@/types/user';
import type { TranscriptUpdate, HistorySegment, SttStatus } from '@/types/transcription';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { STT_CONFIG } from '@/config';
import { Result } from '@/services/transcription/modes/types';
import { ENV } from '@/config/TestFlags';
import { sessionManager } from '@/services/transcription/SessionManager';
import type { TranscriptionServiceOptions } from '@/services/transcription/TranscriptionService';
import { pushE2EEvent } from '@/lib/e2eProbe';
import { DistributedLock } from '@/lib/DistributedLock';
import { validateEngine, STTEngine } from '@/contracts/STTEngine';
import { countFillerWords, FillerCounts } from '@/utils/fillerWordUtils';
import { updateSession } from '@/lib/storage';

declare global {
    interface Window {
        __E2E_UNHANDLED_REJECTIONS__?: unknown[];
        __TRANSCRIPTION_SERVICE__?: SpeechRuntimeController;
        __SpeechRuntimeController__?: typeof SpeechRuntimeController;
        STTEngine?: typeof STTEngine;
        Result?: typeof Result;
    }
}

export type RuntimeState =
    | 'IDLE'
    | 'INITIATING'
    | 'ENGINE_INITIALIZING'
    | 'READY'
    | 'RECORDING'
    | 'STOPPING'
    | 'FAILED'
    | 'FAILED_VISIBLE'
    | 'TERMINATED';

/**
 * SPEECH RUNTIME CONTROLLER (Master FSM)
 * ------------------------------------
 * High-authority controller that mediates between the UI and the 
 * underlying TranscriptionService. 
 */
export class SpeechRuntimeController {
    private static instance: SpeechRuntimeController | null = null;
    private readonly HEARTBEAT_THRESHOLD_MS = 
        import.meta.env.VITE_E2E_MODE ? 60000 : 30000;
    private lifecycleVersion: number = 0;
    private state: RuntimeState = 'IDLE';
    private initialized: boolean = false;
    public service: TranscriptionService | null = null;
    private serviceUnsubscribe: (() => void) | null = null;
    private commandQueue: Promise<void> = Promise.resolve();
    private destroyed: boolean = false;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_PERIOD_MS = STT_CONFIG.HEARTBEAT_TIMEOUT_MS;
    private sessionId: string | null = null;

    // Cancellation tracking for startRecording
    private currentRecordingId: string | null = null;

    // Session Lock (Tab Mutex)
    private lock: DistributedLock;
    private watchdogInterval: NodeJS.Timeout | null = null;
    private idleTimeout: NodeJS.Timeout | null = null;
    private readonly IDLE_RECLAMATION_MS = 5 * 60 * 1000;
    private readonly WATCHDOG_PERIOD_MS = 5000;

    private readonly FAILURE_HOLD_DURATION_MS = STT_CONFIG.FAILURE_HOLD_DURATION_MS;
    private readonly VISIBLE_HOLD_DURATION_MS = STT_CONFIG.VISIBLE_HOLD_DURATION_MS;

    private readyPromise: Promise<void> | null = null;

    // FSM Invariants
    private isEngineReady: boolean = false;
    private lockWatchdogInterval: NodeJS.Timeout | null = null;
    private isSubscriberReady: boolean = false;
    private isEmissionsSafe: boolean = false;

    // Segmented Emission Queue
    private emissionQueue: TranscriptUpdate[] = [];
    private historyQueue: HistorySegment[][] = [];
    private subscriberCallbacks: Partial<TranscriptionServiceOptions> = {};
    private readonly serviceCallbacks: Partial<TranscriptionServiceOptions>;
    private policy: TranscriptionPolicy | null = null;
    private userWords: string[] = [];

    // Runtime rehydration fields (Fix 2)
    private navigate?: NavigateFunction;
    private session: Session | null = null;
    private getAssemblyAIToken?: () => Promise<string | null>;

    private constructor() {
        this.lock = new DistributedLock();
        
        // Authoritative Signal Reset
        syncSTTReady(false);

        this.serviceCallbacks = {
            onTranscriptUpdate: this.handleTranscriptUpdate.bind(this),
            onStatusChange: this.handleStatusChange.bind(this),
            onModelLoadProgress: this.handleModelLoadProgress.bind(this),
            onReady: this.handleReady.bind(this),
            onHistoryUpdate: this.handleHistoryUpdate.bind(this),
            onModeChange: this.handleModeChange.bind(this),
            onAudioData: this.handleAudioData.bind(this),
            onError: this.handleError.bind(this),
        };
        
        // E2E HOOK: Sanctioned Mocks
        if (typeof window !== 'undefined') {
            window.STTEngine = STTEngine;
            window.Result = Result;
            window.__TRANSCRIPTION_SERVICE__ = this;
            window.__SpeechRuntimeController__ = SpeechRuntimeController;
        }
    }

    /**
     * ✅ Authoritative Reset Hook for E2E Tests
     * Purges the singleton instance and all internal execution state.
     */
    public static __resetForTests(): void {
        if (SpeechRuntimeController.instance) {
            SpeechRuntimeController.instance.fullReset();
            SpeechRuntimeController.instance = null;
        }
    }

    /**
     * Exhaustive State Purge:
     * Clears engine, strategy, and readiness bits to prevent state leakage.
     */
    private fullReset(): void {
        this.isEngineReady = false;
        this.isSubscriberReady = false;
        this.isEmissionsSafe = false;
        this.readyPromise = null;
        this.service = null;
        this.lifecycleVersion++;
        this.destroyed = true;

        if (this.watchdogInterval) clearInterval(this.watchdogInterval);
        if (this.heartbeatInterval) clearTimeout(this.heartbeatInterval);
        if (this.idleTimeout) clearTimeout(this.idleTimeout);
        if (this.lockWatchdogInterval) clearInterval(this.lockWatchdogInterval);

        this.watchdogInterval = null;
        this.heartbeatInterval = null;
        this.idleTimeout = null;
        this.lockWatchdogInterval = null;

        // Use Forensic Anchors ONLY
        syncSTTReady(false);
        syncRuntimeState('IDLE');
    }

    /**
     * Singleton instance accessor with global stabilization (v0.6.4).
     * Ensures only one controller instance exists in the runtime context.
     */
    public static getInstance(): SpeechRuntimeController {
        if (!SpeechRuntimeController.instance) {
            SpeechRuntimeController.instance = new SpeechRuntimeController();
        }
        return SpeechRuntimeController.instance;
    }

    /**
     * Internal store accessor for state management and testing.
     */
    public getStore() {
        return useSessionStore;
    }


    /**
     * Warm-up Logic (Clean Pipeline Entry Point):
     * This method ensures the STT engine is ready for use, returning a promise 
     * that resolves when the service is instantiated and the engine is initialized.
     */
    public async warmUp(_mode: TranscriptionMode = 'private'): Promise<void> {
        // Phase 1: Ensure Service Genesis (Once per session)
        if (!this.readyPromise) {
            this.readyPromise = this.initInternal();
        }
        await this.readyPromise;

        // 🛡️ SURGICAL FIX 3: Authoritative Readiness Barrier
        await this.ensureReady({ skipIfDownloadPending: true });

        // Phase 2: Mandatory Subscriber Handshake (Every Pulse)
        await this.syncServiceSubscription();
    }

    /**
     * User-initiated model download. Delegates to service's initiateDownload
     * which handles FSM reset internally.
     */
    public async initiateModelDownload(mode: TranscriptionMode = 'private'): Promise<void> {
        if (!this.service) {
            await this.ensureReady({ skipIfDownloadPending: false });
        }
        await this.service!.initiateDownload(mode);
    }

    /**
     * Synchronizes the controller's internal state callbacks with the transcription service.
     */
    public async syncServiceSubscription(): Promise<void> {
        pushE2EEvent('SYNC_SUBSCRIPTION_START', { source: 'SpeechRuntimeController' });
        try {
            await this.enqueue(async () => {
                if (!this.service) {
                    pushE2EEvent('SYNC_SUBSCRIPTION_SKIP', { reason: 'no_service' });
                    return;
                }

                if (this.serviceUnsubscribe) {
                    pushE2EEvent('SYNC_SUBSCRIPTION_CLEANUP', { source: 'SpeechRuntimeController' });
                    this.serviceUnsubscribe();
                    this.serviceUnsubscribe = null;
                }

                pushE2EEvent('SYNC_SUBSCRIPTION_EXECUTE', { source: 'SpeechRuntimeController' });
                this.serviceUnsubscribe = this.service.subscribe(
                    this.serviceCallbacks,
                    'SpeechRuntimeController'
                );
            });
        } finally {
            // Handled in enqueue
        }
    }

    private async initInternal(): Promise<void> {
        await this.enqueue(async () => {
            const readiness = useReadinessStore.getState();
            readiness.setAppState('BOOTING');

            logger.info('[SpeechRuntimeController] \u{1F3C1} Infrastructure initialization started');

            if (!this.service) {
                this.service = sessionManager.getOrCreateService(this.serviceCallbacks, this.lock);
            }

            readiness.setAppState('SERVICE_READY');
            this.initialized = true;
            await this.transition('READY');
            readiness.setReady('stt');

            this.startLockWatchdog();
            logger.info('[SpeechRuntimeController] Infrastructure ready (Lazy)');
        });
    }

    /**
     * Updates the UI callbacks that the controller should proxy to. 
     */
    public setSubscriberCallbacks(callbacks: Partial<TranscriptionServiceOptions>): void {
        this.subscriberCallbacks = callbacks;

        if (callbacks.navigate) this.navigate = callbacks.navigate;
        if (callbacks.session) this.session = callbacks.session;
        if (callbacks.getAssemblyAIToken) this.getAssemblyAIToken = callbacks.getAssemblyAIToken;

        if (this.service) {
            this.service.updateCallbacks({
                ...callbacks,
                onTranscriptUpdate: (data) => this.handleTranscriptUpdate(data),
                onHistoryUpdate: (history) => this.handleHistoryUpdate(history),
                onError: (error) => this.handleError(error),
            });
        }
    }

    public updatePolicy(policy: TranscriptionPolicy) {
        this.policy = policy;
        if (this.service) {
            this.service.updatePolicy(policy);
        }
    }

    public startLockWatchdog(): void {
        if (typeof window === 'undefined') return;
        this.stopLockWatchdog();

        const checkHost = () => {
            const store = useSessionStore.getState();
            const heldByOther = this.lock.isHeldByOther();
            if (store.isLockHeldByOther !== heldByOther) {
                store.setLockHeldByOther(heldByOther);
            }
        };

        window.addEventListener('storage', (e) => {
            if (e.key === 'speaksharp_active_session_lock') checkHost();
        });

        this.lockWatchdogInterval = setInterval(checkHost, 3000);
        checkHost();
    }

    public stopLockWatchdog(): void {
        if (this.lockWatchdogInterval) {
            clearInterval(this.lockWatchdogInterval);
            this.lockWatchdogInterval = null;
        }
    }

    private updateStreakInternal(): { currentStreak: number; isNewDay: boolean } {
        if (typeof window === 'undefined' || !window.localStorage) return { currentStreak: 0, isNewDay: false };

        const saved = localStorage.getItem('speaksharp-streak');
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        const current = saved ? JSON.parse(saved) : { currentStreak: 0, lastPracticeDate: '' };
        let newStreak = current.currentStreak;
        let isNewDay = false;

        if (current.lastPracticeDate !== today) {
            isNewDay = true;
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (current.lastPracticeDate === yesterdayStr || current.lastPracticeDate === '') {
                newStreak += 1;
            } else {
                newStreak = 1;
            }

            const updated = { currentStreak: newStreak, lastPracticeDate: today };
            localStorage.setItem('speaksharp-streak', JSON.stringify(updated));
        }

        return { currentStreak: newStreak, isNewDay };
    }

    private async enqueue<T>(task: () => Promise<T>): Promise<T> {
        const versionAtEnqueue = this.lifecycleVersion;

        const wrapped = async () => {
            if (this.destroyed || versionAtEnqueue !== this.lifecycleVersion) {
                return undefined as unknown as T;
            }

            try {
                const result = await task();

                if (this.destroyed || versionAtEnqueue !== this.lifecycleVersion) {
                    return undefined as unknown as T;
                }

                return result;
            } catch (err) {
                if (this.destroyed || versionAtEnqueue !== this.lifecycleVersion) {
                    return undefined as unknown as T;
                }
                throw err;
            }
        };

        const next = this.commandQueue.then(wrapped);
        this.commandQueue = next.then(() => { }, () => { });
        return next;
    }

    public getState(): RuntimeState {
        return this.state;
    }

    private updateSessionPersisted(persisted: boolean): void {
        useSessionStore.getState().setSessionSaved(persisted);
    }

    private handleStrategyReady(): void {
        this.transition('READY').catch(err => {
            logger.error({ err }, '[SpeechRuntimeController] Failed to transition to READY');
        });
        this.syncProvider();
    }

    private handleModelProgress(_progress: number): void {
        this.syncProvider();
    }

    private async transition(newState: RuntimeState, _error?: Error): Promise<void> {
        const previousState = this.state;
        this.state = newState;

        logger.info({ from: previousState, to: newState }, '[SpeechRuntimeController] \u{26A1} Transition');
        const store = useSessionStore.getState();

        const isExitTransition =
            newState === 'IDLE' ||
            newState === 'READY' ||
            newState === 'TERMINATED';

        const wasActive =
            previousState === 'RECORDING' ||
            previousState === 'ENGINE_INITIALIZING' ||
            previousState === 'INITIATING' ||
            previousState === 'STOPPING' ||
            previousState === 'FAILED' ||
            previousState === 'FAILED_VISIBLE';

        this.lock.updateState(newState);

        if (isExitTransition) {
            store.setActiveEngine(null);
            store.setSTTStatus({ type: 'idle', message: 'Ready to record' });

            if (wasActive) {
                store.stopSession();
                if (newState === 'TERMINATED') {
                    await this.service?.destroy();
                    this.sessionId = null;
                }
            }
        }

        if (newState === 'RECORDING') {
            if (!this.canTransitionToRecording()) {
                return;
            }
        }

        this.state = newState;
        
        if (newState === 'RECORDING' || newState === 'ENGINE_INITIALIZING' || newState === 'INITIATING') {
            this.stopIdleTimer();
        } else if (newState === 'IDLE' || newState === 'READY') {
            this.startIdleTimer();
        }

        store.setRuntimeState(newState);

        if (newState === 'FAILED') {
            this.commandQueue = Promise.resolve();
            if (this.sessionId) {
                void completeSession(this.sessionId, {
                    status: 'failed',
                    duration: 0,
                    reason: 'Controller transitioned to FAILED state'
                });
            }
            await this.transition('FAILED_VISIBLE');
        }

        if (newState === 'FAILED_VISIBLE') {
            setTimeout(() => {
                if (this.state === 'FAILED_VISIBLE' || this.state === 'FAILED') {
                    void this.transition('TERMINATED');
                }
            }, this.VISIBLE_HOLD_DURATION_MS);
        }

        if (newState === 'RECORDING' && previousState !== 'RECORDING') {
            store.startSession();
        }

        this.syncProvider();
    }

    private canTransitionToRecording(): boolean {
        return this.isEngineReady && this.isEmissionsSafe;
    }

    public confirmSubscriberHandshake(): void {
        const readiness = useReadinessStore.getState();
        this.isSubscriberReady = true;

        if (this.isEngineReady) {
            readiness.setAppState('READY');
            syncSTTReady(true);
        }

        this.flushQueues();

        if (ENV.isE2E) {
            setTimeout(() => {
                if (this.emissionQueue.length > 0) {
                    this.flushQueues();
                }
            }, 100);
        }

        void this.checkRecordingInvariant();
    }

    private async checkRecordingInvariant() {
        if (this.canTransitionToRecording() && (this.state === 'INITIATING' || this.state === 'ENGINE_INITIALIZING')) {
            await this.transition('RECORDING');
        }
    }

    private handleTranscriptUpdate(data: TranscriptUpdate) {
        if (this.isSubscriberReady) {
            this.pushTranscriptToStore(data);
            this.subscriberCallbacks.onTranscriptUpdate?.(data);
        } else {
            this.emissionQueue.push(data);
        }
    }

    private handleHistoryUpdate(history: HistorySegment[]) {
        if (this.isSubscriberReady) {
            queueMicrotask(() => {
                useSessionStore.getState().setHistory(history);
                this.subscriberCallbacks.onHistoryUpdate?.(history);
            });
        } else {
            this.historyQueue.push(history);
        }
    }

    private handleError(error: Error): void {
        syncSTTReady(false);
        if (this.destroyed) return;
        const store = useSessionStore.getState();
        store.setSTTStatus({ type: 'error', message: error.message });
        void this.transition('FAILED', error);
    }

    private handleReady() {
        this.isEngineReady = true;
        if (this.service) {
            this.startWatchdog(this.service);
        }
        void this.checkRecordingInvariant();
    }

    private handleModelLoadProgress(progress: number | null) {
        useSessionStore.getState().setModelLoadingProgress(progress);
        this.subscriberCallbacks.onModelLoadProgress?.(progress);
    }

    private handleModeChange(mode: TranscriptionMode | null) {
        useSessionStore.getState().setSTTMode(mode);
        this.subscriberCallbacks.onModeChange?.(mode);
    }

    private handleStatusChange(status: SttStatus) {
        this.subscriberCallbacks.onStatusChange?.(status);
    }

    private handleAudioData(data: Float32Array) {
        this.subscriberCallbacks.onAudioData?.(data);
    }

    private flushQueues() {
        while (this.emissionQueue.length > 0) {
            const data = this.emissionQueue.shift();
            if (data) {
                this.pushTranscriptToStore(data);
                this.subscriberCallbacks.onTranscriptUpdate?.(data);
            }
        }
        while (this.historyQueue.length > 0) {
            const history = this.historyQueue.shift();
            if (history) {
                queueMicrotask(() => {
                    useSessionStore.getState().setHistory(history);
                    this.subscriberCallbacks.onHistoryUpdate?.(history);
                });
            }
        }
    }

    private pushTranscriptToStore(data: TranscriptUpdate): void {
        const store = useSessionStore.getState();
        const currentTranscript = store.transcript.transcript;

        if (data.transcript.final) {
            const newFullText = currentTranscript ? `${currentTranscript} ${data.transcript.final}` : data.transcript.final;
            store.updateTranscript(newFullText, '');
            store.addChunk({
                transcript: data.transcript.final || '',
                timestamp: Date.now(),
                isFinal: true
            });
        } else if (data.transcript.partial && !data.transcript.partial.startsWith('Downloading model')) {
            queueMicrotask(() => store.updateTranscript(currentTranscript, data.transcript.partial));
        }
    }

    private syncProvider() {
        syncRuntimeState(this.state);
    }

    public async startRecording(policy?: TranscriptionPolicy, userWords: string[] = []): Promise<void> {
        this.userWords = userWords;
        const recordingId = crypto.randomUUID();
        this.currentRecordingId = recordingId;

        return this.enqueue(async () => {
            if (this.currentRecordingId !== recordingId) return;

            if (this.state !== 'READY' && this.state !== 'IDLE' && this.state !== 'FAILED') {
                return;
            }

            if (this.state === 'FAILED') {
                this.resetEphemeralState();
            }

            const version = this.lifecycleVersion;
            if (this.destroyed) return;

            await this.ensureReady();

            if (this.destroyed || version !== this.lifecycleVersion) return;

            if (!this.service) {
                this.service = getTranscriptionService(this.serviceCallbacks, this.lock);
            }

            const mode = this.policy?.preferredMode || 'private';
            if (this.service) {
                await this.service.warmUp(mode);
                const strategy = this.service.getStrategy();
                if (strategy && 'start' in strategy && 'stop' in strategy) {
                    validateEngine(strategy as unknown as STTEngine);
                }
            }

            const acquired = this.lock.acquire('INITIATING');
            if (!acquired) {
                useSessionStore.getState().setSTTStatus({
                    type: 'error',
                    message: '\u26D4 Active session in another tab.'
                });
                await this.transition('FAILED');
                return;
            }

            await this.transition('INITIATING');
            useSessionStore.getState().setStartTime(Date.now());

            const service = this.service;
            if (!service) throw new Error('SERVICE_MISSING');

            await this.transition('ENGINE_INITIALIZING');

            try {
                await service.startTranscription(policy);

                if (this.currentRecordingId !== recordingId) return;

                if (service && service.fsm?.is('DOWNLOAD_REQUIRED')) {
                    this.isEngineReady = false;
                    return;
                }

                this.isEngineReady = true;
                this.isEmissionsSafe = true;
                await this.checkRecordingInvariant();

                const supabase = getSupabaseClient();
                const { data: { session } } = await supabase.auth.getSession();
                const userId = session?.user?.id;

                if (userId) {
                    const mode = service.getMode() || 'unknown';
                    const idempotencyKey = recordingId;
                    const metadata = service.getMetadata?.() || { engineVersion: 'unknown', modelName: 'unknown', deviceType: 'unknown' };

                    const sessionData = {
                        user_id: userId,
                        title: `Session ${new Date().toLocaleString()}`,
                        duration: 0,
                        transcript: ' ',
                        total_words: 0,
                        engine: mode
                    };

                    this.updateSessionPersisted(false);
                    const saveResult = await saveSession(sessionData, { id: userId } as UserProfile, mode, idempotencyKey, metadata);

                    const dbSession = saveResult?.session;
                    if (saveResult?.usageExceeded) throw new Error('Usage limit exceeded');

                    const currentState = this.getState();
                    if (dbSession && service && (currentState === 'RECORDING' || currentState === 'ENGINE_INITIALIZING')) {
                        this.sessionId = dbSession.id;
                        service.setSessionId?.(dbSession.id);
                        this.startHeartbeat(dbSession.id, service);
                    }
                }
            } catch (err: unknown) {
                await this.transition('FAILED', err as Error);
                throw err;
            }
        });
    }

    /**
     * ✅ RESET (Soft Reset for React StrictMode / Remounts)
     * Bifurcated in stabilization v0.6.1.
     */
    /**
     * reset() — Deterministic teardown.
     * 🛡️ Bifurcated to handle 'subscriber_unmount' non-destructively.
     */
    public async reset(reason: string = 'manual'): Promise<void> {
        if (reason === 'subscriber_unmount') {
            logger.debug('[SpeechRuntimeController] Soft reset: Detaching subscriber (preserving engine)');
            if (this.serviceUnsubscribe) {
                this.serviceUnsubscribe();
                this.serviceUnsubscribe = null;
            }
            return;
        }

        logger.warn({ reason, state: this.state }, '[SpeechRuntimeController] HARD RESET triggered');
        
        this.lifecycleVersion++;
        this.destroyed = true;

        if (this.watchdogInterval) clearInterval(this.watchdogInterval);
        if (this.heartbeatInterval) clearTimeout(this.heartbeatInterval);
        this.watchdogInterval = null;
        this.heartbeatInterval = null;

        if (this.service) {
            this.stopWatchdog();
            await this.service.destroy();
            this.service = null;
        }

        return this.enqueue(async () => {
            this.serviceUnsubscribe = null;
            this.isEngineReady = false;
            this.initialized = false;
            this.readyPromise = null;
            this.isSubscriberReady = false;
            this.destroyed = false; // Reset the guard after full teardown
            this.resetEphemeralState(reason);
            await this.transition('TERMINATED');
            await this.transition('IDLE');
        });
    }

    private resetEphemeralState(reason: string = 'unknown'): void {
        if (!(ENV.isE2E && reason === 'subscriber_unmount')) {
            this.emissionQueue = [];
        }
        this.historyQueue = [];
        this.isEmissionsSafe = false;
        this.isSubscriberReady = false;
        useReadinessStore.getState().resetRouterReady();
    }

    public async stopRecording(): Promise<unknown> {
        return this.enqueue(async () => {
            const canStop =
                this.state === 'RECORDING' ||
                this.state === 'ENGINE_INITIALIZING' ||
                this.state === 'INITIATING' ||
                this.state === 'FAILED' ||
                this.state === 'FAILED_VISIBLE';

            if (!canStop) return null;

            const wasRecording = this.state === 'RECORDING';
            await this.transition('STOPPING');
            try {
                this.stopHeartbeat();
                this.stopWatchdog();
                const service = this.service;
                if (!service) {
                    await this.transition('READY');
                    return null;
                }

                let result = null;
                if (wasRecording) {
                    const sessionId = this.sessionId;
                    const startTime = service.getStartTime();
                    result = await service.stopTranscription();

                    if (result && sessionId) {
                        const duration = startTime ? (Date.now() - startTime) / 1000 : 0;
                        const fillerWords = countFillerWords(result.transcript, this.userWords);
                        const wpm = duration > 0 ? Math.round((result.stats.total_words / duration) * 60) : 0;
                        const accuracy = result.stats.accuracy;

                        const store = useSessionStore.getState();
                        if (store.chunks.length === 0) {
                            store.setChunks([{
                                transcript: result.transcript,
                                timestamp: startTime || Date.now(),
                                isFinal: true
                            }]);
                        } else if (result.transcript && result.transcript.length > store.transcript.transcript.length) {
                            store.appendChunk({
                                transcript: result.transcript,
                                timestamp: Date.now(),
                                isFinal: true,
                                isCorrection: true
                            });
                        }

                        const supabase = getSupabaseClient();
                        const { data: { session } } = await supabase.auth.getSession();
                        const userId = session?.user?.id;

                        if (userId) {
                            const { updateLocalUsage } = await import('../hooks/useUsageLimit');
                            updateLocalUsage(userId, Math.round(duration));
                        }

                        await completeSession(sessionId, {
                            status: 'completed',
                            transcript: result.transcript,
                            duration: Math.round(duration)
                        });

                        await updateSession(sessionId, {
                            filler_words: fillerWords as unknown as FillerCounts,
                            wpm,
                            clarity_score: accuracy
                        });

                        this.updateStreakInternal();

                        if (typeof window !== 'undefined') {
                            const { pushE2EEvent } = await import('../lib/e2eProbe');
                            pushE2EEvent('ANALYSIS_COMPLETE', {
                                sessionId,
                                fillerCount: fillerWords.total.count,
                                wpm,
                                accuracy
                            });
                        }

                        this.updateSessionPersisted(true);
                        useSessionStore.getState().setSessionSaved(true);
                    }
                }

                this.lifecycleVersion++;
                this.destroyed = true;
                this.stopWatchdog();
                await service.destroy();
                this.service = null;

                await this.transition('READY');
                return result;
            } catch (err: unknown) {
                if (this.sessionId) {
                    completeSession(this.sessionId, {
                        status: 'failed',
                        reason: `Stop recording failed: ${(err as Error).message}`
                    }).catch(() => {});
                }
                await this.transition('FAILED', err as Error);
                throw err;
            }
        });
    }

    public async ensureReady(options: { skipIfDownloadPending?: boolean } = {}): Promise<void> {
        const version = this.lifecycleVersion;
        if (this.destroyed) return;

        if (!this.service) {
            this.service = getTranscriptionService({
                ...this.serviceCallbacks,
                navigate: this.navigate,
                session: this.session,
                getAssemblyAIToken: this.getAssemblyAIToken,
                userWords: this.userWords
            }, this.lock);
        }

        if (options.skipIfDownloadPending && this.service.fsm?.is('DOWNLOAD_REQUIRED') && this.service.getStrategy()) {
            return;
        }

        const mode = this.service.getMode() || 'private';
        await this.service.warmUp(mode);

        if (this.destroyed || version !== this.lifecycleVersion) return;

        const strategy = this.service.getStrategy();
        if (!strategy) {
            throw new Error('STT_STRATEGY_MISSING_AFTER_ENSURE_READY');
        }
    }

    private startHeartbeat(sessionId: string, service: TranscriptionService): void {
        this.stopHeartbeat();
        const version = ++this.lifecycleVersion;
        const scheduleNext = (immediate = false) => {
            const delay = immediate ? 0 : this.HEARTBEAT_PERIOD_MS;
            this.heartbeatInterval = setTimeout(() => {
                if (version !== this.lifecycleVersion) return;
                void (async () => {
                    try {
                        const currentState = service.getState();
                        if (!sessionId || (currentState !== 'RECORDING' && currentState !== 'ENGINE_INITIALIZING')) return;
                        await heartbeatSession(sessionId, Math.round(this.HEARTBEAT_PERIOD_MS / 1000));
                        if (version !== this.lifecycleVersion) return;
                        scheduleNext();
                    } catch (error: unknown) {
                        if (version !== this.lifecycleVersion) return;
                        scheduleNext();
                    }
                })();
            }, delay);
        };
        scheduleNext(true);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearTimeout(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    private startWatchdog(service: TranscriptionService): void {
        const version = ++this.lifecycleVersion;
        this.stopWatchdog();
        this.watchdogInterval = setInterval(() => {
            if (version !== this.lifecycleVersion) return;
            const strategy = service.getStrategy();
            if (!strategy || !this.isEngineReady) return;
            const lastHeartbeat = service.getLastHeartbeatTimestamp();
            const drift = Date.now() - lastHeartbeat;
            if (drift > this.HEARTBEAT_THRESHOLD_MS) {
                this.handleHeartbeatFailure(new Error(`STT_HEARTBEAT_FAILURE: ${drift}ms`));
            }
        }, this.WATCHDOG_PERIOD_MS);
    }

    private stopWatchdog(): void {
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }
    }

    // --- Idle Reclamation ---

    private startIdleTimer(): void {
        this.stopIdleTimer();
        this.idleTimeout = setTimeout(() => {
            if (this.state === 'IDLE' || this.state === 'READY') {
                void this.reset('idle_reclamation');
            }
        }, this.IDLE_RECLAMATION_MS);
    }

    private stopIdleTimer(): void {
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
            this.idleTimeout = null;
        }
    }

    private handleHeartbeatFailure(error: Error): void {
        this.stopWatchdog();
        this.stopHeartbeat();
        if (this.sessionId) {
            completeSession(this.sessionId, { status: 'failed', reason: error.message }).catch(() => {});
        }
        void this.transition('FAILED', error);
        if (this.service) {
            this.lifecycleVersion++;
            this.destroyed = true;
            this.service.handleHeartbeatFailure(error);
            this.service.destroy().catch(() => {});
            this.service = null;
        }
    }

    public async switchToNative(): Promise<void> {
        return this.enqueue(async () => {
            const serviceWithHandoff = this.service as { switchToNativeSegmented?: () => Promise<void> };
            if (serviceWithHandoff && typeof serviceWithHandoff.switchToNativeSegmented === 'function') {
                await serviceWithHandoff.switchToNativeSegmented();
                return;
            }
            if (this.service) {
                this.lifecycleVersion++;
                this.destroyed = true;
                this.stopWatchdog();
                await this.service.destroy();
                this.service = null;
            }
            this.isEngineReady = false;
            const nativePolicy: TranscriptionPolicy = {
                allowNative: true, allowCloud: false, allowPrivate: false,
                preferredMode: 'native', allowFallback: false, executionIntent: 'native-recovery'
            };
            await this.startRecording(nativePolicy);
        });
    }
}

export const speechRuntimeController = SpeechRuntimeController.getInstance();
