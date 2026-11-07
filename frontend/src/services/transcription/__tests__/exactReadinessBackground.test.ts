// @vitest-environment jsdom
/**
 * PO finding on c821ccf6: readiness compared only a decoded path across both caches, so entries under another origin, another
 * revision, with a query, or in the cache the selected loader does not read reported AVAILABLE. A background warm-up then went
 * past the CACHE_MISS stop and reached initialization, i.e. a download without the consent prompt.
 *
 * Here the REAL facade (PrivateSTT.checkAvailability, the checked-in v2:base.en selection) answers availability over a cache
 * double, and the REAL TranscriptionService decides whether a background warm-up initializes. Only the cache and the engine's
 * init are doubles, so "init was never called" is the proof that nothing was fetched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { STTStrategyFactory } from '../STTStrategyFactory';
import { Result } from '../modes/types';
import { VERIFIED_MODEL_CACHE } from '../verifiedAssetFetch';
import type { NavigateFunction } from 'react-router-dom';

vi.mock('../STTStrategyFactory');
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() } }));

const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'generation_config.json',
    'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const exact = () => files.map(file => `${window.location.origin}/models/whisper-base.en/${file}`);
function cache(urls: readonly string[], name = 'transformers-cache') {
    vi.stubGlobal('caches', {
        has: vi.fn(async (cacheName: string) => cacheName === name),
        open: vi.fn(async () => ({ keys: vi.fn(async () => urls.map(url => ({ url }) as Request)) })),
    } as unknown as CacheStorage);
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function backgroundWarmUp() {
    const { PrivateSTT } = await import('../engines/PrivateSTT');
    const facade = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
    const availability = await facade.checkAvailability();
    const init = vi.fn().mockResolvedValue(Result.ok(undefined));
    vi.mocked(STTStrategyFactory.create).mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue(availability), init,
        start: vi.fn(), stop: vi.fn(), terminate: vi.fn().mockResolvedValue(undefined), getEngineType: vi.fn().mockReturnValue('private'),
    } as unknown as ReturnType<typeof STTStrategyFactory.create>);
    const service = new TranscriptionService({ onTranscriptUpdate: vi.fn(), onModelLoadProgress: vi.fn(), onReady: vi.fn(),
        onStatusChange: vi.fn(), session: null, navigate: vi.fn() as unknown as NavigateFunction, getAssemblyAIToken: vi.fn() });
    await service.warmUp('private');
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    return { availability, init };
}

describe('readiness through the real facade decides whether a background warm-up may initialize', () => {
    it('the exact keys the incumbent loader reads: AVAILABLE, and the warm-up initializes from cache', async () => {
        cache(exact());
        const { availability, init } = await backgroundWarmUp();
        expect(availability.isAvailable).toBe(true);
        expect(init).toHaveBeenCalled();
    });
    it.each([
        ['another origin (c821ccf6)', () => files.map(file => `https://other.example/models/whisper-base.en/${file}`), 'transformers-cache'],
        ['a query string (c821ccf6)', () => exact().map(url => `${url}?v=2`), 'transformers-cache'],
        ['the cache the incumbent loader does not read (c821ccf6)', exact, VERIFIED_MODEL_CACHE],
        ['the old five files, without tokenizer_config.json and generation_config.json (Codex P1 on 92b53931)',
            () => exact().filter(url => !url.endsWith('/tokenizer_config.json') && !url.endsWith('/generation_config.json')), 'transformers-cache'],
    ])('FALSE-READY: %s reports CACHE_MISS and the background warm-up never initializes (nothing fetched)', async (_label, urls, name) => {
        cache(urls(), name);
        const { availability, init } = await backgroundWarmUp();
        expect(availability).toMatchObject({ isAvailable: false, reason: 'CACHE_MISS' });
        expect(init).not.toHaveBeenCalled();
    });
});
