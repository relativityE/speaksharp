/**
 * ============================================================================
 * PRIVATE STT - DUAL-ENGINE FACADE
 * ============================================================================
 * 
 * Main entry point for Private STT. Automatically selects the best engine:
 * 
 * 1. In CI/Playwright: Forces TransformersJSEngine (safe)
 * 2. In production: Tries WhisperTurbo, falls back to TransformersJS on failure
 * 
 * DESIGN PRINCIPLES:
 * - Single API: App only sees PrivateSTT.init() and transcribe()
 * - Lazy loading: Heavy WASM imported only when needed
 * - Automatic fallback: User never notices engine switch
 * 
 * @see docs/ARCHITECTURE.md - "Dual-Engine Private STT"
 */

import { Result } from 'true-myth';
import { IPrivateSTTEngine, EngineCallbacks, EngineType } from './IPrivateSTTEngine';
import { IPrivateSTT, PrivateSTTInitOptions } from './IPrivateSTT';
import logger from '../../../lib/logger';
import { TestFlags, shouldUseMockTranscription } from '../../../config/TestFlags';

/**
 * Check if WebGPU is available for fast path
 */
function hasWebGPU(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Dual-engine Private STT facade
 */
export class PrivateSTT implements IPrivateSTT {
    private engine: IPrivateSTTEngine | null = null;
    private engineType: EngineType | null = null;

    /**
     * Initialize the best available engine.
     * STRICT PRIVACY FALLBACK:
     * 1. In CI/Playwright: Forces MockEngine (safe)
     * 2. In production: Tries WhisperTurbo (WebGPU)
     * 3. Fallback: TransformersJS (WASM CPU)
     * 4. Failure: Terminates with Error (No silent Cloud/Native fallback)
     */
    async init(options: PrivateSTTInitOptions): Promise<Result<EngineType, Error>> {
        logger.info('[PrivateSTT] 🚀 Privacy-first engine selection started...');

        if (TestFlags.DEBUG_ENABLED) {
            logger.info({
                isTestMode: TestFlags.IS_TEST_MODE,
                shouldMock: shouldUseMockTranscription(),
                forceCPU: TestFlags.FORCE_CPU_TRANSCRIPTION
            }, '[PrivateSTT] Checking flags');
        }

        const callbacks = options;

        // 1. Manual engine override
        if (options.forceEngine) {
            if (options.forceEngine === 'whisper-turbo') return this.initFastEngine(callbacks);
            if (options.forceEngine === 'transformers-js') return this.initSafeEngine(callbacks);
            if (options.forceEngine === 'mock') return this.initMockEngine(callbacks);
        }

        // 2. CI/Test Mock
        if (shouldUseMockTranscription()) {
            return this.initMockEngine(callbacks);
        }

        // 3. Fast Path (WebGPU)
        const forceSafe = TestFlags.FORCE_CPU_TRANSCRIPTION;
        const webGPUAvailable = hasWebGPU() && !forceSafe;

        if (webGPUAvailable) {
            logger.info('[PrivateSTT] ⚡ WebGPU detected. Attempting WhisperTurbo...');
            const fastResult = await this.initFastEngine(callbacks);
            if (fastResult.isOk) return fastResult;

            logger.warn({ err: fastResult.error }, '[PrivateSTT] ⚠️ WhisperTurbo failed. Falling back to WASM...');
        } else {
            logger.info('[PrivateSTT] 🐌 WebGPU not available or forced off. Skipping WhisperTurbo.');
        }

        // 4. Safe Path (WASM/CPU)
        logger.info('[PrivateSTT] 🛡️ Initializing TransformersJS (Safe Path)...');
        const safeResult = await this.initSafeEngine(callbacks);

        if (safeResult.isErr) {
            logger.error({ err: safeResult.error }, '[PrivateSTT] ❌ All private engines failed.');
            return Result.err(new Error('Private STT failed: No compatible private engine could be initialized. Please switch to Cloud Mode for transcription.'));
        }

        return safeResult;
    }

    /**
     * Initialize the mock engine for CI/E2E testing
     */
    private async initMockEngine(callbacks: EngineCallbacks): Promise<Result<EngineType, Error>> {
        try {
            logger.info('[PrivateSTT] 🛠️ Loading MockEngine...');
            const { MockEngine } = await import('./MockEngine');
            const engine = new MockEngine();

            const result = await engine.init(callbacks);
            if (!result || result.isErr) {
                const err = result?.error || new Error('MockEngine initialization returned no result');
                logger.error({ err }, '[PrivateSTT] ❌ MockEngine initialization failed');
                return Result.err(err);
            }

            this.engine = engine;
            this.engineType = 'mock';
            logger.info('[PrivateSTT] ✅ MockEngine ready.');
            logger.info('[PrivateSTT] MockEngine initialized successfully.');
            return Result.ok('mock');
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ err: e }, '[PrivateSTT] ❌ MockEngine import/init failed');
            return Result.err(e);
        }
    }

    /**
     * Initialize the fast (whisper-turbo) engine
     */
    private async initFastEngine(callbacks: EngineCallbacks): Promise<Result<EngineType, Error>> {
        try {
            logger.info('[PrivateSTT] 📥 Importing WhisperTurbo engine...');
            // Lazy import to reduce bundle size
            const { WhisperTurboEngine } = await import('./WhisperTurboEngine');
            const engine = new WhisperTurboEngine();

            logger.info('[PrivateSTT] ⏳ calling WhisperTurbo.init()...');
            const result = await engine.init(callbacks);

            if (result.isErr) {
                logger.warn({ err: result.error }, '[PrivateSTT] ⚠️ WhisperTurbo init returned error');
                return Result.err(result.error);
            }

            this.engine = engine;
            this.engineType = 'whisper-turbo';
            logger.info('[PrivateSTT] WhisperTurbo engine initialized successfully.');
            return Result.ok('whisper-turbo');
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.warn({ err: e }, '[PrivateSTT] ⚠️ WhisperTurbo init threw exception');
            return Result.err(e);
        }
    }

    /**
     * Initialize the safe (transformers.js) engine
     */
    private async initSafeEngine(callbacks: EngineCallbacks): Promise<Result<EngineType, Error>> {
        try {
            logger.info('[PrivateSTT] 📥 Importing TransformersJS engine...');
            // Lazy import to reduce bundle size
            const { TransformersJSEngine } = await import('./TransformersJSEngine');
            const engine = new TransformersJSEngine();

            logger.info('[PrivateSTT] ⏳ calling TransformersJS.init()...');

            // Initialize without arbitrary timeout
            const result = await engine.init(callbacks);

            if (result.isErr) {
                logger.error({ err: result.error }, '[PrivateSTT] ❌ TransformersJS init returned error');
                return Result.err(result.error);
            }

            this.engine = engine;
            this.engineType = 'transformers-js';
            logger.info('[PrivateSTT] ✅ TransformersJS engine initialized successfully.');
            logger.info('[PrivateSTT] TransformersJS engine initialized successfully.');
            return Result.ok('transformers-js');
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ err: e }, '[PrivateSTT] ❌ TransformersJS init threw exception');
            return Result.err(e);
        }
    }

    /**
     * Transcribe audio data using the active engine
     */
    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.engine) {
            return Result.err(new Error('PrivateSTT not initialized. Call init() first.'));
        }

        return this.engine.transcribe(audio);
    }

    /**
     * Get the current engine type
     */
    getEngineType(): EngineType | null {
        return this.engineType;
    }

    /**
     * Clean up resources
     */
    async destroy(): Promise<void> {
        if (this.engine) {
            await this.engine.destroy();
            this.engine = null;
            this.engineType = null;
        }
    }
}

// Export a factory function for convenience
export function createPrivateSTT(): PrivateSTT {
    return new PrivateSTT();
}
