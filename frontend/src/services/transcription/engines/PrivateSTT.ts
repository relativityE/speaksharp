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
 * 2. In production: Uses deterministic TransformersJS CPU path by default
 *    WebGPU/WhisperTurbo remains available through explicit engine override.
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
import { ModelManager } from '@/services/transcription/ModelManager';
import { MicStream } from '@/services/transcription/utils/types';
import { getEngine } from '@/services/transcription/STTRegistry';
import { PRIV_STT_V4 } from '../sttConstants';
// Stale import removed

const PRIVATE_ENGINE_OVERRIDE_KEY = 'speaksharp.private.engine';

function getPrivateEngineOverride(): EngineType | null {
    if (typeof window === 'undefined') return null;

    const queryValue = new URLSearchParams(window.location.search).get('privateEngine');
    const storedValue = window.localStorage.getItem(PRIVATE_ENGINE_OVERRIDE_KEY);
    const value = queryValue || storedValue;

    if (value === 'transformers-js-v4' || value === 'transformers-js' || value === 'whisper-turbo') {
        return value;
    }

    return null;
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

    protected override async onInit(timeoutMs?: number, isMock?: boolean): Promise<Result<void, Error>> {
        const options = this.options as PrivateSTTInitOptions;

        this.serviceId = options.serviceId || 'unknown';
        this.runId = options.runId || 'unknown';

        logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🚀 Privacy-first engine selection started...');

        const explicitEngine = options.forceEngine || getPrivateEngineOverride();

        // 1. Manual engine override
        if (explicitEngine) {
            const res = await (async (): Promise<Result<EngineType, Error>> => {
                if (explicitEngine === 'whisper-turbo') return this.initFastEngine();
                if (explicitEngine === 'transformers-js') return this.initSafeEngine();
                if (explicitEngine === 'transformers-js-v4') return this.initV4Engine();
                if (explicitEngine === 'mock') {
                    const factory = getEngine('mock');
                    if (factory) {
                        const engine = factory(this.options as TranscriptionModeOptions);
                        validateEngine(engine);
                        const result = await engine.init(timeoutMs, isMock);
                        if (result.isOk) {
                            this.engine = engine as unknown as IPrivateSTTEngine;
                            this._engineType = 'mock';
                            return Result.ok('mock' as EngineType);
                        }
                    }
                    return { isOk: false, error: new Error('Mock engine requested but not registered in STTRegistry') };
                }
                return { isOk: false as const, error: new Error(`Unknown engine type: ${explicitEngine}`) };
            })();
            return res.isOk ? Result.ok(undefined) : (res as Result<void, Error>);
        }

        // 2. Registry-First Resolution (Mock-First / Environment Agnostic)
        // If the registry provides a factory for our preferred engines, use it.
        const preferredEngine = 'transformers-js';
        const factory = getEngine(preferredEngine) 
            || getEngine('transformers-js')
            || getEngine('whisper-turbo')
            || getEngine('mock');

        if (factory) {
            logger.info({ sId: this.serviceId, rId: this.runId, engine: preferredEngine }, '[PrivateSTT] 🧪 Injecting MockEngine/Override from Registry');
            const engine = factory(this.options as TranscriptionModeOptions);
            validateEngine(engine);
            const initResult = await (engine as unknown as IPrivateSTTEngine).init(timeoutMs, isMock);
            
            // 🛡️ Safe check: Mocks might not return a Result object
            const isOk = initResult ? (initResult as { isOk?: boolean }).isOk !== false : true;
            
            if (!isOk) {
                // 🚨 DEFENSE: Purge failed registry engine before fallback
                await (engine as unknown as IPrivateSTTEngine).terminate?.();
                const error = initResult ? (initResult as { error?: Error }).error : new Error('Registry engine failed to initialize');
                logger.warn({ engine: preferredEngine, error }, '[PrivateSTT] Registry engine failed to initialize.');
                return { isOk: false, error: error || new Error('Registry engine failed to initialize') };
            }
            this.engine = engine as unknown as IPrivateSTTEngine;
            this._engineType = preferredEngine;
            return Result.ok(undefined);
        }

        // 3. Safe Path (WASM/CPU)
        logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🛡️ Initializing TransformersJS (Default Private Path)...');
        const safeResult = await this.initSafeEngine();

        if (safeResult.isOk === false) {
            logger.error({ err: safeResult.error }, '[PrivateSTT] ❌ All private engines failed.');
            return { isOk: false, error: TranscriptionError.engineFailure('private', 'No compatible on-device engine could be initialized.') };
        }

        return Result.ok(undefined);
    }

    protected async onStart(mic?: MicStream, userWords: string[] = []): Promise<void> {
        if (this.engine) {
            await this.engine.start(mic, userWords);
        }
    }

    protected async onStop(): Promise<void> {
        if (this.isTerminated) return;
        if (this.engine) {
            try { await this.engine.stop(); } catch (e) { logger.warn({ e }, '[PrivateSTT] Engine stop failed'); }
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
        if (this.engine) {
            try { await this.engine.destroy(); } catch (e) { logger.warn({ e }, '[PrivateSTT] Engine destroy failed'); }
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
    public override updateOptions(options: Partial<TranscriptionModeOptions>): void {
        super.updateOptions(options);
        if (this.engine) {
            this.engine.updateOptions(options);
        }
    }

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

        // 2. Determine best available engine.
        // Launch policy: CPU/TransformersJS is the deterministic first-run path.
        const preferredEngine = (getPrivateEngineOverride() || 'transformers-js') as EngineType;

        if (preferredEngine === 'transformers-js-v4') {
            return {
                isAvailable: true,
                message: `Private v4 model will download on first use (~${PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB} MB).`,
                sizeMB: PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB,
            };
        }

        // 2.5 Consult the registry first if a mock is provided
        const legacyPreferredEngine = preferredEngine === 'whisper-turbo' ? 'whisper-turbo' : 'transformers-js';
        const mockFactory = getEngine(legacyPreferredEngine)
            || getEngine('transformers-js')
            || getEngine('whisper-turbo')
            || getEngine('mock');
        if (mockFactory) {
            logger.debug(`[PrivateSTT] Delegating availability to mock factory`);
            const tempMock = mockFactory((this.options || {}) as TranscriptionModeOptions);
            return tempMock.checkAvailability();
        }

        // 3. Probe Cache for the preferred model
        const isDownloaded = await ModelManager.isModelDownloaded(legacyPreferredEngine);

        if (!isDownloaded) {
            return {
                isAvailable: false,
                reason: 'CACHE_MISS',
                message: 'Private model unavailable at first-use.',
                sizeMB: ModelManager.getModelSizeMB(legacyPreferredEngine)
            };
        }

        return { isAvailable: true };
    }



    /**
     * Initialize the fast (whisper-turbo) engine
     */
    private async initFastEngine(timeoutMs?: number, isMock?: boolean): Promise<Result<EngineType, Error>> {
        const options = this.options as TranscriptionModeOptions;
        try {
            // 1. Registry Lookup (Mocks or Overrides)
            const factory = getEngine('whisper-turbo');
            if (factory) {
                logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🚀 WhisperTurbo resolved via Registry');
                const engine = factory(options);
                validateEngine(engine);
                const result = await engine.init(timeoutMs, isMock);
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
            const engine = new WhisperTurboEngine(options);
            validateEngine(engine);
            const resultRaw = await engine.init(timeoutMs, isMock);
            const result = resultRaw as unknown as Record<string, unknown>;

            // Type guard for Result variants
            if (result && 'isOk' in result && result.isOk === false) {
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
    private async initSafeEngine(timeoutMs?: number, isMock?: boolean): Promise<Result<EngineType, Error>> {
        const options = this.options as TranscriptionModeOptions;
        try {
            // 1. Registry Lookup (Mocks)
            const factory = getEngine('transformers-js');
            if (factory) {
                logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🛡️ TransformersJS resolved via Registry');
                const engine = factory(options);
                validateEngine(engine);
                const result = await engine.init(timeoutMs, isMock);
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
            const engine = new TransformersJSEngine(options);
            validateEngine(engine);
            const resultRaw = await engine.init(timeoutMs, isMock);
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

    private async initV4Engine(timeoutMs?: number, isMock?: boolean): Promise<Result<EngineType, Error>> {
        const options = this.options as TranscriptionModeOptions;
        try {
            const factory = getEngine('transformers-js-v4');
            if (factory) {
                logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🧪 TransformersJSV4 resolved via Registry');
                const engine = factory(options);
                validateEngine(engine);
                const result = await engine.init(timeoutMs, isMock);
                if (result && typeof result === 'object' && 'isOk' in result && result.isOk === false) {
                    return { isOk: false, error: (result as { error: Error }).error };
                }
                this.engine = engine as unknown as IPrivateSTTEngine;
                this._engineType = 'transformers-js-v4';
                return { isOk: true, data: 'transformers-js-v4' as EngineType };
            }

            logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 📦 Loading production TransformersJSV4 module...');
            const { TransformersJSV4Engine } = await import('./TransformersJSV4Engine');
            const engine = new TransformersJSV4Engine(options);
            validateEngine(engine);
            const resultRaw = await engine.init(timeoutMs, isMock);
            const result = resultRaw as unknown as Record<string, unknown>;
            if (result && 'isOk' in result && result.isOk === false) {
                return { isOk: false, error: result.error as Error };
            }

            this.engine = engine;
            this._engineType = 'transformers-js-v4';
            return { isOk: true, data: 'transformers-js-v4' as EngineType };
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
            try { await this.engine.terminate(); } catch (e) { logger.warn({ e }, '[PrivateSTT] Engine terminate failed'); }
            this.engine = null;
            this._engineType = null;
        }
        await super.terminate();
    }
}

export function createPrivateSTT(): PrivateSTT {
    return new PrivateSTT();
}
