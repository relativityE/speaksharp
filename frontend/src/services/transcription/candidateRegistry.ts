/**
 * #1263 — THE TYPED BOOT-TIME CANDIDATE REGISTRY.
 *
 * One place that answers "which Private STT model is running, and what exactly is it?" — replacing a
 * selection surface that was spread across two URL parameter families, three localStorage keys, a
 * variant constant, an experiment assigner and two flag modules.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. `PrivateSTT.getMetadata()` built its identity from
 * `PRIV_STT_V4_DEFAULT_VARIANT` — a DEFAULT — rather than from what resolved and ran, so a human A/B of
 * `base_int8` was recorded as `base_q4`. No amount of careful test procedure catches that: the identity
 * was fabricated after the fact instead of carried from the decision. The registry makes the selection
 * and the identity the SAME object, so they cannot disagree.
 *
 * CONFIGURED IS NOT OBSERVED. Everything here is a build/configuration fact: checked in, reviewable in a
 * diff, and verified against the lockfile and the committed pin table by `candidateRegistry.test.ts`.
 * None of it is introspected from a runtime, and it must never be described as though it were — the
 * Moonshine runtime exposes no version or model id at all, which is exactly why configured provenance
 * has to carry the identity. Observed execution facts (init success, first decode, resolved backend)
 * are recorded SEPARATELY by the engine and must never be merged into these fields.
 */

/** The candidates the product knows about. An id outside this union does not exist. */
export type CandidateId =
    | 'v2:base.en'
    | 'v4:base:int8'
    | 'v4:base:q4'
    | 'v4:distil:q4'
    | 'moonshine:streaming-medium';

export type EngineKind = 'transformers-js' | 'transformers-js-v4' | 'moonshine-streaming';

export interface ConfiguredRuntime {
    /** npm package that executes the model. */
    package: string;
    /** EXACT locked version, asserted against the installed tree by test — never a semver range. */
    version: string;
}

export interface ConfiguredModel {
    /** Repository/catalog id of the weights. */
    id: string;
    /**
     * Immutable revision of those weights. `null` ONLY where the source publishes no revision concept;
     * it is not a placeholder for "we did not look".
     */
    revision: string | null;
    dtype: Readonly<Record<string, string>> | null;
    device: string | null;
    sampleRateHz: number;
}

export interface ConfiguredAssets {
    /**
     * SHA-256 over the sorted `path:sha256` lines of this candidate's committed component pins, so one
     * value identifies the whole set. `null` where the assets are not pin-tracked. Recomputed from the
     * pin table by test, so an edited pin table fails CI rather than silently re-identifying a model.
     */
    pinDigest: string | null;
    /** Where those pins live, so a reviewer can recompute the digest rather than trust it. */
    pinSource: string | null;
    componentCount: number | null;
    /** Total bytes of the set the digest covers, where the set is a complete on-disk inventory. */
    totalBytes?: number | null;
    /** Where the bytes come from: an upstream pin table, or files this product ships. */
    provenance?: 'upstream_pins' | 'self_hosted';
    /** Why there is no digest, when there is none. Never left unexplained. */
    pinNote?: string | null;
}

/**
 * Whether this candidate can execute in the BROWSER — the only backend the product ships.
 * A candidate can be real, measured, accurate and still unusable here.
 */
export interface BrowserExecutability {
    ok: boolean;
    /** Required when `ok` is false: the recorded reason, not a guess. */
    reason?: string;
}

export interface Candidate {
    id: CandidateId;
    /**
     * Whether this candidate may actually be RUN. Registering a candidate describes it; it does not
     * make it shippable. Moonshine is registered and NOT activation-ready until its windowed E/F
     * validation passes, because its live path was written against the non-streaming API.
     */
    activationReady: boolean;
    /** Required when activationReady is false: what is outstanding. Never left unexplained. */
    notReadyReason?: string;
    engine: EngineKind;
    runtime: ConfiguredRuntime;
    model: ConfiguredModel;
    assets: ConfiguredAssets;
    browser: BrowserExecutability;
}

const WHISPER_BASE = 'onnx-community/whisper-base.en';

