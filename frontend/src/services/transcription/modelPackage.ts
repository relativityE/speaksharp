import type { Candidate, CandidateExecution, ConfiguredModel, ConfiguredRuntime, EngineKind } from './candidateRegistry';
import graniteRuntimePins from './engines/granite/assetPins.json';
import parakeetRuntimePins from './engines/parakeet/assetPins.json';

export interface PackageAsset { path: string; url: string; bytes: number; sha256: string }
/** Inert data only. Architecture algorithms and runtime entrypoints belong to installed adapters. */
export interface ModelPackage {
    schemaVersion: 1;
    kind: 'speaksharp-model-package';
    id: string;
    packageDigest: string;
    assetDigest: string;
    engine: EngineKind;
    execution: CandidateExecution;
    runtime: ConfiguredRuntime;
    model: ConfiguredModel;
    assets: { files: PackageAsset[]; servedFrom?: string };
    license: string;
}
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,119}$/;
const PROFILE_RUNTIME = {
    'transformers-js': ['@xenova/transformers', '2.17.2'],
    'granite-ctc': ['onnxruntime-web', '1.26.0'],
    'parakeet-tdt': ['parakeet.js', '1.4.4'],
    // The installed runtime adapter; a Moonshine package carries only pinned weights (PO 11-01 Moonshine drop-in).
    'moonshine-streaming': ['@moonshine-ai/moonshine-wasm', '0.1.5'],
} as const;
export class UnsupportedModelPackageError extends Error {
    readonly code: string;
    constructor(code: string) { super(code); this.name = 'UnsupportedModelPackageError'; this.code=code; }
}
// A function declaration (not a const arrow), so TypeScript narrows after a guarded refuse() call.
function refuse(code: string): never { throw new UnsupportedModelPackageError(code); }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Stable encoding is shared by import, execution verification and promotion. */
export function canonicalPackageJson(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalPackageJson).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalPackageJson(value[k])).join(',') + '}';
    return refuse('PACKAGE_NON_SERIALIZABLE');
}
export async function digestPackageData(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalPackageJson(value));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function assetInventoryDigest(files: readonly PackageAsset[]): Promise<string> {
    const bytes = new TextEncoder().encode([...files].sort((a,b) => a.path<b.path?-1:a.path>b.path?1:0)
        .map(f => `${f.path}:${f.sha256}\n`).join(''));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(x => x.toString(16).padStart(2, '0')).join('');
}
/** Synchronous shape validation is not execution proof; verifyModelPackage is mandatory before use. */
/**
 * The Parakeet adapter executes the files its profile names in these three roles (runtime bundle, WASM glue, WASM binary).
 * Each role is bound to one reviewed runtime pin, so an imported weight package cannot point an executable role at a
 * different file. Checked against the pin table at load, so the binding cannot drift from the reviewed bytes.
 */
export const PARAKEET_EXECUTABLE_ROLES = Object.freeze({
    runtimeBundleFile: 'parakeet-runtime.mjs', wasmGlueFile: 'ort-wasm-simd-threaded.mjs', wasmBinaryFile: 'ort-wasm-simd-threaded.wasm',
} as const);
if (Object.values(PARAKEET_EXECUTABLE_ROLES).some(path => !parakeetRuntimePins.files.some(pin => pin.path === path))) {
    throw new Error('PARAKEET_EXECUTABLE_ROLE_NOT_PINNED');
}

