// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelManager } from '../ModelManager';
import { createVerifiedAssetFetch, VERIFIED_MODEL_CACHE } from '../verifiedAssetFetch';

vi.mock('@/config/TestFlags', () => ({
    ENV: {
        disableWasm: false,
    },
}));

vi.mock('@/lib/logger', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

const makeRequest = (url: string) => ({ url }) as Request;
// The incumbent's library loader resolves '/models/<model>/<file>' against THIS page's origin; readiness requires that exact key.
const ORIGIN = window.location.origin;

const requiredWhisperTinyCacheUrls = [
    `${ORIGIN}/models/whisper-tiny.en/config.json`,
    `${ORIGIN}/models/whisper-tiny.en/tokenizer.json`,
    `${ORIGIN}/models/whisper-tiny.en/tokenizer_config.json`,
    `${ORIGIN}/models/whisper-tiny.en/preprocessor_config.json`,
    `${ORIGIN}/models/whisper-tiny.en/generation_config.json`,
    `${ORIGIN}/models/whisper-tiny.en/onnx/encoder_model_quantized.onnx`,
    `${ORIGIN}/models/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx`,
];

// PRIVATE-BASE-DEFAULT: the default Private model is now whisper-base.en, so cache-availability
// for 'transformers-js' is gated on the base assets (same filenames, base path).
const requiredWhisperBaseCacheUrls = [
    `${ORIGIN}/models/whisper-base.en/config.json`,
    `${ORIGIN}/models/whisper-base.en/tokenizer.json`,
    `${ORIGIN}/models/whisper-base.en/tokenizer_config.json`,
    `${ORIGIN}/models/whisper-base.en/preprocessor_config.json`,
    `${ORIGIN}/models/whisper-base.en/generation_config.json`,
    `${ORIGIN}/models/whisper-base.en/onnx/encoder_model_quantized.onnx`,
    `${ORIGIN}/models/whisper-base.en/onnx/decoder_model_merged_quantized.onnx`,
];

// v4 rollout model is whisper-base.en (base_q4) — v4 has no tiny variant.
const requiredWhisperBaseV4CacheUrls = [
    'https://huggingface.co/onnx-community/whisper-base.en/resolve/main/config.json',
    'https://huggingface.co/onnx-community/whisper-base.en/resolve/main/tokenizer.json',
    'https://huggingface.co/onnx-community/whisper-base.en/resolve/main/tokenizer_config.json',
    'https://huggingface.co/onnx-community/whisper-base.en/resolve/main/preprocessor_config.json',
    'https://huggingface.co/onnx-community/whisper-base.en/resolve/main/generation_config.json',
    'https://huggingface.co/onnx-community/whisper-base.en/resolve/main/onnx/encoder_model.onnx',
    'https://huggingface.co/onnx-community/whisper-base.en/resolve/main/onnx/decoder_model_merged_q4.onnx',
];

function stubTransformersCache(urls: string[], hasCache = true, onlyCache = 'transformers-cache'): void {
    const cacheStorage = {
        has: vi.fn(async (cacheName: string) => cacheName === onlyCache && hasCache),
        open: vi.fn(async () => ({
            keys: vi.fn(async () => urls.map(makeRequest)),
        })),
    } as unknown as CacheStorage;
    vi.stubGlobal('caches', cacheStorage);
}

describe('ModelManager transformers cache contract', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('reports transformers-js unavailable when the cache does not exist', async () => {
        stubTransformersCache([], false);

        await expect(ModelManager.isModelDownloaded('transformers-js')).resolves.toBe(false);
    });

    it('reports transformers-js unavailable when the cache is empty', async () => {
        stubTransformersCache([]);

        await expect(ModelManager.isModelDownloaded('transformers-js')).resolves.toBe(false);
    });

    it('does not treat unrelated Transformers cache entries as the Whisper model', async () => {
        stubTransformersCache([
            'http://localhost/models/sentence-transformer/config.json',
            'http://localhost/models/sentence-transformer/tokenizer.json',
            'http://localhost/models/sentence-transformer/model.onnx',
        ]);

        await expect(ModelManager.isModelDownloaded('transformers-js')).resolves.toBe(false);
    });

    it('does not treat a partial Whisper cache as downloaded', async () => {
        stubTransformersCache(requiredWhisperTinyCacheUrls.filter((url) => !url.endsWith('decoder_model_merged_quantized.onnx')));

        await expect(ModelManager.isModelDownloaded('transformers-js')).resolves.toBe(false);
    });

    it('reports transformers-js available only when the required Whisper cache assets are present', async () => {
        // Default Private model is base.en (PRIVATE-BASE-DEFAULT) → availability gates on base assets.
        stubTransformersCache(requiredWhisperBaseCacheUrls);

        await expect(ModelManager.isModelDownloaded('transformers-js')).resolves.toBe(true);
    });

    it('fails closed when CacheStorage probing throws', async () => {
        vi.stubGlobal('caches', {
            has: vi.fn(async () => {
                throw new Error('cache-probe-failed');
            }),
        } as unknown as CacheStorage);

        await expect(ModelManager.isModelDownloaded('transformers-js')).resolves.toBe(false);
    });

    it('reports transformers-js-v4 unavailable when the cache does not exist or is empty', async () => {
        stubTransformersCache([], false);
        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(false);

        stubTransformersCache([]);
        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(false);
    });

    it('reports transformers-js-v4 unavailable when required split model assets are missing', async () => {
        stubTransformersCache(requiredWhisperBaseV4CacheUrls.filter((url) => !url.endsWith('decoder_model_merged_q4.onnx')), true, VERIFIED_MODEL_CACHE);

        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(false);
    });

    it('reports transformers-js-v4 available only when required split model assets are present', async () => {
        stubTransformersCache(requiredWhisperBaseV4CacheUrls, true, VERIFIED_MODEL_CACHE);
        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(true);
        // The same exact keys in the library cache, which the v4 loader never reads, are not ready.
        stubTransformersCache(requiredWhisperBaseV4CacheUrls);
        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(false);
    });

    it('returns expected model size estimates for each Private engine family', () => {
        // Default Private model is base.en (~80 MB) per PRIVATE-BASE-DEFAULT.
        expect(ModelManager.getModelSizeMB('transformers-js')).toBe(80);
        expect(ModelManager.getModelSizeMB('transformers-js-v4')).toBeGreaterThan(0);
    });
});

