/**
 * Focus Points meaning model worker (default-off; see `config/focusMeaningMatcher.ts`).
 *
 * Mirrors the Private STT v2 loader (`transcription/engines/transformers-js.worker.ts`):
 *   - `@xenova/transformers` is imported DYNAMICALLY here, inside the worker, so it never enters the main bundle;
 *   - models load from our own origin (`/models/`) with remote loading OFF;
 *   - the ORT WASM runtime comes from our own origin (`transformersV2WasmAssets.ts`) with the shared thread policy.
 *
 * Acquisition is done here rather than by the library so that (a) progress is TRUTHFUL — bytes received over the
 * pinned total, not the library's per-file callbacks — and (b) every byte is verified against its sha256 and
 * length BEFORE it is cached or handed to the runtime. The library then reads the verified bytes from memory via
 * a scoped fetch guard; any other request under the model's directory is refused.
 *
 * Nothing here posts transcript text anywhere: inputs arrive by postMessage and only scores go back.
 */
import { computeWasmThreadCount, getHardwareThreads, isCrossOriginIsolated } from '../../transcription/utils/wasmThreads';
import { TRANSFORMERS_V2_WASM_PATH_PREFIX } from '../../transcription/engines/transformersV2WasmAssets';
import { MEANING_MODEL_CACHE, type MeaningResponsePin } from './meaningAssetPins';
import { MEANING_NOT_CACHED, type MeaningLoadMode, type MeaningWorkerRequest, type MeaningWorkerResponse } from './meaningWorkerProtocol';

type Tokenizer = (text: string, options: Record<string, unknown>) => Promise<Record<string, unknown>>;
type SequenceClassifier = ((inputs: Record<string, unknown>) => Promise<{ logits: { data: ArrayLike<number> } }>) & {
    config: { id2label?: Record<string, string> };
};

let tokenizer: Tokenizer | null = null;
let classifier: SequenceClassifier | null = null;
let entailIndex = -1;
let contradictIndex = -1;
/** One inference at a time; a timed-out caller's last question still finishes before the next starts. */
let queue: Promise<unknown> = Promise.resolve();

function post(response: MeaningWorkerResponse): void {
    self.postMessage(response);
}

const hex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

async function verified(bytes: ArrayBuffer, pin: MeaningResponsePin): Promise<boolean> {
    if (bytes.byteLength !== pin.bytes) return false;
    return hex(await crypto.subtle.digest('SHA-256', bytes)) === pin.sha256;
}

/** Stream one pinned file, reporting bytes as they arrive. */
async function download(pin: MeaningResponsePin, onBytes: (received: number) => void): Promise<ArrayBuffer> {
    const response = await fetch(pin.url, { credentials: 'same-origin' });
    if (!response.ok || !response.body) throw new Error('MEANING_MODEL_DOWNLOAD_FAILED');
    const reader = response.body.getReader();
    const out = new Uint8Array(pin.bytes);
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.byteLength > pin.bytes) throw new Error('MEANING_MODEL_INTEGRITY_FAILED');
        out.set(value, received);
        received += value.byteLength;
        onBytes(received);
    }
    if (received !== pin.bytes) throw new Error('MEANING_MODEL_INTEGRITY_FAILED');
    return out.buffer;
}

/**
 * Every pinned file, verified, as bytes in memory. Cached files are re-verified (a corrupt entry is deleted and,
 * in `download` mode, fetched again); missing files are fetched only in `download` mode.
 */
async function acquire(id: number, mode: MeaningLoadMode, pins: MeaningResponsePin[]): Promise<Map<string, ArrayBuffer>> {
    if (typeof caches === 'undefined') throw new Error('MEANING_MODEL_CACHE_UNAVAILABLE');
    const cache = await caches.open(MEANING_MODEL_CACHE);
    const total = pins.reduce((sum, p) => sum + p.bytes, 0);
    let done = 0;
    let lastPct = -1;
    const report = (bytes: number) => {
        const pct = total > 0 ? Math.min(100, Math.floor((bytes / total) * 100)) : 100;
        if (pct > lastPct) { lastPct = pct; post({ id, type: 'progress', pct }); }
    };
    const files = new Map<string, ArrayBuffer>();
    for (const pin of pins) {
        const cached = await cache.match(pin.url);
        if (cached) {
            const bytes = await cached.arrayBuffer();
            if (await verified(bytes, pin)) {
                files.set(pin.url, bytes);
                done += pin.bytes;
                report(done);
                continue;
            }
            await cache.delete(pin.url);
        }
        if (mode === 'cache-only') throw new Error(MEANING_NOT_CACHED);
        const base = done;
        const bytes = await download(pin, (received) => report(base + received));
        if (!(await verified(bytes, pin))) throw new Error('MEANING_MODEL_INTEGRITY_FAILED');
        await cache.put(pin.url, new Response(bytes.slice(0), {
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(pin.bytes) },
        }));
        files.set(pin.url, bytes);
        done += pin.bytes;
        report(done);
    }
    return files;
}

