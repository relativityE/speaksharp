/**
 * ⚠️ CORE ENGINE ROUTING. Simple/localized changes are OK; notify the User
 * if a design or significant change (engine-selection semantics, fallback policy,
 * or the manifest control-plane contract).
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
 * 1. In CI/Playwright/unit (ENV.disableWasm): Forces TransformersJSEngine (safe).
 * 2. Explicit override (forceEngine / ?privateEngine / localStorage): runs that
 *    engine strictly, with NO automatic fallback.
 * 3. Default (auto) path: promotes to WhisperTurbo (WebGPU) only when WebGPU is
 *    genuinely usable AND the turbo model is already cached, otherwise stays on
 *    the CPU TransformersJSEngine. If the GPU engine fails to initialize, it
 *    falls back automatically to the CPU engine — never to cloud.
 *
 * DESIGN PRINCIPLES:
 * - Single API: App only sees PrivateSTT.init() and transcribe()
 * - Lazy loading: Heavy WASM imported only when needed
 * - Automatic fallback: fast GPU when available, safe CPU otherwise; on-device
 *   only — audio is never sent off-device as a fallback (privacy promise).
 * 
 * @see docs/ARCHITECTURE.md - "Dual-Engine Private STT"
 */

import { TranscriptionModeOptions, Result, ITranscriptionEngine } from '@/services/transcription/modes/types';
import { IPrivateSTTEngine, EngineType } from '@/contracts/IPrivateSTTEngine';
import { STTEngine, validateEngine } from '@/contracts/STTEngine';
import { PrivateSTTInitOptions } from '@/contracts/IPrivateSTT';
import logger from '@/lib/logger';
import posthog from 'posthog-js';
import { ENV } from '@/config/TestFlags';
import { ModelManager } from '@/services/transcription/ModelManager';
import { MicStream } from '@/services/transcription/utils/types';
import { getEngine } from '@/services/transcription/STTRegistry';
import { PRIV_STT_V4, PRIV_STT_V4_DEFAULT_VARIANT, PRIV_STT_V4_VARIANTS, PRIVATE_ENGINE_OVERRIDE_KEY } from '../sttConstants';
import { getDefaultProviderForMode, getProviderIdsForMode } from '../providers/sttProviderConfig';
import type { PrivateSttProvider } from '../providers/types';
import { resolvePrivateRuntimePath, type PrivateRuntimeDecision } from '../utils/privateRuntimePath';
import { getV4FlagState } from '../privateV4Flags';
import { getV4ExperimentOverrides } from '../privateV4Experiment';
import { buildV4LifecycleProps, emitV4Ready, emitV4Fallback, emitV4Error } from '../privateV4Telemetry';
// Stale import removed

declare global {
    interface Window {
        /**
         * Stable, structured Private STT runtime decision for the harness/CI to
         * read as release proof. Populated when the resolver runs and kept after
         * Stop/teardown so evidence collection is not racing strategy disposal.
         */
        __PRIVATE_STT_RUNTIME_DEBUG__?: PrivateRuntimeDecision & { selectedAt: string };
    }
}

/**
 * Publish the resolved runtime decision to a stable window debug object so the
 * harness can collect structured runtime/provider/threads/fallback fields after
 * Stop without traversing fragile internal references. No-op outside the browser.
 */
function publishPrivateRuntimeDebug(decision: PrivateRuntimeDecision): void {
    if (typeof window === 'undefined') return;
    window.__PRIVATE_STT_RUNTIME_DEBUG__ = { ...decision, selectedAt: new Date().toISOString() };
}
type PrivateEngineType = Extract<EngineType, PrivateSttProvider>;
type SelectedPrivateEngine = PrivateEngineType | 'mock';

const getPrivateProviderIds = (): PrivateEngineType[] =>
    getProviderIdsForMode('private')
        .filter((provider): provider is PrivateEngineType =>
            provider === 'transformers-js' ||
            provider === 'transformers-js-v4');

const isPrivateEngineProvider = (value: string | null): value is PrivateEngineType =>
    Boolean(value && getPrivateProviderIds().includes(value as PrivateEngineType));

function getConfiguredPrivateEngine(): PrivateEngineType {
    const provider = getDefaultProviderForMode('private');
    if (!isPrivateEngineProvider(provider)) {
        throw new Error(`[PrivateSTT] Configured private provider is not implemented: ${provider}`);
    }
    return provider;
}

/**
 * Whether the explicit private-engine override (`?privateEngine` / localStorage) may
 * be honored. MERGE-SAFETY: this is a DEV / TEST / E2E affordance ONLY. In a production
 * build a normal user must NOT be able to force an engine (e.g. v4) via a public URL or
 * localStorage and thereby bypass the PostHog flag. `import.meta.env.DEV` is the dev
 * server; `ENV.isTest` covers unit + E2E. Both are false in the production build, so a
 * normal production user always falls through to the flag-gated resolver (v2-base when
 * flags are off). `forceEngine` (a programmatic option, not publicly settable) is
 * unaffected and still honored.
 */
