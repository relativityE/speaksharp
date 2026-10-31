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
} as const;
export class UnsupportedModelPackageError extends Error {
    readonly code: string;
    constructor(code: string) { super(code); this.name = 'UnsupportedModelPackageError'; this.code=code; }
}
const refuse = (code: string): never => { throw new UnsupportedModelPackageError(code); };
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
    if (p.engine === 'transformers-js' && (p.execution.family !== 'whisper' || decode?.kind !== 'whisper'
        || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(p.execution.localModelId ?? '') || p.model.device !== 'wasm' || p.runtime.distribution === 'pinned-assets'
        || p.model.dtype !== null
        || !Number.isFinite(decode.windowSeconds) || decode.windowSeconds <= 0 || !Number.isFinite(decode.strideSeconds)
        || decode.strideSeconds < 0 || decode.strideSeconds >= decode.windowSeconds || typeof decode.returnTimestamps !== 'boolean')) refuse('UNSUPPORTED_WHISPER_PROFILE');
    if (p.engine === 'granite-ctc' && (p.execution.family !== 'granite-ctc' || decode?.kind !== 'granite-ctc'
        || typeof decode.modelFile !== 'string' || !decode.modelFile || typeof decode.applyAgc !== 'boolean'
        || p.runtime.distribution !== 'pinned-assets')) refuse('UNSUPPORTED_GRANITE_PROFILE');
    if (p.engine === 'parakeet-tdt' && (p.execution.family !== 'parakeet-tdt' || decode?.kind !== 'parakeet-tdt'
        || p.model.device !== 'wasm' || decode.backend !== 'wasm' || decode.encoderPrecision !== 'int8'
        || decode.decoderPrecision !== 'int8' || decode.melBins !== 128 || decode.subsampling !== 8
        || decode.windowStride !== 0.01 || !Number.isSafeInteger(decode.vocabularySize) || decode.vocabularySize <= 1
        || decode.blankId !== decode.vocabularySize - 1 || p.runtime.dependencies?.['onnxruntime-web'] !== '1.24.1'
        || p.runtime.distribution !== 'pinned-assets')) refuse('UNSUPPORTED_PARAKEET_PROFILE');
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
            || url.pathname.split('/').some(v => v === '..')) refuse('PACKAGE_ASSET_LOCATION_INVALID');
        paths.add(f.path); urls.add(f.url);
    }
    if (p.engine === 'transformers-js' && (!p.assets.servedFrom || p.assets.servedFrom !== '/models/' + p.execution.localModelId
        || p.assets.files.some(f => f.url !== p.assets.servedFrom + '/' + f.path))) refuse('UNSUPPORTED_WHISPER_LAYOUT');
    const requiredWhisper = ['config.json','generation_config.json','preprocessor_config.json','tokenizer.json','tokenizer_config.json',
        'onnx/encoder_model_quantized.onnx','onnx/decoder_model_merged_quantized.onnx'];
    if (p.engine === 'transformers-js' && (requiredWhisper.some(file=>!paths.has(file))
        || p.assets.files.some(f=>/\.(?:[cm]?js|wasm)$/i.test(f.path)))) refuse('UNSUPPORTED_WHISPER_ASSETS');
    if (p.engine === 'parakeet-tdt' && decode.kind === 'parakeet-tdt') {
        const roles = [decode.encoderFile,decode.decoderFile,decode.vocabularyFile,decode.configurationFile,
            decode.runtimeBundleFile,decode.wasmGlueFile,decode.wasmBinaryFile];
        if (roles.some(file=>typeof file!=='string'||!paths.has(file)) || new Set(roles).size!==roles.length) refuse('UNSUPPORTED_PARAKEET_ASSETS');
    }
    // Runtime code is installed adapter policy, not arbitrary executable package input.
    // A compatible new weight package reuses exactly the reviewed runtime artifacts.
    if (p.engine !== 'transformers-js') {
        const reference = p.engine === 'granite-ctc' ? graniteRuntimePins.files : parakeetRuntimePins.files;
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
    return {
        id: p.id, engine: p.engine, execution: p.execution, runtime: p.runtime, model: p.model,
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

export function expectedModelIdentity(candidate: Candidate) {
    const engine = candidate.engine === 'transformers-js' ? 'private-v2' : candidate.engine === 'transformers-js-v4' ? 'private-v4' : candidate.engine;
    return { engine, modelId: candidate.model.id, revision: candidate.model.revision,
        assetDigest: candidate.assets.pinDigest ?? '', runtime: `${candidate.runtime.package}@${candidate.runtime.version}`,
        backend: candidate.model.device ?? '' };
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
