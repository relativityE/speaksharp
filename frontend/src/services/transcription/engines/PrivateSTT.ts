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

// Engine timeout for whisper-turbo (5 seconds)
const FAST_ENGINE_TIMEOUT_MS = 5000;

/**
 * Check if we're running in a test/CI environment
 */
function isTestEnvironment(): boolean {
    return !!(
        typeof window !== 'undefined' && (
            (window as unknown as { __E2E_PLAYWRIGHT__?: boolean }).__E2E_PLAYWRIGHT__ ||
            (window as unknown as { TEST_MODE?: boolean }).TEST_MODE
        )
    );
}

/**
 * Check if WebGPU is available for fast path
 */
function hasWebGPU(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
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
    async init(callbacks: EngineCallbacks): Promise<Result<EngineType, Error>> {
        console.log('[PrivateSTT] 🚀 Automatic engine selection started...');
        logger.info('[PrivateSTT] Automatic engine selection started.');

        // Force mock engine in CI/test environments
        if (isTestEnvironment()) {
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
            if (result.isErr) {
                console.error('[PrivateSTT] ❌ MockEngine initialization failed:', result.error);
                return Result.err(result.error);
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

            console.log(`[PrivateSTT] ⏳ calling WhisperTurbo.init() with ${FAST_ENGINE_TIMEOUT_MS}ms timeout...`);
            const result = await engine.init(callbacks, FAST_ENGINE_TIMEOUT_MS);

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
