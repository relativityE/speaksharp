import type { PinnedAsset } from '../../moonshineAssetPins';

/** Model and runtime filenames are descriptor data; this adapter implements only strict WASM TDT. */
export interface ParakeetTdtProfile {
    kind: 'parakeet-tdt';
    backend: 'wasm';
    encoderPrecision: 'int8';
    decoderPrecision: 'int8';
    encoderFile: string;
    decoderFile: string;
    vocabularyFile: string;
    configurationFile: string;
    runtimeBundleFile: string;
    wasmGlueFile: string;
    wasmBinaryFile: string;
    melBins: 128;
    subsampling: 8;
    windowStride: 0.01;
    vocabularySize: number;
    blankId: number;
}

export interface ParakeetRuntimeIdentity {
    package: 'parakeet.js';
    version: '1.4.4';
    ortVersion: '1.24.1';
}

export interface ParakeetTdtOptions {
    profile: ParakeetTdtProfile;
    runtime: ParakeetRuntimeIdentity;
    assets: readonly PinnedAsset[];
    onDownloadProgress?: (fraction: number) => void;
}

export type ParakeetWorkerRequest = {
    id: number;
} & ({ type: 'init'; profile: ParakeetTdtProfile; runtime: ParakeetRuntimeIdentity;
    files: Record<string, Uint8Array>; runtimeUrl: string }
    | { type: 'decode'; audio: Float32Array });

export type ParakeetWorkerReply = { id: number } & (
    { ok: true; type: 'ready'; backend: 'wasm'; ortVersion: string }
    | { ok: true; type: 'transcript'; text: string }
    | { ok: false; error: string }
);

export interface RuntimeTensor {
    data: Float32Array | Int32Array | BigInt64Array;
    dims: readonly number[];
    dispose(): void;
}

export interface RuntimeSession {
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
    run(feeds: Record<string, RuntimeTensor>): Promise<Record<string, RuntimeTensor>>;
}

/** Exact pinned source fields, used only for a strict TDT probe, not as invented cleanup APIs. */
export interface ParakeetModelInstance {
    readonly ort: ParakeetRuntimeBundle['ort'];
    encoderSession: RuntimeSession;
    joinerSession: RuntimeSession;
    computeFeatures(audio: Float32Array, sampleRate: number): Promise<{
        features: Float32Array; T: number; melBins: number; validLength?: number;
    }>;
    getStreamingConstants(): { subsampling: number; windowStride: number; melBins: number; blankId: number };
    resetMelCache(): void;
    clearIncrementalCache(): void;
    transcribe(audio: Float32Array, sampleRate: number): Promise<{ utterance_text: string }>;
}

/** Owned bundle contract, exposing the same ORT instance the published model uses internally. */
export interface ParakeetRuntimeBundle {
    bindingIdentity: ParakeetRuntimeIdentity;
    ort: {
        env: { versions?: { common?: string }; wasm: {
            wasmPaths?: { mjs: string; wasm: string }; numThreads?: number; proxy?: boolean;
        } };
        Tensor: new (type: 'float32' | 'int32' | 'int64',
            data: Float32Array | Int32Array | BigInt64Array, dims: number[]) => RuntimeTensor;
    };
    ParakeetModel: { fromUrls(config: {
        encoderUrl: string; decoderUrl: string; tokenizerUrl: string;
        backend: 'wasm'; cpuThreads: 1; preprocessorBackend: 'js'; nMels: 128;
        subsampling: 8; windowStride: 0.01; enableGraphCapture: false;
    }): Promise<ParakeetModelInstance> };
}

export function requiredParakeetFiles(profile: ParakeetTdtProfile): string[] {
    return [profile.encoderFile, profile.decoderFile, profile.vocabularyFile, profile.configurationFile,
        profile.runtimeBundleFile, profile.wasmGlueFile, profile.wasmBinaryFile];
}

export function assertParakeetProfile(profile: ParakeetTdtProfile, runtime: ParakeetRuntimeIdentity): void {
    if (profile.kind !== 'parakeet-tdt' || profile.backend !== 'wasm' ||
        profile.encoderPrecision !== 'int8' || profile.decoderPrecision !== 'int8' ||
        profile.melBins !== 128 || profile.subsampling !== 8 || profile.windowStride !== 0.01 ||
        !Number.isSafeInteger(profile.vocabularySize) || profile.vocabularySize <= 1 ||
        profile.blankId !== profile.vocabularySize - 1 ||
        runtime.package !== 'parakeet.js' || runtime.version !== '1.4.4' || runtime.ortVersion !== '1.24.1') {
        throw new Error('Parakeet requires the explicit WASM/int8 TDT profile and pinned runtime');
    }
    const names = requiredParakeetFiles(profile);
    if (new Set(names).size !== names.length || names.some(name =>
        !name || /[\\/]/.test(name) || name === '.' || name === '..')) {
        throw new Error('Parakeet filenames must be distinct asset basenames');
    }
}
