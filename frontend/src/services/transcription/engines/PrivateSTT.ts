/**
 * 🚨 READ-ONLY: This file is part of the core engine routing logic.
 * No modifications are allowed unless directed by User.
 * 
 * Frozen Gate: Authoritative STT engine selection.
 * Ensures the manifest is the sole control plane for engine intent.
 */

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

import { ITranscriptionEngine, TranscriptionModeOptions, Result } from '@/services/transcription/modes/types';
import { IPrivateSTTEngine, EngineType, EngineCallbacks } from '@/contracts/IPrivateSTTEngine';
import { STTEngine, validateEngine } from '@/contracts/STTEngine';
import { PrivateSTTInitOptions } from '@/contracts/IPrivateSTT';
import logger from '@/lib/logger';
import { ModelManager } from '../ModelManager';
import { ENV } from '@/config/TestFlags';
import { MicStream } from '../utils/types';
import { getEngine } from '../TestRegistry';
import { TranscriptionError } from '../modes/types';

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
export class PrivateSTT extends STTEngine implements IPrivateSTTEngine, ITranscriptionEngine {
    public readonly type: EngineType = 'transformers-js'; // Primary type for this facade
    
    private engine: IPrivateSTTEngine | null = null;
    private mockEngine?: IPrivateSTTEngine;
    private _engineType: EngineType | null = null;

    /**
     * PrivateSTT manages the dual-engine strategy for on-device transcription.
     * It coordinates between WhisperTurbo (GPU) and TransformersJS (CPU/WASM) engines.
     */
    constructor(options: Partial<TranscriptionModeOptions> = {}, mockEngine?: IPrivateSTTEngine) {
        super(options as TranscriptionModeOptions);
        this.mockEngine = mockEngine;
    }

    /**
     * Type-safe access to transcription options from the base class.
     */
    private get modeOptions(): TranscriptionModeOptions | null {
        return this.options as TranscriptionModeOptions;
    }

    /**
     * Interface requirement for STTEngine
     */
    public getEngineType(): EngineType {
        return this._engineType || 'transformers-js';
    }

    protected async onInit(callbacks: EngineCallbacks | TranscriptionModeOptions): Promise<Result<void, Error>> {
        const options = callbacks as PrivateSTTInitOptions;
        
        this.serviceId = options.serviceId || 'unknown';
        this.runId = options.runId || 'unknown';

        logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🚀 Privacy-first engine selection started...');

        // 0. Factory-injected mock engine takes absolute precedence
        if (this.mockEngine) {
            this.engine = this.mockEngine;
            this._engineType = ((this.mockEngine as unknown as { getEngineType?: () => string }).getEngineType?.() as EngineType) || 'mock';
            logger.info({ sId: this.serviceId, engineType: this._engineType }, '[PrivateSTT] Using factory-injected mock engine');
            
            if (this.engine.init) {
                await this.engine.init(options);
            }

            return Result.ok(undefined);
        }

        // 1. Manual engine override
        if (options.forceEngine) {
            const res = await (async () => {
                if (options.forceEngine === 'whisper-turbo') return this.initFastEngine(options);
                if (options.forceEngine === 'transformers-js') return this.initSafeEngine(options);
                if (options.forceEngine === 'mock') return this.initMockEngine(options);
                return { isOk: false as const, error: new Error(`Unknown engine type: ${options.forceEngine}`) };
            })();
            return res.isOk ? Result.ok(undefined) : (res as Result<void, Error>);
        }

        // 2. CI/Test Mock (Enforcement: window.__SS_E2E__ Manifest)
        const manifest = (window as unknown as Record<string, unknown>).__SS_E2E__ as { engineType?: string };
        if (ENV.isE2E && manifest?.engineType === 'mock') {
            const res = await this.initMockEngine(options);
            return res.isOk ? Result.ok(undefined) : (res as Result<void, Error>);
        }

        // 3. Fast Path (WebGPU)
        const forceSafe = ENV.disableWasm;
        const webGPUAvailable = hasWebGPU() && !forceSafe;

        if (webGPUAvailable) {
            const fastResult = await this.initFastEngine(options);
            if (fastResult.isOk) return Result.ok(undefined);

            logger.warn({ sId: this.serviceId, rId: this.runId, err: fastResult.error }, '[PrivateSTT] ⚠️ WhisperTurbo failed. Falling back to WASM...');
        }

        // 4. Safe Path (WASM/CPU)
        logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🛡️ Initializing TransformersJS (Safe Path)...');
        const safeResult = await this.initSafeEngine(options);

        if (safeResult.isOk === false) {
            logger.error({ err: safeResult.error }, '[PrivateSTT] ❌ All private engines failed.');
            return { isOk: false, error: new Error('Private STT failed: No compatible private engine could be initialized. Please switch to Cloud Mode for transcription.') };
        }

        return Result.ok(undefined);
    }

    protected async onStart(mic?: MicStream): Promise<void> {
        if (this.engine) {
            await this.engine.start(mic);
        }
    }

    protected async onStop(): Promise<void> {
        if (this.engine) {
            await this.engine.stop();
        }
    }

    protected async onDestroy(): Promise<void> {
        if (this.engine) {
            await this.engine.destroy();
            this.engine = null;
            this._engineType = null;
        }
    }

