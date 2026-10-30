import logger from '@/lib/logger';
import { assertParakeetProfile, requiredParakeetFiles, type ParakeetModelInstance,
    type ParakeetRuntimeBundle, type ParakeetTdtProfile, type ParakeetWorkerReply,
    type ParakeetWorkerRequest, type RuntimeTensor } from './contracts';

interface WorkerDependencies {
    loadRuntime(url: string): Promise<ParakeetRuntimeBundle>;
    postMessage(reply: ParakeetWorkerReply): void;
    createUrl(bytes: Uint8Array, mime: string): string;
    revokeUrl(url: string): void;
}

function assertModelMetadata(profile: ParakeetTdtProfile, files: Record<string, Uint8Array>): void {
    const config = JSON.parse(new TextDecoder().decode(files[profile.configurationFile])) as {
        model_type?: string; features_size?: number; subsampling_factor?: number;
    };
    if (config.model_type !== 'nemo-conformer-tdt' || config.features_size !== profile.melBins ||
        config.subsampling_factor !== profile.subsampling) throw new Error('Parakeet frontend configuration mismatch');
    const rows = new TextDecoder().decode(files[profile.vocabularyFile]).split(/\r?\n/).filter(line => line.trim());
    const ids = new Set<number>();
    let blank = -1;
    for (const row of rows) {
        const fields = row.trim().split(/\s+/);
        const id = Number(fields[1]);
        if (fields.length !== 2 || !Number.isSafeInteger(id) || id < 0 || id >= profile.vocabularySize || ids.has(id)) {
            throw new Error('Parakeet vocabulary contract mismatch');
        }
        ids.add(id);
        if (fields[0] === '<blk>') blank = id;
    }
    if (ids.size !== profile.vocabularySize || blank !== profile.blankId) throw new Error('Parakeet blank/vocabulary identity mismatch');
}

/** Probe the actual encoder and combined recurrent TDT outputs; upstream compatibility warnings cannot pass readiness. */
export async function probeParakeetTdt(model: ParakeetModelInstance, runtime: ParakeetRuntimeBundle,
    profile: ParakeetTdtProfile): Promise<void> {
    const constants = model.getStreamingConstants();
    if (constants.melBins !== profile.melBins || constants.blankId !== profile.blankId ||
        constants.subsampling !== profile.subsampling || constants.windowStride !== profile.windowStride) {
        throw new Error('Parakeet runtime frontend identity mismatch');
    }
    const encoder = model.encoderSession;
    const decoder = model.joinerSession;
    if (!['audio_signal', 'length'].every(name => encoder.inputNames.includes(name)) ||
        !encoder.outputNames.includes('outputs') ||
        !['encoder_outputs', 'targets', 'target_length', 'input_states_1', 'input_states_2']
            .every(name => decoder.inputNames.includes(name)) ||
        !['outputs', 'output_states_1', 'output_states_2'].every(name => decoder.outputNames.includes(name))) {
        throw new Error('Parakeet requires the encoder and combined recurrent TDT tensor contract');
    }
    const tensors = new Set<RuntimeTensor>();
    const tensor = (type: 'float32' | 'int32' | 'int64', data: Float32Array | Int32Array | BigInt64Array,
        dims: number[]): RuntimeTensor => {
        const value = new runtime.ort.Tensor(type, data, dims); tensors.add(value); return value;
    };
    const retain = (outputs: Record<string, RuntimeTensor>) => {
        for (const value of Object.values(outputs)) tensors.add(value);
        return outputs;
    };
    const finite = (value: RuntimeTensor | undefined): value is RuntimeTensor & { data: Float32Array } =>
        Boolean(value && value.data instanceof Float32Array && value.data.every(sample => Number.isFinite(sample)));
    try {
        const features = await model.computeFeatures(new Float32Array(1600), 16000);
        const length = features.validLength ?? features.T;
        if (features.melBins !== profile.melBins || !Number.isSafeInteger(features.T) || features.T <= 0 ||
            !Number.isSafeInteger(length) || length <= 0 || length > features.T ||
            features.features.length !== profile.melBins * features.T ||
            features.features.some(sample => !Number.isFinite(sample))) throw new Error('Parakeet feature warmup failed');
        const encoded = retain(await encoder.run({
            audio_signal: tensor('float32', features.features, [1, profile.melBins, features.T]),
            length: tensor('int64', BigInt64Array.from([BigInt(length)]), [1]),
        })).outputs;
        if (!finite(encoded) || encoded.dims.length !== 3 || encoded.dims[0] !== 1 ||
            !encoded.dims.slice(1).every(n => Number.isSafeInteger(n) && n > 0) ||
            encoded.data.length !== encoded.dims[1] * encoded.dims[2]) throw new Error('Parakeet encoder warmup contract failed');
        const channels = encoded.dims[1];
        const frames = encoded.dims[2];
        const frame = Float32Array.from({ length: channels }, (_, channel) => encoded.data[channel * frames]);
        const outputs = retain(await decoder.run({
            encoder_outputs: tensor('float32', frame, [1, channels, 1]),
            targets: tensor('int32', Int32Array.from([profile.blankId]), [1, 1]),
            target_length: tensor('int32', Int32Array.from([1]), [1]),
            input_states_1: tensor('float32', new Float32Array(2 * 640), [2, 1, 640]),
            input_states_2: tensor('float32', new Float32Array(2 * 640), [2, 1, 640]),
        }));
        if (!finite(outputs.outputs) || outputs.outputs.data.length <= profile.vocabularySize) {
            throw new Error('Parakeet TDT token and duration logits are required');
        }
        for (const name of ['output_states_1', 'output_states_2']) {
            const state = outputs[name];
            if (!finite(state) || state.dims.length !== 3 || state.dims[0] !== 2 || state.dims[1] !== 1 ||
                state.dims[2] !== 640 || state.data.length !== 1280) throw new Error('Parakeet recurrent state warmup failed');
        }
        const result = await model.transcribe(new Float32Array(1600), 16000);
        if (typeof result.utterance_text !== 'string') throw new Error('Parakeet transcript warmup failed');
        model.clearIncrementalCache();
        model.resetMelCache();
    } finally {
        for (const value of tensors) value.dispose();
    }
}

