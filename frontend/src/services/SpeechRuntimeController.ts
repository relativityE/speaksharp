// src/services/SpeechRuntimeController.ts
import logger from '../lib/logger';
import { STTServiceFactory } from './transcription/STTServiceFactory';
import TranscriptionService from './transcription/TranscriptionService';
import { TranscriptionPolicy } from './transcription/TranscriptionPolicy';
import { testRegistry } from './transcription/TestRegistry';
import { useReadinessStore } from '../stores/useReadinessStore';
import { saveSession, completeSession, heartbeatSession } from '../lib/storage';
import { useSessionStore } from '../stores/useSessionStore';
import { getSupabaseClient } from '../lib/supabaseClient';
import { UserProfile } from '../types/user';
import { TranscriptUpdate, HistorySegment } from '../types/transcription';
import { TranscriptionMode } from './transcription/TranscriptionPolicy';
import { Result } from './transcription/modes/types';
import { STT_CONFIG } from '../config';
import { TranscriptionServiceOptions } from './transcription/TranscriptionService';
import { TestFlags } from '../config/TestFlags';
import { DistributedLock } from '../lib/DistributedLock';
import { validateEngine, STTEngine } from '../contracts/STTEngine';
import { countFillerWords, FillerCounts } from '../utils/fillerWordUtils';
import { updateSession } from '../lib/storage';