/**
 * A real, named, in-memory CacheStorage. The stub above answers `has`/`open` for any name with the same keys, which is why every
 * test passed while readiness reported CACHE_MISS after a successful v4 / package-v2 load (the loader wrote to
 * `speaksharp-verified-model-v1`, the probe read only `transformers-cache`). This one distinguishes caches, and the entries are
 * written by the REAL verified loader, not placed by the test.
 */
function memoryCacheStorage(): CacheStorage & { names(): string[] } {
    const stores = new Map<string, Map<string, Response>>();
    const cacheFor = (name: string) => {
        const entries = stores.get(name) ?? new Map<string, Response>();
        stores.set(name, entries);
        return {
            match: async (key: RequestInfo | URL) => entries.get(String(key instanceof Request ? key.url : key))?.clone(),
            put: async (key: RequestInfo | URL, response: Response) => { entries.set(String(key instanceof Request ? key.url : key), response); },
            keys: async () => [...entries.keys()].map(makeRequest),
        } as unknown as Cache;
    };
    return {
        has: async (name: string) => stores.has(name),
        open: async (name: string) => cacheFor(name),
        match: async (key: RequestInfo | URL) => {
            for (const entries of stores.values()) { const hit = entries.get(String(key instanceof Request ? key.url : key)); if (hit) return hit.clone(); }
            return undefined;
        },
        delete: async (name: string) => stores.delete(name),
        keys: async () => [...stores.keys()],
        names: () => [...stores.keys()],
    } as unknown as CacheStorage & { names(): string[] };
}

