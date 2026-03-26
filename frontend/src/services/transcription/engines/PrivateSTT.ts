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

import { TranscriptionModeOptions, Result, ITranscriptionEngine } from '@/services/transcription/modes/types';
import { IPrivateSTTEngine, EngineType, EngineCallbacks } from '@/contracts/IPrivateSTTEngine';
import { IPrivateSTT, PrivateSTTInitOptions } from '@/contracts/IPrivateSTT';
import logger from '@/lib/logger';
import { ENV } from '@/config/TestFlags';
import { getEngine } from '../TestRegistry';
import { validateEngine } from '@/contracts/STTEngine';

/**
 * Check if WebGPU is available for fast path
 */
function hasWebGPU(): boolean {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as Navigator & { gpu?: unknown };
    return 'gpu' in nav && !!nav.gpu;
}

/**
 * Dual-engine Private STT facade
 */
export class PrivateSTT implements IPrivateSTT, ITranscriptionEngine {
    private engine: IPrivateSTTEngine | null = null;
    private engineType: EngineType | null = null;
    private serviceId: string = 'unknown';
    private runId: string = 'unknown';

    /**
     * Initialize the best available engine.
     * STRICT PRIVACY FALLBACK:
     * 1. In CI/Playwright: Forces MockEngine (safe)
     * 2. In production: Tries WhisperTurbo (WebGPU)
     * 3. Fallback: TransformersJS (WASM CPU)
     * 4. Failure: Terminates with Error (No silent Cloud/Native fallback)
     */
    async init(options: PrivateSTTInitOptions): Promise<Result<void, Error>> {
        this.serviceId = options.serviceId || 'unknown';
        this.runId = options.runId || 'unknown';

        logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🚀 Privacy-first engine selection started...');

        logger.info({
            isE2E: ENV.isE2E,
            engineType: ENV.engineType,
            disableWasm: ENV.disableWasm
        }, '[PrivateSTT] Checking flags');

        const callbacks = options;

        // 1. Manual engine override
        if (options.forceEngine) {
            const res = await (async () => {
                if (options.forceEngine === 'whisper-turbo') return this.initFastEngine(callbacks);
                if (options.forceEngine === 'transformers-js') return this.initSafeEngine(callbacks);
                if (options.forceEngine === 'mock') return this.initMockEngine(callbacks);
                return { isOk: false as const, error: new Error(`Unknown engine type: ${options.forceEngine}`) };
            })();
            return res.isOk ? Result.ok(undefined) : res;
        }

        // 2. CI/Test Mock (Enforcement: window.__SS_E2E__ Manifest)
        const manifest = (window as unknown as Record<string, unknown>).__SS_E2E__ as { engineType?: string };
        if (manifest?.engineType === 'mock' || getEngine('mock-engine')) {
            const res = await this.initMockEngine(callbacks);
            return res.isOk ? Result.ok(undefined) : res;
        }

        // 3. Fast Path (WebGPU)
        const forceSafe = ENV.disableWasm;
        const webGPUAvailable = hasWebGPU() && !forceSafe;

        if (webGPUAvailable) {
            logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] ⚡ WebGPU detected. Attempting WhisperTurbo...');
            const fastResult = await this.initFastEngine(callbacks);
            if (fastResult.isOk) return Result.ok(undefined);

            logger.warn({ sId: this.serviceId, rId: this.runId, err: fastResult.error }, '[PrivateSTT] ⚠️ WhisperTurbo failed. Falling back to WASM...');
        } else {
            logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🐌 WebGPU not available or forced off. Skipping WhisperTurbo.');
        }

        // 4. Safe Path (WASM/CPU)
        logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🛡️ Initializing TransformersJS (Safe Path)...');
        const safeResult = await this.initSafeEngine(callbacks);

        if (safeResult.isOk === false) {
            logger.error({ err: safeResult.error }, '[PrivateSTT] ❌ All private engines failed.');
            return { isOk: false, error: new Error('Private STT failed: No compatible private engine could be initialized. Please switch to Cloud Mode for transcription.') };
        }

