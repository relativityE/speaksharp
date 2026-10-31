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
import selfHostedBasePins from './selfHostedAssetPins.json' with { type: 'json' };
import selfHostedTinyPins from './selfHostedTinyAssetPins.json' with { type: 'json' };
import granitePins from './engines/granite/assetPins.json' with { type: 'json' };
import parakeetPins from './engines/parakeet/assetPins.json' with { type: 'json' };
import type { ParakeetTdtProfile } from './engines/parakeet/contracts';
import type { ModelPackage } from './modelPackage';

/** IDs are validated package data, not an executable per-model union. */
export type CandidateId = string;

export type EngineKind = 'transformers-js' | 'transformers-js-v4' | 'moonshine-streaming' | 'granite-ctc' | 'parakeet-tdt';

export interface WhisperDecodeProfile {
    kind: 'whisper';
    windowSeconds: number;
    strideSeconds: number;
    returnTimestamps: boolean;
    language?: string;
    task?: 'transcribe' | 'translate';
    generation?: Readonly<Record<string, number | boolean>>;
}

export interface MoonshineDecodeProfile {
    kind: 'moonshine-streaming';
    streamingConfig: 'pinned-assets';
    finalization: 'force-update';
}

/** Serializable load settings; architecture algorithms belong to the engine adapter. */
export interface CandidateExecution {
    family: 'whisper' | 'moonshine-streaming' | 'granite-ctc' | 'parakeet-tdt';
    /** Compatibility token for existing runtime/telemetry consumers, not a second model catalogue. */
    variant: string | null;
    /** Registration and historical attribution do not establish an implemented loading path. */
    implemented: boolean;
    liveResultKind: 'incremental' | 'snapshot';
    preprocessing: {
        input: 'float32-pcm'; channels: 1; sampleRateHz: number;
        /** Feature extraction is implemented by the pinned runtime and preprocessing assets. */
        features: 'runtime';
    };
    decode: WhisperDecodeProfile | MoonshineDecodeProfile | ParakeetTdtProfile | { kind: 'granite-ctc'; modelFile: string; applyAgc: boolean };
    expectedDownloadMb?: number;
    /** Directory beneath the product's /models/ origin for local-only Whisper exports. */
    localModelId?: string;
    cacheFiles?: readonly string[];
    modelArch?: 'MOONSHINE_STREAMING_MEDIUM' | 'MOONSHINE_STREAMING_SMALL';
}

export interface ConfiguredRuntime {
    /** Pinned browser assets execute outside the installed npm tree. */
    distribution?: 'npm' | 'pinned-assets';
    /** npm package that executes the model. */
    package: string;
    /** EXACT locked version, asserted against the installed tree by test — never a semver range. */
    version: string;
    /** Publication provenance and exact companion runtimes, not observed execution evidence. */
    integrity?: string;
    dependencies?: Readonly<Record<string, string>>;
}

export interface ConfiguredModel {
    /** Repository/catalog id of the weights. */
    id: string;
    /**
     * Immutable upstream checkpoint revision, when recorded by the publisher. Export revisions are
     * distinct and must not be substituted here; missing upstream lineage is explained in export.
     */
    revision: string | null;
    export?: { repository: string; revision: string; upstreamRevisionNote: string };
    dtype: Readonly<Record<string, string>> | null;
    device: string | null;
    sampleRateHz: number;
}