/** Reviewed Whisper generation knobs and their admitted ranges. Window, stride and timestamps are never package-overridable. */
const WHISPER_GENERATION_RULES: Readonly<Record<string, (value: unknown) => boolean>> = Object.freeze({
    condition_on_previous_text: (v: unknown) => typeof v === 'boolean',
    no_repeat_ngram_size: (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 20,
    compression_ratio_threshold: (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10,
    logprob_threshold: (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= -10 && v <= 0,
    no_speech_threshold: (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1,
    temperature: (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1,
});
/** Files the Granite core reads by basename besides the model and its external data. */
const GRANITE_REQUIRED_FILES: readonly string[] = Object.freeze(['frontend_config.json', 'mel_filters.bin', 'stft_window.bin', 'vocab.json']);

/**
 * Every file the installed Whisper (v2, Xenova 2.17.2) loader requests for the supported package layout, the same set the
 * built-in incumbent requires: tokenizer_config.json is fatal in loadTokenizer and generation_config.json is fetched when served. Readiness reads `execution.cacheFiles`, so an admitted Whisper package always carries it.
 */
export const WHISPER_PACKAGE_CACHE_FILES: readonly string[] = Object.freeze(['config.json', 'tokenizer.json', 'tokenizer_config.json',
    'preprocessor_config.json', 'generation_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']);
export function parseModelPackage(input: unknown): ModelPackage {
    if (!object(input) || input.schemaVersion !== 1 || input.kind !== 'speaksharp-model-package') refuse('UNSUPPORTED_PACKAGE_FORMAT');
    const p = input as unknown as ModelPackage;
    if (Object.keys(input).some(k => !['schemaVersion','kind','id','packageDigest','assetDigest','engine','execution','runtime','model','assets','license'].includes(k))) refuse('PACKAGE_UNKNOWN_FIELD');
    if (!ID.test(p.id) || !HASH.test(p.packageDigest) || !HASH.test(p.assetDigest) || typeof p.license !== 'string' || !p.license.trim()) refuse('PACKAGE_IDENTITY_INVALID');
    if (!Object.prototype.hasOwnProperty.call(PROFILE_RUNTIME, p.engine)) refuse('UNSUPPORTED_PACKAGE_ARCHITECTURE');
    const runtime = PROFILE_RUNTIME[p.engine as keyof typeof PROFILE_RUNTIME];
    if (!object(p.runtime) || p.runtime.package !== runtime[0] || p.runtime.version !== runtime[1]) refuse('UNSUPPORTED_PACKAGE_RUNTIME');
    if (!object(p.model) || typeof p.model.id !== 'string' || !p.model.id.trim() || p.model.sampleRateHz !== 16000
        || !['wasm','webgpu'].includes(p.model.device ?? '') || !(p.model.revision === null || typeof p.model.revision === 'string')
        || !(p.model.dtype === null || object(p.model.dtype) && Object.values(p.model.dtype).every(v=>typeof v==='string'&&v.length>0))) refuse('UNSUPPORTED_PACKAGE_MODEL');
    if (!object(p.execution) || p.execution.preprocessing?.input !== 'float32-pcm'
        || p.execution.preprocessing.channels !== 1 || p.execution.preprocessing.sampleRateHz !== 16000
        || p.execution.preprocessing.features !== 'runtime' || !p.execution.implemented
        || !['incremental','snapshot'].includes(p.execution.liveResultKind)) refuse('UNSUPPORTED_PACKAGE_PREPROCESSING');
    const decode = p.execution.decode;
    // Whisper stride: the same half-window rule buildShippingDecodeOptions enforces (Codex P2 on 66f048d0), so a profile the
    // decoder cannot execute is refused at admission instead of failing every transcription after import.
    // A package's preparation budget is bounded data; adapters that acquire and build large pinned assets must declare it, so an
    // imported Granite/Parakeet package cannot silently fall back to the 5 s service default.
    const budget = p.execution.preparationBudgetMs;
    if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < 5_000 || budget > 600_000)) refuse('PACKAGE_PREPARATION_BUDGET_INVALID');
    if ((p.engine === 'granite-ctc' || p.engine === 'parakeet-tdt') && budget === undefined) refuse('PACKAGE_PREPARATION_BUDGET_MISSING');
    if (p.engine === 'transformers-js' && (p.execution.family !== 'whisper' || decode?.kind !== 'whisper'
        || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(p.execution.localModelId ?? '') || p.model.device !== 'wasm' || p.runtime.distribution === 'pinned-assets'
        || p.model.dtype !== null
        || !Number.isFinite(decode.windowSeconds) || decode.windowSeconds <= 0 || !Number.isFinite(decode.strideSeconds)
        || decode.strideSeconds < 0 || decode.strideSeconds * 2 >= decode.windowSeconds || typeof decode.returnTimestamps !== 'boolean')) refuse('UNSUPPORTED_WHISPER_PROFILE');
    // Independent review of 27607fb3 (P1): `generation` is spread into the decode options, so a package could re-introduce
    // a window/stride/timestamp setting (e.g. stride_length_s 15 against a 30 s window: Xenova's chunk loop never advances).
    // Only reviewed generation knobs, within reviewed ranges, are admitted; language and task are closed values.
    if (p.engine === 'transformers-js' && decode?.kind === 'whisper') {
        const generation = (decode as { generation?: unknown }).generation;
        if (generation !== undefined && (!object(generation)
            || Object.entries(generation).some(([key, value]) => !Object.prototype.hasOwnProperty.call(WHISPER_GENERATION_RULES, key) || !WHISPER_GENERATION_RULES[key](value)))) {
            refuse('UNSUPPORTED_WHISPER_GENERATION');
        }
        const { language, task } = decode as { language?: unknown; task?: unknown };
        if ((language !== undefined && (typeof language !== 'string' || !/^[a-z]{2,16}$/.test(language)))
            || (task !== undefined && task !== 'transcribe' && task !== 'translate')) refuse('UNSUPPORTED_WHISPER_GENERATION');
    }
    if (p.engine === 'granite-ctc' && (p.execution.family !== 'granite-ctc' || decode?.kind !== 'granite-ctc'
        || typeof decode.modelFile !== 'string' || !decode.modelFile || typeof decode.applyAgc !== 'boolean'
        || p.runtime.distribution !== 'pinned-assets')) refuse('UNSUPPORTED_GRANITE_PROFILE');
    if (p.engine === 'parakeet-tdt' && (p.execution.family !== 'parakeet-tdt' || decode?.kind !== 'parakeet-tdt'
        || p.model.device !== 'wasm' || decode.backend !== 'wasm' || decode.encoderPrecision !== 'int8'
        || decode.decoderPrecision !== 'int8' || decode.melBins !== 128 || decode.subsampling !== 8
        || decode.windowStride !== 0.01 || !Number.isSafeInteger(decode.vocabularySize) || decode.vocabularySize <= 1
        || decode.blankId !== decode.vocabularySize - 1 || p.runtime.dependencies?.['onnxruntime-web'] !== '1.24.1'
        || p.runtime.distribution !== 'pinned-assets')) refuse('UNSUPPORTED_PARAKEET_PROFILE');
    if (p.engine === 'moonshine-streaming' && (p.execution.family !== 'moonshine-streaming' || decode?.kind !== 'moonshine-streaming'
        || decode.streamingConfig !== 'pinned-assets' || decode.finalization !== 'force-update'
        || typeof decode.runtimeArch !== 'string' || !/^[A-Z][A-Za-z0-9]{0,63}$/.test(decode.runtimeArch)
        || typeof p.execution.modelArch !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(p.execution.modelArch)
        || p.execution.variant !== p.execution.modelArch || p.execution.liveResultKind !== 'snapshot'
        || p.model.device !== 'wasm' || p.model.dtype !== null || p.runtime.distribution === 'pinned-assets')) refuse('UNSUPPORTED_MOONSHINE_PROFILE');
    if (!object(p.assets) || !Array.isArray(p.assets.files) || !p.assets.files.length || p.assets.files.length > 128) refuse('PACKAGE_ASSETS_MISSING');
    const paths = new Set<string>(); const urls = new Set<string>();
    for (const f of p.assets.files) {
        if (!object(f) || typeof f.path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(f.path)
            || f.path.startsWith('/') || f.path.split('/').some(v => v === '..' || v === '.' || !v)
            || !Number.isSafeInteger(f.bytes) || f.bytes <= 0 || !HASH.test(f.sha256) || typeof f.url !== 'string'
            || paths.has(f.path) || urls.has(f.url)) refuse('PACKAGE_ASSET_INVALID');
        const url = new URL(f.url, 'https://package.invalid');
        if (url.username || url.password || url.search || url.hash ||
            !(f.url.startsWith('https://') || /^\/models\/[A-Za-z0-9_./-]+$/.test(f.url))
            // The URL constructor already removed dot segments from `pathname`, so check the raw text (review of 27607fb3),
            // including percent-encoded dots.
            || f.url.split('/').some(v => v === '..' || v === '.') || /%2e/i.test(f.url)) refuse('PACKAGE_ASSET_LOCATION_INVALID');
        paths.add(f.path); urls.add(f.url);
    }
    if (p.engine === 'transformers-js' && (!p.assets.servedFrom || p.assets.servedFrom !== '/models/' + p.execution.localModelId
        || p.assets.files.some(f => f.url !== p.assets.servedFrom + '/' + f.path))) refuse('UNSUPPORTED_WHISPER_LAYOUT');
    const requiredWhisper = ['config.json','generation_config.json','preprocessor_config.json','tokenizer.json','tokenizer_config.json',
        'onnx/encoder_model_quantized.onnx','onnx/decoder_model_merged_quantized.onnx'];
    // Optional cache requirements, when declared, must contain the COMPLETE supported set (a shorter list would let
    // readiness report a model as cached while a file the loader needs is missing) and name only distinct files the
    // package ships. An absent list is derived at admission (WHISPER_PACKAGE_CACHE_FILES).
    const cacheFiles = (p.execution as { cacheFiles?: unknown }).cacheFiles;
    if (p.engine === 'transformers-js' && cacheFiles !== undefined && (!Array.isArray(cacheFiles)
        || cacheFiles.some(file => typeof file !== 'string' || !paths.has(file)) || new Set(cacheFiles).size !== cacheFiles.length
        || WHISPER_PACKAGE_CACHE_FILES.some(file => !cacheFiles.includes(file)))) refuse('UNSUPPORTED_WHISPER_CACHE_FILES');
    if (p.engine === 'transformers-js' && (requiredWhisper.some(file=>!paths.has(file))
        || p.assets.files.some(f=>/\.(?:[cm]?js|wasm)$/i.test(f.path)))) refuse('UNSUPPORTED_WHISPER_ASSETS');
    // The Moonshine runtime keys verified buffers by filename: each component has a distinct filename and is fetched from https.
    if (p.engine === 'moonshine-streaming' && (p.assets.files.some(f => !f.url.startsWith('https://'))
        || new Set(p.assets.files.map(f => f.path.split('/').pop())).size !== p.assets.files.length)) refuse('UNSUPPORTED_MOONSHINE_ASSETS');
    if (p.engine === 'parakeet-tdt' && decode.kind === 'parakeet-tdt') {
        const roles = [decode.encoderFile,decode.decoderFile,decode.vocabularyFile,decode.configurationFile,
            decode.runtimeBundleFile,decode.wasmGlueFile,decode.wasmBinaryFile];
        if (roles.some(file=>typeof file!=='string'||!paths.has(file)) || new Set(roles).size!==roles.length) refuse('UNSUPPORTED_PARAKEET_ASSETS');
        // Codex P2 on 1786e230: the adapter (assertParakeetProfile) accepts only distinct asset BASENAMES, so a role in a
        // subdirectory passed admission and then could never initialize. Admission applies the adapter's own rule.
        if (roles.some(file=>/[\\/]/.test(file))) refuse('UNSUPPORTED_PARAKEET_ASSET_LAYOUT');
        // Review of 27607fb3: the engine and worker require EXACTLY the seven role files, so any extra file (a README, a
        // second vocab.txt in a subdirectory) passed admission and then could never initialize.
        if (p.assets.files.length !== roles.length) refuse('UNSUPPORTED_PARAKEET_ASSET_LAYOUT');
        // Codex P1 on c72108a1: the engine executes whatever file these roles name, so each executable role must be the
        // reviewed runtime pin itself, not merely a file present beside it. (The pin loop below binds that path's bytes.)
        if (Object.entries(PARAKEET_EXECUTABLE_ROLES).some(([role, pinned]) => decode[role as keyof typeof PARAKEET_EXECUTABLE_ROLES] !== pinned)) {
            refuse('UNSUPPORTED_PARAKEET_RUNTIME_ROLES');
        }
    }
    // Review of 27607fb3: Granite keys its files by basename and its core needs the model, its external data and the
    // frontend/vocabulary files; without them it failed only after the consented download. Admission applies the core's rule.
    if (p.engine === 'granite-ctc' && decode.kind === 'granite-ctc') {
        const basenames = p.assets.files.map(f => f.path.split('/').pop()!);
        const required = [decode.modelFile, decode.modelFile + '.data', ...GRANITE_REQUIRED_FILES];
        if (/[\\/]/.test(decode.modelFile) || new Set(basenames).size !== basenames.length
            || required.some(file => !basenames.includes(file))) refuse('UNSUPPORTED_GRANITE_ASSETS');
    }
    // Runtime code is installed adapter policy, not arbitrary executable package input.
    // A compatible new weight package reuses exactly the reviewed runtime artifacts.
    if (p.engine !== 'transformers-js') {
        // Moonshine's runtime is the installed npm adapter, so its package may carry no runtime bytes at all.
        const reference: readonly { path: string; sha256: string; bytes: number }[] = p.engine === 'granite-ctc' ? graniteRuntimePins.files
            : p.engine === 'parakeet-tdt' ? parakeetRuntimePins.files : [];
        const runtimeFiles = reference.filter(f=>/\.(?:[cm]?js|wasm)$/i.test(f.path));
        for (const pin of runtimeFiles) {
            const asset=p.assets.files.find(f=>f.path===pin.path);
            if (!asset || asset.sha256!==pin.sha256 || asset.bytes!==pin.bytes) refuse('UNSUPPORTED_PACKAGE_RUNTIME_BYTES');
        }
        if (p.assets.files.some(f=>/\.(?:[cm]?js|wasm)$/i.test(f.path) && !runtimeFiles.some(pin=>pin.path===f.path))) refuse('UNSUPPORTED_PACKAGE_RUNTIME_BYTES');
    }
    return p;
}
export async function verifyModelPackage(input: unknown): Promise<ModelPackage> {
    const p = parseModelPackage(input);
    const { packageDigest, ...body } = p;
    if (await digestPackageData(body) !== packageDigest || await assetInventoryDigest(p.assets.files) !== p.assetDigest) refuse('PACKAGE_DIGEST_MISMATCH');
    return p;
}
/** Importer stamps derived fields; users never duplicate evaluator identities or inventory totals. */
export async function sealModelPackage(input: Omit<ModelPackage, 'packageDigest' | 'assetDigest'>): Promise<ModelPackage> {
    const body = { ...input, assetDigest: await assetInventoryDigest(input.assets.files) };
    return verifyModelPackage({ ...body, packageDigest: await digestPackageData(body) });
}
export function candidateFromPackage(input: unknown, sourcePath: string): Candidate {
    const p = parseModelPackage(input);
    const execution = p.engine === 'transformers-js' && !p.execution.cacheFiles
        ? { ...p.execution, cacheFiles: WHISPER_PACKAGE_CACHE_FILES } : p.execution;
    return {
        id: p.id, engine: p.engine, execution, runtime: p.runtime, model: p.model,
        modelPackage: { descriptor: p, sourcePath, digest: p.packageDigest },
        // Imported data cannot self-authorize production activation.
        activationReady: false, comparisonReady: false,
        notReadyReason: 'Imported package requires product qualification and explicit activation admission',
        comparisonNotReadyReason: 'Imported package is internal until qualified',
        browser: { ok: true },
        assets: { files: p.assets.files, servedFrom: p.assets.servedFrom,
            provenance: p.engine === 'transformers-js' ? 'self_hosted' : 'upstream_pins',
            inventoryComplete: true, componentCount: p.assets.files.length,
            totalBytes: p.assets.files.reduce((n,f) => n + f.bytes, 0),
            pinDigest: p.assetDigest, pinSource: sourcePath },
    };
}

/** The backend a candidate actually runs on: its declared device, or wasm for the v2 worker, whose ONNX Runtime build is wasm-only
 * (it reports wasm-default/single/multithread). Any other undeclared device stays unknown (null) and is never guessed. */
export function effectiveBackend(candidate: Candidate): string | null {
    return candidate.model.device ?? (candidate.engine === 'transformers-js' ? 'wasm' : null);
}

export function expectedModelIdentity(candidate: Candidate) {
    const engine = candidate.engine === 'transformers-js' ? 'private-v2' : candidate.engine === 'transformers-js-v4' ? 'private-v4' : candidate.engine;
    return { engine, modelId: candidate.model.id, revision: candidate.model.revision,
        assetDigest: candidate.assets.pinDigest ?? '', runtime: `${candidate.runtime.package}@${candidate.runtime.version}`,
        backend: effectiveBackend(candidate) ?? '' };
}

/** The product save and its evaluator derive the legacy projection from the SAME resolved candidate. */
export function productModelMetadata(candidate: Candidate) {
    const variants: Record<EngineKind,string> = { 'transformers-js':'private_v2', 'transformers-js-v4':'private_v4',
        'moonshine-streaming':'private_moonshine', 'granite-ctc':'private_granite', 'parakeet-tdt':'private_parakeet' };
    const modelName = candidate.engine === 'transformers-js-v4' ? candidate.execution.variant
        : candidate.execution.localModelId ?? candidate.model.id;
    if (!modelName || !variants[candidate.engine]) throw Error('PACKAGE_ATTRIBUTION_UNSUPPORTED');
    return { modelName, engineVersion: `${variants[candidate.engine]}:${modelName}`, deviceType:'browser' };
}
