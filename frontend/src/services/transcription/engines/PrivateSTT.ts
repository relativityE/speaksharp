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
 * 2. Explicit override (programmatic `forceEngine` only): runs that
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
import type { LiveResultKind, PrivateRuntimeEvidence } from '@/contracts/IPrivateSTTEngine';
import { STTEngine, validateEngine, assertEngineCanDecode } from '@/contracts/STTEngine';
import { PrivateSTTInitOptions } from '@/contracts/IPrivateSTT';
import logger from '@/lib/logger';
import { ModelManager } from '@/services/transcription/ModelManager';
import { MicStream } from '@/services/transcription/utils/types';
import { getEngine } from '@/services/transcription/STTRegistry';
import { PRIV_STT_V4, PRIV_STT_V4_DEFAULT_VARIANT, PRIV_STT_V4_VARIANTS } from '../sttConstants';
import {
    CANDIDATES, candidateForRuntime, identityOf,
    type CandidateId, type SessionModelIdentity,
} from '../candidateRegistry';
import { recordResolvedEngine } from '@/services/telemetry/runtimeAttribution';
import { effectiveCandidate, assertDeviceAvailable, v4VariantFor, type EffectiveSelection } from '../candidateSelection';
import { consentCopy, consentDecision, consentTermsFor, readReceipt, recordConsent, reducedDataRequested } from '../modelConsent';
import type { MoonshineArch, MoonshineCandidateId } from './MoonshineStreamingEngine';
import { runtimeCandidateOverride } from '../runtimeCandidateSwitch';
import { captureCapabilities } from '../capabilitySnapshot';
import { getDefaultProviderForMode, getProviderIdsForMode } from '../providers/sttProviderConfig';
import type { PrivateSttProvider } from '../providers/types';
import { resolvePrivateRuntimePath, type PrivateRuntimeDecision } from '../utils/privateRuntimePath';
import { buildV4LifecycleProps, emitV4Ready, emitV4Fallback, emitV4Error, emitV4Telemetry, V4_TELEMETRY_EVENTS } from '../privateV4Telemetry';
import { buildEngineVersion, type EngineVariant } from '../privateTelemetry';
import {
    probeCache, recordAcquisitionStart, recordAcquisitionSuccess, recordAcquisitionFailure,
    classifyAcquisitionError, type AcquisitionSubject, type PinnedAssetRef,
} from '../modelAcquisitionTelemetry';
import type { Candidate } from '../candidateRegistry';
import { acquisitionComponentGroupsFor, assetRequestsFor, acquisitionScopeFor, resolveCandidateAssetUrl } from '../candidateAssetRequests';
import { verifyModelPackage, productModelMetadata } from '../modelPackage';
import { observeAcquisitionNetwork } from '../acquisitionNetworkObservation';
import { receiptMatches, type AcquisitionAttempt, type AcquisitionReceipt } from '../acquisitionAttempt';
import type { AcquisitionTrigger } from '../modelAcquisitionTelemetry';
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

/** One constructor seam for product and evaluator; registry injection keeps priority. */
async function constructPrivateEngine(
    kind: Candidate['engine'], candidate: Candidate, options: TranscriptionModeOptions,
): Promise<IPrivateSTTEngine> {
    const factory = getEngine(kind);
    if (factory) {
        const injected = factory(options);
        validateEngine(injected);
        return injected;
    }
    if (candidate.engine !== kind || !candidate.execution.implemented) {
        throw new Error(`Descriptor ${candidate.id} cannot initialize ${kind}`);
    }
    const input = candidate.execution.preprocessing;
    if (input.input !== 'float32-pcm' || input.channels !== 1 || input.sampleRateHz !== 16_000 ||
        candidate.model.sampleRateHz !== input.sampleRateHz || input.features !== 'runtime') {
        throw new Error(`Descriptor ${candidate.id} requires unsupported audio preprocessing`);
    }
    let engine: unknown;
    switch (kind) {
        case 'parakeet-tdt': {
            const profile = candidate.execution.decode;
            const backend = (options as PrivateSTTInitOptions).evaluatorBackend ?? candidate.model.device;
            const { package: packageName, version } = candidate.runtime;
            const ortVersion = candidate.runtime.dependencies?.['onnxruntime-web'];
            if (profile.kind !== 'parakeet-tdt' || backend !== 'wasm' ||
                packageName !== 'parakeet.js' || version !== '1.4.4' || ortVersion !== '1.24.1') {
                throw new Error(`Invalid pinned Parakeet WASM/int8 profile for ${candidate.id}`);
            }
            const assets = candidate.assets.files?.map(file => {
                if (!file.url) throw new Error(`Missing pinned URL for ${file.path}`);
                return { file: file.path.split('/').pop()!, url: resolveCandidateAssetUrl(file.url), bytes: file.bytes, sha256: file.sha256 };
            });
            if (!assets?.length) throw new Error(`Missing Parakeet asset inventory for ${candidate.id}`);
            engine = new (await import('./ParakeetTdtEngine')).ParakeetTdtEngine({
                profile, runtime: { package: packageName, version, ortVersion }, assets,
                onDownloadProgress: fraction => options.onModelLoadProgress?.(Math.round(fraction * 100)),
            });
            break;
        }
        case 'granite-ctc': {
            const profile = candidate.execution.decode;
            const backend = (options as PrivateSTTInitOptions).evaluatorBackend ?? candidate.model.device;
            if (profile.kind !== 'granite-ctc' || (backend !== 'wasm' && backend !== 'webgpu')) {
                throw new Error(`Invalid Granite execution profile for ${candidate.id}`);
            }
            const assets = candidate.assets.files?.map(file => {
                if (!file.url) throw new Error(`Missing pinned URL for ${file.path}`);
                return { file: file.path.split('/').pop()!, url: file.url, bytes: file.bytes, sha256: file.sha256 };
            });
            if (!assets?.length) throw new Error(`Missing asset inventory for ${candidate.id}`);
            engine = new (await import('./GraniteCtcEngine')).GraniteCtcEngine({
                modelFile: profile.modelFile, backend, applyAgc: profile.applyAgc, assets,
                onDownloadProgress: fraction => options.onModelLoadProgress?.(Math.round(fraction * 100)),
            });
            break;
        }
        case 'transformers-js':
            engine = new (await import('./TransformersJSEngine')).TransformersJSEngine(options);
            break;
        case 'transformers-js-v4':
            engine = new (await import('./TransformersJSV4Engine')).TransformersJSV4Engine(options);
            break;
        case 'moonshine-streaming': {
            const modelArch = candidate.execution.modelArch;
            if (!modelArch) throw new Error(`Descriptor ${candidate.id} has no Moonshine architecture`);
            engine = new (await import('./MoonshineStreamingEngine')).MoonshineStreamingEngine({
                candidateId: candidate.id as MoonshineCandidateId, modelArch,
                onDownloadProgress: (fraction) => options.onModelLoadProgress?.(Math.round(fraction * 100)),
            });
            break;
        }
    }
    validateEngine(engine);
    return engine;
}

const getPrivateProviderIds = (): PrivateEngineType[] =>
    getProviderIdsForMode('private')
        .filter((provider): provider is PrivateEngineType =>
            provider === 'transformers-js' ||
            provider === 'transformers-js-v4' ||
            provider === 'parakeet-tdt');

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
 * Dual-engine Private STT facade
 */
/** Upper bound on a v4 AUTO-path decode. A base_q4-on-WASM decode can HANG and never return;
 *  past this bound we treat it as a failure and fall back to v2-base. Kept comfortably under the
 *  app-path proof's first-text window so the v2 re-transcribe still fits inside it. */