declare global {
  interface Window {
    __TRANSCRIPTION_SERVICE__?: SpeechRuntimeController;
    __TEST_REGISTRY__?: typeof testRegistry;
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
    private service: TranscriptionService | null = null;
    private commandQueue: Promise<void> = Promise.resolve();
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_PERIOD_MS = 30000;
    private sessionId: string | null = null;

    // Cancellation tracking for startRecording
    private currentRecordingId: string | null = null;

    // Session Lock (Tab Mutex)
    private lock: DistributedLock;
    private watchdogInterval: NodeJS.Timeout | null = null;
    private idleTimeout: NodeJS.Timeout | null = null;
    private readonly IDLE_RECLAMATION_MS = 5 * 60 * 1000;
    private readonly WATCHDOG_PERIOD_MS = 5000;
    private readonly HEARTBEAT_TIMEOUT_MS = TestFlags.IS_E2E
        ? STT_CONFIG.HEARTBEAT_TIMEOUT_MS.CI
        : STT_CONFIG.HEARTBEAT_TIMEOUT_MS.PROD;


    private readonly FAILURE_HOLD_DURATION_MS = TestFlags.IS_E2E
        ? STT_CONFIG.FAILURE_HOLD_DURATION_MS.CI
        : STT_CONFIG.FAILURE_HOLD_DURATION_MS.PROD;
    private readonly VISIBLE_HOLD_DURATION_MS = TestFlags.IS_E2E
        ? STT_CONFIG.VISIBLE_HOLD_DURATION_MS.CI
        : STT_CONFIG.VISIBLE_HOLD_DURATION_MS.PROD;

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
    private policy: TranscriptionPolicy | null = null;
    private userWords: string[] = [];

    private constructor() {
        this.lock = new DistributedLock();
        // E2E HOOK: Expose Controller on window for behavioral inspection
        if (typeof window !== 'undefined') {
            window.__TRANSCRIPTION_SERVICE__ = this;
            window.__TEST_REGISTRY__ = testRegistry;
            window.STTEngine = STTEngine;
            window.Result = Result;
        }
    }

    public static getInstance(): SpeechRuntimeController {
        if (!SpeechRuntimeController.instance) {
            SpeechRuntimeController.instance = new SpeechRuntimeController();
        }
        return SpeechRuntimeController.instance;
    }

    /**
     * Warm-up Logic (Clean Pipeline Entry Point):
     * This method ensures the STT engine is ready for use, returning a promise 
     * that resolves when the service is instantiated and the engine is initialized.
     */
    public async warmUp(_mode: TranscriptionMode = 'private'): Promise<void> {
        if (!this.readyPromise) {
            this.readyPromise = this.initInternal();
        }
        return this.readyPromise;
    }

    private async initInternal(): Promise<void> {
        if (this.initialized) return;

        // E2E Short-circuit: Skip heavy WASM/mic probing in Playwright context
        // to avoid silent WASM crashes in sharded environments.
        const isE2E = TestFlags.IS_E2E;

        if (isE2E) {
            logger.info('[SpeechRuntimeController] E2E Mode detected. Short-circuiting STT readiness.');

            // Boot-time registry validation (Expert Requirement)
            // @ts-ignore - Internal test hook
            const registry = window.__SS_E2E__?.registry;
            if (registry) {
                Object.keys(registry).forEach(name => {
                    const engine = registry[name];
                    // Structural-only validation (Duck-typing)
                    if (engine) {
                        const required = ['type', 'init', 'start', 'stop', 'destroy', 'transcribe'];
                        const missing = required.filter(p => typeof (engine as any)[p] === 'undefined');
                        if (missing.length > 0) {
                            throw new Error(`REGISTRY_VALIDATION_FAILED: ${name} missing [${missing.join(', ')}]`);
                        }
                    }
                });
            }

            this.initialized = true;
            this.isEngineReady = true;
            await this.transition('READY');
            useReadinessStore.getState().setReady('stt');
            this.setCanonicalAttribute('data-app-booted', 'true');
            return;
        }

        // EXECUTIVE PATTERN: All core lifecycle transitions MUST be enqueued 
        // to prevent race conditions with reset() or destroy() commands.
        await this.enqueue(async () => {
            const readiness = useReadinessStore.getState();
            readiness.setAppState('BOOTING');

            logger.info('[SpeechRuntimeController] \u{1F3C1} Infrastructure initialization started');

            // 1. Create service eagerly (lightweight factory)
            if (!this.service) {
                this.service = STTServiceFactory.createService({
                    onTranscriptUpdate: this.handleTranscriptUpdate.bind(this),
                    onHistoryUpdate: this.handleHistoryUpdate.bind(this),
                    onError: this.handleError.bind(this),
                });
                this.syncProvider();
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
            this.setCanonicalAttribute('data-app-booted', 'true');

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

        // Re-sync with service if it exists (for session/params)
        if (this.service) {
            this.service.updateCallbacks({
                ...callbacks,
                onTranscriptUpdate: (data) => this.handleTranscriptUpdate(data),
                onHistoryUpdate: (history) => this.handleHistoryUpdate(history),
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

    private enqueue<T>(command: () => Promise<T>): Promise<T> {
        const next = this.commandQueue.then(command);
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
     * Internal State Transition (Master Switch):
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
                    this.lock.release();
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
                completeSession(this.sessionId, {
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
        if (this.isSubscriberReady) return;

        logger.info('[SpeechRuntimeController] \u{1F91D} Subscriber handshake confirmed');
        this.isSubscriberReady = true;

        const readiness = useReadinessStore.getState();
        readiness.setAppState('SUBSCRIBER_READY');

        // Logic Gating: Transition to READY only if Engine is also ready
        if (this.isEngineReady) {
            logger.info('[SpeechRuntimeController] \u2705 Full Handshake Complete (Engine ready & Subscriber attached)');
            readiness.setAppState('READY');
        }

        // Flush any buffered data arrived before the UI was ready
        this.flushQueues();

        void this.checkRecordingInvariant();
    }

    private async checkRecordingInvariant() {
        if (this.canTransitionToRecording() && (this.state === 'INITIATING' || this.state === 'ENGINE_INITIALIZING')) {
            logger.info('[SpeechRuntimeController] \u2705 All invariants met, finalizing transition to RECORDING');
            await this.transition('RECORDING');
        }
    }

    private handleTranscriptUpdate(data: TranscriptUpdate) {
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
        void this.transition('FAILED', error);
        this.subscriberCallbacks.onError?.(error);
    }

    private flushQueues() {
        if (this.emissionQueue.length > 0) {
            logger.info({ count: this.emissionQueue.length }, '[SpeechRuntimeController] \u{1F4E4} Flushing emission queue');
            while (this.emissionQueue.length > 0) {
                const data = this.emissionQueue.shift();
                if (data) {
                    queueMicrotask(() => {
                        this.pushTranscriptToStore(data);
                        this.subscriberCallbacks.onTranscriptUpdate?.(data);
                    });
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

    private pushTranscriptToStore(data: TranscriptUpdate) {
        const store = useSessionStore.getState();
        const currentTranscript = store.transcript.transcript;

        // Final transcript adds to the existing text
        if (data.transcript.final) {
            const newFullText = currentTranscript ? `${currentTranscript} ${data.transcript.final}` : data.transcript.final;
            queueMicrotask(() => {
                store.updateTranscript(newFullText, '');
                store.addChunk({
                    transcript: data.transcript.final || '',
                    timestamp: Date.now(),
                    isFinal: true
                });
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

            // 0.25 Ensure Service & Engine Instance Exist (Validation Gate)
            if (!this.service) {
                this.service = STTServiceFactory.createService({
                    onTranscriptUpdate: (data) => this.handleTranscriptUpdate(data),
                    onHistoryUpdate: (history) => this.handleHistoryUpdate(history),
                    onError: (error) => this.handleError(error),
                });
                this.syncProvider();
            }

            // 0.3 VALIDATION FIRST \u2014 no side effects (Cluster B: Contract Alignment)
            const mode = this.policy?.preferredMode || 'private';
            await this.service.warmUp(mode); // Ensure engine instance is created
            const engine = this.service.getEngine();
            if (engine) {
                validateEngine(engine);
            } else {
                throw new Error('STT_ENGINE_MISSING_DURING_INIT');
            }

            // 0.5 Acquire Lock (Tab Mutex) with initial state
            // THEN side effects (Cluster G: Deadlock Prevention)
            const acquired = this.lock.acquire('INITIATING');
            if (TestFlags.IS_E2E && typeof window !== 'undefined') {
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
                if (service.fsm?.is('DOWNLOAD_REQUIRED')) {
                    logger.info('[SpeechRuntimeController] \u{1F4E5} Service is waiting for model download. Halting startRecording sequence.');
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
                    if (dbSession && (currentState === 'RECORDING' || currentState === 'ENGINE_INITIALIZING')) {
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
                    } catch (error) {
                        logger.error({ error, sessionId }, '[SpeechRuntimeController] Heartbeat failed');
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
            const engine = service.getEngine();
            if (!engine) {
                this.handleHeartbeatFailure(new Error('STT_ENGINE_MISSING_DURING_WATCHDOG'));
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

    private stopWatchdog(): void {
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }
    }

    // --- Idle Reclamation ---

    private startIdleTimer(): void {
        // Prevent idle reclamation during CI/Test
        if (import.meta.env.MODE === 'test') {
            logger.debug('[SpeechRuntimeController] \u23F3 Idle timer skipped (Test Environment)');
            return;
        }

        this.stopIdleTimer();
        logger.debug({ timeout: this.IDLE_RECLAMATION_MS }, '[SpeechRuntimeController] \u23F3 Inactivity watchdog started');
        this.idleTimeout = setTimeout(() => {
            if (this.state === 'IDLE' || this.state === 'READY') {
                logger.info('[SpeechRuntimeController] \u267B\u{FE0F} Inactivity timeout reached. Reclaiming resources...');
                this.reset('idle_reclamation').catch(err => {
                    logger.error({ err }, '[SpeechRuntimeController] Idle reclamation failed');
                });
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
            // Non-swallowing: Ensure the service also knows about the heartbeat failure
            this.service.handleHeartbeatFailure(error);
            this.service.destroy().catch(e => logger.error({ e }, '[SpeechRuntimeController] \u{1F6A8} Failed to destroy service during heartbeat recovery'));
            this.service = null;
        }
    }

    /**
     * Hard Reset:
     * Forcefully destroys the current service and returns the FSM to IDLE.
     * Used for manual recovery or idle reclamation.
     */
    public async reset(reason: string = 'manual'): Promise<void> {
        logger.warn({ reason }, '[SpeechRuntimeController] \u26A0\u{FE0F} Hard reset triggered');
        return this.enqueue(async () => {
            if (this.service) {
                await this.service.destroy();
                this.service = null;
            }
            this.isEngineReady = false;
            this.initialized = false;
            this.readyPromise = null;
            this.isSubscriberReady = false;
            this.resetEphemeralState();
            await this.transition('IDLE');
        });
    }

    /**
     * Ephemeral State Reset:
     * Clears per-session state without destroying the engine infrastructure.
     */
    private resetEphemeralState(): void {
        this.emissionQueue = [];
        this.historyQueue = [];
        this.isEmissionsSafe = false;
        this.isSubscriberReady = false;
        useReadinessStore.getState().resetRouteReady();
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
