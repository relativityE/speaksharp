// src/services/SpeechRuntimeController.ts
import logger from '../lib/logger';
import { getTranscriptionService } from './transcription/TranscriptionService';
import { useReadinessStore } from '../stores/useReadinessStore';

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
    private commandQueue: Promise<void> = Promise.resolve();

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

    private enqueue<T>(command: () => Promise<T>): Promise<T> {
        const next = this.commandQueue.then(command);
        this.commandQueue = next.then(() => {}, () => {});
        return next;
    }

    public getState(): RuntimeState {
        return this.state;
    }

    private transition(newState: RuntimeState) {
        logger.info(`[SpeechRuntimeController] FSM: ${this.state} -> ${newState}`);
        this.state = newState;
        
        // Expose to DOM for Playwright gating
        if (typeof document !== 'undefined') {
            document.body.setAttribute('data-recording-state', newState.toLowerCase());
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

            const service = getTranscriptionService();
            
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
            } catch (error) {
                logger.error({ error }, '[SpeechRuntimeController] ❌ startTranscription failed');
                this.transition('FAILED');
                throw error;
            }
        });
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
                const service = getTranscriptionService();
                const result = await service.stopTranscription();
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
            const service = getTranscriptionService();
            await service.destroy(); // Ensure low-level service is also cleaned up
        });
    }
}

export const speechRuntimeController = SpeechRuntimeController.getInstance();
