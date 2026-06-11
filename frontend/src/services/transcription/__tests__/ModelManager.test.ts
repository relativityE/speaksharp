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

// PRIVATE-BASE-DEFAULT: the default Private model is now whisper-base.en, so cache-availability
// for 'transformers-js' is gated on the base assets (same filenames, base path).
const requiredWhisperBaseCacheUrls = [
    'http://localhost/models/whisper-base.en/config.json',
    'http://localhost/models/whisper-base.en/tokenizer.json',
    'http://localhost/models/whisper-base.en/preprocessor_config.json',
    'http://localhost/models/whisper-base.en/onnx/encoder_model_quantized.onnx',
    'http://localhost/models/whisper-base.en/onnx/decoder_model_merged_quantized.onnx',
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
        stubTransformersCache(requiredWhisperTinyV4CacheUrls.filter((url) => !url.endsWith('decoder_model_merged_q4.onnx')));

        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(false);
    });

    it('reports transformers-js-v4 available only when required split model assets are present', async () => {
        stubTransformersCache(requiredWhisperTinyV4CacheUrls);

        await expect(ModelManager.isModelDownloaded('transformers-js-v4')).resolves.toBe(true);
    });

    it('returns expected model size estimates for each Private engine family', () => {
        // Default Private model is base.en (~80 MB) per PRIVATE-BASE-DEFAULT.
        expect(ModelManager.getModelSizeMB('transformers-js')).toBe(80);
        expect(ModelManager.getModelSizeMB('transformers-js-v4')).toBeGreaterThan(0);
    });
});