function isPrivateOverrideContextAllowed(): boolean {
    return import.meta.env.DEV === true || ENV.isTest;
}

function getPrivateEngineOverride(): PrivateEngineType | null {
    if (typeof window === 'undefined') return null;
    if (!isPrivateOverrideContextAllowed()) return null;

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
/** Upper bound on a v4 AUTO-path decode. A base_q4-on-WASM decode can HANG and never return;
 *  past this bound we treat it as a failure and fall back to v2-base. Kept comfortably under the
 *  app-path proof's first-text window so the v2 re-transcribe still fits inside it. */
const V4_AUTO_DECODE_TIMEOUT_MS = 40_000;

export class PrivateSTT extends STTEngine implements IPrivateSTTEngine, ITranscriptionEngine {
    public readonly type: EngineType = 'transformers-js'; // Primary type for this facade

    private engine: IPrivateSTTEngine | null = null;
    protected _engineType: EngineType | 'mock' | null = null;
    protected serviceId: string = 'unknown';
    protected runId: string = 'unknown';
    private runtimePath: PrivateRuntimeDecision | null = null;
    // True ONLY when the AUTO (flag) path successfully initialized v4. Gates the
    // decode-time fallback to v2-base; the strict explicit-override path never sets it.
    private v4AutoFallbackEligible = false;

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
        this.v4AutoFallbackEligible = false; // reset per init; only auto-path v4 success re-enables

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

        // EXPLICIT OVERRIDE PATH (forceEngine / ?privateEngine / localStorage):
        // strict, no automatic fallback. A user/test that explicitly demands an
        // engine must get exactly that engine or a hard failure — this preserves
        // the v4 contract ("failed explicit init does not silently fall back").
        if (overrideEngine) {
            logger.info({ sId: this.serviceId, rId: this.runId, provider: selectedEngine, source: 'override' }, '[PrivateSTT] Initializing explicitly overridden private provider');
            if (selectedEngine === 'transformers-js') {
                const decision = await resolvePrivateRuntimePath({
                    webgpuPromotionAllowed: false,
                    turboModelCached: false,
                });
                this.runtimePath = decision;
                publishPrivateRuntimeDebug(decision);
                logger.info({ sId: this.serviceId, rId: this.runId, runtimeDecision: decision, selectedEngine, source: 'override' }, '[PrivateSTT] Published explicit CPU runtime decision');
            }
            const res = await this.initSelectedEngine(selectedEngine, timeoutMs, isMock);
            return res.isOk ? Result.ok(undefined) : (res as Result<void, Error>);
        }

        // DEFAULT (AUTO) PATH — on-device only. After the whisper-turbo (WebGPU)
        // retirement, the auto path resolves to the configured CPU engine
        // (transformers-js): never strand a user without on-device STT, and never
        // silently send audio off-device (cloud is never a fallback). CPU is the
        // product floor, so there is nothing safer to fall back to — if it fails,
        // surface the error rather than loop.
        const autoEngine = await this.resolveAutoPrivateEngine(selectedEngine);
        logger.info({ sId: this.serviceId, rId: this.runId, provider: autoEngine, configured: selectedEngine, source: 'auto' }, '[PrivateSTT] Initializing auto-selected private provider');
        const initStart = performance.now();
        const primary = await this.initSelectedEngine(autoEngine, timeoutMs, isMock);
        if (primary.isOk) {
            // Eligible for a one-shot decode-time fallback ONLY when the AUTO path chose v4.
            this.v4AutoFallbackEligible = autoEngine === 'transformers-js-v4';
            this.emitV4FlagTelemetry(null, Math.round(performance.now() - initStart));
            return Result.ok(undefined);
        }

        // v4 → v2-base fallback (AUTO path only; the explicit-override path stays
        // strict). A flagged v4 user must never be stranded: if v4 init/load fails,
        // fall back to the proven v2-base engine.
        if (autoEngine === 'transformers-js-v4') {
            logger.warn({ sId: this.serviceId, rId: this.runId, error: (primary as { error?: Error }).error }, '[PrivateSTT] v4 init failed; falling back to v2-base');
            const fallback = await this.initSafeEngine(timeoutMs, isMock);
            this.emitV4FlagTelemetry('v4_init_failed', Math.round(performance.now() - initStart));
            return fallback.isOk ? Result.ok(undefined) : (fallback as Result<void, Error>);
        }

        return primary as Result<void, Error>;
    }

    /**
     * Structured runtime path chosen on the DEFAULT (auto) path: which provider
     * + device + thread tier Private STT resolved to. Null until init runs, or on
     * the explicit-override path (which bypasses the resolver). Exposed for UX
     * copy, telemetry, and release proof — never includes a Cloud option.
     */
    public getRuntimePath(): PrivateRuntimeDecision | null {
        return this.runtimePath;
    }

    /**
     * Decide which engine the DEFAULT (non-override) path should attempt first,
     * via the single deterministic runtime-path resolver. CPU is the product
     * FLOOR and the only on-device engine after the whisper-turbo (WebGPU)
     * retirement.
     *
     * The auto path now always resolves to the configured CPU engine
     * (`transformers-js`). We still run the runtime-path resolver so the CPU
     * device/thread tier (multi-thread when cross-origin isolated, else
     * single-thread) is recorded for telemetry/UX, but WebGPU promotion is never
     * considered. This is behaviorally identical to the shipped path: turbo only
     * ever promoted when its model was pre-cached, which no production flow did.
     */
    private async resolveAutoPrivateEngine(configured: SelectedPrivateEngine): Promise<SelectedPrivateEngine> {
        // v4 flag-gated tiering (post-paid-soft-launch). When the flag is OFF, `v4`
        // is omitted, so the resolver returns the EXACT v2/CPU decision as before —
        // flag-off is byte-identical to the v2-base default (no v4 ever selected).
        const v4Flags = getV4FlagState();
        // DEV/TEST-only force-AUTO knob: attempt v4 on the AUTO path even without WebGPU so
        // headless CI can prove the decode-fallback contract. Inert in production.
        const forceAuto = getV4ExperimentOverrides().forceAuto;
        const decision = await resolvePrivateRuntimePath({
            webgpuPromotionAllowed: false,
            turboModelCached: false,
            v4: (v4Flags.v4Enabled || forceAuto)
                ? {
                    enabled: true,
                    distilEnabled: v4Flags.distilEnabled,
                    forceAuto,
                    // Honest provenance: the REAL flag wins when on (even if forceAuto is also set);
                    // forceAuto-only is the dev/test harness shim. This — not `reason` — drives the
                    // artifact's selectionSource, since on real WebGPU `reason` is identical for both.
                    selectionSource: v4Flags.v4Enabled ? 'posthog_flag' : 'dev_harness',
                  }
                : undefined,
        });
        this.runtimePath = decision;
        publishPrivateRuntimeDebug(decision);
        logger.info({ sId: this.serviceId, rId: this.runId, runtimeDecision: decision, configured }, '[PrivateSTT] Resolved private runtime decision');

        // Route to v4 ONLY when the resolver actually selected it (flag on + confirmed
        // WebGPU). Otherwise stay on the configured v2 engine. v4 init failure falls
        // back to v2-base in onInit (auto path only).
        if (decision.provider === 'transformers-js-v4') {
            return 'transformers-js-v4';
        }
        return configured;
    }

    /**
     * Internal-only v4 flag telemetry. Emitted only when the v4 flag is on, so the
     * default v2 path stays silent. Records the attempted/selected variant, device,
     * and any fallback reason — never user-facing engine internals. Never throws.
     */
    private emitV4FlagTelemetry(fallbackReason: string | null, loadMs?: number, errorClass?: string | null): void {
        try {
            const flags = getV4FlagState();
            if (!flags.v4Enabled) return;
            const d = this.runtimePath;
            const variant = d?.v4Variant ?? null;
            const variantCfg = variant ? PRIV_STT_V4_VARIANTS[variant] : null;
            const payload = {
                v4FlagEnabled: flags.v4Enabled,
                distilFlagEnabled: flags.distilEnabled,
                // Provenance of the selection so evidence can distinguish a REAL PostHog-flag
                // selection from the dev/test forceAuto shim. Read from the decision (computed at
                // selection time from flag-vs-forceAuto) — NOT derived from `reason`, which on real
                // WebGPU reads `webgpu_available_v4_flag` for forceAuto too and would mislabel it.
                selectionSource: d?.selectionSource ?? 'posthog_flag',
                selectedVariant: variant,
                model: variantCfg?.MODEL_ID ?? null,
                dtype: variantCfg ? JSON.stringify(variantCfg.DTYPE) : null,
                requestedDevice: d?.provider === 'transformers-js-v4' ? 'webgpu' : 'cpu',
                resolvedDevice: d?.runtime ?? null,
                attemptedProvider: d?.provider ?? null,
                finalProvider: this._engineType ?? null,
                fallbackProvider: fallbackReason ? (this._engineType ?? null) : null,
                fallbackReason,
                loadMs: loadMs ?? null,
                errorClass: errorClass ?? null, // class name only — never message/stack (no PII)
            };
            // Internal log (always) + PostHog event (analytics) for flagged v4 attempts.
            // No user-facing engine internals; safe to capture for cohort validation.
            logger.info({ sId: this.serviceId, rId: this.runId, ...payload }, '[V4_FLAG_TELEMETRY]');
            try { posthog?.capture?.('private_stt_v4_attempt', payload); } catch { /* posthog optional */ }

            // Stage-B structured lifecycle events (allowlisted, no PII): ready on success;
            // fallback + error when v4 init/load fell back to the v2-base floor.
            const lifecycle = buildV4LifecycleProps({
                finalEngine: this._engineType ?? null,
                variant,
                model: variantCfg?.MODEL_ID ?? null,
                dtype: variantCfg ? JSON.stringify(variantCfg.DTYPE) : null,
                requestedDevice: d?.provider === 'transformers-js-v4' ? 'webgpu' : 'cpu',
                resolvedDevice: d?.runtime ?? null,
                webgpuAvailable: d?.webgpuAvailable,
                fallbackReason,
                loadMs: loadMs ?? null,
            });
            if (fallbackReason) {
                emitV4Fallback(lifecycle);
                emitV4Error({ ...lifecycle, errorClass: errorClass ?? fallbackReason });
            } else {
                emitV4Ready(lifecycle);
            }
        } catch (error) {
            logger.debug?.({ error }, '[PrivateSTT] v4 flag telemetry emit failed');
        }
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
        const v4Auto = this.v4AutoFallbackEligible && this._engineType === 'transformers-js-v4';

        // On the AUTO path, BOUND the v4 decode: a base_q4-on-WASM decode can HANG and never
        // return (no error, no result), which would strand the user because the fallback only
        // runs AFTER transcribe resolves. Race it against a timeout so a stuck decode becomes a
        // failure we can fall back from. v2 / strict-override paths call transcribe directly.
        const result = v4Auto
            ? await this.transcribeBounded(this.engine, audio, V4_AUTO_DECODE_TIMEOUT_MS)
            : await this.engine.transcribe(audio);

        // A flagged v4 engine on the AUTO path "produced nothing" if it ERRORED / TIMED OUT or
        // returned an EMPTY / whitespace transcript. base_q4 on WASM can fail SILENTLY
        // (isOk:true, data:"") or hang, so all three must trigger fallback — otherwise the user
        // is stranded. Genuine silence is safe: v2 also returns empty. Strict override never
        // sets the flag, so it is unaffected.
        const v4Empty = v4Auto && result.isOk && result.data.trim().length === 0;
        const v4ProducedNothing = v4Auto && (!result.isOk || v4Empty);

        if (result.isOk && !v4Empty) return result;

        // DECODE-time fallback (AUTO / flag path only): tear down v4, init the proven v2-base
        // engine, and RE-TRANSCRIBE the SAME audio (no data loss). One-shot: clear the flag.
        if (v4ProducedNothing) {
            this.v4AutoFallbackEligible = false;
            const errorClass = result.isOk ? 'EmptyTranscript' : (result.error instanceof Error ? result.error.name : 'Error');
            logger.warn({ sId: this.serviceId, rId: this.runId, errorClass, empty: result.isOk }, '[PrivateSTT] v4 produced no transcript; falling back to v2-base and re-transcribing');
            try { await this.engine.terminate?.(); } catch { /* best-effort v4 teardown */ }
            const fallback = await this.initSafeEngine();
            if (!fallback.isOk || !this.engine) {
                return result; // v2 also unavailable — surface v4's original result
            }
            this.emitV4FlagTelemetry('v4_decode_failed', undefined, errorClass);
            return this.engine.transcribe(audio);
        }
        return result;
    }

    /** Race a v4 decode against a timeout so a HUNG WASM decode degrades to a failure we can fall
     *  back from (AUTO path only). The timeout never throws; it resolves to a failure Result. */
    private async transcribeBounded(engine: IPrivateSTTEngine, audio: Float32Array, ms: number): Promise<Result<string, Error>> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<Result<string, Error>>((resolve) => {
            timer = setTimeout(() => resolve({ isOk: false, error: new Error(`v4 decode exceeded ${ms}ms`) }), ms);
        });
        try {
            return await Promise.race([engine.transcribe(audio), timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
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
            preferredEngine === 'transformers-js-v4' ? 'transformers-js-v4'
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
        if (engineType === 'transformers-js') return this.initSafeEngine(timeoutMs, isMock);
        if (engineType === 'transformers-js-v4') return this.initV4Engine(timeoutMs, isMock);
        return { isOk: false as const, error: new Error(`Unknown private provider: ${engineType}`) };
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
        // Thread the resolver-chosen v4 model variant (base_q4 floor / distil_q4 tier)
        // into the engine via options. Override path (no resolver) defaults to base_q4.
        const variant = this.runtimePath?.v4Variant ?? PRIV_STT_V4_DEFAULT_VARIANT;
        const options = { ...(this.options as TranscriptionModeOptions), v4Variant: variant } as TranscriptionModeOptions;
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