const V4_AUTO_DECODE_TIMEOUT_MS = 40_000;

interface EngineLifetime {
    generation: number;
    release?: Promise<Error | null>;
    /** Undefined while release is unconfirmed; null only after successful termination. */
    outcome?: Error | null;
}

export class PrivateSTT extends STTEngine implements IPrivateSTTEngine, ITranscriptionEngine {
    public readonly type: EngineType = 'transformers-js'; // Primary type for this facade

    private engine: IPrivateSTTEngine | null = null;
    protected _engineType: EngineType | 'mock' | null = null;
    protected serviceId: string = 'unknown';
    protected runId: string = 'unknown';
    private runtimePath: PrivateRuntimeDecision | null = null;
    private selection: EffectiveSelection | null = null;
    /** Init owns these before adoption; teardown must reach their acquisition cancellation now. */
    private readonly acquiringEngines = new Set<IPrivateSTTEngine>();
    private readonly engineReleases = new WeakMap<IPrivateSTTEngine, EngineLifetime>();
    // True ONLY when the AUTO (flag) path successfully initialized v4. Gates the
    // decode-time fallback to v2-base; the strict explicit-override path never sets it.

    /**
     * PrivateSTT manages the dual-engine strategy for on-device transcription.
     * It coordinates between WhisperTurbo (GPU) and TransformersJS (CPU/WASM) engines.
     */
    constructor(options: Partial<PrivateSTTInitOptions> = {}, mockEngine?: IPrivateSTTEngine) {
        super(options as TranscriptionModeOptions);
        this.engine = mockEngine || null;
    }

    /** One immutable selection for this facade's consent, acquisition and recording lifetime. */
    private resolvedSelection(freeze = true): EffectiveSelection {
        if (this.selection) return this.selection;
        const options = this.options as PrivateSTTInitOptions;
        const id = options.evaluatorCandidateId;
        if (id && import.meta.env.VITE_INTERNAL_BUILD !== 'true') {
            throw new Error('Explicit evaluator selection requires an internal build');
        }
        const selected = id
            ? effectiveCandidate({ candidate: id, acknowledgeNotProductionReady: true }, undefined, undefined, null)
            : effectiveCandidate();
        if (id && (selected.candidate.id !== id || selected.fallbackCause)) {
            throw new Error('Evaluator selection differs from effective safety selection');
        }
        if (options.evaluatorBackend && (!id ||
            (selected.candidate.model.device === 'wasm' && options.evaluatorBackend !== 'wasm'))) {
            throw new Error('Backend override requires an explicit compatible evaluator selection');
        }
        const resolved = Object.freeze(selected);
        if (freeze) this.selection = resolved;
        return resolved;
    }