    /**
     * Interface requirement: Transcribe audio data
     */
    public async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.engine) {
            return { isOk: false, error: new Error('PrivateSTT not initialized.') };
        }
        return this.engine.transcribe(audio);
    }

    /**
     * STTStrategy Requirement: Probe availability and prerequisites.
     */
    public async checkAvailability(): Promise<import('../STTStrategy').AvailabilityResult> {
        // 1. Prioritize Injected Mock or E2E Registry
        if (this.mockEngine || (ENV.isE2E && (getEngine('whisper-turbo') || (window as unknown as Record<string, unknown>).__SS_E2E__))) {
            return { isAvailable: true };
        }

        // 2. Determine best available engine (WebGPU preference)
        const hasWebGPUAvailable = hasWebGPU() && !ENV.disableWasm;
        const preferredEngine: 'whisper-turbo' | 'transformers-js' = hasWebGPUAvailable ? 'whisper-turbo' : 'transformers-js';

        // 3. Probe Cache for the preferred model
        const isDownloaded = await ModelManager.isModelDownloaded(preferredEngine);

        if (!isDownloaded) {
            return { 
                isAvailable: false, 
                reason: 'CACHE_MISS', 
                message: 'Private model unavailable at first-use.',
                sizeMB: ModelManager.getModelSizeMB(preferredEngine)
            };
        }

        return { isAvailable: true };
    }

    /**
     * Initialize the mock engine for CI/E2E testing
     */
    private async initMockEngine(callbacks: TranscriptionModeOptions): Promise<Result<EngineType, Error>> {
        try {
            logger.info('[PrivateSTT] 🛠️ Loading MockEngine...');
            // Registry Injection
            const registryFactory = getEngine('mock');
            if (registryFactory) {
                logger.info('[PrivateSTT] 🧪 Injecting MockEngine from Registry');
                const engine = registryFactory(callbacks);
                validateEngine(engine);
                await engine.init(callbacks);
                this.engine = engine;
                this._engineType = 'mock';
                return { isOk: true, data: 'mock' as EngineType };
            }
            return { isOk: true, data: 'mock' as EngineType };
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ err: e }, '[PrivateSTT] ❌ MockEngine init failed');
            return { isOk: false, error: e };
        }
    }

    /**
     * Initialize the fast (whisper-turbo) engine
     */
    private async initFastEngine(callbacks: TranscriptionModeOptions): Promise<Result<EngineType, Error>> {
        try {
            if (this.mockEngine) {
                logger.info('[PrivateSTT] 🧪 Using injected MockEngine');
                validateEngine(this.mockEngine);
                const result = await this.mockEngine.init(callbacks as unknown as EngineCallbacks);
                if (result && !result.isOk) return { isOk: false, error: result.error };
                this.engine = this.mockEngine;
                this._engineType = 'whisper-turbo';
                return { isOk: true, data: 'whisper-turbo' as EngineType };
            }
            
            const { WhisperTurboEngine } = await import('./WhisperTurboEngine');
            const engine = new WhisperTurboEngine();
            validateEngine(engine);
            const resultRaw = await engine.init(callbacks as unknown as EngineCallbacks, 30000);
            const result = resultRaw as unknown as Record<string, unknown>;
            
            // Type guard for Result variants
            if (result && typeof result === 'object' && 'isOk' in result && result.isOk === false) {
                logger.warn({ err: result.error as Error }, '[PrivateSTT] ⚠️ WhisperTurbo.init() failed');
                return { isOk: false, error: result.error as Error };
            }
            // Check for status-based result (DownloadRequired)
            if (result && result.status === 'requires_download') {
                return { isOk: false, error: new TranscriptionError('Download required', 'CACHE_MISS', true) };
            }
            this.engine = engine;
            this._engineType = 'whisper-turbo';
            return { isOk: true, data: 'whisper-turbo' as EngineType };
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            return { isOk: false, error: e };
        }
    }

    /**
     * Initialize the safe (transformers.js) engine
     */
    private async initSafeEngine(callbacks: TranscriptionModeOptions): Promise<Result<EngineType, Error>> {
        try {
            const registryFactory = getEngine('transformers-js');
            if (registryFactory) {
                const engine = registryFactory(callbacks);
                validateEngine(engine);
                const resultRaw = await engine.init(callbacks);
                const result = resultRaw as unknown as Record<string, unknown>;
                if (result && 'isOk' in result && result.isOk === false) {
                    return { isOk: false, error: result.error as Error };
                }
                this.engine = engine;
                this._engineType = 'transformers-js';
                return { isOk: true, data: 'transformers-js' as EngineType };
            }

            const { TransformersJSEngine } = await import('./TransformersJSEngine');
            const engine = new TransformersJSEngine();
            validateEngine(engine);
            const resultRaw = await engine.init(callbacks);
            const result = resultRaw as unknown as Record<string, unknown>;
            if (result && 'isOk' in result && result.isOk === false) {
                return { isOk: false, error: result.error as Error };
            }

            this.engine = engine;
            this._engineType = 'transformers-js';
            return { isOk: true, data: 'transformers-js' as EngineType };
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            return { isOk: false, error: e };
        }
    }

    public async getTranscript(): Promise<string> {
        return this.engine ? await (this.engine as unknown as { getTranscript: () => Promise<string> }).getTranscript() : '';
    }

    public getLastHeartbeatTimestamp(): number {
        return this.engine ? this.engine.getLastHeartbeatTimestamp() : Date.now();
    }

    async terminate(): Promise<void> {
        if (this.engine) {
            if (this.engine.terminate) {
                await this.engine.terminate();
            } else {
                await this.engine.destroy();
            }
            this.engine = null;
            this._engineType = null;
        }
    }
}

export function createPrivateSTT(): PrivateSTT {
    return new PrivateSTT();
}