export interface ConfiguredAssets {
    /** Explicitly false while a registered candidate lacks required runtime/model artifact pins. */
    inventoryComplete?: boolean;
    servedFrom?: string;
    /** Explicit URLs are required for upstream inventories; self-hosted paths use servedFrom. */
    files?: readonly { path: string; bytes: number; sha256: string; url?: string }[];
    /** Exact entries in a shared pin table, or an exact model/revision directory prefix. */
    pinKeys?: readonly string[];
    pinKeyPrefix?: string;
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

interface CandidateDefinition {
    modelPackage?: { descriptor: ModelPackage; sourcePath: string; digest: string };
    id: string;
    /**
     * Whether this candidate may actually be RUN. Registering a candidate describes it; it does not
     * make it shippable. Moonshine is registered and NOT activation-ready until the real-runtime
     * windowed E/F validation proves its implemented streaming path.
     */
    activationReady: boolean;
    /** Required when activationReady is false: what is outstanding. Never left unexplained. */
    notReadyReason?: string;
    /** May the signed Production comparison surface measure this candidate without known harness bias? */
    comparisonReady: boolean;
    /** Required when comparisonReady is false: the named evidence still missing. */
    comparisonNotReadyReason?: string;
    engine: EngineKind;
    execution: CandidateExecution;
    runtime: ConfiguredRuntime;
    model: ConfiguredModel;
    assets: ConfiguredAssets;
    browser: BrowserExecutability;
}

export interface Candidate extends CandidateDefinition {
    id: CandidateId;
}

const WHISPER_BASE = 'onnx-community/whisper-base.en';
const whisperCacheFiles = (decoder: string): string[] => [
    'config.json', 'tokenizer.json', 'preprocessor_config.json',
    'onnx/encoder_model.onnx', `onnx/${decoder}`,
];
const LOCAL_WHISPER_CACHE_FILES = ['config.json', 'tokenizer.json', 'preprocessor_config.json',
    'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const PCM_16K = { input: 'float32-pcm', channels: 1, sampleRateHz: 16_000, features: 'runtime' } as const;
const WHISPER_DECODE: WhisperDecodeProfile = {
    kind: 'whisper', windowSeconds: 30, strideSeconds: 5, returnTimestamps: true,
};
const WHISPER_ANTI_LOOP_DECODE: WhisperDecodeProfile = {
    ...WHISPER_DECODE, generation: { condition_on_previous_text: false, no_repeat_ngram_size: 6 },
};
const MOONSHINE_DECODE: MoonshineDecodeProfile = {
    kind: 'moonshine-streaming', streamingConfig: 'pinned-assets', finalization: 'force-update',
};
const whisperAssetKeys = (repository: string, decoder: string): string[] => [
    'config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json',
    'tokenizer_config.json', 'onnx/encoder_model.onnx', `onnx/${decoder}`,
].map((file) => `${repository}/resolve/main/${file}`);

/** Object.freeze is SHALLOW: without this, `CANDIDATES[id].runtime.version = 'x'` silently succeeds. */
function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    }
    return value;
}

