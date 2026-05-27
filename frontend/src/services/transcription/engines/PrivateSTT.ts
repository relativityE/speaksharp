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
import { getDefaultProviderForMode, getProviderIdsForMode } from '../providers/sttProviderConfig';
import type { PrivateSttProvider } from '../providers/types';
// Stale import removed

const PRIVATE_ENGINE_OVERRIDE_KEY = 'speaksharp.private.engine';
type PrivateEngineType = Extract<EngineType, PrivateSttProvider>;
type SelectedPrivateEngine = PrivateEngineType | 'mock';

const getPrivateProviderIds = (): PrivateEngineType[] =>
    getProviderIdsForMode('private')
        .filter((provider): provider is PrivateEngineType =>
            provider === 'transformers-js' ||
            provider === 'transformers-js-v4' ||
            provider === 'whisper-turbo');

const isPrivateEngineProvider = (value: string | null): value is PrivateEngineType =>
    Boolean(value && getPrivateProviderIds().includes(value as PrivateEngineType));

function getConfiguredPrivateEngine(): PrivateEngineType {
    const provider = getDefaultProviderForMode('private');
    if (!isPrivateEngineProvider(provider)) {
        throw new Error(`[PrivateSTT] Configured private provider is not implemented: ${provider}`);
    }
    return provider;
}

function getPrivateEngineOverride(): PrivateEngineType | null {
    if (typeof window === 'undefined') return null;

    const queryValue = new URLSearchParams(window.location.search).get('privateEngine');
    const storedValue = window.localStorage.getItem(PRIVATE_ENGINE_OVERRIDE_KEY);
    const value = queryValue || storedValue;

    if (isPrivateEngineProvider(value)) {
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

        const forceEngine = options.forceEngine === 'mock' || isPrivateEngineProvider(options.forceEngine ?? null)
            ? options.forceEngine as SelectedPrivateEngine
            : null;
        const overrideEngine = forceEngine || getPrivateEngineOverride();
        const selectedEngine = overrideEngine || getConfiguredPrivateEngine();

        if (this.engine && !overrideEngine) {
            logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🧪 Initializing injected engine');
            validateEngine(this.engine);
            const initResult = await this.engine.init(timeoutMs, isMock);
            const isOk = initResult ? (initResult as { isOk?: boolean }).isOk !== false : true;
            if (!isOk) {
                await this.engine.terminate?.();
                const error = initResult ? (initResult as { error?: Error }).error : new Error('Injected private engine failed to initialize');
                logger.warn({ error }, '[PrivateSTT] Injected engine failed to initialize.');
                return { isOk: false, error: error || new Error('Injected private engine failed to initialize') };
            }
            this._engineType = this.engine.type;
            return Result.ok(undefined);
        }

        logger.info({ sId: this.serviceId, rId: this.runId, provider: selectedEngine, source: overrideEngine ? 'override' : 'config' }, '[PrivateSTT] Initializing configured private provider');
        const res = await this.initSelectedEngine(selectedEngine, timeoutMs, isMock);
        return res.isOk ? Result.ok(undefined) : (res as Result<void, Error>);
    }

    protected async onStart(mic?: MicStream, userWords: string[] = []): Promise<void> {
        if (this.engine) {
            await this.engine.start(mic, userWords);
        }
    }

    protected async onStop(): Promise<void> {
        if (this.isTerminated) return;
        if (this.engine) {
            try { await this.engine.stop(); } catch (error) { logger.warn({ error, engineType: this._engineType }, '[PrivateSTT] Engine stop failed during Private STT shutdown'); }
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
            try { await this.engine.destroy(); } catch (error) { logger.warn({ error, engineType: this._engineType }, '[PrivateSTT] Engine destroy failed during Private STT teardown'); }
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
        // Availability is a pure readiness probe. It must never instantiate an
        // engine or call pipeline(), because that can silently download model
        // assets before the user explicitly chooses Private setup.
        if (this.engine) {
            logger.debug('[PrivateSTT] Delegating availability to active engine');
            return this.engine.checkAvailability();
        }

        const preferredEngine = (getPrivateEngineOverride() || getConfiguredPrivateEngine()) as EngineType;
        const cacheEngine =
            preferredEngine === 'whisper-turbo' ? 'whisper-turbo'
                : preferredEngine === 'transformers-js-v4' ? 'transformers-js-v4'
                    : 'transformers-js';
        const isDownloaded = await ModelManager.isModelDownloaded(cacheEngine);

        if (!isDownloaded) {
            const sizeMB = preferredEngine === 'transformers-js-v4'
                ? PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB
                : ModelManager.getModelSizeMB(cacheEngine);
            return {
                isAvailable: false,
                reason: 'CACHE_MISS',
                message: 'Private model unavailable at first-use.',
                sizeMB,
            };
        }

        return { isAvailable: true };
    }


    private async initSelectedEngine(engineType: SelectedPrivateEngine, timeoutMs?: number, isMock?: boolean): Promise<Result<EngineType, Error>> {
        if (engineType === 'mock') {
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
                return { isOk: false, error: result.error };
            }
            return { isOk: false, error: new Error('Mock engine requested but not registered in STTRegistry') };
        }
        if (engineType === 'whisper-turbo') return this.initFastEngine(timeoutMs, isMock);
        if (engineType === 'transformers-js') return this.initSafeEngine(timeoutMs, isMock);
        if (engineType === 'transformers-js-v4') return this.initV4Engine(timeoutMs, isMock);
        return { isOk: false as const, error: new Error(`Unknown private provider: ${engineType}`) };
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
            try { await this.engine.terminate(); } catch (error) { logger.warn({ error, engineType: this._engineType }, '[PrivateSTT] Engine terminate failed during forced termination'); }
            this.engine = null;
            this._engineType = null;
        }
        await super.terminate();
    }
}

export function createPrivateSTT(options: Partial<PrivateSTTInitOptions> = {}): PrivateSTT {
    return new PrivateSTT(options);
}
