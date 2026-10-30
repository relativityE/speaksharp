/* Classic worker: ORT's pinned UMD bundle installs globalThis.ort via importScripts. */
let engine = null;
let glueUrl = null;
let queue = Promise.resolve();

async function execute(message) {
    const { id, type } = message;
    try {
        if (type === 'init') {
            if (engine) throw new Error('Granite worker already initialized');
            // URLs are constructed by the owned adapter from hash-verified runtime bytes and
            // the bundled core, never supplied by model descriptors as executable callbacks.
            importScripts(message.runtimeUrl);
            const ort = globalThis.ort;
            if (!ort?.InferenceSession || !ort?.env?.wasm) throw new Error('Pinned ORT runtime unavailable');
            glueUrl = URL.createObjectURL(new Blob([message.files['ort-wasm-simd-threaded.jsep.mjs']],
                { type: 'text/javascript' }));
            const binary = message.files['ort-wasm-simd-threaded.jsep.wasm'];
            ort.env.wasm.wasmBinary = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
            ort.env.wasm.wasmPaths = { mjs: glueUrl };
            ort.env.wasm.numThreads = 1;
            const { createGraniteCtcModule } = await import(/* @vite-ignore */ message.coreModuleUrl);
            engine = await createGraniteCtcModule(ort, message.files).CtcEngine.load({
                modelFile: message.modelFile, device: message.backend, allowFallback: false,
            });
            self.postMessage({ id, ok: true, backend: engine.device });
        } else if (type === 'decode') {
            if (!engine) throw new Error('Granite worker not initialized');
            const result = await engine.transcribe(message.audio, { applyAgc: message.applyAgc });
            self.postMessage({ id, ok: true, text: result.text });
        } else if (type === 'dispose') {
            await engine?.close();
            engine = null;
            if (glueUrl) URL.revokeObjectURL(glueUrl);
            glueUrl = null;
            self.postMessage({ id, ok: true });
        } else {
            throw new Error('Unknown Granite worker operation');
        }
    } catch (error) {
        self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
}

self.onmessage = ({ data }) => { queue = queue.then(() => execute(data)); };
