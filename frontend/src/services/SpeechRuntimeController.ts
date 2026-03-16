// src/services/SpeechRuntimeController.ts
import logger from '../lib/logger';
import { STTServiceFactory } from './transcription/STTServiceFactory';
import TranscriptionService from './transcription/TranscriptionService';
import { useReadinessStore } from '../stores/useReadinessStore';
import { saveSession, completeSession, heartbeatSession } from '../lib/storage';
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

    private constructor() { }

    public static getInstance(): SpeechRuntimeController {
        if (!SpeechRuntimeController.instance) {
            SpeechRuntimeController.instance = new SpeechRuntimeController();
        }
        return SpeechRuntimeController.instance;
    }

    /**
     * Cold Boot: Initialize the setup (DOM, listeners, etc).
     * Lightweight initialization - NO engine warmup on boot.
     */
    public async initialize(): Promise<void> {
        return this.enqueue(async () => {
            if (this.initialized) return;

            logger.info('[SpeechRuntimeController] 🏁 Initialization started (Lightweight)');
            
            // Explicitly set STT readiness signal for the boot contract
            // Actual engine load deferred to runtime start (Lazy Init Rule)
            this.initialized = true;
            this.transition('IDLE');
            useReadinessStore.getState().setReady('stt');
            logger.info('[SpeechRuntimeController] ✅ Layout/Boot Ready (Engine dormant)');
        });
    }

    /**
     * Pre-warms the STT engine (especially heavy WASM models).
     * Creates a service instance if none exists.
     */
    public async warmUp(mode: 'private'): Promise<void> {
        return this.enqueue(async () => {
            if (!this.service) {
                logger.info('[SpeechRuntimeController] 🌡️ Creating service instance for warm-up');
                this.service = STTServiceFactory.createService();
                // Notify provider to sync the new service
                if (typeof window !== 'undefined' && window.dispatchEvent) {
                    window.dispatchEvent(new CustomEvent('speech-runtime-state', { detail: { state: this.state } }));
                }
            }
            await this.service.warmUp(mode);
        });
    }

    private enqueue<T>(command: () => Promise<T>): Promise<T> {
        const next = this.commandQueue.then(command);
        this.commandQueue = next.then(() => {}, () => {});
        return next;
    }

    public getState(): RuntimeState {
        return this.state;
    }

    public getService(): TranscriptionService | null {
        return this.service;
    }

    private transition(newState: RuntimeState) {
        logger.info(`[SpeechRuntimeController] FSM: ${this.state} -> ${newState}`);
        this.state = newState;
        
        // Broadcast custom event instead of direct DOM mutation
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('speech-runtime-state', { detail: { state: newState } }));
        }
    }

    /**
     * Safe Proxy for starting recording.
     * Triggers Lazy Engine Initialization on first use.
     */
    public async startRecording(): Promise<void> {
        return this.enqueue(async () => {
            if (this.state !== 'IDLE' && this.state !== 'READY') {
                logger.warn(`[SpeechRuntimeController] startRecording() ignored. Current state: ${this.state}`);
                return;
            }

            // ✅ SYSTEMATIC: Reuse pre-warmed service or create fresh instance
            if (!this.service) {
                this.service = STTServiceFactory.createService();
            }
            const service = this.service;

            // Inject DB operations
            service.setDbHandlers({
                initDbSession: async (mode: string, idempotencyKey: string, metadata: unknown) => {
                    const { data: { session } } = await getSupabaseClient().auth.getSession();
                    if (!session?.user?.id) return null;

                    const sessionData = {
                        user_id: session.user.id,
                        title: `Session ${new Date().toLocaleString()}`,
                        duration: 0,
                        transcript: ' ',
                        total_words: 0,
                        engine: mode
                    };

                    logger.info({ userId: sessionData.user_id, idempotencyKey }, '[SpeechRuntimeController] Attempting to create DB session');
                    // We must bypass types for saveSession since we extracted the explicit type dependencies
                    // from TranscriptionService to keep the runtime clean.
                    const saveResult = await saveSession(
                        sessionData as Parameters<typeof saveSession>[0],
                        { subscription_status: 'free' } as Parameters<typeof saveSession>[1],
                        mode,
                        idempotencyKey,
                        metadata as Record<string, unknown>
                    );

                    const dbSession = saveResult?.session;
                    const usageExceeded = saveResult?.usageExceeded;

                    if (usageExceeded) {
                        throw new Error('Usage limit exceeded');
                    }
                    if (dbSession) {
                        return dbSession.id;
                    }
                    return null;
                },
                heartbeatSession: async (sessionId: string) => {
                    await heartbeatSession(sessionId, 30);
                },
                completeSession: async (sessionId: string, transcript: string, duration: number) => {
                    await completeSession(sessionId, transcript, Math.round(duration));
                }
            });
            
            // 🚀 Lazy Initialization: Warm up only if engine not already initialized
            const isEngineReady = service.getState() === 'READY';
            
            if (!isEngineReady) {
                this.transition('ENGINE_INITIALIZING');
                try {
                    logger.info('[SpeechRuntimeController] ⚡ Performing Lazy Engine Warmup...');
                    
                    // Use a reasonable timeout for first-time WASM load
                    const warmUpPromise = service.warmUp('private');
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Lazy engine warmup timed out after 45s')), 45000)
                    );
                    
                    await Promise.race([warmUpPromise, timeoutPromise]);
                    logger.info('[SpeechRuntimeController] ✅ Engine Warmup Complete');
                } catch (error) {
                    logger.error({ error }, '[SpeechRuntimeController] ❌ Lazy initialization failed');
                    this.transition('FAILED');
                    throw error;
                }
            }

            this.transition('RECORDING');
            try {
                await service.startTranscription();

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

    private startHeartbeat(sessionId: string, service: TranscriptionService): void {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(async () => {
            if (!sessionId || service.getState() !== 'RECORDING') return;

            await heartbeatSession(sessionId, Math.round(this.HEARTBEAT_PERIOD_MS / 1000));
        }, this.HEARTBEAT_PERIOD_MS);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
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