export function createParakeetWorker(dependencies: WorkerDependencies): (message: ParakeetWorkerRequest) => Promise<void> {
    let model: ParakeetModelInstance | null = null;
    let attemptedInit = false;
    let queue = Promise.resolve();
    const urls: string[] = [];
    const blobUrl = (bytes: Uint8Array, mime: string) => {
        const url = dependencies.createUrl(bytes, mime); urls.push(url); return url;
    };
    const execute = async (message: ParakeetWorkerRequest): Promise<void> => {
        try {
            if (message.type === 'init') {
                // Failed/partial init must retire the worker; it cannot reuse an uncertain ORT singleton.
                if (attemptedInit) throw new Error('Parakeet worker initialization already attempted');
                attemptedInit = true;
                const { profile, runtime: expected, files } = message;
                assertParakeetProfile(profile, expected);
                const required = requiredParakeetFiles(profile);
                if (Object.keys(files).length !== required.length || required.some(name =>
                    !(files[name] instanceof Uint8Array) || !files[name].byteLength)) throw new Error('Parakeet verified file inventory mismatch');
                assertModelMetadata(profile, files);
                const runtime = await dependencies.loadRuntime(message.runtimeUrl);
                if (runtime.bindingIdentity.package !== expected.package || runtime.bindingIdentity.version !== expected.version ||
                    runtime.bindingIdentity.ortVersion !== expected.ortVersion ||
                    runtime.ort.env.versions?.common !== expected.ortVersion) throw new Error('Parakeet pinned runtime binding mismatch');
                // Public ORT environment, configured BEFORE stock1.4.4's fromUrls. That release ignores
                // its wasmPaths argument. The owned bundle must expose the SAME ORT module it imports.
                // ORT1.24.1 glue resolves the binary filename even with wasmBinary supplied.
                // Explicit verified blob paths supply locateFile without resolving against a blob base.
                runtime.ort.env.wasm.wasmPaths = {
                    mjs: blobUrl(files[profile.wasmGlueFile], 'text/javascript'),
                    wasm: blobUrl(files[profile.wasmBinaryFile], 'application/wasm'),
                };
                runtime.ort.env.wasm.numThreads = 1;
                runtime.ort.env.wasm.proxy = false;
                const initialized = await runtime.ParakeetModel.fromUrls({
                    encoderUrl: blobUrl(files[profile.encoderFile], 'application/octet-stream'),
                    decoderUrl: blobUrl(files[profile.decoderFile], 'application/octet-stream'),
                    tokenizerUrl: blobUrl(files[profile.vocabularyFile], 'text/plain'),
                    backend: 'wasm', cpuThreads: 1, preprocessorBackend: 'js', nMels: profile.melBins,
                    subsampling: profile.subsampling, windowStride: profile.windowStride, enableGraphCapture: false,
                });
                if (initialized.ort !== runtime.ort) throw new Error('Parakeet model used a different ORT instance');
                await probeParakeetTdt(initialized, runtime, profile);
                model = initialized;
                dependencies.postMessage({ id: message.id, ok: true, type: 'ready', backend: 'wasm',
                    ortVersion: runtime.ort.env.versions!.common! });
            } else if (message.type === 'decode') {
                if (!model) throw new Error('Parakeet worker not ready');
                if (!(message.audio instanceof Float32Array) || !message.audio.length ||
                    message.audio.some(sample => !Number.isFinite(sample))) throw new Error('Parakeet requires finite mono PCM');
                const result = await model.transcribe(message.audio, 16000);
                if (typeof result.utterance_text !== 'string') throw new Error('Parakeet returned no utterance text');
                dependencies.postMessage({ id: message.id, ok: true, type: 'transcript', text: result.utterance_text });
            } else {
                throw new Error('Unknown Parakeet worker operation');
            }
        } catch (error) {
            logger.warn('[ParakeetTDT] Worker operation failed');
            model = null;
            for (const url of urls.splice(0)) dependencies.revokeUrl(url);
            dependencies.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
            // The adapter terminates this worker on failure. There is no upstream model.dispose API.
        }
    };
    return (message) => { queue = queue.then(() => execute(message)); return queue; };
}

if (typeof document === 'undefined' && typeof globalThis.postMessage === 'function') {
    const scope = globalThis as unknown as { postMessage(reply: ParakeetWorkerReply): void;
        onmessage: ((event: MessageEvent<ParakeetWorkerRequest>) => void) | null };
    const handle = createParakeetWorker({
        loadRuntime: (url) => import(/* @vite-ignore */ url) as Promise<ParakeetRuntimeBundle>,
        postMessage: reply => scope.postMessage(reply),
        createUrl: (bytes, mime) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })),
        revokeUrl: url => URL.revokeObjectURL(url),
    });
    scope.onmessage = ({ data }) => { void handle(data); };
}
