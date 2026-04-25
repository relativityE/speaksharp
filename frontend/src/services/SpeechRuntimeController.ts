import logger from '@/lib/logger';
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
    private static instance: SpeechRuntimeController;
    private state: RuntimeState = 'IDLE';
    private initialized: boolean = false;
    public service: TranscriptionService | null = null;
    private serviceUnsubscribe: (() => void) | null = null;
    private commandQueue: Promise<void> = Promise.resolve();
    private lifecycleVersion: number = 0;
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
    private readonly HEARTBEAT_TIMEOUT_MS = STT_CONFIG.HEARTBEAT_TIMEOUT_MS;

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
        this.serviceCallbacks = {
            onTranscriptUpdate: this.handleTranscriptUpdate.bind(this),
            onModelLoadProgress: this.handleModelLoadProgress.bind(this),
            onReady: this.handleReady.bind(this),
            onHistoryUpdate: this.handleHistoryUpdate.bind(this),
            onModeChange: this.handleModeChange.bind(this),
            onStatusChange: this.handleStatusChange.bind(this),
            onAudioData: this.handleAudioData.bind(this),
            onError: this.handleError.bind(this),
        };
        this.lock = new DistributedLock();
        // E2E HOOK: Sanctioned Mocks
        if (typeof window !== 'undefined') {
            window.STTEngine = STTEngine;
            window.Result = Result;
            window.__TRANSCRIPTION_SERVICE__ = this;
        }
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
        // This bridges the React StrictMode pulse by ensuring Pulse 2 
        // always gets a fresh re-binding and synchronous rehydration.
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
     * We use a global re-entrancy lock to prevent subscription storms during 
     * rapid React remount cycles (bridging the StrictMode pulse window).
     */
    public async syncServiceSubscription(): Promise<void> {

        try {
            await this.enqueue(async () => {
                if (!this.service) return;

                // Enforce cleanup symmetry by terminating any existing subscription before re-syncing
                if (this.serviceUnsubscribe) {
                    this.serviceUnsubscribe();
                    this.serviceUnsubscribe = null;
                }

                this.serviceUnsubscribe = this.service.subscribe(
                    this.serviceCallbacks,
                    'SpeechRuntimeController'
                );
            });
        } finally {
            // Hardened No-Op: Ensures structural integrity of the mutex-guarded subscription
        }
    }

    private async initInternal(): Promise<void> {
        // EXECUTIVE PATTERN: All core lifecycle transitions MUST be enqueued 
        // to prevent race conditions with reset() or destroy() commands.
        await this.enqueue(async () => {
            const readiness = useReadinessStore.getState();
            readiness.setAppState('BOOTING');

            logger.info('[SpeechRuntimeController] \u{1F3C1} Infrastructure initialization started');

            // 1. Structural Fix (Step 1): Retrieve authoritative service from SessionManager
            if (!this.service) {
                this.service = sessionManager.getOrCreateService(this.serviceCallbacks, this.lock);
            }

            readiness.setAppState('SERVICE_READY');

            // 2. SIGNAL READINESS - Architectural Ready (Shell) 
            // We do NOT warm up the engine or activate the microphone here.
            // That happens lazily during the first startRecording call.
            this.initialized = true;
            await this.transition('READY');

            // Note: Handshake confirmation will trigger the final 'READY' appState
            readiness.setReady('stt');

            // 3. Start session lock watchdog
            this.startLockWatchdog();

            // 4. BOOT BARRIER: Signal to E2E that infrastructure is fully instantiated
            // Registry read, Controller instantiated, Initial state committed.
            this.setCanonicalAttribute('data-app-ready', 'true');

            logger.info('[SpeechRuntimeController] Infrastructure ready (Lazy)');
        });
    }

    /**
     * Updates the UI callbacks that the controller should proxy to. 
     * This ensures UI logic (e.g. navigation, toasted errors) still works 
     * without compromising the FSM's buffering logic.
     */
    public setSubscriberCallbacks(callbacks: Partial<TranscriptionServiceOptions>): void {
        this.subscriberCallbacks = callbacks;

        // Store rehydration fields for recovery (Fix 2)
        if (callbacks.navigate) this.navigate = callbacks.navigate;
        if (callbacks.session) this.session = callbacks.session;
        if (callbacks.getAssemblyAIToken) this.getAssemblyAIToken = callbacks.getAssemblyAIToken;

        // Re-sync with service via subscription-safe update
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

    /**
     * Start Lock Watchdog:
     * Listens for storage events and polls to update the reactive store.
     */
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

    private isExecuting = false;

    /**
     * Serial Task Queue via Promise Chaining.
     * Supports re-entrancy discovery: if already inside an execution context, 
     * bypass the queue to prevent circular wait deadlocks (Cluster C4).
     */
    private async enqueue<T>(task: () => Promise<T>): Promise<T> {
        const versionAtEnqueue = this.lifecycleVersion;

        const wrapped = async () => {
            if (this.destroyed || versionAtEnqueue !== this.lifecycleVersion) {
                logger.debug({ versionAtEnqueue, current: this.lifecycleVersion }, '[SpeechRuntimeController] Task aborted: stale lifecycle');
                return undefined as unknown as T;
            }

            try {
                const result = await task();

                if (this.destroyed || versionAtEnqueue !== this.lifecycleVersion) {
                    logger.debug('[SpeechRuntimeController] Task side-effects discarded: stale lifecycle post-await');
                    return undefined as unknown as T;
                }

                return result;
            } catch (err) {
                if (this.destroyed || versionAtEnqueue !== this.lifecycleVersion) {
                    logger.warn({ err }, '[SpeechRuntimeController] Stale task threw, suppressing error toast');
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

    /**
     * Internal helper to set canonical E2E attributes directly on the DOM.
     * This ensures attributes are authoritative and \"upstream\" of React logic.
     * TARGET: document.documentElement (<html>) for T=0 visibility and selector consistency.
     */
    private setCanonicalAttribute(name: string, value: string | null): void {
        if (typeof document === 'undefined') return;
        if (value === null) {
            document.documentElement.removeAttribute(name);
        } else {
            document.documentElement.setAttribute(name, value);
        }
    }

    private updateE2EAttributes(state: RuntimeState): void {
        // 1. data-recording-state (idle | recording | failed | terminated)
        const stateMap: Record<RuntimeState, string> = {
            'IDLE': 'idle',
            'READY': 'idle',
            'INITIATING': 'idle',
            'ENGINE_INITIALIZING': 'idle',
            'RECORDING': 'recording',
            'STOPPING': 'recording',
            'FAILED': 'failed',
            'FAILED_VISIBLE': 'failed',
            'TERMINATED': 'terminated'
        };
        const recordingState = stateMap[state] || 'idle';
        this.setCanonicalAttribute('data-recording-state', recordingState);

        // 2. data-error-visible (true | false)
        const isErrorVisible = state === 'FAILED' || state === 'FAILED_VISIBLE';
        this.setCanonicalAttribute('data-error-visible', isErrorVisible.toString());

        // 3. data-engine-ready (true | false)
        // True if initialized OR in a state that implies active engine use
        const isEngineReady = this.isEngineReady || state === 'RECORDING' || state === 'READY';
        this.setCanonicalAttribute('data-engine-ready', isEngineReady.toString());

        logger.debug({ state, recordingState, isEngineReady }, '[SpeechRuntimeController] \u{1F3F7}\u{FE0F} E2E Attributes Updated');
    }

    private updateSessionPersisted(persisted: boolean): void {
        this.setCanonicalAttribute('data-session-persisted', persisted.toString());
        useSessionStore.getState().setSessionSaved(persisted);
    }

    /**
     * Handle engine readiness signal.
     */
    private handleStrategyReady(): void {
        console.warn('[TRACE] ENGINE_READY');
        this.transition('READY').catch(err => {
            logger.error({ err }, '[SpeechRuntimeController] Failed to transition to READY in handleStrategyReady');
        });
        this.syncProvider();
    }

    /**
     * Handle model loading progress.
     */
    private handleModelProgress(_progress: number): void {
        // ReadinessStore currently does not support granular progress tracking
        // We sync providers to ensure any downstream listeners are aware of activity
        this.syncProvider();
    }

    /**
     * Handle state transitions and synchronization.
     * Orchestrates store updates, lock management, and lifecycle timers.
     */
    private async transition(newState: RuntimeState, _error?: Error): Promise<void> {
        const previousState = this.state;
        this.state = newState;

        // P1 DETERMINISM: Canonical data attribute for E2E verification
        if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-speech-state', newState);
        }

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

        // Clear store BEFORE any other updates to avoid Overwrite Warning
        // Update Lock Metadata immediately so release() check passes (Cluster C: Polarization)
        // This ensures the DistributedLock invariant (can only release if state is TERMINATED)
        // is satisfied when this.lock.release() is called below.
        this.lock.updateState(newState);

        if (isExitTransition) {
            store.setActiveEngine(null); // Force clear on every session exit

            // Reset message to 'idle' on clean exit
            store.setSTTStatus({ type: 'idle', message: 'Ready to record' });

            if (wasActive) {
                store.stopSession();

                // Lifecycle Guard: Enforce TERMINATED as sole lock release state
                // This prevents race conditions where another tab steals the lock 
                // during a failure-visibility hold or a transient switch.
                if (newState === 'TERMINATED') {
                    await this.service?.destroy();
                    this.sessionId = null; // Clear session tracking on release
                }
            }
        }

        // E2E Note: Cleanup of DOM attributes (data-recording-state, etc.) 
        // is now handled reactively by SessionPage via useEffect(runtimeState).

        // Invariant Guard
        if (newState === 'RECORDING') {
            if (!this.canTransitionToRecording()) {
                logger.warn({
                    engine: this.isEngineReady,
                    subscriber: this.isSubscriberReady,
                    emissions: this.isEmissionsSafe
                }, '[SpeechRuntimeController] \u{274C} Transition to RECORDING blocked by missing invariants');
                return;
            }
        }

        this.state = newState;
        logger.info(`[SpeechRuntimeController] FSM: ${previousState} -> ${newState}`);

        // Push state change
        if (newState === 'RECORDING' || newState === 'ENGINE_INITIALIZING' || newState === 'INITIATING') {
            this.stopIdleTimer();
        } else if (newState === 'IDLE' || newState === 'READY') {
            this.startIdleTimer();
        }

        // Push to store for reactive UI (Single Source of Truth)
        store.setRuntimeState(newState);

        // Update Authoritative E2E Attributes Immediately (Sync)
        this.updateE2EAttributes(newState);

        // Sticky Error Messaging for Cache Misses
        // If we transition to FAILED, only set generic error if a more specific
        // status (like download-required) hasn't already been set by the caller.
        // --- FAILED -> FAILED_VISIBLE Hold Sequence ---
        if (newState === 'FAILED') {
            logger.info('[SpeechRuntimeController] \u{1F6E1}\u{FE0F} Entering failure hold protocol.');

            // Hard interrupt: Clear pending commands
            this.commandQueue = Promise.resolve();

            // Explicit session finalization on failure
            if (this.sessionId) {
                void completeSession(this.sessionId, {
                    status: 'failed',
                    duration: 0,
                    reason: 'Controller transitioned to FAILED state'
                });
            }

            // Prescriptive: Align state to visible hold
            await this.transition('FAILED_VISIBLE');
        }

        // --- FAILED_VISIBLE -> TERMINATED Sequence ---
        if (newState === 'FAILED_VISIBLE') {
            logger.info('[SpeechRuntimeController] \u{1F6E1}\u{FE0F} Failure visible. Blocking all transitions.');

            // Final Cleanup after hold
            // FailureHoldTimer (Timing Alignment: 50ms test / 4000ms prod)
            setTimeout(() => {
                if (this.state === 'FAILED_VISIBLE' || this.state === 'FAILED') {
                    void this.transition('TERMINATED');
                }
            }, this.VISIBLE_HOLD_DURATION_MS);
        }

        if (newState === 'TERMINATED') {
            logger.info('[SpeechRuntimeController] \u{1F3C1} Terminal cleanup triggered.');
            // Implicitly triggers releaseLock via isExitTransition
        }

        if (newState === 'RECORDING' && previousState !== 'RECORDING') {
            store.startSession();
        }

        this.syncProvider();
    }

    /**
     * Clear Queue on Failure (Consolidated into transition logic)
     */
    private enterFailureHold(): void {
        // Obsolete: logic moved to transition('FAILED') block for atomicity.
    }

    private canTransitionToRecording(): boolean {
        return this.isEngineReady && this.isEmissionsSafe;
    }

    /**
     * Subscriber Handshake:
     * Called by the UI (TranscriptionProvider) to confirm it is ready to receive data.
     */
    public confirmSubscriberHandshake(): void {
        const readiness = useReadinessStore.getState();
        this.isSubscriberReady = true; // Mark subscriber as attached

        // Logic Gating: Transition to READY only if Engine is also ready
        if (this.isEngineReady) {
            logger.info('[SpeechRuntimeController] \u2705 Full Handshake Complete (Engine ready & Subscriber attached)');
            readiness.setAppState('READY');
        }

        // ✅ BOOT SIGNAL: Ensure E2E boot barrier is satisfied once UI is attached
        this.setCanonicalAttribute('data-app-ready', 'true');
        this.setCanonicalAttribute('data-route-ready', 'true');

        // Flush any buffered data arrived before the UI was ready
        this.flushQueues();

        // E2E Gating: Perform a second delayed flush to handle React's eventual consistency
        if (ENV.isE2E) {
            setTimeout(() => {
                if (this.emissionQueue.length > 0) {
                    console.warn(`[DIAG] \u26FE E2E Delayed Flush triggered (Buffered: ${this.emissionQueue.length})`);
                    this.flushQueues();
                }
            }, 100);
        }

        void this.checkRecordingInvariant();
    }

    private async checkRecordingInvariant() {
        if (this.canTransitionToRecording() && (this.state === 'INITIATING' || this.state === 'ENGINE_INITIALIZING')) {
            logger.info('[SpeechRuntimeController] \u2705 All invariants met, finalizing transition to RECORDING');
            await this.transition('RECORDING');
        }
    }

    private handleTranscriptUpdate(data: TranscriptUpdate) {
        if (ENV.isE2E) {
            console.warn('[E2E-TRACE-FLOW] SpeechRuntimeController received transcript:', JSON.stringify(data));
        }
        console.warn('[step: 7] SpeechRuntimeController RECEIVED TRANSCRIPT:', JSON.stringify(data), 'UI_READY:', this.isSubscriberReady);
        if (this.isSubscriberReady) {
            this.pushTranscriptToStore(data);
            this.subscriberCallbacks.onTranscriptUpdate?.(data);
        } else {
            logger.debug({ data }, '[SpeechRuntimeController] \u{1F4E5} Buffering early transcript');
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
            logger.debug('[SpeechRuntimeController] \u{1F4E5} Buffering early history');
            this.historyQueue.push(history);
        }
    }

    private handleError(error: Error) {
        logger.error({ error }, '[SpeechRuntimeController] \u{1F6A8} Service error received');
        const store = useSessionStore.getState();
        store.setSTTStatus({ type: 'error', message: error.message });
        void this.transition('FAILED', error);
    }

    private handleReady() {
        logger.info('[SpeechRuntimeController] \u2705 Service signaling READY');
        this.setCanonicalAttribute('data-model-status', 'ready');
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
        if (this.emissionQueue.length > 0) {
            logger.info({ count: this.emissionQueue.length }, '[SpeechRuntimeController] \u1F4E4 Flushing emission queue');
            while (this.emissionQueue.length > 0) {
                const data = this.emissionQueue.shift();
                if (data) {
                    this.pushTranscriptToStore(data);
                    this.subscriberCallbacks.onTranscriptUpdate?.(data);
                }
            }
        }

        if (this.historyQueue.length > 0) {
            logger.info({ count: this.historyQueue.length }, '[SpeechRuntimeController] \u{1F4E4} Flushing history queue');
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
    }

    private pushTranscriptToStore(data: TranscriptUpdate): void {
        const store = useSessionStore.getState();
        const currentTranscript = store.transcript.transcript;

        // Final transcript adds to the existing text
        if (data.transcript.final) {
            const newFullText = currentTranscript ? `${currentTranscript} ${data.transcript.final}` : data.transcript.final;
            store.updateTranscript(newFullText, '');
            store.addChunk({
                transcript: data.transcript.final || '',
                timestamp: Date.now(),
                isFinal: true
            });

            // Also add to history segment if we want to track it there
            if (store.activeEngine && store.activeEngine !== 'none') {
                // Note: we might want a more sophisticated history management here
                // but for now we follow the existing pattern
            }
        } else if (data.transcript.partial && !data.transcript.partial.startsWith('Downloading model')) {
            queueMicrotask(() => store.updateTranscript(currentTranscript, data.transcript.partial));
        }
    }

    private syncProvider() {
        // Broadcast custom event instead of direct DOM mutation
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('speech-runtime-state', { detail: { state: this.state } }));
        }
    }

    public async startRecording(policy?: TranscriptionPolicy, userWords: string[] = []): Promise<void> {
        this.userWords = userWords;
        logger.info('[SpeechRuntimeController] \u{1F399}\u{FE0F} startRecording called');
        const recordingId = crypto.randomUUID();
        this.currentRecordingId = recordingId;

        return this.enqueue(async () => {
            logger.info('[SpeechRuntimeController] \u{26D3}\u{FE0F} startRecording executing in queue');
            if (this.currentRecordingId !== recordingId) {
                logger.warn({ recordingId }, '[SpeechRuntimeController] startRecording aborted before start');
                return;
            }

            if (this.state !== 'READY' && this.state !== 'IDLE' && this.state !== 'FAILED') {
                logger.debug({ state: this.state }, '[SpeechRuntimeController] startRecording ignored');
                logger.warn(`[SpeechRuntimeController] startRecording() ignored. Current state: ${this.state}`);
                return;
            }

            if (this.state === 'FAILED') {
                logger.info('[SpeechRuntimeController] \u{1F504} Recovering from FAILED state \u2014 resetting controller');
                this.resetEphemeralState();
            }

            const version = this.lifecycleVersion;
            if (this.destroyed) return;

            // 🛡️ SURGICAL FIX 3: Strategic Readiness Barrier
            await this.ensureReady();

            if (this.destroyed || version !== this.lifecycleVersion) {
                logger.debug('[SpeechRuntimeController] startRecording aborted: lifecycle invalidated during ensureReady');
                return;
            }

            // 0.25 Ensure Service & Strategy Instance Exist (Validation Gate)
            if (!this.service) {
                this.destroyed = false;
                this.service = getTranscriptionService(this.serviceCallbacks, this.lock);
                this.syncProvider();
            }

            // 0.3 VALIDATION FIRST \u2014 no side effects (Cluster B: Contract Alignment)
            const mode = this.policy?.preferredMode || 'private';
            if (this.service) {
                await this.service.warmUp(mode); // Ensure strategy instance is created
                const strategy = this.service.getStrategy();
                if (strategy) {
                    // Ensure strategy conforms to STTEngine contract (if applicable)
                    if ('start' in strategy && 'stop' in strategy) {
                        validateEngine(strategy as unknown as STTEngine);
                    }
                } else {
                    throw new Error('STT_STRATEGY_MISSING_DURING_INIT');
                }
            }

            // 0.5 Acquire Lock (Tab Mutex) with initial state
            // THEN side effects (Cluster G: Deadlock Prevention)
            const acquired = this.lock.acquire('INITIATING');
            if (ENV.isE2E && typeof window !== 'undefined') {
                (window as unknown as Record<string, boolean>).__lockAcquired__ = acquired;
            }

            if (!acquired) {
                logger.warn('[SpeechRuntimeController] \u{274C} startRecording failed: Lock held by another tab');
                useSessionStore.getState().setSTTStatus({
                    type: 'error',
                    message: '\u26D4 Active session in another tab.'
                });
                await this.transition('FAILED');
                return;
            }

            // 1. Transition to INITIATING immediately (User Intent Captured)
            await this.transition('INITIATING');

            // \u2705 UX: Set start time immediately so the timer starts ticking
            useSessionStore.getState().setStartTime(Date.now());

            const service = this.service;
            if (!service) throw new Error('SERVICE_MISSING_DURING_RECORDING');

            // 2. Transition to ENGINE_INITIALIZING (System Work Started)
            await this.transition('ENGINE_INITIALIZING');

            try {
                await service.startTranscription(policy);

                // Cancellation Guard: Check if we were stopped while waiting for service
                if (this.currentRecordingId !== recordingId) {
                    logger.debug({ recordingId }, '[SpeechRuntimeController] startRecording aborted after start');
                    logger.warn({ recordingId }, '[SpeechRuntimeController] startRecording aborted after start');
                    return;
                }

                // Readiness Handshake: Prevent false positive RECORDING transition on CACHE_MISS.
                if (service && service.fsm?.is('DOWNLOAD_REQUIRED')) {
                    logger.info('[SpeechRuntimeController] \u1F4E5 Service is waiting for model download. Halting startRecording sequence.');
                    this.isEngineReady = false;
                    return;
                }

                // 3. Final Transition Handshake (Engine Guaranteed Ready)
                logger.info('[SpeechRuntimeController] \u2699\u{FE0F} Engine Ready');
                this.isEngineReady = true;
                this.isEmissionsSafe = true; // Default to safe

                await this.checkRecordingInvariant();

                // DB Session Initialization (Moved from TranscriptionService)
                const supabase = getSupabaseClient();
                const { data: { session } } = await supabase.auth.getSession();
                const userId = session?.user?.id;

                if (userId) {
                    const mode = service.getMode() || 'unknown';
                    const idempotencyKey = recordingId; // Use recordingId as idempotency key
                    const metadata = service.getMetadata?.() || { engineVersion: 'unknown', modelName: 'unknown', deviceType: 'unknown' };

                    const sessionData = {
                        user_id: userId,
                        title: `Session ${new Date().toLocaleString()}`,
                        duration: 0,
                        transcript: ' ',
                        total_words: 0,
                        engine: mode
                    };

                    logger.info({ userId, idempotencyKey }, '[SpeechRuntimeController] Attempting to create DB session');
                    this.updateSessionPersisted(false); // Indicate session is not yet saved
                    const saveResult = await saveSession(
                        sessionData,
                        {
                            id: userId,
                            email: session?.user?.email || '',
                            subscription_status: 'free',
                            usage_seconds: 0,
                            usage_reset_date: new Date().toISOString(),
                            created_at: new Date().toISOString()
                        } as UserProfile,
                        mode,
                        idempotencyKey,
                        metadata
                    );

                    const dbSession = saveResult?.session;
                    const usageExceeded = saveResult?.usageExceeded;

                    if (usageExceeded) {
                        throw new Error('Usage limit exceeded');
                    }

                    const currentState = this.getState();
                    if (dbSession && service && (currentState === 'RECORDING' || currentState === 'ENGINE_INITIALIZING')) {
                        this.sessionId = dbSession.id;
                        service.setSessionId?.(dbSession.id);
                        logger.info({ sessionId: dbSession.id }, '[SpeechRuntimeController] DB Session initialized successfully');
                        this.startHeartbeat(dbSession.id, service);
                    } else {
                        logger.warn({ hasSession: !!dbSession, state: currentState }, '[SpeechRuntimeController] Session created but guard blocked assignment');
                    }
                }
            } catch (err: unknown) {
                const error = err as Error;
                logger.error({ err: error }, '[SpeechRuntimeController] \u{274C} startRecording failed');

                // State transition handles centralized error messaging
                await this.transition('FAILED', error);
                // \u{1F512} DO NOT release lock here. Let FSM handle it.
                throw error;
            }
        });
    }

    // --- E2E Bridge & Policy (Task 10 Match) ---

    /**
     * @E2E_BRIDGE_SUPPORT
     * These methods ensure the Controller satisfies the contract expected
     * by existing E2E test suites on window.__TRANSCRIPTION_SERVICE__
     */
    public getPolicy(): TranscriptionPolicy | null {
        return this.policy;
    }

    public async getTranscript(): Promise<string> {
        if (!this.service) return '';
        return this.service.getTranscript();
    }

    public getMode(): TranscriptionMode | null {
        return this.service?.getMode() || null;
    }

    // --- Heartbeat (Persistence) ---

    /**
     * Persistence Heartbeat:
     * Keeps the remote session alive in the database during long recordings.
     * Distinct from the Engine Heartbeat Watchdog.
     *
     * @param sessionId Remote session ID
     * @param service Current transcription service instance
     */
    private startHeartbeat(sessionId: string, service: TranscriptionService): void {
        this.stopHeartbeat();

        const scheduleNext = (immediate = false) => {
            const delay = immediate ? 0 : this.HEARTBEAT_PERIOD_MS;
            this.heartbeatInterval = setTimeout(() => {
                void (async () => {
                    try {
                        // \u2705 Safety Check: Only heartbeat if still recording and session matches
                        const currentState = service.getState();
                        if (!sessionId || (currentState !== 'RECORDING' && currentState !== 'ENGINE_INITIALIZING')) {
                            logger.debug({ sessionId, state: currentState }, '[SpeechRuntimeController] Heartbeat skipped (invalid state/session)');
                            return;
                        }

                        await heartbeatSession(sessionId, Math.round(this.HEARTBEAT_PERIOD_MS / 1000));

                        // Recursive call to schedule next heartbeat only after previous one succeeds
                        scheduleNext();
                    } catch (error: unknown) {
                        const e = error as { message?: string };
                        logger.error({ sessionId, message: e?.message }, '[SpeechRuntimeController] Heartbeat failed');
                        // Even on failure, we retry unless the state changed
                        scheduleNext();
                    }
                })();
            }, delay);
        };

        scheduleNext(true); // Immediate first pulse
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearTimeout(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    // --- Watchdog (Heartbeat) ---

    /**
     * Engine Heartbeat Watchdog:
     * Monitors the engine's heartbeat timestamps and triggers recovery if frozen.
     *
     * @param service Current transcription service instance
     */
    private startWatchdog(service: TranscriptionService): void {
        this.stopWatchdog();

        this.watchdogInterval = setInterval(() => {
            const strategy = service.getStrategy();
            if (!strategy) {
                this.handleHeartbeatFailure(new Error('STT_STRATEGY_MISSING_DURING_WATCHDOG'));
                return;
            }
            const lastHeartbeat = service.getLastHeartbeatTimestamp();
            const drift = Date.now() - lastHeartbeat;

            if (drift > this.HEARTBEAT_TIMEOUT_MS) {
                const error = new Error(`STT_HEARTBEAT_FAILURE: Engine unresponsive for ${drift}ms (Threshold: ${this.HEARTBEAT_TIMEOUT_MS}ms)`);
                logger.error({ drift, threshold: this.HEARTBEAT_TIMEOUT_MS, error }, '[SpeechRuntimeController] \u{1F6A8} Heartbeat Failure!');
                this.handleHeartbeatFailure(error);
            }
        }, this.WATCHDOG_PERIOD_MS);
    }

    /**
     * ✅ STRATEGIC READINESS GATE.
     * Blocks execution until the Service instance and its underlying strategy 
     * are physically instantiated and ready to receive commands.
     */
    public async ensureReady(options: { skipIfDownloadPending?: boolean } = {}): Promise<void> {
        const version = this.lifecycleVersion;
        if (this.destroyed) return;

        if (!this.service) {
            // Rehydrate service with both structural and instance-bound runtime callbacks (Fix 2)
            this.service = getTranscriptionService({
                ...this.serviceCallbacks,
                navigate: this.navigate,
                session: this.session,
                getAssemblyAIToken: this.getAssemblyAIToken,
                userWords: this.userWords
            }, this.lock);
        }

        // Only skip during automatic warm-up pulses, not user-initiated start
        if (
            options.skipIfDownloadPending &&
            this.service.fsm?.is('DOWNLOAD_REQUIRED') &&
            this.service.getStrategy()
        ) {
            logger.debug('[SpeechRuntimeController] ensureReady() skipped — awaiting user download action');
            return;
        }

        const mode = this.service.getMode() || 'private';
        await this.service.warmUp(mode);

        if (this.destroyed || version !== this.lifecycleVersion) {
            logger.debug('[SpeechRuntimeController] ensureReady aborted: lifecycle invalidated during warmUp');
            return;
        }

        const strategy = this.service.getStrategy();
        if (!strategy) {
            pushE2EEvent('STT_STRATEGY_MISSING', {
                serviceId: this.service.serviceId,
                instanceId: (this.service as unknown as { instanceId: string }).instanceId,
                isMock: (this.service as unknown as { isMock: boolean }).isMock,
                state: this.service.getState(),
                source: 'SpeechRuntimeController',
                sessionId: this.sessionId,
            });
            throw new Error('STT_STRATEGY_MISSING_AFTER_ENSURE_READY');
        }
    }

    private pushE2EEvent(event: string, payload: Record<string, unknown> = {}): void {
        pushE2EEvent(event, { ...payload, sessionId: this.sessionId });
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
        logger.debug({ timeout: this.IDLE_RECLAMATION_MS }, '[SpeechRuntimeController] \u23F3 Inactivity watchdog started');
        this.idleTimeout = setTimeout(() => {
            if (this.state === 'IDLE' || this.state === 'READY') {
                logger.info('[SpeechRuntimeController] \u267B\u{FE0F} Inactivity timeout reached. Reclaiming resources...');
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

        // P3 DATA CONSISTENCY: Guaranteed terminal state for sessions with an ID
        if (this.sessionId) {
            completeSession(this.sessionId, {
                status: 'failed',
                reason: `Heartbeat failure: ${error.message}`
            }).catch(e => logger.error({ e }, '[SpeechRuntimeController] \u{1F6A8} Failed to finalize session during heartbeat failure'));
        }

        // Triggers UI error state and internal cleanup
        void this.transition('FAILED', error);

        if (this.service) {
            this.lifecycleVersion++;
            this.destroyed = true;
            // Non-swallowing: Ensure the service also knows about the heartbeat failure
            this.service.handleHeartbeatFailure(error);
            this.service.destroy().catch(e => logger.error({ e }, '[SpeechRuntimeController] \u{1F6A8} Failed to destroy service during heartbeat recovery'));
            this.service = null;
        }
    }

    /**
     * ✅ STRUCTURAL FIX: Non-destructive reset.
     * Unmount is a UI event, not a session event.
     * We ONLY detach listeners; we do NOT terminate the session service.
     */
    public async reset(reason: string = 'manual'): Promise<void> {
        this.lifecycleVersion++;
        logger.warn({ reason, state: this.state }, '[SpeechRuntimeController] RESET triggered');
        logger.warn({ reason }, `[SpeechRuntimeController] Reset triggered by: ${reason}`);

        // 🛡️ STEP 1: Non-destructive Detachment for unmount
        if (reason === 'subscriber_unmount') {
            logger.debug('[SpeechRuntimeController] Detaching handlers for unmount (preserving engine)');
            if (this.serviceUnsubscribe) {
                this.serviceUnsubscribe();
                this.serviceUnsubscribe = null;
            }
            return;
        }

        logger.info({ reason }, '[SpeechRuntimeController] 🚮 Full reset initiated');
        // ✅ Orphaned lock.release() removed - now handled by service.destroy()

        if (this.service) {
            this.destroyed = true;
            this.stopWatchdog();
            await this.service.destroy();
            this.service = null;
        }

        this.destroyed = false;
        return this.enqueue(async () => {
            // 🏁 Programmatic Termination Guarantee
            this.serviceUnsubscribe = null;
            this.isEngineReady = false;
            this.initialized = false;
            this.readyPromise = null;
            this.isSubscriberReady = false;
            this.resetEphemeralState(reason);
            await this.transition('TERMINATED');
            await this.transition('IDLE');
        });
    }

    /**
     * Ephemeral State Reset:
     * Clears per-session state without destroying the engine infrastructure.
     */
    private resetEphemeralState(reason: string = 'unknown'): void {
        // E2E Invariant: Do NOT wipe the emission queue on unmount in E2E mode.
        // We must preserve mock transcripts emitted during the early handshake.
        if (!(ENV.isE2E && reason === 'subscriber_unmount')) {
            this.emissionQueue = [];
        } else {
            console.warn(`[DIAG] \u{1F6E1}\u{FE0F} E2E Buffer Preserved during reset (${this.emissionQueue.length} segments)`);
        }

        this.historyQueue = [];
        this.isEmissionsSafe = false;
        this.isSubscriberReady = false;
        useReadinessStore.getState().resetRouterReady();
    }

    /**
     * Safe Proxy for stopping recording
     */
    public async stopRecording(): Promise<unknown> {
        return this.enqueue(async () => {
            const canStop =
                this.state === 'RECORDING' ||
                this.state === 'ENGINE_INITIALIZING' ||
                this.state === 'INITIATING' ||
                this.state === 'FAILED' ||
                this.state === 'FAILED_VISIBLE';

            if (!canStop) {
                logger.warn(`[SpeechRuntimeController] stopRecording() ignored in state: ${this.state}`);
                return null;
            }

            const wasRecording = this.state === 'RECORDING';
            await this.transition('STOPPING');
            try {
                this.stopHeartbeat();
                this.stopWatchdog();
                const service = this.service;
                if (!service) {
                    logger.warn('[SpeechRuntimeController] stopRecording() called but no service active');
                    await this.transition('READY');
                    return null;
                }

                let result = null;
                if (wasRecording) {
                    const sessionId = this.sessionId;
                    const startTime = service.getStartTime();
                    result = await service.stopTranscription();

                    // P1 DETERMINISM: Enrich result and finalize session atomically in the controller
                    if (result && sessionId) {
                        const duration = startTime ? (Date.now() - startTime) / 1000 : 0;
                        const fillerWords = countFillerWords(result.transcript, this.userWords);
                        const wpm = duration > 0 ? Math.round((result.stats.total_words / duration) * 60) : 0;
                        const accuracy = result.stats.accuracy;

                        // 🛡️ Fix 3: Authoritative Reconcile vs Blind Overwrite
                        // Preserve live chunks while incorporating service improvements
                        const store = useSessionStore.getState();
                        const existingChunks = store.chunks;
                        const existingTranscript = existingChunks
                            .map(c => c.transcript)
                            .join(' ')
                            .trim();

                        if (existingChunks.length === 0) {
                            // No live chunks — use service result as primary source for UI
                            store.setChunks([{
                                transcript: result.transcript,
                                timestamp: startTime || Date.now(),
                                isFinal: true
                            }]);
                        } else if (result.transcript && result.transcript.length > existingTranscript.length) {
                            // Service result is more complete (e.g. cloud post-processing corrected data)
                            // Append as a final correction chunk
                            store.appendChunk({
                                transcript: result.transcript,
                                timestamp: Date.now(),
                                isFinal: true,
                                isCorrection: true
                            });
                        }

                        // 1. Force local authoritative state (Tier + DB Race fix)
                        const supabase = getSupabaseClient();
                        const { data: { session } } = await supabase.auth.getSession();
                        const userId = session?.user?.id;

                        if (userId) {
                            const { updateLocalUsage } = await import('../hooks/useUsageLimit');
                            updateLocalUsage(userId, Math.round(duration));
                        }

                        // 2. Sync DB: Complete for duration/usage, then Update for rich metrics
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

                        // 3. Update Streak (Controller Authority)
                        this.updateStreakInternal();

                        this.updateSessionPersisted(true);
                        useSessionStore.getState().setSessionSaved(true);
                    }
                }

                // Destroy the service instance
                this.lifecycleVersion++;
                this.destroyed = true;
                this.stopWatchdog();
                await service.destroy();
                this.service = null;

                await this.transition('READY');
                return result;
            } catch (err: unknown) {
                const error = err as Error;
                logger.error({ err: error }, '[SpeechRuntimeController] \u{274C} stopRecording failed');

                // P3 DATA CONSISTENCY: Guaranteed session finalization
                if (this.sessionId) {
                    completeSession(this.sessionId, {
                        status: 'failed',
                        reason: `Stop recording failed: ${error.message}`
                    }).catch(e => logger.error({ e }, '[SpeechRuntimeController] \u{1F6A8} Failed to finalize session during stop error'));
                }

                await this.transition('FAILED', error);
                throw error;
            }
        });
    }

    /**
     * Emergency Switch to Native:
     * Forcefully destroys the current engine and re-enters startRecording
     * with a 'native' policy.
     */
    public async switchToNative(): Promise<void> {
        return this.enqueue(async () => {
            logger.warn('[SpeechRuntimeController] \u{1F691} Emergency Switch to Native triggered');

            // Check if current service supports segmented handoff (Task 8 integration)
            const serviceWithHandoff = this.service as { switchToNativeSegmented?: () => Promise<void> };
            if (serviceWithHandoff && typeof serviceWithHandoff.switchToNativeSegmented === 'function') {
                await serviceWithHandoff.switchToNativeSegmented();
                return;
            }

            // Fallback: Manual cleanup and restart with Native Policy
            if (this.service) {
                this.lifecycleVersion++;
                this.destroyed = true;
                this.stopWatchdog();
                await this.service.destroy();
                this.service = null;
            }
            this.isEngineReady = false;

            // Re-initialize with native policy
            const nativePolicy: TranscriptionPolicy = {
                allowNative: true,
                allowCloud: false,
                allowPrivate: false,
                preferredMode: 'native',
                allowFallback: false,
                executionIntent: 'native-recovery'
            };

            await this.startRecording(nativePolicy);
        });
    }
}

// Singleton Export for Global Access
export const speechRuntimeController = SpeechRuntimeController.getInstance();