    /** Model-only harness evidence from the adopted instance, never a previous window-global run. */
    public getExecutionEvidence(): { runtime: PrivateRuntimeEvidence | null; workerAcquisition: AcquisitionReceipt | null } {
        const engine = this.engine as (IPrivateSTTEngine & {
            getAcquisitionReceipt?: () => AcquisitionReceipt | null;
        }) | null;
        return {
            runtime: engine?.getRuntimeEvidence?.() ?? null,
            workerAcquisition: engine?.getAcquisitionReceipt?.() ?? null,
        };
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

    /**
     * #1405s — how the ACTIVE engine's live results must be interpreted.
     *
     * Read from the engine rather than switched on its name: a name-based test would hand any future
     * snapshot engine the incremental behaviour by default, which is the duplication this fixes.
     * Absent means `incremental`, preserving v2/v4 exactly.
     */
    public getLiveResultKind(): LiveResultKind {
        return this.engine?.liveResultKind ?? 'incremental';
    }

    /**
     * Durable engine metadata for the saved session row. Records the resolved A/B arm
     * (private_v2 / private_v4) and model so `sessions.engine_version` reconstructs the
     * variant even if PostHog is missing — `private_v2:whisper-base.en` /
     * `private_v4:base_q4`. Previously the controller hardcoded `'transformers-js'`,
     * which erased the v4 arm. `deviceType` stays `'browser'` (on-device).
     */
    /**
     * Publish the RESOLVED identity to the telemetry seam.
     *
     * Never throws: attribution is evidence about a session, and failing to record it must not end the
     * session it describes.
     */
    private publishResolvedIdentity(): void {
        try {
            const { candidateId, modelIdentity } = this.getMetadata();
            recordResolvedEngine(candidateId ? { candidateId, modelIdentity } : null);
        } catch {
            // An unresolvable combination stays absent rather than becoming a guessed identity.
        }
    }

    /** The arch a completed Moonshine init actually loaded. Null until then. */
    private moonshineArch: MoonshineArch | null = null;

    /**
     * Record the user's consent for the SELECTED candidate.
     *
     * Named and public so the grant is auditable rather than a side effect buried in init: consent that
     * is recorded implicitly is indistinguishable, later, from consent that was never asked for.
     */
    public grantModelConsent(): void {
        // NOTHING IS SWALLOWED HERE EITHER. This caught every failure, so a storage error surfaced by
        // `recordConsent` was discarded a second time and the caller still proceeded to initialise. Two
        // layers of suppression over the same fact produced a user who granted consent, waited for a
        // ~305 MB download, and was asked again next session — with no error anywhere.
        //
        // An unresolvable candidate is a real failure too: it means we cannot say WHAT was consented to,
        // and a receipt that does not name its subject is not one.
        const candidate = this.resolvedSelection().candidate;
        recordConsent(consentTermsFor(candidate), new Date().toISOString());
    }

    public getMetadata(): {
        engineVersion: string; modelName: string; deviceType: string;
        candidateId?: CandidateId; modelIdentity?: SessionModelIdentity;
    } {
        // AN EXPLICIT THREE-WAY. This was `isV4 ? 'private_v4' : 'private_v2'`, a two-value boolean over
        // what is now three engines — so every Moonshine session fell through the else and was persisted
        // as `private_v2` / `whisper-base.en`. The saved row named a model that had not run, which is
        // precisely the comparison the human test exists to make; the arm would have been invisible in
        // its own results. A boolean cannot be extended safely here, so the engine is switched on
        // directly and an unknown engine is left unattributed rather than defaulted.
        const isV4 = this._engineType === 'transformers-js-v4';
        const isMoonshine = this._engineType === 'moonshine-streaming';
        const isGranite = this._engineType === 'granite-ctc';
        const isParakeet = this._engineType === 'parakeet-tdt';
        const variant: EngineVariant = isV4
            ? 'private_v4'
            : isMoonshine ? 'private_moonshine' : isGranite ? 'private_granite'
                : isParakeet ? 'private_parakeet' : 'private_v2';

        // THE RESOLVED variant, not the default constant. `PRIV_STT_V4_DEFAULT_VARIANT` is base_q4, so
        // a session that actually resolved distil_q4 was recorded as base_q4 — the model name in the
        // saved row named a model that never ran, and no test procedure could catch it because the
        // identity was synthesised here rather than carried from the decision. The resolved variant was
        // already on `this.runtimePath`; it simply was not consulted.
        const resolvedVariant = this.runtimePath?.v4Variant ?? null;

        let candidateId: CandidateId | undefined;
        let modelIdentity: SessionModelIdentity | undefined;
        try {
            // DECODER PRECISION, carried explicitly. base_q4 and base_int8 share a repo and an
            // encoder and differ only here, so a mapping keyed on the variant name alone cannot tell
            // them apart — and an int8 session recorded as q4 is the same defect in a new place.
            const variantCfg = resolvedVariant ? PRIV_STT_V4_VARIANTS[resolvedVariant] : null;
            candidateId = this.selection?.candidate.engine === this._engineType
                ? this.selection.candidate.id : candidateForRuntime({
                engineType: this._engineType,
                // The Moonshine arch IS its variant for identity purposes; `v4Variant` is null on that
                // path and passing it would send the registry a provider with no model.
                variant: isMoonshine ? this.moonshineArch : resolvedVariant,
                decoderDtype: (variantCfg?.DTYPE as { decoder_model_merged?: string } | undefined)
                    ?.decoder_model_merged ?? null,
                // `acceleration` is the decision's own field; there is no `device` on it, and
                // inventing one would put a guessed value into a session's identity.
                device: this.runtimePath?.acceleration ?? null,
            });
            modelIdentity = identityOf(this.selection?.candidate.id === candidateId
                ? this.selection.candidate : CANDIDATES[candidateId]);
        } catch {
            // An unrecognised combination is left ABSENT, never defaulted. A row with no identity is
            // honestly unattributable; a row carrying a guessed identity is evidence for a claim that
            // was never measured. Legacy fields below still describe the arm.
        }

        // Moonshine's model name comes from the registry entry the arch resolved to, never from a
        // constant: a hardcoded name here is the same defect as `PRIV_STT_V4_DEFAULT_VARIANT` was.
        if (modelIdentity && this.selection?.candidate.id === candidateId) {
            return { ...productModelMetadata(this.selection.candidate), candidateId, modelIdentity };
        }
        const model = isV4
            ? (resolvedVariant ?? PRIV_STT_V4_DEFAULT_VARIANT)
            : (isMoonshine || isGranite || isParakeet) ? (modelIdentity?.configuredModel.id ?? 'unknown')
                : (modelIdentity?.configuredExecution?.localModelId ?? 'whisper-base.en');
        return {
            engineVersion: buildEngineVersion(variant, model),
            modelName: model,
            deviceType: 'browser',
            ...(candidateId ? { candidateId } : {}),
            ...(modelIdentity ? { modelIdentity } : {}),
        };
    }

    public override init(timeoutMs?: number): Promise<Result<void, Error>> {
        return super.init(timeoutMs);
    }

    protected override async onInit(timeoutMs?: number, isMock?: boolean): Promise<Result<void, Error>> {
        try {
            const descriptor = this.resolvedSelection(false).candidate.modelPackage?.descriptor;
            if (descriptor) await verifyModelPackage(descriptor);
        } catch (error) {
            return { isOk: false, error: error instanceof Error ? error : new Error('Model package refused') };
        }
        // #1635: captured synchronously at entry, i.e. the generation of the init() that called us. Every engine
        // this init acquires is adopted only while that generation still owns the facade.
        const generation = this.lifecycleGeneration;
        const options = this.options as PrivateSTTInitOptions;

        this.serviceId = options.serviceId || 'unknown';
        this.runId = options.runId || 'unknown';

        logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🚀 Privacy-first engine selection started...');

        const forceEngine = options.forceEngine === 'mock' || isPrivateEngineProvider(options.forceEngine ?? null)
            ? options.forceEngine as SelectedPrivateEngine
            : null;
        // `forceEngine` only: the URL/localStorage override is retired. A programmatic option is not a
        // visitor-reachable channel, so it stays.
        const overrideEngine = forceEngine;
        const selectedEngine = overrideEngine || getConfiguredPrivateEngine();

        if (this.engine && !overrideEngine) {
            logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateSTT] 🧪 Initializing injected engine');
            // #1635: a destroy during this await nulls `this.engine` (and disposes it); keep our own reference.
            const injected = this.engine;
            validateEngine(injected);
            const lifetime = this.beginEngineAcquisition(injected, generation);
            try {
                const initResult = await injected.init(timeoutMs, isMock);
                // #1635: the teardown that cancelled us owns this engine's release and reports its outcome; it may still
                // be pending or fail, so this init never claims the engine was released.
                if (this.acquisitionCancelled(generation)) return Result.err(this.cancelledInitError(false));
                const isOk = initResult ? (initResult as { isOk?: boolean }).isOk !== false : true;
                if (!isOk) {
                    const error = (initResult ? (initResult as { error?: Error }).error : undefined)
                        || new Error('Injected private engine failed to initialize');
                    logger.warn({ error }, '[PrivateSTT] Injected engine failed to initialize.');
                    // #1635: released through the recording path. An injected child is not assumed to carry its own sticky
                    // protection: a failed release is recorded on THIS facade, and the uncertain engine is never re-invoked.
                    const releaseFailure = await this.releaseEngine(injected, lifetime);
                    if (releaseFailure) {
                        if (this.engine === injected) this.engine = null;
                        return Result.err(new Error(`${error.message}; releasing the injected engine FAILED (release uncertain): ${releaseFailure.message}`));
                    }
                    return { isOk: false, error };
                }
                this._engineType = injected.type;
                return Result.ok(undefined);
            } finally {
                if (this.engineReleases.get(injected) === lifetime) this.acquiringEngines.delete(injected);
            }
        }

        // EXPLICIT OVERRIDE PATH (programmatic forceEngine only):
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
                // Identity is published AFTER the engine initialises — see initSelectedEngine.
                publishPrivateRuntimeDebug(decision);
                logger.info({ sId: this.serviceId, rId: this.runId, runtimeDecision: decision, selectedEngine, source: 'override' }, '[PrivateSTT] Published explicit CPU runtime decision');
            }
            const res = await this.initSelectedEngine(selectedEngine, timeoutMs, isMock, generation);
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
        // AN EXPLICITLY SELECTED CANDIDATE IS NEVER SUBSTITUTED.
        //
        // The v4 -> v2 fallback existed when v4 was a percentage rollout: a flagged user must not be
        // stranded, and which model they got was not a claim anyone relied on. Selection is now a
        // reviewed config decision, so substituting silently produces a v2 recording under the
        // selected candidate's id — a comparison of distil against v2 would be v2 against v2, and the
        // difference would be read as quality. The safety kill remains the way to move traffic to v2,
        // and it is explicit and recorded as `remote_safety_kill`.
        const explicitlySelected = this.runtimePath?.selectionSource === 'config'
            || this.runtimePath?.selectionSource === 'runtime_switch';

        const primary = await this.initSelectedEngine(autoEngine, timeoutMs, isMock, generation);
        if (primary.isOk) {
            this.emitV4FlagTelemetry(null, Math.round(performance.now() - initStart));
            return Result.ok(undefined);
        }

        // #1635: a cancelled init never falls back to acquire a second engine for a destroyed facade.
        if (this.acquisitionCancelled(generation)) return primary as Result<void, Error>;
        if (autoEngine === 'transformers-js-v4' && !explicitlySelected) {
            logger.warn({ sId: this.serviceId, rId: this.runId, error: (primary as { error?: Error }).error }, '[PrivateSTT] v4 init failed; falling back to v2-base');
            const fallback = await this.initSafeEngine(timeoutMs, isMock, generation);
            this.emitV4FlagTelemetry('v4_init_failed', Math.round(performance.now() - initStart));
            return fallback.isOk ? Result.ok(undefined) : (fallback as Result<void, Error>);
        }