/** Object.freeze is SHALLOW: without this, `CANDIDATES[id].runtime.version = 'x'` silently succeeds. */
function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    }
    return value;
}

export const CANDIDATES: Readonly<Record<CandidateId, Candidate>> = deepFreeze({
    'v2:base.en': {
        id: 'v2:base.en',
        activationReady: true,
        engine: 'transformers-js',
        runtime: { package: '@xenova/transformers', version: '2.17.2' },
        model: {
            id: 'Xenova/whisper-base.en',
            revision: null,
            dtype: null,
            device: null,
            sampleRateHz: 16_000,
        },
        assets: {
            // THE SHIPPING DEFAULT IS SELF-HOSTED, so its identity comes from the bytes we actually
            // ship, not from an upstream pin table. An earlier version of this entry recorded "no pins
            // exist" and treated v2 as permanently unattributable; that was looking in the wrong place.
            // `frontend/public/models/whisper-base.en/` IS the model, and hashing it is exact.
            //
            // Digest = sha256 over sorted `relpath:sha256` lines across the complete file set, the same
            // construction used for the pinned candidates, so the values are comparable.
            pinDigest: 'c7eaa6a9f8ccacbdafce2092d8e03752e2540acf0d4d87b01aebb05f6ba1d110',
            pinSource: 'frontend/public/models/whisper-base.en',
            componentCount: 12,
            totalBytes: 80_553_222,
            provenance: 'self_hosted',
            pinNote: null,
        },
        browser: { ok: true },
    },
    'v4:base:q4': {
        id: 'v4:base:q4',
        activationReady: false,
        notReadyReason:
            'benchmark control only. It is a measured arm and a valid ATTRIBUTION target, but it is not one of the three candidates under product comparison, so a build may not ship it as the default',
        engine: 'transformers-js-v4',
        runtime: { package: '@huggingface/transformers', version: '4.2.0' },
        model: {
            id: WHISPER_BASE,
            revision: null,
            dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
            device: null,
            sampleRateHz: 16_000,
        },
        assets: {
            pinDigest: '19e79a9e383779a6763c9e766ccd4e3067d5481d6468164c4b86147ddb356644',
            provenance: 'upstream_pins',
            pinSource: 'tests/fixtures/hf-asset-pins.json',
            componentCount: 7,
            pinNote: null,
        },
        browser: { ok: true },
    },
    'v4:base:int8': {
        id: 'v4:base:int8',
        activationReady: false,
        notReadyReason:
            'benchmark control only, and PRIV_STT_V4_VARIANTS registers no int8 runtime variant, so the engine cannot load it at all. Selecting it could only ever run a different model under this id',
        engine: 'transformers-js-v4',
        runtime: { package: '@huggingface/transformers', version: '4.2.0' },
        model: {
            id: WHISPER_BASE,
            revision: null,
            dtype: { encoder_model: 'fp32', decoder_model_merged: 'int8' },
            device: null,
            sampleRateHz: 16_000,
        },
        assets: {
            pinDigest: '14e12c137a55be0d2e49de2d7f1330518e88de652eded865b762143f2d96251c',
            provenance: 'upstream_pins',
            pinSource: 'tests/fixtures/hf-asset-pins.json',
            componentCount: 7,
            pinNote: null,
        },
        // CORRECTED. An earlier version of this entry marked int8 browser-unusable, citing the arm
        // registry's note that ONNX Runtime Web refused to create a session for this decoder. That note
        // is STALE, and a source comment is not evidence: the r9 preflight ran this candidate at
        // `executionBackend: "browser_wasm"` with `backendProven: true` and 23/23 decoded, every
        // reliability counter zero, and the earlier targeted run decoded 600/600. A run beats a comment.
        browser: { ok: true },
    },
    /**
     * NOT one of the four finalists — registered because the SHIPPING resolver can still select it
     * (WebGPU + the distil flag). A candidate the product can run but the registry cannot describe would
     * recreate the exact defect this registry closes: a session with no attributable model. It is
     * registered so it is always identifiable, never so it is preferred.
     */
    'v4:distil:q4': {
        id: 'v4:distil:q4',
        activationReady: false,
        notReadyReason:
            'no qualification evidence exists for this candidate on the product path. It is selectable '
            + 'for internal comparison via acknowledgeNotProductionReady, and becomes eligible as a '
            + 'public default only once a human comparison has actually been run against it',
        engine: 'transformers-js-v4',
        runtime: { package: '@huggingface/transformers', version: '4.2.0' },
        model: {
            id: 'onnx-community/distil-small.en',
            revision: null,
            dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
            // WebGPU-ONLY: WASM RTF ~2.2 is unusable, so it is never a universal default.
            device: 'webgpu',
            sampleRateHz: 16_000,
        },
        assets: {
            pinDigest: 'b5e113f824bd8db270210d4c90ac779d2914c705bc692a9376b7cb89dbde042e',
            provenance: 'upstream_pins',
            pinSource: 'tests/fixtures/hf-asset-pins.json',
            componentCount: 7,
            pinNote: null,
        },
        browser: { ok: true },
    },
    'moonshine:streaming-medium': {
        id: 'moonshine:streaming-medium',
        activationReady: false,
        notReadyReason: 'windowed E/F validation of the live session path has not passed; the engine\'s '
            + 'live decode was written against the non-streaming whole-buffer API',
        engine: 'moonshine-streaming',
        runtime: { package: '@moonshine-ai/moonshine-wasm', version: '0.1.5' },
        model: {
            id: 'medium-streaming-en',
            revision: 'quantized_26_07_30',
            dtype: null,
            device: 'wasm',
            sampleRateHz: 16_000,
        },
        assets: {
            pinDigest: '898305d7768356a7f56002a4b2c4e55dd0534a6fd1ae11b0aadc0d11d2a27891',
            provenance: 'upstream_pins',
            pinSource: 'frontend/src/services/transcription/moonshineAssetPins.json',
            componentCount: 7,
            // The HONEST MAXIMUM this candidate may pull over the network, summed from the seven pinned
            // components. It is not an estimate and not a typical case: consent copy quotes it as an
            // upper bound, so understating it would make the consent meaningless. Bound to the pin table
            // by test, so re-pinning to larger assets fails CI instead of silently enlarging a download
            // the user already consented to.
            totalBytes: 304_690_919,
            pinNote: null,
        },
        browser: { ok: true },
    },
});

