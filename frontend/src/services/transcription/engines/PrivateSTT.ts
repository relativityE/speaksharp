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
import { STTEngine, validateEngine, assertEngineCanDecode } from '@/contracts/STTEngine';
import { PrivateSTTInitOptions } from '@/contracts/IPrivateSTT';
import logger from '@/lib/logger';
import posthog from 'posthog-js';
import { ModelManager } from '@/services/transcription/ModelManager';
import { MicStream } from '@/services/transcription/utils/types';
import { getEngine } from '@/services/transcription/STTRegistry';
import { PRIV_STT_V4, PRIV_STT_V4_DEFAULT_VARIANT, PRIV_STT_V4_VARIANTS } from '../sttConstants';
import {
    CANDIDATES, candidateForRuntime, identityOf,
    type CandidateId, type SessionModelIdentity,
} from '../candidateRegistry';
import { recordResolvedEngine } from '@/services/telemetry/runtimeAttribution';
import { effectiveCandidate, assertDeviceAvailable, v4VariantFor } from '../candidateSelection';
import { consentCopy, consentDecision, consentTermsFor, readReceipt, recordConsent, reducedDataRequested } from '../modelConsent';
import type { MoonshineArch, MoonshineCandidateId } from './MoonshineStreamingEngine';
import { MOONSHINE_ARCH_BY_CANDIDATE } from './MoonshineStreamingEngine';
import { runtimeCandidateOverride } from '../runtimeCandidateSwitch';
import { captureCapabilities } from '../capabilitySnapshot';
import { getDefaultProviderForMode, getProviderIdsForMode } from '../providers/sttProviderConfig';
import type { PrivateSttProvider } from '../providers/types';
import { resolvePrivateRuntimePath, type PrivateRuntimeDecision } from '../utils/privateRuntimePath';
import { buildV4LifecycleProps, emitV4Ready, emitV4Fallback, emitV4Error } from '../privateV4Telemetry';
import { buildEngineVersion, type EngineVariant } from '../privateTelemetry';
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
        try {
            const candidate = effectiveCandidate().candidate;
            recordConsent(consentTermsFor(candidate), new Date().toISOString());
        } catch {
            // A candidate we cannot resolve is one we cannot describe to the user, so there is nothing
            // honest to record. The next availability check will ask again.
        }
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
        const variant: EngineVariant = isV4
            ? 'private_v4'
            : isMoonshine ? 'private_moonshine' : 'private_v2';

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
            candidateId = candidateForRuntime({
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
            modelIdentity = identityOf(CANDIDATES[candidateId]);
        } catch {
            // An unrecognised combination is left ABSENT, never defaulted. A row with no identity is
            // honestly unattributable; a row carrying a guessed identity is evidence for a claim that
            // was never measured. Legacy fields below still describe the arm.
        }

        // Moonshine's model name comes from the registry entry the arch resolved to, never from a
        // constant: a hardcoded name here is the same defect as `PRIV_STT_V4_DEFAULT_VARIANT` was.
        const model = isV4
            ? (resolvedVariant ?? PRIV_STT_V4_DEFAULT_VARIANT)
            : isMoonshine ? (modelIdentity?.configuredModel.id ?? 'unknown')
                : 'whisper-base.en';
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

        const primary = await this.initSelectedEngine(autoEngine, timeoutMs, isMock);
        if (primary.isOk) {
            this.emitV4FlagTelemetry(null, Math.round(performance.now() - initStart));
            return Result.ok(undefined);
        }

        if (autoEngine === 'transformers-js-v4' && !explicitlySelected) {
            logger.warn({ sId: this.serviceId, rId: this.runId, error: (primary as { error?: Error }).error }, '[PrivateSTT] v4 init failed; falling back to v2-base');
            const fallback = await this.initSafeEngine(timeoutMs, isMock);
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
        const { candidate, fallbackCause } = effectiveCandidate();

        // A candidate that REQUIRES an accelerator is refused HERE, visibly, rather than being quietly
        // downgraded to WASM further down. A slow run recorded under the same candidate id would be
        // evidence for a configuration nobody measured.
        // ONE READING, USED BY BOTH DECISIONS. This called `isWebGPUSupported()` while the resolver
        // below independently called `detectWebGPUSupport()`. Two async probes, nothing comparing them:
        // when they disagreed the gate admitted a WebGPU-only candidate and the resolver quietly
        // returned the v2 floor, so the session ran Whisper while the switch reported success for the
        // model that was asked for. The snapshot is taken once here and threaded onward.
        const capabilities = await captureCapabilities();
        if (candidate.model.device === 'webgpu') {
            assertDeviceAvailable(candidate, capabilities.webgpuAvailable);
        }

        // MOONSHINE SHORT-CIRCUITS THE v4 RESOLVER. That resolver reasons about WebGPU promotion and
        // v4 variants, neither of which describes Moonshine; routing it through would force a v4-shaped
        // decision onto an engine that is not one, and the recorded provenance would describe the wrong
        // machinery. Its runtime decision is stated directly instead.
        if (candidate.engine === 'moonshine-streaming') {
            const decision: PrivateRuntimeDecision = {
                runtime: 'wasm-singlethread',
                provider: 'moonshine-streaming',
                v4Variant: null,
                acceleration: 'cpu',
                reason: 'no_webgpu_or_isolation',
                selectionSource: fallbackCause ? 'remote_safety_kill' : (runtimeCandidateOverride() ? 'runtime_switch' : 'config'),
                webgpuAvailable: false,
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
            }, '[PrivateSTT] Resolved Moonshine runtime decision from config');
            return 'moonshine-streaming';
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
                    allowWithoutWebGPU: candidate.model.device !== 'webgpu',
                    distilEnabled: false,
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
            : await this.engine.transcribe(audio);

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
        const selected = (() => {
            try { return effectiveCandidate().candidate; } catch { return null; }
        })();
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
        if (selected?.engine === 'moonshine-streaming') {
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
            selectedVariant?.MODEL_ID ?? PRIV_STT_V4.MODEL_ID,
        );

        if (!isDownloaded) {
            const sizeMB = preferredEngine === 'transformers-js-v4'
                ? (selectedVariant?.EXPECTED_SPLIT_DOWNLOAD_MB ?? PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB)
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


    /**
     * PUBLISH THE OBSERVED IDENTITY ONLY ONCE AN ENGINE EXISTS.
     *
     * This used to be published at RESOLUTION, before initialisation, while `_engineType` still held
     * the previous value or none. An observer could then read a model identity for an engine that had
     * not been built — and after a switch, the app could reach READY reporting either the OUTGOING
     * model or nothing at all. `observed` must mean "this is running", so it is written here, after a
     * successful init, and stays null until then.
     */
    private async initSelectedEngine(engineType: SelectedPrivateEngine, timeoutMs?: number, isMock?: boolean): Promise<Result<EngineType, Error>> {
        const outcome = await this.initSelectedEngineInner(engineType, timeoutMs, isMock);
        if (outcome.isOk) this.publishResolvedIdentity();
        return outcome;
    }

    private async initSelectedEngineInner(engineType: SelectedPrivateEngine, timeoutMs?: number, isMock?: boolean): Promise<Result<EngineType, Error>> {
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
        if (engineType === 'moonshine-streaming') return this.initMoonshineEngine(timeoutMs, isMock);
        return { isOk: false as const, error: new Error(`Unknown private provider: ${engineType}`) };
    }

    /**
     * Initialize the Moonshine streaming engine.
     *
     * NO SUBSTITUTION, by the same rule as v4: Moonshine is only ever reached because the config or an
     * internal switch named it, so a failure here is surfaced rather than quietly becoming v2. A
     * comparison recording that silently ran a different model is worse than a missing one.
     *
     * The arch is derived from the CANDIDATE ID rather than passed in, so the running weights and the
     * reported identity cannot disagree.
     */
    private async initMoonshineEngine(timeoutMs?: number, isMock?: boolean): Promise<Result<EngineType, Error>> {
        const options = this.options as TranscriptionModeOptions;
        try {
            const candidate = effectiveCandidate().candidate;
            if (candidate.engine !== 'moonshine-streaming') {
                return { isOk: false, error: new Error(`Moonshine requested but config names ${candidate.id}`) };
            }
            const arch = MOONSHINE_ARCH_BY_CANDIDATE[candidate.id as MoonshineCandidateId];
            if (!arch) {
                // Absent, never guessed: an unmapped Moonshine candidate would otherwise load whichever
                // arch happened to be first and report the configured id over it.
                return { isOk: false, error: new Error(`no Moonshine arch registered for ${candidate.id}`) };
            }

            // Registry lookup first, so tests drive the real facade without a 318 MB download.
            const factory = getEngine('moonshine-streaming');
            const engine = factory
                ? factory(options)
                : new (await import('./MoonshineStreamingEngine')).MoonshineStreamingEngine({
                    candidateId: candidate.id as MoonshineCandidateId,
                    modelArch: arch,
                    onDownloadProgress: (f) => options.onModelLoadProgress?.(Math.round(f * 100)),
                }) as unknown as IPrivateSTTEngine;

            validateEngine(engine as unknown as IPrivateSTTEngine);
            assertEngineCanDecode(engine, 'moonshine-streaming');
            const result = await (engine as unknown as IPrivateSTTEngine).init(timeoutMs, isMock);
            if (result && typeof result === 'object' && 'isOk' in result && result.isOk === false) {
                return { isOk: false, error: (result as { error: Error }).error };
            }
            this.engine = engine as unknown as IPrivateSTTEngine;
            this._engineType = 'moonshine-streaming';
            // Recorded only after a successful init, and recorded as the ARCH that was actually loaded
            // rather than the candidate that was requested, so metadata cannot describe a model the
            // session never ran.
            this.moonshineArch = arch;
            return { isOk: true, data: 'moonshine-streaming' as EngineType };
        } catch (error) {
            return { isOk: false, error: error instanceof Error ? error : new Error(String(error)) };
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