        if (autoEngine === 'transformers-js-v4') {
            // Reported as a v4 failure, then surfaced. Silence here would look like a working session.
            logger.error({ sId: this.serviceId, rId: this.runId, error: (primary as { error?: Error }).error },
                '[PrivateSTT] explicitly selected v4 failed to initialise; REFUSING to substitute v2-base');
            this.emitV4FlagTelemetry('v4_init_failed_no_substitution', Math.round(performance.now() - initStart));
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
        // CONFIG IS THE SELECTOR.
        //
        // This previously read PostHog flags and a URL/localStorage experiment shim, so which model a
        // visitor ran was a property of remote state at that moment and could not be reviewed. It now
        // comes from a checked-in file. `effectiveCandidate()` applies the one-way safety kill and
        // nothing else: no URL parameter, no localStorage key, no flag payload and no cohort reaches
        // this decision, and the kill can only ever force the v2 floor.
        const { candidate, fallbackCause } = this.resolvedSelection();

        // A candidate that REQUIRES an accelerator is refused HERE, visibly, rather than being quietly
        // downgraded to WASM further down. A slow run recorded under the same candidate id would be
        // evidence for a configuration nobody measured.
        // ONE READING, USED BY BOTH DECISIONS. This called `isWebGPUSupported()` while the resolver
        // below independently called `detectWebGPUSupport()`. Two async probes, nothing comparing them:
        // when they disagreed the gate admitted a WebGPU-only candidate and the resolver quietly
        // returned the v2 floor, so the session ran Whisper while the switch reported success for the
        // model that was asked for. The snapshot is taken once here and threaded onward.
        const evaluatorBackend = (this.options as PrivateSTTInitOptions).evaluatorBackend;
        const observedCapabilities = await captureCapabilities();
        // Scientific backend controls stay internal/model-only. They do not change the descriptor or
        // product eligibility, and the engine must later report the explicitly requested backend.
        const capabilities = evaluatorBackend === 'wasm'
            ? { ...observedCapabilities, webgpuAvailable: false } : observedCapabilities;
        if (evaluatorBackend === 'webgpu' && !capabilities.webgpuAvailable) {
            throw new Error('Requested evaluator WebGPU backend is unavailable');
        }
        if (candidate.model.device === 'webgpu' && evaluatorBackend !== 'wasm') {
            assertDeviceAvailable(candidate, capabilities.webgpuAvailable);
        }

        // Explicit adapter backends do not pass through Whisper promotion/fallback policy.
        if (candidate.engine === 'moonshine-streaming' || candidate.engine === 'granite-ctc' || candidate.engine === 'parakeet-tdt') {
            const useGpu = candidate.engine === 'granite-ctc' &&
                (evaluatorBackend ?? candidate.model.device) === 'webgpu';
            const decision: PrivateRuntimeDecision = {
                runtime: useGpu ? 'webgpu' : 'wasm-singlethread',
                provider: candidate.engine,
                v4Variant: null,
                acceleration: useGpu ? 'gpu' : 'cpu',
                reason: candidate.engine === 'moonshine-streaming' ? 'no_webgpu_or_isolation' : 'descriptor_backend',
                selectionSource: fallbackCause ? 'remote_safety_kill' : (runtimeCandidateOverride() ? 'runtime_switch' : 'config'),
                webgpuAvailable: capabilities.webgpuAvailable,
                turboCached: false,
                crossOriginIsolated: typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : false,
                wasmThreadCount: 1,
                fallbackAvailable: false,
                cloudFallbackAttempted: false,
            };
            this.runtimePath = decision;
            publishPrivateRuntimeDebug(decision);
            logger.info({
                sId: this.serviceId, rId: this.runId, candidateId: candidate.id, fallbackCause,
            }, '[PrivateSTT] Resolved adapter runtime decision from config');
            return candidate.engine;
        }

        const wantsV4 = candidate.engine === 'transformers-js-v4';
        const decision = await resolvePrivateRuntimePath({
            webgpuPromotionAllowed: false,
            turboModelCached: false,
            capabilities,
            v4: wantsV4
                ? {
                    enabled: true,
                    // The EXACT variant the config named. Passing a boolean here is what made
                    // base_int8 unselectable.
                    variant: v4VariantFor(candidate),
                    // WASM-capable variants are honoured without WebGPU: a checked-in selection is a
                    // deliberate choice, not a percentage rollout that should stay conservative.
                    allowWithoutWebGPU: evaluatorBackend === 'wasm' || candidate.model.device !== 'webgpu',
                    forceAuto: false,
                    // A session decoded under an internal runtime switch must NOT be recorded as a
                    // normal config selection: it was chosen in-page for a comparison, on a build a
                    // real user never receives, and reading it as production evidence later would be
                    // reading an experiment as a release.
                    selectionSource: fallbackCause
                        ? 'remote_safety_kill'
                        : (runtimeCandidateOverride() ? 'runtime_switch' : 'config'),
                  }
                : undefined,
        });
        this.runtimePath = decision;
        // Identity is published AFTER the engine initialises — see initSelectedEngine.
        publishPrivateRuntimeDebug(decision);
        logger.info({
            sId: this.serviceId, rId: this.runId, runtimeDecision: decision, configured,
            candidateId: candidate.id, fallbackCause,
        }, '[PrivateSTT] Resolved private runtime decision from config');

        if (decision.provider === 'transformers-js-v4') {
            return 'transformers-js-v4';
        }
        return configured;
    }