export const CANDIDATE_IDS = Object.freeze(Object.keys(CANDIDATES) as CandidateId[]);

export class UnknownCandidateError extends Error {}

/**
 * Map RESOLVED runtime state onto a candidate id.
 *
 * `PrivateSTT.getMetadata()` previously answered "which model ran?" with
 * `PRIV_STT_V4_DEFAULT_VARIANT` — a constant — so a session running `base_int8` was recorded as
 * `base_q4`. The resolved variant was available the whole time on the runtime decision; it simply was
 * not consulted. This maps what ACTUALLY resolved, and refuses combinations it does not recognise
 * rather than falling back to a default, because a wrong identity is worse than a missing one.
 */
export interface ResolvedRuntimeState {
    engineType: string | null | undefined;
    /** The v4 variant the resolver chose, e.g. `base_q4` / `distil_q4`. */
    variant?: string | null;
    /** Decoder precision actually configured for this run — `q4`, `int8`, `fp32`. */
    decoderDtype?: string | null;
    device?: string | null;
}

/**
 * Map RESOLVED runtime state onto a candidate id.
 *
 * DECODER PRECISION IS PART OF THE IDENTITY. An earlier version keyed only on `variant`, so
 * `base_q4` and `base_int8` — the same repo and the same encoder, differing only in decoder precision —
 * collapsed onto `v4:base:q4` or fell through unrecognised. That is exactly the mis-attribution this
 * registry exists to prevent, and it would have made an int8 human test untrustworthy in the same way
 * the original `PRIV_STT_V4_DEFAULT_VARIANT` bug did.
 *
 * Unrecognised combinations are REFUSED rather than defaulted.
 */
