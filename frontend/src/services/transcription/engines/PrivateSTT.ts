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
import logger from '../../../lib/logger';
import { IS_TEST_ENVIRONMENT } from '../../../config/env';




/**
 * Check if WebGPU is available for fast path
 */
function hasWebGPU(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Options for engine initialization
 */
export interface PrivateSTTInitOptions extends EngineCallbacks {
    /** 
     * Force a specific engine, bypassing automatic selection and test-environment mocks.
     * Useful for unit testing the routing logic.
     */
    forceEngine?: EngineType;
}

/**
 * Dual-engine Private STT facade
 */
export class PrivateSTT {
    private engine: IPrivateSTTEngine | null = null;
    private engineType: EngineType | null = null;

    /**
     * Initialize the best available engine.
     * In CI: Uses MockEngine (both real engines fail in Playwright)
     * In production: Tries WhisperTurbo, falls back to TransformersJS
     */
    async init(options: PrivateSTTInitOptions): Promise<Result<EngineType, Error>> {
        console.log('[PrivateSTT] 🚀 Automatic engine selection started...');
        logger.info('[PrivateSTT] Automatic engine selection started.');

        const callbacks = options;

        // 1. Check for manual engine override (Testability/Deep-linking)
        if (options.forceEngine) {
            console.log(`[PrivateSTT] 🎯 Forcing engine: ${options.forceEngine}`);
            if (options.forceEngine === 'whisper-turbo') return this.initFastEngine(callbacks);
            if (options.forceEngine === 'transformers-js') return this.initSafeEngine(callbacks);
            if (options.forceEngine === 'mock') return this.initMockEngine(callbacks);
        }

        // 2. Force mock engine in CI/test environments unless specifically bypassed
        if (IS_TEST_ENVIRONMENT) {
            console.log('[PrivateSTT] 🧪 Test environment detected. Using MockEngine.');
            logger.info('[PrivateSTT] Test environment detected. Using MockEngine.');
            return this.initMockEngine(callbacks);
        }

        // Try fast engine first if WebGPU is available
        const webGPUAvailable = hasWebGPU();
        console.log(`[PrivateSTT] 🔍 WebGPU support check: ${webGPUAvailable}`);

        if (webGPUAvailable) {
            console.log('[PrivateSTT] ⚡ WebGPU available. Attempting to initialize WhisperTurbo (Fast Path)...');
            logger.info('[PrivateSTT] WebGPU available. Trying WhisperTurbo engine...');

            const fastResult = await this.initFastEngine(callbacks);
            if (fastResult.isOk) {
                console.log('[PrivateSTT] ✅ WhisperTurbo initialized successfully.');
                console.log('[PrivateSTT] [DEBUG-PRIVATE] 🚀 Verified: Using Fast WhisperTurbo engine.');
                return fastResult;
            }

            console.warn('[PrivateSTT] ⚠️ WhisperTurbo failed to initialize. Falling back to safe engine.', fastResult.error);
            logger.warn({ err: fastResult.error }, '[PrivateSTT] WhisperTurbo failed. Falling back to TransformersJS...');
        } else {
            console.log('[PrivateSTT] 🐌 WebGPU not available. Skipping WhisperTurbo.');
            logger.info('[PrivateSTT] WebGPU not available. Using TransformersJS engine.');
        }

        // Fallback to safe engine
        console.log('[PrivateSTT] 🛡️ Initializing TransformersJS (Safe Path)...');
        return this.initSafeEngine(callbacks);
    }

    /**
     * Initialize the mock engine for CI/E2E testing
     */
    private async initMockEngine(callbacks: EngineCallbacks): Promise<Result<EngineType, Error>> {
        try {
            console.log('[PrivateSTT] 🛠️ Loading MockEngine...');
            const { MockEngine } = await import('./MockEngine');
            const engine = new MockEngine();

            const result = await engine.init(callbacks);
            if (!result || result.isErr) {
                const err = result?.error || new Error('MockEngine initialization returned no result');
                console.error('[PrivateSTT] ❌ MockEngine initialization failed:', err);
                return Result.err(err);
            }

            this.engine = engine;
            this.engineType = 'mock';
            console.log('[PrivateSTT] ✅ MockEngine ready.');
            logger.info('[PrivateSTT] MockEngine initialized successfully.');
            return Result.ok('mock');
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            console.error('[PrivateSTT] ❌ MockEngine import/init failed:', e);
            return Result.err(e);
        }
    }

    /**
     * Initialize the fast (whisper-turbo) engine
     */
    private async initFastEngine(callbacks: EngineCallbacks): Promise<Result<EngineType, Error>> {
        try {
            console.log('[PrivateSTT] 📥 Importing WhisperTurbo engine...');
            // Lazy import to reduce bundle size
            const { WhisperTurboEngine } = await import('./WhisperTurboEngine');
            const engine = new WhisperTurboEngine();

            console.log('[PrivateSTT] ⏳ calling WhisperTurbo.init()...');
            const result = await engine.init(callbacks);

            if (result.isErr) {
                console.warn('[PrivateSTT] ⚠️ WhisperTurbo init returned error:', result.error);
                return Result.err(result.error);
            }

            this.engine = engine;
            this.engineType = 'whisper-turbo';
            logger.info('[PrivateSTT] WhisperTurbo engine initialized successfully.');
            return Result.ok('whisper-turbo');
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            console.warn('[PrivateSTT] ⚠️ WhisperTurbo init threw exception:', e);
            return Result.err(e);
        }
    }

    /**
     * Initialize the safe (transformers.js) engine
     */
    private async initSafeEngine(callbacks: EngineCallbacks): Promise<Result<EngineType, Error>> {
        try {
            console.log('[PrivateSTT] 📥 Importing TransformersJS engine...');
            // Lazy import to reduce bundle size
            const { TransformersJSEngine } = await import('./TransformersJSEngine');
            const engine = new TransformersJSEngine();

            console.log('[PrivateSTT] ⏳ calling TransformersJS.init()...');

            // Initialize without arbitrary timeout
            const result = await engine.init(callbacks);

            if (result.isErr) {
                console.error('[PrivateSTT] ❌ TransformersJS init returned error:', result.error);
                return Result.err(result.error);
            }

            this.engine = engine;
            this.engineType = 'transformers-js';
            console.log('[PrivateSTT] ✅ TransformersJS engine initialized successfully.');
            logger.info('[PrivateSTT] TransformersJS engine initialized successfully.');
            return Result.ok('transformers-js');
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            console.error('[PrivateSTT] ❌ TransformersJS init threw exception:', e);
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
