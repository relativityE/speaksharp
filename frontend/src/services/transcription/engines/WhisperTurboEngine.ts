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
    private session: unknown | null = null; // Use unknown for Comlink compatibility

    constructor() { }

    async init(callbacks: EngineCallbacks): Promise<Result<void, Error>> {
        const tStart = performance.now();
        logger.info(`[WhisperTurbo] [PERF] Initializing engine via Registry at ${new Date().toISOString()}`);

        try {
            if (callbacks.onModelLoadProgress) {
                callbacks.onModelLoadProgress(0);
            }

            // Acquire engine from singleton registry
            // This avoids re-downloading/re-compiling if already warmed up.
            this.session = await WhisperEngineRegistry.acquire(callbacks.onModelLoadProgress);

            const tTotalInit = performance.now() - tStart;
            logger.info(`[WhisperTurbo] [PERF] Engine acquisition took ${tTotalInit.toFixed(2)}ms`);

            if (callbacks.onModelLoadProgress) {
                callbacks.onModelLoadProgress(100);
            }

            if (callbacks.onReady) {
                callbacks.onReady();
            }

            return Result.ok(undefined);
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ err: e }, '[WhisperTurbo] Failed to acquire engine from registry.');
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

            return Result.ok(result.value.text || '');
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ err: e }, '[WhisperTurbo] Transcription failed.');
            return Result.err(e);
        }
    }

    async destroy(): Promise<void> {
        logger.info('[WhisperTurbo] [PERF] Releasing engine back to registry...');
        WhisperEngineRegistry.release();
        this.session = null;
    }
}