async function loadThroughVerifiedFetch(storage: CacheStorage, urls: readonly string[]): Promise<void> {
    const encode = (text: string): ArrayBuffer => {
        const bytes = new TextEncoder().encode(text);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    };
    const bodies = new Map(urls.map((url) => [url, encode(`bytes of ${url}`)]));
    const sha = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((n) => n.toString(16).padStart(2, '0')).join('');
    const pins = await Promise.all(urls.map(async (url) => ({ url, sha256: await sha(bodies.get(url)!), bytes: bodies.get(url)!.byteLength })));
    const upstream = (async (input: RequestInfo | URL) => new Response(bodies.get(String(input))!)) as typeof fetch;
    const verifiedFetch = createVerifiedAssetFetch(pins, ['https://huggingface.co/onnx-community/whisper-base.en/'], upstream, storage);
    for (const url of urls) await verifiedFetch(url);
}

describe('ModelManager readiness against the cache the verified loaders actually write (#1760 finding A)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('reports a package loaded through the real verified fetch as downloaded, with no consent prompt and no library cache', async () => {
        const storage = memoryCacheStorage();
        vi.stubGlobal('caches', storage);
        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(false);   // before the first load: a true first use
        await loadThroughVerifiedFetch(storage, requiredWhisperBaseV4CacheUrls);
        expect(storage.names()).toEqual([VERIFIED_MODEL_CACHE]);                                   // the loader never touched transformers-cache
        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(true);    // broken before: CACHE_MISS after every load
    });

    it('still requires every required asset: a partial verified cache is not ready', async () => {
        const storage = memoryCacheStorage();
        vi.stubGlobal('caches', storage);
        await loadThroughVerifiedFetch(storage, requiredWhisperBaseV4CacheUrls.filter((url) => !url.endsWith('decoder_model_merged_q4.onnx')));
        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(false);
    });

    it('is not satisfied by unrelated verified-cache entries', async () => {
        const storage = memoryCacheStorage();
        vi.stubGlobal('caches', storage);
        await loadThroughVerifiedFetch(storage, ['http://localhost/models/sentence-transformer/config.json']);
        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(false);
    });

    it('each loader is ready only from the cache it reads: v4 from the verified cache, the incumbent from the library cache', async () => {
        // PO finding on c821ccf6 (4): readiness accepted the union of both caches, so a file present only in the cache the selected
        // loader does not read reported READY and the loader then went to the network.
        const storage = memoryCacheStorage();
        vi.stubGlobal('caches', storage);
        const [first, ...rest] = requiredWhisperBaseV4CacheUrls;
        await loadThroughVerifiedFetch(storage, rest);
        await (await storage.open('transformers-cache')).put(first, new Response('x'));
        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(false);
        const incumbent = memoryCacheStorage();
        vi.stubGlobal('caches', incumbent);
        const library = await incumbent.open('transformers-cache');
        for (const url of requiredWhisperBaseCacheUrls) await library.put(url, new Response('x'));
        await expect(ModelManager.isModelDownloaded('transformers-js')).resolves.toBe(true);
        const verifiedOnly = memoryCacheStorage();
        vi.stubGlobal('caches', verifiedOnly);
        const verified = await verifiedOnly.open(VERIFIED_MODEL_CACHE);
        for (const url of requiredWhisperBaseCacheUrls) await verified.put(url, new Response('x'));
        await expect(ModelManager.isModelDownloaded('transformers-js')).resolves.toBe(false);
    });
});