const CANDIDATE_DEFINITIONS = deepFreeze({
    'parakeet:tdt-v3:int8': {
        id: 'parakeet:tdt-v3:int8', engine: 'parakeet-tdt',
        activationReady: false, comparisonReady: false,
        notReadyReason: 'Executable pinned adapter; actual model/browser/product qualification is still required',
        comparisonNotReadyReason: 'Not approved for production comparison; actual model/device evidence missing',
        execution: { family: 'parakeet-tdt', variant: 'tdt-v3-int8', implemented: true,
            liveResultKind: 'incremental', preprocessing: PCM_16K,
            decode: { kind: 'parakeet-tdt', backend: 'wasm', encoderPrecision: 'int8', decoderPrecision: 'int8',
                encoderFile: 'encoder-model.int8.onnx', decoderFile: 'decoder_joint-model.int8.onnx',
                vocabularyFile: 'vocab.txt', configurationFile: 'config.json',
                runtimeBundleFile: 'parakeet-runtime.mjs', wasmGlueFile: 'ort-wasm-simd-threaded.mjs',
                wasmBinaryFile: 'ort-wasm-simd-threaded.wasm',
                melBins: 128, subsampling: 8, windowStride: 0.01, vocabularySize: 8193, blankId: 8192,
            } satisfies ParakeetTdtProfile },
        runtime: { package: parakeetPins.runtime.package, version: parakeetPins.runtime.version,
            integrity: parakeetPins.runtime.integrity, distribution: 'pinned-assets',
            dependencies: { 'onnxruntime-web': parakeetPins.runtime.onnxruntime.version } },
        model: { id: parakeetPins.upstreamModel, revision: null,
            export: { repository: parakeetPins.repository, revision: parakeetPins.revision,
                upstreamRevisionNote: `Conversion source ${parakeetPins.conversionSource}@${parakeetPins.conversionRevision}; original NVIDIA checkpoint revision not established` },
            dtype: { encoder_model: 'int8', decoder_joint_model: 'int8' }, device: 'wasm', sampleRateHz: 16_000 },
        assets: { files: parakeetPins.files, provenance: 'upstream_pins', inventoryComplete: parakeetPins.runtimeInventoryComplete,
            pinSource: 'frontend/src/services/transcription/engines/parakeet/assetPins.json',
            pinDigest: parakeetPins.pinDigest, componentCount: parakeetPins.files.length, totalBytes: parakeetPins.totalBytes,
            pinNote: 'Four immutable upstream model/configuration files and three verified local runtime artifacts. Actual model execution and product qualification are separate evidence.' },
        browser: { ok: true },
    },
    'granite:turboctc-q4f16': {
        id: 'granite:turboctc-q4f16', engine: 'granite-ctc',
        activationReady: false, comparisonReady: false,
        notReadyReason: 'Pinned adapter source implemented; browser execution and product qualification have not run',
        comparisonNotReadyReason: 'Not approved for production comparison; actual browser/device evidence missing',
        execution: { family: 'granite-ctc', variant: 'turboctc-q4f16', implemented: true,
            liveResultKind: 'incremental', preprocessing: PCM_16K,
            decode: { kind: 'granite-ctc', modelFile: 'ctc_conformer_q4f16.onnx', applyAgc: true } },
        runtime: { package: 'onnxruntime-web', version: '1.26.0', distribution: 'pinned-assets' },
        model: { id: granitePins.upstreamDeclaredModel, revision: null,
            export: { repository: granitePins.repo, revision: granitePins.revision,
                upstreamRevisionNote: granitePins.lineageEvidence },
            dtype: { model: 'q4f16' }, device: 'webgpu', sampleRateHz: 16_000 },
        assets: { files: granitePins.files, provenance: 'upstream_pins',
            pinSource: 'frontend/src/services/transcription/engines/granite/assetPins.json',
            pinDigest: '3d20c877a2764c504ed79c38598579f47cdb1f57b004af4b76ee0b4af3944d62',
            componentCount: 9, totalBytes: 339_374_194,
            pinNote: 'Six model/frontend and three ORT Web files; aggregate includes runtime. Configured export provenance, not observed weights.' },
        browser: { ok: true },
    },
    'v2:base.en': {
        id: 'v2:base.en',
        activationReady: true,
        comparisonReady: true,
        engine: 'transformers-js',
        execution: { family: 'whisper', variant: null, implemented: true, liveResultKind: 'incremental', preprocessing: PCM_16K, decode: WHISPER_DECODE,
            localModelId: 'whisper-base.en', expectedDownloadMb: 80, cacheFiles: LOCAL_WHISPER_CACHE_FILES },
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
            servedFrom: selfHostedBasePins.servedFrom,
            files: selfHostedBasePins.files,
            componentCount: 12,
            totalBytes: 80_553_222,
            provenance: 'self_hosted',
            pinNote: null,
        },
        browser: { ok: true },
    },
    'xenova:whisper-tiny.en': {
        id: 'xenova:whisper-tiny.en',
        activationReady: false,
        notReadyReason: 'Descriptor-driven app recording, stop/save and next-take parity has not been qualified.',
        comparisonReady: false,
        comparisonNotReadyReason: 'The shared loading path has not been qualified through the product.',
        engine: 'transformers-js',
        execution: { family: 'whisper', variant: 'whisper-tiny.en', implemented: true,
            liveResultKind: 'incremental', preprocessing: PCM_16K, decode: WHISPER_DECODE,
            localModelId: 'whisper-tiny.en', expectedDownloadMb: 45, cacheFiles: LOCAL_WHISPER_CACHE_FILES },
        runtime: { package: '@xenova/transformers', version: '2.17.2' },
        model: { id: 'Xenova/whisper-tiny.en', revision: null, dtype: null,
            device: 'wasm', sampleRateHz: 16_000 },
        assets: {
            pinDigest: '3568515f713914a11fcd769eb609ee41175abae4f081c18ab6937db5d80bf908',
            pinSource: 'frontend/public/models/whisper-tiny.en', componentCount: 12,
            servedFrom: selfHostedTinyPins.servedFrom,
            files: selfHostedTinyPins.files,
            totalBytes: 44_497_724, provenance: 'self_hosted', pinNote: null,
        },
        browser: { ok: true },
    },
    'v4:base:q4': {
        id: 'v4:base:q4',
        activationReady: false,
        comparisonReady: false,
        comparisonNotReadyReason: 'benchmark control is outside the PO-approved three-model comparison',
        notReadyReason:
            'benchmark control only. It is a measured arm and a valid ATTRIBUTION target, but it is not one of the three candidates under product comparison, so a build may not ship it as the default',
        engine: 'transformers-js-v4',
        execution: { family: 'whisper', variant: 'base_q4', implemented: true, liveResultKind: 'incremental', expectedDownloadMb: 142, cacheFiles: whisperCacheFiles('decoder_model_merged_q4.onnx'), preprocessing: PCM_16K, decode: WHISPER_ANTI_LOOP_DECODE },
        runtime: { package: '@huggingface/transformers', version: '4.3.0' },
        model: {
            id: WHISPER_BASE,
            revision: null,
            dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
            device: null,
            sampleRateHz: 16_000,
        },
        assets: {
            pinDigest: '19e79a9e383779a6763c9e766ccd4e3067d5481d6468164c4b86147ddb356644',
            pinKeys: whisperAssetKeys(WHISPER_BASE, 'decoder_model_merged_q4.onnx'),
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
        comparisonReady: false,
        comparisonNotReadyReason: 'benchmark control is outside the PO-approved three-model comparison',
        notReadyReason:
            'benchmark control only, and PRIV_STT_V4_VARIANTS registers no int8 runtime variant, so the engine cannot load it at all. Selecting it could only ever run a different model under this id',
        engine: 'transformers-js-v4',
        execution: { family: 'whisper', variant: 'base_int8', implemented: false, liveResultKind: 'incremental', cacheFiles: whisperCacheFiles('decoder_model_merged_int8.onnx'), preprocessing: PCM_16K, decode: WHISPER_ANTI_LOOP_DECODE },
        runtime: { package: '@huggingface/transformers', version: '4.3.0' },
        model: {
            id: WHISPER_BASE,
            revision: null,
            dtype: { encoder_model: 'fp32', decoder_model_merged: 'int8' },
            device: null,
            sampleRateHz: 16_000,
        },
        assets: {
            pinDigest: '14e12c137a55be0d2e49de2d7f1330518e88de652eded865b762143f2d96251c',
            pinKeys: whisperAssetKeys(WHISPER_BASE, 'decoder_model_merged_int8.onnx'),
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
        comparisonReady: true,
        notReadyReason:
            'no qualification evidence exists for this candidate on the product path. It is selectable '
            + 'for internal comparison via acknowledgeNotProductionReady, and becomes eligible as a '
            + 'public default only once a human comparison has actually been run against it',
        engine: 'transformers-js-v4',
        execution: { family: 'whisper', variant: 'distil_q4', implemented: true, liveResultKind: 'incremental', expectedDownloadMb: 251, cacheFiles: whisperCacheFiles('decoder_model_merged_q4.onnx'), preprocessing: PCM_16K, decode: WHISPER_ANTI_LOOP_DECODE },
        runtime: { package: '@huggingface/transformers', version: '4.3.0' },
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
            pinKeys: whisperAssetKeys('onnx-community/distil-small.en', 'decoder_model_merged_q4.onnx'),
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
        notReadyReason: 'real-runtime windowed E/F comparison-readiness passed; public-default '
            + 'qualification awaits the PO-authorized human comparison and down-selection',
        comparisonReady: true,
        engine: 'moonshine-streaming',
        execution: { family: 'moonshine-streaming', variant: 'MOONSHINE_STREAMING_MEDIUM', modelArch: 'MOONSHINE_STREAMING_MEDIUM', implemented: true, liveResultKind: 'snapshot', preprocessing: PCM_16K, decode: MOONSHINE_DECODE },
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
            pinKeyPrefix: 'download.moonshine.ai/model/medium-streaming-en/quantized_26_07_30/',
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
    'moonshine:streaming-small': {
        id: 'moonshine:streaming-small',
        activationReady: false,
        comparisonReady: false,
        notReadyReason: 'descriptor-only compatibility candidate; browser and product qualification have not run',
        comparisonNotReadyReason: 'not approved for the production comparison slate',
        engine: 'moonshine-streaming',
        execution: { family: 'moonshine-streaming', variant: 'MOONSHINE_STREAMING_SMALL', modelArch: 'MOONSHINE_STREAMING_SMALL', implemented: true, liveResultKind: 'snapshot', preprocessing: PCM_16K, decode: MOONSHINE_DECODE },
        runtime: { package: '@moonshine-ai/moonshine-wasm', version: '0.1.5' },
        model: {
            id: 'small-streaming-en', revision: 'quantized_26_07_30', dtype: null,
            device: 'wasm', sampleRateHz: 16_000,
        },
        assets: {
            pinDigest: 'ce52c19ff8d34ed881c9ec15efad54e5aa148cb6e3c07aa8ea70b33cf5ef07a7',
            pinKeyPrefix: 'download.moonshine.ai/model/small-streaming-en/quantized_26_07_30/',
            provenance: 'upstream_pins',
            pinSource: 'frontend/src/services/transcription/moonshineAssetPins.json',
            componentCount: 7, totalBytes: 165_489_086, pinNote: null,
        },
        browser: { ok: true },
    },
} satisfies Record<string, CandidateDefinition>);

// Dropping a validated package JSON here adds a compatible model without catalogue TS edits.
// Node callers load the same files explicitly; Vite supplies them to evaluation AND adoption.
const packageFiles = typeof import.meta.env !== 'undefined'
    ? import.meta.glob('./model-packages/*.json', { eager: true, query: '?raw', import: 'default' }) : {};
// Native Node reads the built-in data without a TS module resolver. Its package
// catalogue is loaded explicitly by product-campaign under the existing tsx entry.
const packageParsers = typeof import.meta.env !== 'undefined'
    ? import.meta.glob('./modelPackage.ts', { eager: true }) : {};
const importedPackages: Record<string, Candidate> = {};
export const MODEL_PACKAGE_REJECTIONS: Array<{ file: string; code: string }> = [];
for (const [path, value] of Object.entries(packageFiles)) {
    try {
        if (String(value).length > 1_048_576) throw new Error('PACKAGE_DESCRIPTOR_TOO_LARGE');
        const parser = packageParsers['./modelPackage.ts'] as typeof import('./modelPackage');
        const candidate = parser.candidateFromPackage(JSON.parse(String(value)), 'frontend/src/services/transcription/' + path.slice(2));
        if (Object.prototype.hasOwnProperty.call(CANDIDATE_DEFINITIONS, candidate.id) || Object.prototype.hasOwnProperty.call(importedPackages, candidate.id)) throw new Error('PACKAGE_DUPLICATE_ID');
        importedPackages[candidate.id] = candidate;
    } catch (error) {
        // A refused import never replaces the incumbent or prevents its catalogue from loading.
        MODEL_PACKAGE_REJECTIONS.push({ file: path, code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'PACKAGE_INVALID' });
    }
}
Object.freeze(MODEL_PACKAGE_REJECTIONS);
export const CANDIDATES: Readonly<Record<CandidateId, Candidate>> = deepFreeze({ ...CANDIDATE_DEFINITIONS, ...importedPackages });

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
    const registered = Object.values(CANDIDATES);
    const variantMatches = registered.filter((candidate) =>
        candidate.engine === engineType && candidate.execution.variant === (variant ?? null));
    // A resolved decoder override may select a sibling precision, but cannot change model,
    // checkpoint or runtime family. An unknown variant never establishes that family.
    const matches = decoderDtype == null ? variantMatches : registered.filter((candidate) =>
        candidate.model.dtype?.decoder_model_merged === decoderDtype
        && variantMatches.some((requested) =>
            candidate.engine === requested.engine
            && candidate.execution.family === requested.execution.family
            && candidate.model.id === requested.model.id
            && candidate.model.revision === requested.model.revision
            && candidate.model.export?.repository === requested.model.export?.repository
            && candidate.model.export?.revision === requested.model.export?.revision
            && candidate.runtime.package === requested.runtime.package
            && candidate.runtime.version === requested.runtime.version));
    if (matches.length === 1) return matches[0].id;
    throw new UnknownCandidateError(
        `runtime identity has ${matches.length} registered matches for ${JSON.stringify(state)}; refusing to attribute the session to a default precision`,
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
    /** Included by new recordings; absent only in historical stored identities. */
    configuredExecution?: CandidateExecution;
}

export function identityOf(candidate: Candidate): SessionModelIdentity {
    return {
        candidateId: candidate.id,
        engine: candidate.engine,
        configuredRuntime: { ...candidate.runtime },
        configuredModel: { ...candidate.model },
        configuredAssets: { ...candidate.assets },
        configuredExecution: candidate.execution,
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
    return Boolean(a?.inventoryComplete !== false && a?.pinDigest && a?.pinSource && a?.componentCount);
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
