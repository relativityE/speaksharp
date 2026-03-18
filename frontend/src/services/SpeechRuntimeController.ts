// src/services/SpeechRuntimeController.ts
import logger from '../lib/logger';
import { STTServiceFactory } from './transcription/STTServiceFactory';
import TranscriptionService from './transcription/TranscriptionService';
import { useReadinessStore } from '../stores/useReadinessStore';
import { saveSession, completeSession, heartbeatSession } from '../lib/storage';
import { useSessionStore } from '../stores/useSessionStore';
import { getSupabaseClient } from '../lib/supabaseClient';
import { UserProfile } from '../types/user';

export type RuntimeState =
    | 'IDLE'
    | 'ENGINE_INITIALIZING'
    | 'READY'
    | 'RECORDING'
    | 'STOPPING'
    | 'FAILED';

/**
 * SPEECH RUNTIME CONTROLLER (Master FSM)
 * ------------------------------------
 * High-authority controller that mediates between the UI and the 
 * underlying TranscriptionService. 
 */
class SpeechRuntimeController {
    private static instance: SpeechRuntimeController;
    private state: RuntimeState = 'IDLE';
    private initialized: boolean = false;
    private service: TranscriptionService | null = null;
    private commandQueue: Promise<void> = Promise.resolve();
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_PERIOD_MS = 30000;
    
    // Session Lock (Tab Mutex)
    private readonly LOCK_KEY = 'speaksharp_active_session_lock';
    private readonly LOCK_TIMEOUT = 5000;
    private readonly LOCK_HEARTBEAT_INTERVAL = 2000;
    private lockHeartbeatInterval: NodeJS.Timeout | null = null;
    private tabId: string = Math.random().toString(36).substring(2, 15);
    private watchdogInterval: NodeJS.Timeout | null = null;
    private readonly WATCHDOG_PERIOD_MS = 5000;
    private readonly LIVENESS_THRESHOLD_MS = 8000;

    private readyPromise: Promise<void> | null = null;

    private constructor() { }

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
    public async warmUp(): Promise<void> {
        if (!this.readyPromise) {
            this.readyPromise = this.initInternal();
        }
        return this.readyPromise;
    }

    private async initInternal(): Promise<void> {
        if (this.initialized) return;

        const readiness = useReadinessStore.getState();
        readiness.setAppState('BOOTING');

        logger.info('[SpeechRuntimeController] 🏁 Initialization started');

        // 1. Create service eagerly
        if (!this.service) {
            this.service = STTServiceFactory.createService({
                onHistoryUpdate: (history) => {
                    useSessionStore.getState().setHistory(history);
                }
            });
            this.syncProvider();
        }
        readiness.setAppState('SERVICE_READY');

        // 2. Warm up engine and activate microphone
        this.transition('ENGINE_INITIALIZING');
        try {
            // Defaulting to private mode for pre-warm
            logger.info('[SpeechRuntimeController] Warming up engine...');
            await this.service.warmUp('private');
            readiness.setAppState('ENGINE_READY');

            // Activate microphone to reach READY state (Synchronous Contract)
            logger.info('[SpeechRuntimeController] Activating microphone...');
            const initResult = await this.service.init();
            if (!initResult.success) {
                throw new Error('Microphone activation failed during init');
            }

            // 3. Final Transition
            this.initialized = true;
            this.transition('READY');
            
            readiness.setAppState('READY');
            readiness.setReady('stt');

            // ✅ HEARTBEAT SYSTEM: Start engine liveness watchdog AFTER ready
            this.startWatchdog(this.service);
            
            this.startLockWatchdog();
            
            logger.info('[SpeechRuntimeController] ✅ Initialization complete');
            if (typeof window !== 'undefined') {
                (window as any).__APP_READY_STATE__ = 'READY';
            }
        } catch (error) {
            logger.error({ error }, '[SpeechRuntimeController] ❌ Initialization failed');
            this.transition('FAILED');
            this.readyPromise = null; // Allow retry
            throw error;
        }
    }

    /**
     * Start Lock Watchdog:
     * Listens for storage events and polls to update the reactive store.
     */
    public startLockWatchdog(): void {
        if (typeof window === 'undefined') return;

        const checkHost = () => {
            const lock = this.getLock();
            const store = useSessionStore.getState();
            const heldByOther = !!(lock && (Date.now() - lock.timestamp <= this.LOCK_TIMEOUT) && lock.tabId !== this.tabId);
            if (store.isLockHeldByOther !== heldByOther) {
                store.setLockHeldByOther(heldByOther);
            }
        };

        window.addEventListener('storage', (e) => {
            if (e.key === this.LOCK_KEY) checkHost();
        });

        setInterval(checkHost, 3000);
        checkHost();
    }


    private enqueue<T>(command: () => Promise<T>): Promise<T> {
        const next = this.commandQueue.then(command);
        this.commandQueue = next.then(() => { }, () => { });
        return next;
    }

