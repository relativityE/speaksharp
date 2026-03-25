/**
 * ============================================================================
 * WHISPER-TURBO ENGINE
 * ============================================================================
 * 
 * Fast path engine using whisper-turbo for Private STT.
 * Leverages WebGPU for hardware-accelerated inference.
 * 
 * This engine is:
 * - Very fast on GPU-capable hardware
 * - May fail in headless/CI environments
 * - Falls back to TransformersJSEngine on failure
 * 
 * @see docs/ARCHITECTURE.md - "Dual-Engine Private STT"
 */

import { Result } from '@/services/transcription/modes/types';
import { EngineCallbacks, EngineType } from '@/contracts/IPrivateSTTEngine';

import { floatToWavAsync } from '../utils/AudioProcessor';
import { WhisperEngineRegistry } from './WhisperEngineRegistry';
import { ENV } from '@/config/TestFlags';
import logger from '@/lib/logger';
import { STTEngine } from '@/contracts/STTEngine';

export class WhisperTurboEngine extends STTEngine {
    public readonly type: EngineType = 'whisper-turbo';
    private session: unknown | null = null; // Use unknown for Comlink compatibility

    constructor() {
        super();
    }

    protected async onInit(callbacks: EngineCallbacks): Promise<Result<void, Error>> {
        const tStart = performance.now();
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, `[WhisperTurbo] [PERF] Initializing engine via Registry at ${new Date().toISOString()}`);

        try {
            if (ENV.disableWasm) {
                logger.warn({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[WhisperTurbo] WASM Disabled via manifest. Forcing fallback.');
                return { isOk: false, error: new Error('WASM_DISABLED_IN_CI') };
            }

            if (callbacks.onModelLoadProgress) {
                callbacks.onModelLoadProgress(0);
            }

            // Acquire engine from singleton registry
            // This avoids re-downloading/re-compiling if already warmed up.
            this.session = await WhisperEngineRegistry.acquire(callbacks.onModelLoadProgress);

            const tTotalInit = performance.now() - tStart;
            logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, `[WhisperTurbo] [PERF] Engine acquisition took ${tTotalInit.toFixed(2)}ms`);

            if (callbacks.onModelLoadProgress) {
                callbacks.onModelLoadProgress(100);
            }

            if (callbacks.onReady) {
                callbacks.onReady();
            }

            return { isOk: true, data: undefined };
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, err: e }, '[WhisperTurbo] Failed to acquire engine from registry.');
            return { isOk: false, error: e };
        }
    }

    protected async onStart(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, `[WhisperTurbo] Engine started at ${new Date().toISOString()}`);
    }

    protected async onStop(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[WhisperTurbo] Releasing engine back to registry...');
        WhisperEngineRegistry.release();
        this.session = null;
    }

    protected async onDestroy(): Promise<void> {
        // No additional cleanup beyond stop() for now
    }

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.session) {
            return { isOk: false, error: new Error('WhisperTurbo engine not initialized. Call init() first.') };
        }
        
        this.updateHeartbeat(); // Standard contract: update heartbeat on activity

        try {
            const wavData = await floatToWavAsync(audio);
            const wavBlob = new Blob([wavData as unknown as BlobPart], { type: 'audio/wav' });
            const result = await (this.session as { transcribe: (data: Blob, sil: boolean, opts: unknown) => Promise<{ isOk: boolean; data?: { text: string }; error?: Error }> }).transcribe(wavBlob, false, {});

            if (!result.isOk) {
                return result as { isOk: false, error: Error };
            }

            const transcript = result.data?.text || '';
            this.currentTranscript = transcript;
            this.updateHeartbeat();
            return { isOk: true, data: transcript };
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, err: e }, '[WhisperTurbo] Transcription failed.');
            return { isOk: false, error: e };
        }
    }

    async terminate(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[WhisperTurbo] [PERF] Nuclear Termination requested. Purging registry...');
        await WhisperEngineRegistry.purge();
        this.session = null;
        this.isInitialized = false;
    }
}

