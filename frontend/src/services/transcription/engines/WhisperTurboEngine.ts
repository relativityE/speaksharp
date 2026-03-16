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

import { Result } from 'true-myth';
import { IPrivateSTTEngine, EngineCallbacks, EngineType } from './IPrivateSTTEngine';
import { floatToWavAsync } from '../utils/AudioProcessor';
import { WhisperEngineRegistry } from './WhisperEngineRegistry';
import logger from '../../../lib/logger';

export class WhisperTurboEngine implements IPrivateSTTEngine {
    public readonly type: EngineType = 'whisper-turbo';
    public readonly instanceId: string;
    private session: unknown | null = null; // Use unknown for Comlink compatibility
    private serviceId: string = 'unknown';
    private runId: string = 'unknown';

    constructor() {
        this.instanceId = Math.random().toString(36).substring(7);
    }

    async init(callbacks: EngineCallbacks): Promise<Result<void, Error>> {
        this.serviceId = callbacks.serviceId || 'unknown';
        this.runId = callbacks.runId || 'unknown';

        const tStart = performance.now();
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, `[WhisperTurbo] [PERF] Initializing engine via Registry at ${new Date().toISOString()}`);

        try {
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

            return Result.ok(undefined);
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, err: e }, '[WhisperTurbo] Failed to acquire engine from registry.');
            return Result.err(e);
        }
    }

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.session) {
            return Result.err(new Error('WhisperTurbo engine not initialized. Call init() first.'));
        }

        try {
            const wavData = await floatToWavAsync(audio);
            const result = await (this.session as { transcribe: (...args: unknown[]) => Promise<Result<{ text: string }, Error>> }).transcribe(wavData, false, {});

            if (result.isErr) {
                return Result.err(result.error);
            }

            const transcript = result.value.text || '';
            return Result.ok(transcript);
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, err: e }, '[WhisperTurbo] Transcription failed.');
            return Result.err(e);
        }
    }

    async destroy(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[WhisperTurbo] [PERF] Releasing engine back to registry...');
        WhisperEngineRegistry.release();
        this.session = null;
    }

    async terminate(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[WhisperTurbo] [PERF] Nuclear Termination requested. Purging registry...');
        await WhisperEngineRegistry.purge();
        this.session = null;
    }
}