    public getState(): RuntimeState {
        return this.state;
    }

    public getService(): TranscriptionService | null {
        return this.service;
    }

    private transition(newState: RuntimeState) {
        const previousState = this.state;
        logger.info(`[SpeechRuntimeController] FSM: ${previousState} -> ${newState}`);
        
        // Push state change
        this.state = newState;
        
        // Push to store for reactive UI (Single Source of Truth)
        const store = useSessionStore.getState();
        store.setRuntimeState(newState);

        // ✅ Master Invariant: isListening is exactly FSM state RECORDING
        // We use explicit boolean checks to avoid lint narrowing issues
        const wasRecording = previousState === 'RECORDING';
        const isRecording = newState === 'RECORDING';

        if (isRecording && !wasRecording) {
            store.startSession();
        } else if (wasRecording && !isRecording) {
            store.stopSession();
            this.releaseLock();
        }

        this.syncProvider();
    }

    private syncProvider() {
        // Broadcast custom event instead of direct DOM mutation
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('speech-runtime-state', { detail: { state: this.state } }));
        }
    }

    public async startRecording(): Promise<void> {
        return this.enqueue(async () => {
            if (this.state !== 'READY' && this.state !== 'IDLE') {
                logger.warn(`[SpeechRuntimeController] startRecording() ignored. Current state: ${this.state}`);
                return;
            }

            // Ensure service exists (should be created during app mount)
            if (!this.service) {
                logger.info('[SpeechRuntimeController] ⚠️ Service missing during start, creating fresh');
                this.service = STTServiceFactory.createService({
                    onHistoryUpdate: (history) => {
                        useSessionStore.getState().setHistory(history);
                    }
                });
                this.syncProvider();
            }
            const service = this.service;

            // The transition to RECORDING is now gated until the engine is fully initialised and ready.
            // This enforces the invariant: RECORDING => engine.isReady === true.
            this.transition('ENGINE_INITIALIZING');
            try {
                await service.startTranscription();
                
                // Final state transition — now safe to signal RECORDING to the UI
                this.transition('RECORDING');

                // DB Session Initialization (Moved from TranscriptionService)
                const supabase = getSupabaseClient();
                const { data: { session } } = await supabase.auth.getSession();
                const userId = session?.user?.id;

                if (userId) {
                    const mode = service.getMode() || 'unknown';
                    const idempotencyKey = service.getIdempotencyKey() || crypto.randomUUID();
                    const metadata = service.getMetadata() || { engineVersion: 'unknown', modelName: 'unknown', deviceType: 'unknown' };

                    const sessionData = {
                        user_id: userId,
                        title: `Session ${new Date().toLocaleString()}`,
                        duration: 0,
                        transcript: ' ',
                        total_words: 0,
                        engine: mode
                    };

                    logger.info({ userId, idempotencyKey }, '[SpeechRuntimeController] Attempting to create DB session');
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

                    if (dbSession && (service.getState() === 'RECORDING' || service.getState() === 'ENGINE_INITIALIZING')) {
                        service.setSessionId(dbSession.id);
                        logger.info({ sessionId: dbSession.id }, '[SpeechRuntimeController] DB Session initialized successfully');
                        this.startHeartbeat(dbSession.id, service);
                    } else {
                        logger.warn({ hasSession: !!dbSession, state: service.getState() }, '[SpeechRuntimeController] Session created but guard blocked assignment');
                    }
                }
            } catch (error) {
                logger.error({ error }, '[SpeechRuntimeController] ❌ startTranscription failed');
                this.transition('FAILED');
                throw error;
            }
        });
    }

    // --- Session Lock (Tab Mutex) ---

    public acquireLock(): boolean {
        if (typeof localStorage === 'undefined') return true;

        const lock = this.getLock();
        const now = Date.now();
        if (lock && (now - lock.timestamp <= this.LOCK_TIMEOUT) && lock.tabId !== this.tabId) {
            logger.warn({ existingLock: lock }, '[SpeechRuntimeController] Lock held by another tab');
            return false;
        }

        const info = {
            tabId: this.tabId,
            timestamp: now
        };
        localStorage.setItem(this.LOCK_KEY, JSON.stringify(info));

        // Start lock heartbeat
        if (this.lockHeartbeatInterval) clearInterval(this.lockHeartbeatInterval);
        this.lockHeartbeatInterval = setInterval(() => {
            const currentLock = this.getLock();
            if (currentLock && currentLock.tabId === this.tabId) {
                localStorage.setItem(this.LOCK_KEY, JSON.stringify({
                    tabId: this.tabId,
                    timestamp: Date.now()
                }));
            }
        }, this.LOCK_HEARTBEAT_INTERVAL);

        if (typeof window !== 'undefined') {
            (window as any).__lockAcquired__ = true;
        }

        return true;
    }

    public releaseLock(): void {
        if (typeof localStorage === 'undefined') return;

        const lock = this.getLock();
        if (lock && lock.tabId === this.tabId) {
            localStorage.removeItem(this.LOCK_KEY);
        }
        if (this.lockHeartbeatInterval) {
            clearInterval(this.lockHeartbeatInterval);
            this.lockHeartbeatInterval = null;
        }
        
        if (typeof window !== 'undefined') {
            (window as any).__lockAcquired__ = false;
        }
    }

    private getLock(): { tabId: string; timestamp: number } | null {
        const raw = localStorage.getItem(this.LOCK_KEY);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    // --- Heartbeat (Persistence) ---

    /**
     * Persistence Heartbeat:
     * Keeps the remote session alive in the database during long recordings.
     * Distinct from the Engine Liveness Watchdog.
     */
    private startHeartbeat(sessionId: string, service: TranscriptionService): void {
        this.stopHeartbeat();
        
        const scheduleNext = (immediate = false) => {
             const delay = immediate ? 0 : this.HEARTBEAT_PERIOD_MS;
             this.heartbeatInterval = setTimeout(async () => {
                try {
                    // ✅ Safety Check: Only heartbeat if still recording and session matches
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

    // --- Watchdog (Liveness) ---

    /**
     * Engine Liveness Watchdog:
     * Monitors the engine's heartbeat timestamps and triggers recovery if frozen.
     */
    private startWatchdog(service: TranscriptionService): void {
        this.stopWatchdog();
        
        this.watchdogInterval = setInterval(() => {
            const engine = service.getEngine?.();
            const lastHeartbeat = engine?.getLastHeartbeatTimestamp?.() || Date.now();
            const drift = Date.now() - lastHeartbeat;

            if (drift > this.LIVENESS_THRESHOLD_MS) {
                logger.error({ drift, threshold: this.LIVENESS_THRESHOLD_MS }, '[SpeechRuntimeController] 🚨 Engine Liveness Failure! Unresponsive for too long.');
                this.handleLivenessFailure();
            }
        }, this.WATCHDOG_PERIOD_MS);
    }

    private stopWatchdog(): void {
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }
    }

    private handleLivenessFailure(): void {
        this.stopWatchdog();
        this.stopHeartbeat();
        // Triggers UI error state and internal cleanup
        this.transition('FAILED');
        if (this.service) {
            this.service.destroy().catch(e => logger.error({ e }, '[SpeechRuntimeController] 🚨 Failed to destroy service during liveness recovery'));
            this.service = null;
        }
    }

    /**
     * Safe Proxy for stopping recording
     */
    public async stopRecording(): Promise<unknown> {
        return this.enqueue(async () => {
            if (this.state !== 'RECORDING') {
                logger.warn(`[SpeechRuntimeController] stopRecording() ignored in state: ${this.state}`);
                return null;
            }

            this.transition('STOPPING');
            try {
                this.stopHeartbeat();
                this.stopWatchdog();
                const service = this.service;
                if (!service) {
                    logger.warn('[SpeechRuntimeController] stopRecording() called but no service active');
                    return null;
                }
                const sessionId = service.getSessionId();
                const startTime = service.getStartTime();

                const result = await service.stopTranscription();

                if (result && result.success && sessionId) {
                    const duration = startTime ? (Date.now() - startTime) / 1000 : 0;
                    await completeSession(sessionId, result.transcript, Math.round(duration));
                }

                // ✅ SYSTEMATIC: Destroy the service instance after the session ends
                await service.destroy();
                this.service = null;

                this.transition('READY');
                return result;
            } catch (error) {
                logger.error({ error }, '[SpeechRuntimeController] ❌ stopRecording failed');
                this.transition('FAILED');
                throw error;
            }
        });
    }

    /**
     * MULTI-SEGMENT HANDOFF (Task 8):
     * Switches from the current (frozen) Private engine to the Native Browser engine.
     * Preserves the current transcript as Chapter 1 in the session history.
     */
    public async switchToNative(): Promise<void> {
        return this.enqueue(async () => {
            if (!this.service) {
                logger.warn('[SpeechRuntimeController] switchToNative() ignored - no service active');
                return;
            }

            logger.info('[SpeechRuntimeController] 🔄 Orchestrating multi-segment handoff to Native');

            // 1. Trigger the segmented handoff in the service
            await this.service.switchToNativeSegmented();

            // 2. Ensure FSM is in RECORDING (switchToNativeSegmented triggers startTranscription)
            this.transition('RECORDING');
        });
    }

    /**
     * Recovery: Reset the controller to IDLE state.
     * Allows re-initialization after a FAILED state.
     */
    public async reset(): Promise<void> {
        return this.enqueue(async () => {
            logger.info('[SpeechRuntimeController] 🔄 Resetting to IDLE');
            this.initialized = false;
            this.transition('IDLE');
            if (this.service) {
                await this.service.destroy(); // Ensure low-level service is also cleaned up
                this.service = null;
            }
        });
    }
}

export const speechRuntimeController = SpeechRuntimeController.getInstance();