    /**
     * Internal-only v4 telemetry. Records the attempted/selected variant, device, and any fallback
     * reason — never user-facing engine internals. Never throws.
     *
     * GATED ON WHAT RAN, NOT ON A FLAG. This returned early unless `getV4FlagState().v4Enabled` was
     * true. Once selection moved to config that flag stopped deciding anything, so the gate would have
     * ended v4 telemetry silently — and an absence of events is indistinguishable from v4 never having
     * been attempted, which is the exact ambiguity this telemetry exists to remove.
     */
    private emitV4FlagTelemetry(fallbackReason: string | null, loadMs?: number, errorClass?: string | null): void {
        try {
            const d = this.runtimePath;
            // The decision records the ATTEMPTED provider, so this still fires when v4 was tried and
            // fell back to the v2 floor — which is the case most worth recording.
            if (d?.provider !== 'transformers-js-v4') return;
            const variant = d?.v4Variant ?? null;
            const variantCfg = variant ? PRIV_STT_V4_VARIANTS[variant] : null;
            const payload = {
                // Provenance of the selection, so evidence can tell a checked-in config choice from a
                // safety-kill fallback or a dev harness run. Read from the decision — NOT derived from
                // `reason`, which on real WebGPU reads identically across sources and would mislabel it.
                // The retired v4FlagEnabled/distilFlagEnabled fields are gone: flags no longer select a
                // model, so reporting their state alongside a selection would invite reading them as
                // the cause of it.
                selectionSource: d?.selectionSource ?? 'config',
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
            // #1259 — WAS A THIRD CAPTURE BOUNDARY, and the least governed of the three: `payload` went
            // to PostHog RAW. Not merely bypassing the envelope — bypassing every allowlist, so
            // `selectionSource`, `attemptedProvider`, `finalProvider` and `fallbackProvider` reached the
            // vendor without ever having been reviewed. Production traffic confirms this event is live,
            // which is why it is routed rather than deleted. `emitV4Telemetry` carries it to the one
            // boundary, where the v4 allowlist now enumerates those fields.
            emitV4Telemetry(V4_TELEMETRY_EVENTS.ATTEMPT, payload);

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
        // #1635: Start never "succeeds" with no engine running.
        if (!this.engine) throw new Error('[PrivateSTT] Cannot start: no engine is adopted.');
        await this.engine.start(mic, userWords);
    }

    protected async onStop(): Promise<void> {
        if (this.isTerminated) return;
        if (this.engine) {
            // #1476 PM RETURN: a failed engine stop is reported, not swallowed. Swallowing it let STTEngine.stop() mark the
            // strategy stopped and the service report STOP_COMPLETED while the engine may still be running.
            try { await this.engine.stop(); } catch (error) { logger.warn({ error, engineType: this._engineType }, '[PrivateSTT] Engine stop failed during Private STT shutdown'); throw error; }
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
        const acquiring = [...this.acquiringEngines];
        this.acquiringEngines.clear();
        // #1635: detach before awaiting, so nothing adopted or read during the teardown sees a dying engine.
        const engine = this.engine;
        const engineType = this._engineType;
        this.engine = null;
        this._engineType = null;
        const failures = await Promise.all([...new Set([...acquiring, ...(engine ? [engine] : [])])]
            .map(child => this.releaseEngine(child)));
        const failure = failures.find(value => value !== null);
        if (failure) {
            // The shared teardown rejects, so public destroy() and every concurrent waiter see it.
            logger.warn({ error: failure, engineType }, '[PrivateSTT] Engine release failed during Private STT teardown');
            throw new Error(`[PrivateSTT] engine release FAILED during teardown (release uncertain): ${failure.message}`);
        }
        this.selection = null;
    }

    /** Open a new ownership lifetime, including static registry objects returned after successful cleanup. */
    private beginEngineAcquisition(engine: IPrivateSTTEngine, generation: number): EngineLifetime {
        const previous = this.engineReleases.get(engine);
        if (previous?.release && previous.outcome !== null) {
            throw new Error('[PrivateSTT] previous child release is unconfirmed; refusing reinitialization');
        }
        // A static registry may return the same object for a NEW lifetime. Its previous successful
        // release is not proof that the newly initialized worker is off. Old continuations retain
        // their own lifetime below, so they cannot terminate or untrack this replacement.
        const lifetime: EngineLifetime = { generation };
        this.engineReleases.set(engine, lifetime);
        this.acquiringEngines.add(engine);
        return lifetime;
    }

    /** Share cleanup within this lifetime. Failed or pending cleanup never authorizes reacquisition. */
    private async releaseEngine(engine: IPrivateSTTEngine,
        lifetime: EngineLifetime = this.engineReleases.get(engine) ?? { generation: this.lifecycleGeneration },
    ): Promise<Error | null> {
        if (!this.engineReleases.has(engine)) this.engineReleases.set(engine, lifetime);
        if (lifetime.release) return lifetime.release;
        const release = Promise.resolve().then(async () => {
            try {
                await engine.terminate();
                lifetime.outcome = null;
                return null;
            } catch (error) {
                const failure = error instanceof Error ? error : new Error(String(error));
                lifetime.outcome = failure;
                this.recordReleaseFailure(failure);
                return failure;
            }
        });
        lifetime.release = release;
        return release;
    }

    /** #1635: the init that started in `generation` no longer owns this facade. */
    private acquisitionCancelled(generation: number): boolean {
        return generation !== this.lifecycleGeneration || this.isTerminated;
    }

    /** `released` only when THIS init verified the release; otherwise the cancelling teardown reports it. */
    private cancelledInitError(released: boolean): Error {
        return new Error(released
            ? '[PrivateSTT] init cancelled by destroy/terminate; the acquired engine was released.'
            : '[PrivateSTT] init cancelled by destroy/terminate; the engine release belongs to that teardown.');
    }

    /**
     * #1635: adopt an engine acquired by the init that started in `generation`, or release it exactly once.
     * A different previous engine is retired first; ownership is rechecked after that await, and an engine
     * adopted meanwhile by a newer owner is never destroyed here.
     */
    private async adoptEngine(engine: IPrivateSTTEngine, generation: number,
        lifetime: EngineLifetime = this.engineReleases.get(engine) ?? { generation },
    ): Promise<Result<void, Error>> {
        // A failed cleanup is never reported as a release: the error says the release is UNCERTAIN.
        const release = async (): Promise<Result<void, Error>> => {
            const failure = await this.releaseEngine(engine, lifetime);
            return Result.err(failure
                ? new Error(`[PrivateSTT] init cancelled, and releasing the acquired engine FAILED (release uncertain): ${failure.message}`)
                : this.cancelledInitError(true));
        };
        if (this.acquisitionCancelled(generation)) return release();
        // A release failure recorded while this acquisition was pending (e.g. a stale, cancelled acquisition whose
        // cleanup failed): refuse to adopt, and dispose only this init's own candidate.
        const retained = this.retainedReleaseFailure();
        if (retained) {
            const candidateFailure = await this.releaseEngine(engine, lifetime);
            return Result.err(new Error(`[PrivateSTT] a previous engine release FAILED (release uncertain): ${retained.message}`
                + (candidateFailure ? `; releasing the new engine also FAILED: ${candidateFailure.message}` : '; the new engine was released')));
        }
        const previous = this.engine;
        if (previous && previous !== engine) {
            // This init still owns the facade (checked synchronously above). While the previous engine is being
            // retired there is no engine to start, so the facade is not initialised: Start rejects instead of
            // resolving with nothing running. A successful adoption re-marks it initialised.
            this.isInitialized = false;
            this.engine = null;
            const retireFailure = await this.releaseEngine(previous);
            if (retireFailure) {
                // The replacement is refused: the facade cannot claim a clean hand-over from an engine whose
                // release failed. The new candidate is released too, and both outcomes are reported.
                const candidateFailure = await this.releaseEngine(engine, lifetime);
                // Readiness was already cleared when the retirement began; only the init that still OWNS the facade
                // could change it, and after these awaits a destroy and a newer, successful init may have taken over.
                // Both failures are sticky (releaseEngine), so no later init can acquire an engine on this facade.
                return Result.err(new Error(`[PrivateSTT] releasing the replaced engine FAILED (release uncertain): ${retireFailure.message}`
                    + (candidateFailure ? `; releasing the new engine also FAILED: ${candidateFailure.message}` : '; the new engine was released')));
            }
            if (this.acquisitionCancelled(generation) || (this.engine !== null && this.engine !== engine)) return release();
        }
        this.engine = engine;
        return Result.ok(undefined);
    }

    /**
     * Interface requirement: Transcribe audio data
     */
    public async transcribe(audio: Float32Array, options?: { final?: boolean }): Promise<Result<string, Error>> {
        if (!this.engine) {
            return { isOk: false, error: new Error('PrivateSTT not initialized.') };
        }
        // BOUND EVERY v4 DECODE, SUBSTITUTE FOR NONE.
        //
        // Two separate protections used to be fused into one flag. The BOUND exists because a
        // base_q4-on-WASM decode can hang and never return, stranding the session; the SUBSTITUTION
        // re-ran the audio on v2. Only the substitution is unsafe now: selection is an explicit,
        // reviewed choice, so quietly producing a v2 transcript under the selected candidate's id
        // would make a comparison of two models a comparison of one against itself.
        //
        // Keeping them fused would have been worse than either: the flag is only ever false today, so
        // the hang protection would have been switched off along with the substitution.
        const isV4 = this._engineType === 'transformers-js-v4';
        const result = isV4
            ? await this.transcribeBounded(this.engine, audio, V4_AUTO_DECODE_TIMEOUT_MS)
            : await this.engine.transcribe(audio, options);

        if (!result.isOk && isV4) {
            // Surfaced, never swapped. A failed decode is visible; a substituted one is not.
            const errorClass = result.error instanceof Error ? result.error.name : 'Error';
            logger.warn({ sId: this.serviceId, rId: this.runId, errorClass },
                '[PrivateSTT] v4 decode failed; REFUSING to re-transcribe on v2-base');
            this.emitV4FlagTelemetry('v4_decode_failed_no_substitution', undefined, errorClass);
        }
        return result;
    }

    /** Race a v4 decode against a timeout so a HUNG WASM decode becomes a reported failure instead of
     *  an unbounded wait. The timeout never throws; it resolves to a failure Result. */
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

        // READINESS IS ABOUT THE SELECTED CANDIDATE, NOT THE DEFAULT.
        //
        // This read the provider default and quoted `EXPECTED_Q4_SPLIT_DOWNLOAD_MB` for any v4, so a
        // build configured for distil reported base_q4's ~142 MB while distil needs ~251 MB, and probed
        // the wrong model for cache presence. The user was told a number for a model they were not
        // getting — a download-consent prompt has to be about the thing being downloaded.
        let selected: Candidate;
        try {
            selected = this.resolvedSelection(false).candidate;
            if (selected.modelPackage) await verifyModelPackage(selected.modelPackage.descriptor);
        } catch (error) {
            logger.warn('[PrivateSTT] Selected candidate is unavailable');
            return { isAvailable: false, reason: 'UNSUPPORTED',
                message: error instanceof Error ? error.message : String(error) };
        }
        const preferredEngine = (selected?.engine ?? getConfiguredPrivateEngine()) as EngineType;

        // MOONSHINE IS A CONSENT QUESTION, NOT A CACHE QUESTION.
        //
        // The branch below probes a Transformers cache. Moonshine does not use one — its runtime fetches
        // and stores its own assets and exposes no probe — so falling through here read a DIFFERENT
        // engine's cache and answered about v2. A user with v2 cached was told the model was ready and
        // then pulled ~305 MB with no prompt at all; when a prompt did appear it quoted v2's ~80 MB.
        //
        // We cannot honestly answer "is it cached?", so we stop asking. What we can record is that the
        // user agreed to a possible download of a NAMED set of bytes, which stays true across sessions
        // and does not require seeing the disk. A valid receipt means initialization may proceed without
        // nagging; it never means the assets are present, and it never means READY — only the real
        // engine publishing a matching identity does that.
        if (selected?.engine === 'moonshine-streaming' || selected?.engine === 'granite-ctc' || selected?.engine === 'parakeet-tdt') {
            const decision = consentDecision(
                selected,
                readReceipt(selected.id),
                reducedDataRequested(),
            );
            if (decision.state === 'consent_required') {
                return {
                    isAvailable: false,
                    reason: 'CONSENT_REQUIRED',
                    message: consentCopy(decision.terms),
                    // Omitted rather than sent as 0 when unknown: a consent prompt reading "0 MB" is
                    // worse than one that declines to name a number.
                    ...(decision.maxBytes === null ? {} : { sizeMB: Math.round(decision.maxBytes / 1_000_000) }),
                };
            }
            // Consent covers this exact candidate, asset set, runtime and size. Nothing is asserted about
            // whether a download will actually occur.
            return { isAvailable: true };
        }

        const cacheEngine =
            preferredEngine === 'transformers-js-v4' ? 'transformers-js-v4'
                : 'transformers-js';
        const selectedVariant = (() => {
            try { return selected ? PRIV_STT_V4_VARIANTS[v4VariantFor(selected)] : null; } catch { return null; }
        })();
        // PROBE THE SELECTED MODEL'S FILES. Fixing only the reported SIZE left readiness still checking
        // base-q4's cache entries, so a distil build could report the wrong model as downloaded or as
        // missing — the number was corrected while the answer it accompanied was not.
        const isDownloaded = await ModelManager.isModelDownloaded(
            cacheEngine,
            selected?.execution.localModelId ?? selectedVariant?.MODEL_ID ?? PRIV_STT_V4.MODEL_ID,
            selected?.execution.cacheFiles,
        );

        if (!isDownloaded) {
            const sizeMB = preferredEngine === 'transformers-js-v4'
                ? (selectedVariant?.EXPECTED_SPLIT_DOWNLOAD_MB ?? PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB)
                : (selected?.execution.expectedDownloadMb ?? ModelManager.getModelSizeMB(cacheEngine));
            return {
                isAvailable: false,
                reason: 'CACHE_MISS',
                message: 'Private model unavailable at first-use.',
                sizeMB,
            };
        }

        return { isAvailable: true };
    }


    /**
     * PUBLISH THE OBSERVED IDENTITY ONLY ONCE AN ENGINE EXISTS.
     *
     * This used to be published at RESOLUTION, before initialisation, while `_engineType` still held
     * the previous value or none. An observer could then read a model identity for an engine that had
     * not been built — and after a switch, the app could reach READY reporting either the OUTGOING
     * model or nothing at all. `observed` must mean "this is running", so it is written here, after a
     * successful init, and stays null until then.
     */
    /**
     * #1259s — THE ONE PLACE MODEL ACQUISITION IS MEASURED.
     *
     * Both the override and auto paths funnel through here, and every approved candidate — v2, v4 distil
     * and Moonshine — initialises inside it. Instrumenting the real routine rather than building a
     * parallel path is the point: a simulated one would only ever measure itself.
     *
     * The cache is probed BEFORE the load, from real Cache Storage, so `cache_result` is an observation
     * rather than an inference. A load that turns out fast is not evidence of a hit.
     */
    // #1635: `generation` is the owning init's; a direct call (no init in progress) adopts for the current one.
    private async initSelectedEngine(engineType: SelectedPrivateEngine, timeoutMs?: number, isMock?: boolean, generation: number = this.lifecycleGeneration): Promise<Result<EngineType, Error>> {
        // The mock engine is not an acquisition: nothing is fetched and nothing is cached.
        if (engineType === 'mock') return this.initSelectedEngineInner(engineType, timeoutMs, isMock, generation);

        // THE SUBJECT IS FROZEN BEFORE THE LOAD, FROM THE SELECTED CANDIDATE.
        //
        // It used to be read from `getMetadata()`, which derives from `_engineType` — a field the
        // initialisation being measured is what SETS. So the start and failure events, the only two
        // that describe a load that never completed, reported `candidate_id: unknown` for a candidate
        // that was already named. The registry knows the answer before anything is fetched.
        const candidate = this.resolveAcquisitionCandidate();
        const subject = this.acquisitionSubject(candidate);
        const requests = candidate ? assetRequestsFor(candidate) : { assets: [], unobservableReason: 'candidate could not be resolved' };
        this.acquisitionAssets = requests.assets;

        // THE TOTAL CLOCK STARTS BEFORE THE CACHE IS INSPECTED.
        //
        // It used to start after `probeCache` resolved, so `total_ms` excluded the probe while its
        // contract says it covers the whole acquisition. Inspecting the cache is real time the user
        // spends waiting — for a candidate with a dozen pinned assets it is a dozen Cache Storage
        // lookups — and leaving it out systematically understated setup, in the flattering direction.
        const acquisitionStartedAt = performance.now();
        const cacheResult = await probeCache(this.acquisitionAssets);
        // A SEPARATE clock for the DOWNLOAD window. `download_ms` is derived only from Resource Timing
        // and must not absorb probe time: cache inspection is not a download, and folding it in would
        // invent transfer duration out of a local lookup.
        const loadStartedAt = performance.now();
        const prefixes = candidate ? acquisitionScopeFor(candidate) : [];
        recordAcquisitionStart(subject, cacheResult);

        try {
            const acquired = await this.initSelectedEngineInner(engineType, timeoutMs, isMock, generation);
            // #1635: ownership is rechecked after this await too, BEFORE the adopted engine's receipt is read; a
            // teardown that detached it meanwhile cancels this init rather than leaving a null to dereference.
            const outcome: Result<EngineType, Error> = acquired.isOk && this.acquisitionCancelled(generation)
                ? { isOk: false, error: this.cancelledInitError(false) }
                : acquired;
            const totalMs = Math.round(performance.now() - acquisitionStartedAt);
            if (outcome.isOk) {
                this.publishResolvedIdentity();
                // MEASURED, NOT PREDICTED, AND MEASURED WHERE THE BYTES ACTUALLY ARRIVE.
                //
                // v2 and v4 fetch their models inside a Web Worker, so those requests are recorded on
                // the WORKER's performance timeline. Reading `window.performance` here finds nothing
                // for them — it would honestly report an absent observation for the two candidates
                // that matter most, which is no measurement at all. The engine therefore hands back
                // the receipt its worker took, and that is preferred whenever it exists.
                //
                // The main-window read remains the fallback for an engine that loads on this thread.
                // The two are never merged: a receipt is one observation or the other, never a blend.
                // AND IT MUST BE THIS LOAD'S RECEIPT. The engine already refuses one that does not match
                // its own in-flight attempt; this second check catches the case the engine cannot see —
                // a receipt from an engine instance this acquisition has already replaced.
                const acquiring = this.engine as {
                    getAcquisitionReceipt?: () => AcquisitionReceipt | null;
                    getAcquisitionAttempt?: () => AcquisitionAttempt | null;
                };
                const workerReceipt = acquiring.getAcquisitionReceipt?.() ?? null;
                const boundToThisLoad = receiptMatches(workerReceipt, acquiring.getAcquisitionAttempt?.() ?? null)
                    && workerReceipt?.candidateId === candidate?.id;

                // NEVER BLENDED. A receipt is one observation or the other. Merging a worker's byte count
                // with a main-window duration would produce a row that describes no single load, and
                // nothing downstream could tell it apart from a real one.
                const observed = boundToThisLoad && workerReceipt
                    ? workerReceipt
                    : observeAcquisitionNetwork(prefixes, loadStartedAt, undefined, {
                        // THE MAIN WINDOW'S TIMELINE IS THE PAGE'S, NOT THIS DOWNLOAD'S. Concurrent
                        // auth, history, analytics and image requests are certain during a
                        // main-thread acquisition, so unmatched entries say nothing about coverage.
                        // Coverage is proven positively instead, against the components the
                        // candidate declares.
                        timeline: 'shared',
                        expectedComponents: candidate?.assets.componentCount ?? null,
                        expectedComponentGroups: candidate ? acquisitionComponentGroupsFor(candidate) : [],
                    });
                recordAcquisitionSuccess(subject, {
                    cacheResult,
                    // Carried through, not recomputed: only the observer knows how much of the download
                    // it actually covered, and that judgement cannot be reconstructed downstream.
                    completeness: observed.completeness,
                    reasonCode: observed.reasonCode,
                    outOfScopeCount: observed.outOfScopeCount,
                    networkUsed: observed.networkUsed,
                    networkBytes: observed.networkBytes,
                    // OBSERVED OR NULL. This previously fell back to the registry's configured component
                    // count, which is expected inventory rather than a request anyone watched happen —
                    // so a load that observed nothing reported a full asset count and looked measured.
                    assetCount: observed.assetCount,
                    downloadMs: observed.downloadMs,
                    totalMs,
                });
            } else {
                recordAcquisitionFailure(subject, cacheResult, classifyAcquisitionError(outcome.error), totalMs);
            }
            return outcome;
        } catch (err) {
            recordAcquisitionFailure(subject, cacheResult, classifyAcquisitionError(err),
                Math.round(performance.now() - acquisitionStartedAt));
            throw err;
        }
    }

    /**
     * Why this load began. The two are different populations, and the field was previously a constant.
     *
     * It was declared and never assigned, so every acquisition — including a background warm-up that
     * found the model already cached and initialised it — reported `explicit-setup`. Warm-up loads are
     * exactly the cheap warm ones, so folding them into the explicit population made setup look faster
     * than the experience a user who presses "Set up Private" actually gets.
     */
    private acquisitionTrigger: AcquisitionTrigger = 'explicit-setup';

    /**
     * Set by the caller that knows WHY initialisation is happening.
     *
     * `TranscriptionService.initializeStrategy` holds that authority: an explicit init is a user act,
     * a background pulse is a warm-up. On a cache MISS the warm-up stops at DOWNLOAD_REQUIRED and never
     * acquires — but on a cache HIT it proceeds and initialises the model, which is a real acquisition
     * and the case this exists to label.
     */
    public setAcquisitionTrigger(trigger: AcquisitionTrigger): void {
        this.acquisitionTrigger = trigger;
    }
    /** Pinned assets for the selected candidate, filled from the registry before each load. */
    private acquisitionAssets: PinnedAssetRef[] = [];

    /**
     * The registry entry for the candidate about to load.
     *
     * Resolved from configuration, so it is available BEFORE initialisation and cannot report a model
     * the session did not select. Null only when selection itself failed, which is a state the events
     * are allowed to say plainly rather than paper over with a name.
     */
    private resolveAcquisitionCandidate(): Candidate | null {
        try {
            return this.resolvedSelection().candidate;
        } catch {
            return null;
        }
    }

    /** Identity of what is being acquired, from the RESOLVED candidate — never a name guess. */
    private acquisitionSubject(candidate: Candidate | null): AcquisitionSubject {
        const runtimeConfig = typeof window !== 'undefined' ? window.__APP_RUNTIME_CONFIG__ : undefined;
        if (!candidate) {
            return {
                candidateId: 'unresolved', modelIdentity: 'unresolved', assetPinDigest: null,
                releaseId: runtimeConfig?.release ?? null, trigger: this.acquisitionTrigger,
            };
        }
        return {
            candidateId: candidate.id,
            // The IMMUTABLE identity: repository plus pinned revision. A bare repo id is a moving target,
            // and two runs of "the same model" months apart would be indistinguishable.
            modelIdentity: `${candidate.model.id}@${candidate.model.revision ?? 'no-revision'}`,
            assetPinDigest: candidate.assets.pinDigest,
            releaseId: runtimeConfig?.release ?? null,
            trigger: this.acquisitionTrigger,
        };
    }

    private async initSelectedEngineInner(engineType: SelectedPrivateEngine, timeoutMs?: number, isMock?: boolean, generation: number = this.lifecycleGeneration): Promise<Result<EngineType, Error>> {
        if (engineType === 'mock') {
            const factory = getEngine('mock');
            if (factory) {
                const engine = factory(this.options as TranscriptionModeOptions);
                validateEngine(engine);
                const result = await engine.init(timeoutMs, isMock);
                if (result.isOk) {
                    const adopted = await this.adoptEngine(engine as unknown as IPrivateSTTEngine, generation);
                    if (!adopted.isOk) return { isOk: false, error: adopted.error };
                    // #1635: a teardown in the post-adoption window owns the engine now; nothing is published for it.
                    if (this.acquisitionCancelled(generation)) return { isOk: false, error: this.cancelledInitError(false) };
                    this._engineType = 'mock';
                    return Result.ok('mock' as EngineType);
                }
                return { isOk: false, error: result.error };
            }
            return { isOk: false, error: new Error('Mock engine requested but not registered in STTRegistry') };
        }
        if (engineType === 'transformers-js') return this.initSafeEngine(timeoutMs, isMock, generation);
        if (engineType === 'transformers-js-v4') return this.initV4Engine(timeoutMs, isMock, generation);
        if (engineType === 'moonshine-streaming' || engineType === 'granite-ctc' || engineType === 'parakeet-tdt') {
            return this.initDescriptorEngine(engineType, timeoutMs, isMock, generation);
        }
        return { isOk: false as const, error: new Error(`Unknown private provider: ${engineType}`) };
    }

    /**
     * Initialize an explicitly selected adapter without substitution. The frozen descriptor supplies
     * its load profile; only successful initialization may adopt and publish the engine.
     */
    private async initDescriptorEngine(kind: 'moonshine-streaming' | 'granite-ctc' | 'parakeet-tdt', timeoutMs?: number, isMock?: boolean, generation: number = this.lifecycleGeneration): Promise<Result<EngineType, Error>> {
        const options = this.options as TranscriptionModeOptions;
        let engine: IPrivateSTTEngine | undefined;
        let lifetime: EngineLifetime | undefined;
        try {
            const candidate = this.resolvedSelection().candidate;
            if (candidate.engine !== kind) {
                return { isOk: false, error: new Error(`${kind} requested but config names ${candidate.id}`) };
            }
            const arch = candidate.execution.modelArch;
            if (kind === 'moonshine-streaming' && !arch) {
                // Absent, never guessed: an unmapped Moonshine candidate would otherwise load whichever
                // arch happened to be first and report the configured id over it.
                return { isOk: false, error: new Error(`no Moonshine arch registered for ${candidate.id}`) };
            }

            // Registry lookup first, so tests drive the real facade without a 318 MB download.
            engine = await constructPrivateEngine(kind, candidate, options);
            if (this.acquisitionCancelled(generation)) {
                const current = this.engineReleases.get(engine);
                if (current && current.generation > generation) return { isOk: false, error: this.cancelledInitError(false) };
                const failure = await this.releaseEngine(engine);
                return { isOk: false, error: failure ?? this.cancelledInitError(true) };
            }
            lifetime = this.beginEngineAcquisition(engine, generation);

            validateEngine(engine as unknown as IPrivateSTTEngine);
            assertEngineCanDecode(engine, kind);
            const result = await (engine as unknown as IPrivateSTTEngine).init(timeoutMs, isMock);
            if (result && typeof result === 'object' && 'isOk' in result && result.isOk === false) {
                const releaseFailure = await this.releaseEngine(engine, lifetime);
                if (releaseFailure) return { isOk: false, error: new Error(
                    `${result.error.message}; releasing ${kind} failed (release uncertain): ${releaseFailure.message}`,
                ) };
                return { isOk: false, error: (result as { error: Error }).error };
            }
            const adopted = await this.adoptEngine(engine as unknown as IPrivateSTTEngine, generation, lifetime);
            if (!adopted.isOk) return { isOk: false, error: adopted.error };
            // #1635: a teardown in the post-adoption window owns the engine now; nothing is published for it.
            if (this.acquisitionCancelled(generation)) return { isOk: false, error: this.cancelledInitError(false) };
            this._engineType = kind;
            // Recorded only after a successful init, and recorded as the ARCH that was actually loaded
            // rather than the candidate that was requested, so metadata cannot describe a model the
            // session never ran.
            if (kind === 'moonshine-streaming' && arch) this.moonshineArch = arch;
            return { isOk: true, data: kind };
        } catch (error) {
            if (engine) {
                const failure = await this.releaseEngine(engine, lifetime);
                if (failure) return { isOk: false, error: new Error(`Descriptor init failed; release uncertain: ${failure.message}`) };
            }
            return { isOk: false, error: error instanceof Error ? error : new Error(String(error)) };
        } finally {
            if (engine && this.engineReleases.get(engine) === lifetime) this.acquiringEngines.delete(engine);
        }
    }

    /**
     * Initialize the safe (transformers-js) engine
     */
    private async initSafeEngine(timeoutMs?: number, isMock?: boolean, generation: number = this.lifecycleGeneration): Promise<Result<EngineType, Error>> {
        return this.initWhisperEngine('transformers-js', timeoutMs, isMock, generation);
    }

    private async initV4Engine(timeoutMs?: number, isMock?: boolean, generation: number = this.lifecycleGeneration): Promise<Result<EngineType, Error>> {
        return this.initWhisperEngine('transformers-js-v4', timeoutMs, isMock, generation);
    }

    private async initWhisperEngine(
        kind: 'transformers-js' | 'transformers-js-v4', timeoutMs: number | undefined,
        isMock: boolean | undefined, generation: number,
    ): Promise<Result<EngineType, Error>> {
        const candidate = this.resolvedSelection().candidate;
        const options: TranscriptionModeOptions & { resolvedCandidate: Candidate } = { ...(this.options as TranscriptionModeOptions), resolvedCandidate: candidate,
            ...(kind === 'transformers-js-v4'
                ? { v4Variant: this.runtimePath?.v4Variant ?? PRIV_STT_V4_DEFAULT_VARIANT } : {}),
        };
        let engine: IPrivateSTTEngine | undefined;
        let lifetime: EngineLifetime | undefined;
        try {
            engine = await constructPrivateEngine(kind, candidate, options);
            if (this.acquisitionCancelled(generation)) {
                const current = this.engineReleases.get(engine);
                if (current && current.generation > generation) return { isOk: false, error: this.cancelledInitError(false) };
                const failure = await this.releaseEngine(engine);
                return { isOk: false, error: failure
                    ? new Error(`Whisper init cancelled; release uncertain: ${failure.message}`)
                    : this.cancelledInitError(true) };
            }
            // Teardown must reach a child whose worker is still loading, before adoption.
            lifetime = this.beginEngineAcquisition(engine, generation);
            const result = await engine.init(timeoutMs, isMock);
            if (result && result.isOk === false) {
                const failure = await this.releaseEngine(engine, lifetime);
                return { isOk: false, error: failure
                    ? new Error(`${result.error.message}; releasing ${kind} failed (release uncertain): ${failure.message}`)
                    : result.error };
            }
            const adopted = await this.adoptEngine(engine, generation, lifetime);
            if (!adopted.isOk) return { isOk: false, error: adopted.error };
            if (this.acquisitionCancelled(generation)) return { isOk: false, error: this.cancelledInitError(false) };
            this._engineType = kind;
            return { isOk: true, data: kind };
        } catch (error) {
            if (engine) {
                const failure = await this.releaseEngine(engine, lifetime);
                if (failure) return { isOk: false, error: new Error(
                    `Whisper init failed: ${error instanceof Error ? error.message : String(error)}; release uncertain: ${failure.message}`,
                ) };
            }
            return { isOk: false, error: error instanceof Error ? error : new Error(String(error)) };
        } finally {
            if (engine && this.engineReleases.get(engine) === lifetime) this.acquiringEngines.delete(engine);
        }
    }

    public async getTranscript(): Promise<string> {
        return this.engine ? await (this.engine as unknown as { getTranscript: () => Promise<string> }).getTranscript() : '';
    }

    public getLastHeartbeatTimestamp(): number {
        return this.engine ? this.engine.getLastHeartbeatTimestamp() : Date.now();
    }

    async terminate(): Promise<void> {
        // #1635: invalidate at ENTRY, before the awaited child terminate, so an init settling meanwhile is
        // cancelled and releases its engine instead of adopting it.
        if (!this.beginTermination()) return this.awaitTeardown();
        logger.info({ type: this.type, instanceId: this.instanceId }, `[STTEngine] 🛑 Nuclear termination requested for ${this.type}`);

        // #1476: a failed engine termination is reported, not swallowed — callers must not read it as "engine off".
        // Cleanup still completes first; every caller (TranscriptionService destroy/reset/mode switch) handles the throw.
        // #1635: the whole teardown is THE teardown in progress, so a fresh init waits for it and this teardown
        // can only ever act on the engine it detached here.
        // The child failure is raised INSIDE the shared teardown, so its promise itself rejects: every concurrent
        // or later terminate/destroy waiter sees the same failure, never a success for the same failed release.
        await this.runTeardown(async () => {
            // onDestroy detaches active and acquiring children synchronously, then awaits all releases.
            await this.onDestroy();
            await this.stop();
        });
    }
}

export function createPrivateSTT(options: Partial<PrivateSTTInitOptions> = {}): PrivateSTT {
    return new PrivateSTT(options);
}
