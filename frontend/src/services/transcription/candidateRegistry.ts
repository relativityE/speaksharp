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
    engine: EngineKind;
    runtime: ConfiguredRuntime;
    model: ConfiguredModel;
    assets: ConfiguredAssets;
    browser: BrowserExecutability;
}

const WHISPER_BASE = 'onnx-community/whisper-base.en';

export const CANDIDATES: Readonly<Record<CandidateId, Candidate>> = Object.freeze({
    'v2:base.en': {
        id: 'v2:base.en',
        engine: 'transformers-js',
        runtime: { package: '@xenova/transformers', version: '2.17.2' },
        model: {
            id: 'Xenova/whisper-base.en',
            revision: null,
            dtype: null,
            device: null,
            sampleRateHz: 16_000,
        },
        assets: { pinDigest: null, pinSource: null, componentCount: null },
        browser: { ok: true },
    },
    'v4:base:q4': {
        id: 'v4:base:q4',
        engine: 'transformers-js-v4',
        runtime: { package: '@huggingface/transformers', version: '4.2.0' },
        model: {
            id: WHISPER_BASE,
            revision: null,
            dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
            device: null,
            sampleRateHz: 16_000,
        },
        assets: { pinDigest: null, pinSource: null, componentCount: null },
        browser: { ok: true },
    },
    'v4:base:int8': {
        id: 'v4:base:int8',
        engine: 'transformers-js-v4',
        runtime: { package: '@huggingface/transformers', version: '4.2.0' },
        model: {
            id: WHISPER_BASE,
            revision: null,
            dtype: { encoder_model: 'fp32', decoder_model_merged: 'int8' },
            device: null,
            sampleRateHz: 16_000,
        },
        assets: { pinDigest: null, pinSource: null, componentCount: null },
        // RECORDED FROM A RUN, not assumed. ONNX Runtime WEB refuses to create a session for this
        // decoder — `qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits, Missing required scale:
        // model.decoder.embed_tokens.weight_merged_0_scale` — so it scores only under
        // onnxruntime-node. It is registered because it is a real measured candidate; it is marked
        // unusable because the browser is the backend the product ships.
        browser: {
            ok: false,
            reason: 'ONNX Runtime Web cannot create a session for the int8 decoder '
                + '(TransposeDQWeightsForMatMulNBits: missing scale for '
                + 'model.decoder.embed_tokens.weight_merged_0_scale); node-lane only',
        },
    },
    'moonshine:streaming-medium': {
        id: 'moonshine:streaming-medium',
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
            pinSource: 'tests/fixtures/moonshine-asset-pins.json',
            componentCount: 7,
        },
        browser: { ok: true },
    },
});

export const CANDIDATE_IDS = Object.freeze(Object.keys(CANDIDATES) as CandidateId[]);

/**
 * THE SOLE CANDIDATE SELECTOR: one checked-in, build-time value.
 *
 * Not a URL parameter, not localStorage, not a flag. Changing which model users get is a reviewable
 * commit, because "which model is in production" is a release decision and must appear in a diff.
 *
 * Stays `v2:base.en` until the Product Owner rules on the frozen-600 selection. Registering a candidate
 * does NOT activate it.
 */
export const PRIVATE_STT_MODEL_IN_USE: CandidateId = 'v2:base.en';

export class UnknownCandidateError extends Error {}
export class UnusableCandidateError extends Error {}

/**
 * Resolve a candidate id to its full identity, FAILING CLOSED.
 *
 * Two refusals, not one. An unknown id is obvious; a KNOWN id that cannot execute in the browser is the
 * one that would otherwise be discovered at a user's first session, after the download.
 */
export function resolveCandidate(id: string): Candidate {
    const candidate = (CANDIDATES as Record<string, Candidate | undefined>)[id];
    if (!candidate) {
        throw new UnknownCandidateError(
            `unknown Private STT candidate "${id}"; registered: ${CANDIDATE_IDS.join(', ')}`,
        );
    }
    if (!candidate.browser.ok) {
        throw new UnusableCandidateError(
            `Private STT candidate "${id}" cannot execute in the browser: ${candidate.browser.reason}`,
        );
    }
    return candidate;
}

/** The candidate this build runs. Throws at boot rather than at a user's first session. */
export function activeCandidate(): Candidate {
    return resolveCandidate(PRIVATE_STT_MODEL_IN_USE);
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