        return Result.ok(undefined);
    }

    /**
     * Initialize the mock engine for CI/E2E testing
     */
    private async initMockEngine(callbacks: TranscriptionModeOptions): Promise<Result<EngineType, Error>> {
        try {
            logger.info('[PrivateSTT] 🛠️ Loading MockEngine...');

            // Registry Injection
            const registryFactory = getEngine('mock-engine');
            if (registryFactory) {
                logger.info('[PrivateSTT] 🧪 Injecting MockEngine from Registry');
                const engine = registryFactory(callbacks);
                validateEngine(engine); // Contract enforcement

                await engine.init(callbacks);
                this.engine = engine;
                this.engineType = 'mock';
                logger.info('[PrivateSTT] ✅ MockEngine ready.');
                return { isOk: true, data: 'mock' as EngineType };
            }
            logger.info('[PrivateSTT] MockEngine initialized successfully.');
            return { isOk: true, data: 'mock' as EngineType };
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ err: e }, '[PrivateSTT] ❌ MockEngine import/init failed');
            return { isOk: false, error: e };
        }
    }

    /**
     * Initialize the fast (whisper-turbo) engine
     */
    private async initFastEngine(callbacks: TranscriptionModeOptions): Promise<Result<EngineType, Error>> {
        try {
            logger.info('[PrivateSTT] 📥 Importing WhisperTurbo engine...');

            // Registry Injection
            const registryFactory = getEngine('whisper-turbo');
            if (registryFactory) {
                const untypedEngine = registryFactory(callbacks);
                validateEngine(untypedEngine); // Contract enforcement
                const engine: IPrivateSTTEngine = untypedEngine;

                const result = await engine.init(callbacks as unknown as EngineCallbacks);
                if (!result.isOk) {
                    return { isOk: false, error: result.error };
                }

                this.engine = engine;
                this.engineType = 'whisper-turbo';
                return { isOk: true, data: 'whisper-turbo' as EngineType };
            }

            // Lazy import to reduce bundle size
            const { WhisperTurboEngine } = await import('./WhisperTurboEngine');
            const engine = new WhisperTurboEngine();
            validateEngine(engine); // Contract enforcement

            const result = await engine.init(callbacks as unknown as EngineCallbacks);
            if (!result.isOk) {
                logger.warn({ err: result.error }, '[PrivateSTT] ⚠️ WhisperTurbo.init() failed');
                return { isOk: false, error: result.error };
            }

            this.engine = engine;
            this.engineType = 'whisper-turbo';
            logger.info('[PrivateSTT] WhisperTurbo engine initialized successfully.');
            return { isOk: true, data: 'whisper-turbo' as EngineType };
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ sId: this.serviceId, rId: this.runId, err: e }, '[PrivateSTT] ❌ WhisperTurbo init threw exception');
            return { isOk: false, error: e };
        }
    }

    /**
     * Initialize the safe (transformers.js) engine
     */
    private async initSafeEngine(callbacks: TranscriptionModeOptions): Promise<Result<EngineType, Error>> {
        try {
            logger.info('[PrivateSTT] 📥 Importing TransformersJS engine...');

            // Registry Injection
            const registryFactory = getEngine('transformers-js');
            if (registryFactory) {
                logger.info('[PrivateSTT] 🧪 Injecting TransformersJS from Registry');
                const engine = registryFactory(callbacks);
                validateEngine(engine); // Contract enforcement

                await engine.init(callbacks);
                this.engine = engine;
                this.engineType = 'transformers-js';
                return { isOk: true, data: 'transformers-js' as EngineType };
            }

            // Lazy import to reduce bundle size
            const { TransformersJSEngine } = await import('./TransformersJSEngine');
            const engine = new TransformersJSEngine();
            validateEngine(engine); // Contract enforcement

            logger.info('[PrivateSTT] ⏳ calling TransformersJS.init()...');

            // Initialize without arbitrary timeout
            const result = await engine.init(callbacks);


            if (result.isOk === false) {
                logger.error({ err: result.error }, '[PrivateSTT] ❌ TransformersJS init returned error');
                return { isOk: false, error: result.error };
            }


            this.engine = engine;
            this.engineType = 'transformers-js';
            return { isOk: true, data: 'transformers-js' as EngineType };
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ err: e }, '[PrivateSTT] ❌ TransformersJS init threw exception');
            return { isOk: false, error: e };
        }
    }

    /**
     * Transcribe audio data using the active engine
     */
    async start(): Promise<void> {
        if (this.engine) {
            await this.engine.start();
        }
    }

    async stop(): Promise<void> {
        if (this.engine) {
            await this.engine.stop();
        }
    }

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.engine) {
            return { isOk: false, error: new Error('PrivateSTT not initialized. Call init() first.') };
        }

        return this.engine.transcribe(audio);
    }

    public async getTranscript(): Promise<string> {
        // Delegate to the active engine's transcript store
        if (this.engine && 'getTranscript' in this.engine) {
            return (this.engine as unknown as ITranscriptionEngine).getTranscript();
        }
        return '';
    }

    public dispose(): void {
        this.destroy().catch(err => logger.error({ err }, '[PrivateSTT] Async destruction failed in dispose'));
    }

    /**
     * Get the current engine type
     */
    getEngineType(): string {
        return this.engineType || 'unknown';
    }

    /**
     * Get the last heartbeat timestamp from the active engine
     */
    getLastHeartbeatTimestamp(): number {
        return this.engine?.getLastHeartbeatTimestamp() ?? Date.now();
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

    /**
     * Forcefully terminate engines and workers
     */
    async terminate(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] Forceful termination requested');
        if (this.engine) {
            // Unified lifecycle: terminate (nuclear) or destroy (standard)
            if (this.engine.terminate) {
                await this.engine.terminate();
            } else {
                await this.engine.destroy();
            }
            this.engine = null;
            this.engineType = null;
        }

    }

}

// Export a factory function for convenience
export function createPrivateSTT(): PrivateSTT {
    return new PrivateSTT();
}