describe('readiness matches the selected loader\'s exact request identities (PO reviews of 5462dad7 and c821ccf6)', () => {
    beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
    const json = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'generation_config.json'];
    const files = [...json, 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
    const v4Files = [...json, 'onnx/encoder_model.onnx', 'onnx/decoder_model_merged_q4.onnx'];
    const at = (prefix: string, list = files) => list.map(file => `${prefix}/${file}`);
    const v4Ready = () => ModelManager.isModelDownloaded('transformers-js-v4', 'onnx-community/whisper-base.en', v4Files);

    it('accepts exactly the keys the loaders read: this origin\'s /models/<model>/<file>, and the pinned Hub revision in the verified cache', async () => {
        stubTransformersCache(at(`${ORIGIN}/models/whisper-base.en`));
        await expect(ModelManager.isModelDownloaded('transformers-js', 'whisper-base.en', files)).resolves.toBe(true);
        stubTransformersCache(at('https://huggingface.co/onnx-community/whisper-base.en/resolve/main', v4Files), true, VERIFIED_MODEL_CACHE);
        await expect(v4Ready()).resolves.toBe(true);
    });
    it('a different file whose name ends with the required one does not count (preprocessor_config.json is not config.json)', async () => {
        stubTransformersCache(at(`${ORIGIN}/models/whisper-base.en`).filter(url => !url.endsWith('/config.json') || url.endsWith('preprocessor_config.json')));
        await expect(ModelManager.isModelDownloaded('transformers-js', 'whisper-base.en', files)).resolves.toBe(false);
    });
    it('another model directory containing this name, or a nested path, does not count', async () => {
        for (const prefix of [`${ORIGIN}/models/distil-whisper-base.en`, `${ORIGIN}/models/whisper-base.en-old`,
            `${ORIGIN}/models/whisper-base.en/stale`, `${ORIGIN}/other/models/whisper-base.en`]) {
            stubTransformersCache(at(prefix));
            // each prefix above must not count
            expect(await ModelManager.isModelDownloaded('transformers-js', 'whisper-base.en', files)).toBe(false);
        }
        stubTransformersCache(at('https://huggingface.co/onnx-community/whisper-base.en/resolve/main/extra', v4Files), true, VERIFIED_MODEL_CACHE);
        await expect(v4Ready()).resolves.toBe(false);
    });
    it('FALSE-READY (92b53931 Codex P1): the old five-file cache, without tokenizer_config.json and generation_config.json, is not ready', async () => {
        // Both loaders request these two files; with only the old five cached, initialization still downloaded them.
        const oldFive = (list: string[]) => list.filter(file => file !== 'tokenizer_config.json' && file !== 'generation_config.json');
        stubTransformersCache(at(`${ORIGIN}/models/whisper-base.en`, oldFive(files)));
        await expect(ModelManager.isModelDownloaded('transformers-js')).resolves.toBe(false);
        stubTransformersCache(at('https://huggingface.co/onnx-community/whisper-base.en/resolve/main', oldFive(v4Files)), true, VERIFIED_MODEL_CACHE);
        await expect(ModelManager.isModelDownloaded('transformers-js-v4', 'onnx-community/whisper-base.en')).resolves.toBe(false);
        for (const missing of ['tokenizer_config.json', 'generation_config.json']) {
            stubTransformersCache(at(`${ORIGIN}/models/whisper-base.en`, files.filter(file => file !== missing)));
            expect(await ModelManager.isModelDownloaded('transformers-js'), `missing ${missing}`).toBe(false);
        }
        // With all seven cached, the registry-derived requirements report ready for both loaders.
        stubTransformersCache(at(`${ORIGIN}/models/whisper-base.en`));
        await expect(ModelManager.isModelDownloaded('transformers-js')).resolves.toBe(true);
        stubTransformersCache(at('https://huggingface.co/onnx-community/whisper-base.en/resolve/main', v4Files), true, VERIFIED_MODEL_CACHE);
        await expect(ModelManager.isModelDownloaded('transformers-js-v4', 'onnx-community/whisper-base.en')).resolves.toBe(true);
    });
    it('FALSE-READY (c821ccf6): another origin, another Hub revision or a query string does not count', async () => {
        // The incumbent: the same path under another origin, or with a query, is not the key the loader looks up.
        for (const urls of [at('https://other.example/models/whisper-base.en'), at(`${ORIGIN}/models/whisper-base.en`).map(url => `${url}?v=2`)]) {
            stubTransformersCache(urls);
            expect(await ModelManager.isModelDownloaded('transformers-js', 'whisper-base.en', files)).toBe(false);
        }
        // v4: an old revision, another host, or a query is never the pinned request the verified fetch serves.
        for (const urls of [at('https://huggingface.co/onnx-community/whisper-base.en/resolve/old-revision', v4Files),
            at('https://other.example/onnx-community/whisper-base.en/resolve/main', v4Files),
            at('https://huggingface.co/onnx-community/whisper-base.en/resolve/main', v4Files).map(url => `${url}?download=1`)]) {
            stubTransformersCache(urls, true, VERIFIED_MODEL_CACHE);
            expect(await v4Ready()).toBe(false);
        }
    });
});
