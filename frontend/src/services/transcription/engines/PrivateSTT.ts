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

import { TranscriptionModeOptions, Result, ITranscriptionEngine } from '@/services/transcription/modes/types';
import { TranscriptionError } from '@/services/transcription/errors';
import { IPrivateSTTEngine, EngineType } from '@/contracts/IPrivateSTTEngine';
import { STTEngine, validateEngine } from '@/contracts/STTEngine';
import { PrivateSTTInitOptions } from '@/contracts/IPrivateSTT';
import logger from '@/lib/logger';
import { ModelManager } from '../ModelManager';
import { ENV } from '@/config/TestFlags';
import { MicStream } from '../utils/types';
import { getEngine } from '@/services/transcription/STTRegistry';
// Stale import removed

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
    protected _engineType: EngineType | 'mock' | null = null;
    protected serviceId: string = 'unknown';
    protected runId: string = 'unknown';

    /**
     * PrivateSTT manages the dual-engine strategy for on-device transcription.
     * It coordinates between WhisperTurbo (GPU) and TransformersJS (CPU/WASM) engines.
     */
    constructor(options: Partial<TranscriptionModeOptions> = {}, mockEngine?: IPrivateSTTEngine) {
        super(options as TranscriptionModeOptions);
        this.engine = mockEngine || null;
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

    public override init(timeoutMs?: number): Promise<Result<void, Error>> {
        return super.init(timeoutMs);
    }
    
    protected override async onInit(timeoutMs?: number): Promise<Result<void, Error>> {
        const options = this.options as PrivateSTTInitOptions;

        this.serviceId = options.serviceId || 'unknown';
        this.runId = options.runId || 'unknown';

        logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🚀 Privacy-first engine selection started...');

        // 1. Manual engine override
        if (options.forceEngine) {
            const res = await (async (): Promise<Result<EngineType, Error>> => {
                if (options.forceEngine === 'whisper-turbo') return this.initFastEngine();
                if (options.forceEngine === 'transformers-js') return this.initSafeEngine();
                if (options.forceEngine === 'mock') {
                    const factory = getEngine('mock');
                    if (factory) {
                        const engine = factory(this.options as TranscriptionModeOptions);
                        validateEngine(engine);
                        const result = await engine.init(timeoutMs);
                        if (result.isOk) {
                            this.engine = engine as IPrivateSTTEngine;
                            this._engineType = 'mock';
                            return Result.ok('mock' as EngineType);
                        }
                    }
                    return { isOk: false, error: new Error('Mock engine requested but not registered in STTRegistry') };
                }
                return { isOk: false as const, error: new Error(`Unknown engine type: ${options.forceEngine}`) };
            })();
            return res.isOk ? Result.ok(undefined) : (res as Result<void, Error>);
        }

        // 2. Registry-First Resolution (Mock-First / Environment Agnostic)
        // If the registry provides a factory for our preferred engines, use it.
        const preferredEngine = hasWebGPU() && !ENV.disableWasm ? 'whisper-turbo' : 'transformers-js';
        const factory = getEngine(preferredEngine) || getEngine('mock');

        if (factory) {
            logger.info({ sId: this.serviceId, rId: this.runId, engine: preferredEngine }, '[PrivateSTT] 🧪 Injecting MockEngine/Override from Registry');
            const engine = factory(this.options as TranscriptionModeOptions);
            validateEngine(engine);
            const result = await (engine as IPrivateSTTEngine).init(timeoutMs);
            if (result.isOk) {
                this.engine = engine as IPrivateSTTEngine;
                this._engineType = (preferredEngine === 'whisper-turbo' || preferredEngine === 'transformers-js') ? preferredEngine : 'transformers-js';
                return Result.ok(undefined);
            }
            // 🚨 DEFENSE: Purge failed registry engine before fallback
            await (engine as IPrivateSTTEngine).terminate?.();
            logger.warn({ engine: preferredEngine, error: result.error }, '[PrivateSTT] Registry engine failed to initialize. Continuing discovery...');
        }

        // 3. Environment-Based Discovery (Fast Path -> Safe Path)
        const forceSafe = ENV.disableWasm;
        const webGPUAvailable = hasWebGPU() && !forceSafe;

        if (webGPUAvailable) {
            const fastResult = await this.initFastEngine(timeoutMs);
            if (fastResult.isOk) return Result.ok(undefined);

            logger.warn({ sId: this.serviceId, rId: this.runId, err: fastResult.error }, '[PrivateSTT] ⚠️ WhisperTurbo failed. Falling back to WASM...');
        }

        // 4. Safe Path (WASM/CPU)
        logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🛡️ Initializing TransformersJS (Safe Path)...');
        const safeResult = await this.initSafeEngine(timeoutMs);

        if (safeResult.isOk === false) {
            logger.error({ err: safeResult.error }, '[PrivateSTT] ❌ All private engines failed.');
            return { isOk: false, error: TranscriptionError.engineFailure('private', 'No compatible on-device engine could be initialized.') };
        }

        return Result.ok(undefined);
    }

    protected async onStart(mic?: MicStream): Promise<void> {
        if (this.engine) {
            await this.engine.start(mic);
        }
    }

    protected async onStop(): Promise<void> {
        if (this.isTerminated) return;
        if (this.engine) {
            await this.engine.stop();
        }
    }

    protected async onPause(): Promise<void> {
        if (this.isTerminated) return;
        if (this.engine) {
            await this.engine.pause();
        }
    }

    protected async onResume(): Promise<void> {
        if (this.isTerminated) return;
        if (this.engine) {
            await this.engine.resume();
        }
    }

    protected async onDestroy(): Promise<void> {
        if (this.isTerminated) return;
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
        // 1. Registry Lookup (Environment Agnostic)
        // If an engine is already instantiated (e.g. Mock), delegate to it.
        if (this.engine) {
            logger.debug('[PrivateSTT] Delegating availability to active engine');
            return this.engine.checkAvailability();
        }

        // If a manifest exists, we MUST still probe the actual engine or manager
        const hasManifest = getEngine('whisper-turbo') || getEngine('transformers-js') || getEngine('mock');
        logger.debug({ hasManifest }, '[PrivateSTT] Base manifest check');

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
     * Initialize the fast (whisper-turbo) engine
     */
    private async initFastEngine(timeoutMs?: number): Promise<Result<EngineType, Error>> {
        const options = this.options as TranscriptionModeOptions;
        try {
            // 1. Registry Lookup (Mocks or Overrides)
            const factory = getEngine('whisper-turbo');
            if (factory) {
                logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🚀 WhisperTurbo resolved via Registry');
                const engine = factory(options);
                validateEngine(engine);
                const result = await engine.init(timeoutMs);
                if (result && typeof result === 'object' && 'isOk' in result && result.isOk === false) {
                    return { isOk: false, error: (result as { error: Error }).error };
                }
                this.engine = engine;
                this._engineType = 'whisper-turbo';
                return { isOk: true, data: 'whisper-turbo' as EngineType };
            }

            // 2. Production Fallback (Dynamic Import)
            logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 📦 Loading production WhisperTurbo module...');
            const { WhisperTurboEngine } = await import('./WhisperTurboEngine');
            const engine = new WhisperTurboEngine();
            validateEngine(engine);
            const resultRaw = await engine.init(timeoutMs);
            const result = resultRaw as unknown as Record<string, unknown>;

            // Type guard for Result variants
            if (result && typeof result === 'object' && 'isOk' in result && result.isOk === false) {
                logger.warn({ err: result.error as Error }, '[PrivateSTT] ⚠️ WhisperTurbo.init() failed');
                return { isOk: false, error: result.error as Error };
            }
            // Check for status-based result (DownloadRequired)
            if (result && result.status === 'requires_download') {
                return { isOk: false, error: TranscriptionError.cacheMiss() };
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
     * Initialize the safe (transformers-js) engine
     */
    private async initSafeEngine(timeoutMs?: number): Promise<Result<EngineType, Error>> {
        const options = this.options as TranscriptionModeOptions;
        try {
            // 1. Registry Lookup (Mocks)
            const factory = getEngine('transformers-js');
            if (factory) {
                logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🛡️ TransformersJS resolved via Registry');
                const engine = factory(options);
                validateEngine(engine);
                const result = await engine.init(timeoutMs);
                if (result && typeof result === 'object' && 'isOk' in result && result.isOk === false) {
                    return { isOk: false, error: (result as { error: Error }).error };
                }
                this.engine = engine;
                this._engineType = 'transformers-js';
                return { isOk: true, data: 'transformers-js' as EngineType };
            }

            // 2. Production Fallback
            logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 📦 Loading production TransformersJS module...');
            const { TransformersJSEngine } = await import('./TransformersJSEngine');
            const engine = new TransformersJSEngine();
            validateEngine(engine);
            const resultRaw = await engine.init(timeoutMs);
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
        if (this.isTerminated) return;

        if (this.engine) {
            if (this.engine.terminate) {
                await this.engine.terminate();
            } else {
                await this.engine.destroy();
            }
            this.engine = null;
            this._engineType = null;
        }
        await super.terminate();
    }
}

export function createPrivateSTT(): PrivateSTT {
    return new PrivateSTT();
}