export function candidateForRuntime(state: ResolvedRuntimeState): CandidateId {
    const { engineType, variant, decoderDtype } = state;
    if (engineType === 'transformers-js') return 'v2:base.en';
    if (engineType === 'transformers-js-v4') {
        const base = variant === 'base_q4' || variant === 'base_int8' || variant?.startsWith('base');
        if (variant === 'distil_q4') return 'v4:distil:q4';
        if (base) {
            // Prefer the explicitly resolved dtype; fall back to the dtype implied by the variant name.
            const dtype = decoderDtype ?? (variant === 'base_int8' ? 'int8' : variant === 'base_q4' ? 'q4' : null);
            if (dtype === 'q4') return 'v4:base:q4';
            if (dtype === 'int8') return 'v4:base:int8';
            throw new UnknownCandidateError(
                `v4 base resolved decoder precision ${JSON.stringify(dtype)}; `
                + 'refusing to attribute the session to a default precision',
            );
        }
        throw new UnknownCandidateError(
            `v4 engine resolved an unrecognised variant ${JSON.stringify(variant)}; `
            + 'refusing to attribute the session to a default',
        );
    }
    if (engineType === 'moonshine-streaming') {
        // KEYED ON THE ARCH, NOT THE PROVIDER. Only the medium arch is registered today, so mapping the
        // provider straight to `moonshine:streaming-medium` would look correct and stay correct until
        // the moment someone runs SmallStreaming — at which point every small session would be recorded,
        // and compared, as medium. The provider says which machinery ran; only the arch says which model
        // did, and it is the model the human test is choosing between.
        if (variant === 'MOONSHINE_STREAMING_MEDIUM') return 'moonshine:streaming-medium';
        throw new UnknownCandidateError(
            `moonshine engine resolved arch ${JSON.stringify(variant)}, which no registered candidate `
            + 'describes; refusing to attribute the session to the one arch that happens to be registered',
        );
    }
    throw new UnknownCandidateError(
        `no candidate maps to engine type ${JSON.stringify(engineType)}`,
    );
}

/**
 * The identity a completed session records. `configured` is provenance; `observed` is what the run
 * actually did. They are separate objects on purpose — merging them is how a default becomes evidence.
 */
export interface SessionModelIdentity {
    candidateId: CandidateId;
    engine: EngineKind;
    configuredRuntime: ConfiguredRuntime;
    configuredModel: ConfiguredModel;
    configuredAssets: ConfiguredAssets;
}

export function identityOf(candidate: Candidate): SessionModelIdentity {
    return {
        candidateId: candidate.id,
        engine: candidate.engine,
        configuredRuntime: { ...candidate.runtime },
        configuredModel: { ...candidate.model },
        configuredAssets: { ...candidate.assets },
    };
}

/**
 * TWO SEPARATE STATES, deliberately.
 *
 * `identityComplete` — the session can say WHICH model was configured to run.
 * `assetsVerified`   — the exact loaded BYTES are digested and reconcilable.
 *
 * Collapsing them is what made v2 look unattributable: it has complete identity and, now that its
 * self-hosted files are digested, verified assets too. Qualification-grade human testing requires BOTH;
 * ordinary operation requires only the first, so a candidate without an asset digest can still run
 * while being excluded from qualification evidence.
 */
export function assetsVerified(identity: SessionModelIdentity | null | undefined): boolean {
    const a = identity?.configuredAssets;
    return Boolean(a?.pinDigest && a?.pinSource && a?.componentCount);
}

/** True only when identity is complete AND the loaded bytes are digested. */
export function isQualificationGrade(identity: SessionModelIdentity | null | undefined): boolean {
    return isCompleteIdentity(identity) && assetsVerified(identity);
}

/** Complete = every field a session needs to be attributable. Incomplete identity must fail init. */
export function isCompleteIdentity(identity: SessionModelIdentity | null | undefined): boolean {
    if (!identity) return false;
    const { configuredRuntime: r, configuredModel: m } = identity;
    return Boolean(
        identity.candidateId && identity.engine
        && r?.package && r?.version
        && m?.id && typeof m?.sampleRateHz === 'number' && m.sampleRateHz > 0,
    );
}