/** Serve the model directory from verified memory only; leave every other request (e.g. ORT wasm) alone. */
function installScopedFetch(files: Map<string, ArrayBuffer>, scope: string): () => void {
    const upstream = globalThis.fetch;
    const guarded: typeof fetch = async (input, init) => {
        const raw = input instanceof Request ? input.url : input.toString();
        const url = new URL(raw, self.location.href).href;
        if (!url.startsWith(scope)) return upstream(input, init);
        const bytes = files.get(url);
        if (!bytes) throw new Error('MEANING_MODEL_UNPINNED_REQUEST');
        return new Response(bytes.slice(0), {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength) },
        });
    };
    globalThis.fetch = guarded;
    return () => { if (globalThis.fetch === guarded) globalThis.fetch = upstream; };
}

async function load(request: Extract<MeaningWorkerRequest, { type: 'load' }>): Promise<void> {
    if (tokenizer && classifier) {
        post({ id: request.id, type: 'loaded', loadTimeMs: 0 });
        return;
    }
    const start = performance.now();
    const files = await acquire(request.id, request.mode, request.pins);

    const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import('@xenova/transformers');
    env.allowLocalModels = true;
    env.localModelPath = '/models/';
    env.allowRemoteModels = false;
    // The verified bytes come from our own cache; the library must not keep a second, unverified copy.
    env.useBrowserCache = false;
    try {
        const wasm = env.backends?.onnx?.wasm;
        if (wasm) {
            wasm.wasmPaths = TRANSFORMERS_V2_WASM_PATH_PREFIX;
            wasm.numThreads = computeWasmThreadCount(isCrossOriginIsolated(), getHardwareThreads());
            wasm.simd = true;
        }
    } catch {
        // Non-fatal: the runtime keeps its defaults.
    }

    const restore = installScopedFetch(files, request.scope);
    try {
        const tok = await AutoTokenizer.from_pretrained(request.modelId);
        const model = await AutoModelForSequenceClassification.from_pretrained(request.modelId, { quantized: true });
        const labels = (model as unknown as SequenceClassifier).config.id2label ?? {};
        const find = (prefix: string) => Number(Object.keys(labels).find((k) => labels[k].toLowerCase().startsWith(prefix)));
        entailIndex = find('entail');
        contradictIndex = find('contra');
        if (!Number.isInteger(entailIndex) || !Number.isInteger(contradictIndex)) throw new Error('MEANING_MODEL_LABELS_MISSING');
        tokenizer = tok as unknown as Tokenizer;
        classifier = model as unknown as SequenceClassifier;
    } catch (err) {
        const code = err instanceof Error && err.message.startsWith('MEANING_') ? err.message : 'MEANING_MODEL_LOAD_FAILED';
        throw new Error(code);
    } finally {
        restore();
        files.clear();
    }
    post({ id: request.id, type: 'loaded', loadTimeMs: Math.round(performance.now() - start) });
}

async function infer(id: number, premise: string, hypothesis: string): Promise<void> {
    if (!tokenizer || !classifier) throw new Error('MEANING_MODEL_NOT_LOADED');
    const inputs = await tokenizer(premise, { text_pair: hypothesis, padding: true, truncation: true });
    const { logits } = await classifier(inputs);
    const v = Array.from(logits.data);
    const m = Math.max(...v);
    const ex = v.map((x) => Math.exp(x - m));
    const z = ex.reduce((a, b) => a + b, 0);
    post({ id, type: 'nli-result', entail: ex[entailIndex] / z, contradict: ex[contradictIndex] / z });
}

self.onmessage = (event: MessageEvent<MeaningWorkerRequest>) => {
    const request = event.data;
    const run = async () => {
        switch (request.type) {
            case 'load': await load(request); break;
            case 'nli': await infer(request.id, request.premise, request.hypothesis); break;
            case 'destroy':
                tokenizer = null;
                classifier = null;
                post({ id: request.id, type: 'destroyed' });
                break;
        }
    };
    queue = queue.then(run).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '';
        // Codes only — never a message that could carry transcript text or a URL.
        post({ id: request.id, type: 'error', code: /^MEANING_[A-Z_]+$/.test(message) ? message : 'MEANING_WORKER_ERROR' });
    });
};
