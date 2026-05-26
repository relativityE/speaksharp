// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelManager } from '../ModelManager';

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

const requiredWhisperTinyCacheUrls = [
    'http://localhost/models/whisper-tiny.en/config.json',
    'http://localhost/models/whisper-tiny.en/tokenizer.json',
    'http://localhost/models/whisper-tiny.en/preprocessor_config.json',
    'http://localhost/models/whisper-tiny.en/onnx/encoder_model_quantized.onnx',
    'http://localhost/models/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx',
];

const requiredWhisperTinyV4CacheUrls = [
    'http://localhost/models/onnx-community/whisper-tiny.en/config.json',
    'http://localhost/models/onnx-community/whisper-tiny.en/tokenizer.json',
    'http://localhost/models/onnx-community/whisper-tiny.en/preprocessor_config.json',
    'http://localhost/models/onnx-community/whisper-tiny.en/onnx/encoder_model.onnx',
    'http://localhost/models/onnx-community/whisper-tiny.en/onnx/decoder_model_merged_q4.onnx',
];

function stubTransformersCache(urls: string[], hasCache = true): void {
    const cacheStorage = {
        has: vi.fn(async (cacheName: string) => cacheName === 'transformers-cache' && hasCache),
        open: vi.fn(async () => ({
            keys: vi.fn(async () => urls.map(makeRequest)),
        })),
    } as unknown as CacheStorage;
    vi.stubGlobal('caches', cacheStorage);
}

type FakeIndexedDbOptions = {
    stores?: Record<string, number>;
    blocked?: boolean;
    openError?: boolean;
    upgradeNeeded?: boolean;
    transactionError?: boolean;
};

function stubIndexedDb({ stores = {}, blocked = false, openError = false, upgradeNeeded = false, transactionError = false }: FakeIndexedDbOptions = {}): void {
    const open = vi.fn(() => {
        const request = {
            result: {
                objectStoreNames: {
                    contains: (storeName: string) => Object.prototype.hasOwnProperty.call(stores, storeName),
                },
                transaction: (storeName: string) => {
                    if (transactionError) {
                        throw new Error('indexeddb-transaction-failed');
                    }
                    const tx = {
                        objectStore: () => ({
                            count: () => {
                                const countRequest = { result: stores[storeName] ?? 0, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
                                queueMicrotask(() => {
                                    countRequest.onsuccess?.();
                                    tx.oncomplete?.();
                                });
                                return countRequest;
                            },
                        }),
                        oncomplete: null as (() => void) | null,
                        onerror: null as (() => void) | null,
                        onabort: null as (() => void) | null,
                    };
                    return tx;
                },
                close: vi.fn(),
            },
            error: openError ? new Error('indexeddb-open-failed') : null,
            transaction: {
                abort: vi.fn(),
            },
            onerror: null as (() => void) | null,
            onblocked: null as (() => void) | null,
            onupgradeneeded: null as (() => void) | null,
            onsuccess: null as (() => void) | null,
        };

        queueMicrotask(() => {
            if (blocked) {
                request.onblocked?.();
                return;
            }
            if (upgradeNeeded) {
                request.onupgradeneeded?.();
                return;
            }
            if (openError) {
                request.onerror?.();
                return;
            }
            request.onsuccess?.();
        });

        return request;
    });

    vi.stubGlobal('indexedDB', { open });
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
        stubTransformersCache(requiredWhisperTinyCacheUrls);

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
        stubTransformersCache(requiredWhisperTinyV4CacheUrls.filter((url) => !url.endsWith('decoder_model_merged_q4.onnx')));

        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(false);
    });

    it('reports transformers-js-v4 available only when required split model assets are present', async () => {
        stubTransformersCache(requiredWhisperTinyV4CacheUrls);

        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(true);
    });

    it('returns expected model size estimates for each Private engine family', () => {
        expect(ModelManager.getModelSizeMB('transformers-js')).toBe(40);
        expect(ModelManager.getModelSizeMB('whisper-turbo')).toBe(75);
        expect(ModelManager.getModelSizeMB('transformers-js-v4')).toBeGreaterThan(0);
    });
});

describe('ModelManager Whisper Turbo IndexedDB contract', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('reports whisper-turbo unavailable when IndexedDB is unavailable', async () => {
        vi.stubGlobal('indexedDB', undefined);

        await expect(ModelManager.isModelDownloaded('whisper-turbo')).resolves.toBe(false);
    });

    it('reports whisper-turbo unavailable when only the model store has entries', async () => {
        stubIndexedDb({ stores: { models: 1 } });

        await expect(ModelManager.isModelDownloaded('whisper-turbo')).resolves.toBe(false);
    });

    it('reports whisper-turbo unavailable when only the availability store has entries', async () => {
        stubIndexedDb({ stores: { availableModels: 1 } });

        await expect(ModelManager.isModelDownloaded('whisper-turbo')).resolves.toBe(false);
    });

    it('reports whisper-turbo available only when both required stores have entries', async () => {
        stubIndexedDb({ stores: { models: 1, availableModels: 1 } });

        await expect(ModelManager.isModelDownloaded('whisper-turbo')).resolves.toBe(true);
    });

    it('fails closed when IndexedDB open is blocked, errors, or needs upgrade', async () => {
        stubIndexedDb({ stores: { models: 1, availableModels: 1 }, blocked: true });
        await expect(ModelManager.isModelDownloaded('whisper-turbo')).resolves.toBe(false);

        stubIndexedDb({ stores: { models: 1, availableModels: 1 }, openError: true });
        await expect(ModelManager.isModelDownloaded('whisper-turbo')).resolves.toBe(false);

        stubIndexedDb({ stores: { models: 1, availableModels: 1 }, upgradeNeeded: true });
        await expect(ModelManager.isModelDownloaded('whisper-turbo')).resolves.toBe(false);
    });

    it('fails closed when IndexedDB store probing throws after opening', async () => {
        stubIndexedDb({ stores: { models: 1, availableModels: 1 }, transactionError: true });

        await expect(ModelManager.isModelDownloaded('whisper-turbo')).resolves.toBe(false);
    });
});
