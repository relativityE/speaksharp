/**
 * Codex (416770cd, modelPackage.ts): a Whisper package may omit the optional `execution.cacheFiles`. Admission
 * carried it through as undefined, and readiness (ModelManager) then fell back to a CANDIDATES lookup that cannot
 * contain an imported package, so the package reported CACHE_MISS forever, even with its whole inventory cached.
 * Admission now derives the supported layout's cache files, and validates a declared list against the inventory.
 * The readiness probe below is the real ModelManager over a CacheStorage double.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CANDIDATES } from '../candidateRegistry';
import { candidateFromPackage, sealModelPackage, verifyModelPackage, WHISPER_PACKAGE_CACHE_FILES } from '../modelPackage';
import { ModelManager } from '../ModelManager';

const localModelId = 'fixture-readiness-whisper';
beforeAll(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('crypto', webcrypto); });

async function whisperPackage(cacheFiles?: unknown) {
    const base = CANDIDATES['v2:base.en'];
    const execution = { ...base.execution };
    delete (execution as { cacheFiles?: unknown }).cacheFiles;
    return sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'fixture:readiness-whisper',
        engine: base.engine, runtime: base.runtime, model: { ...base.model, device: 'wasm' },
        execution: { ...execution, localModelId, ...(cacheFiles === undefined ? {} : { cacheFiles }) } as never,
        assets: { servedFrom: `/models/${localModelId}`, files: base.assets.files!.map(f => ({ ...f, url: `/models/${localModelId}/${f.path}` })) },
        license: 'MIT (fixture declaration; no model copied)' } as never);
}

function cached(files: readonly string[]) {
    // The package loader's verified fetch keys each entry by its pinned URL: this origin's served directory.
    const keys = files.map(file => ({ url: `${window.location.origin}/models/${localModelId}/${file}` }));
    vi.stubGlobal('caches', {
        has: vi.fn(async (name: string) => name === 'speaksharp-verified-model-v1'),
        open: vi.fn(async () => ({ keys: vi.fn(async () => keys) })),
    } as unknown as CacheStorage);
}

describe('an admitted Whisper package always carries its readiness requirements', () => {
    it('derives the supported layout when the optional list is absent: the same seven files the incumbent requires', async () => {
        const candidate = candidateFromPackage(await whisperPackage(), 'fixture.json');
        expect(candidate.execution.cacheFiles).toEqual(WHISPER_PACKAGE_CACHE_FILES);
        expect([...WHISPER_PACKAGE_CACHE_FILES]).toEqual([...CANDIDATES['v2:base.en'].execution.cacheFiles!]);
    });
    it('reports READY through the real probe once every derived file is cached, and not before', async () => {
        const candidate = candidateFromPackage(await whisperPackage(), 'fixture.json');
        cached(WHISPER_PACKAGE_CACHE_FILES);
        expect(await ModelManager.isModelDownloaded('transformers-js', localModelId, candidate.execution.cacheFiles, candidate)).toBe(true);
        for (const missing of WHISPER_PACKAGE_CACHE_FILES) {
            cached(WHISPER_PACKAGE_CACHE_FILES.filter(file => file !== missing));
            expect(await ModelManager.isModelDownloaded('transformers-js', localModelId, candidate.execution.cacheFiles, candidate), `missing ${missing}`).toBe(false);
        }
    });
    it('FALSE-READY 1: a cached preprocessor_config.json does not stand in for a missing config.json', async () => {
        // The probe matched by suffix, so this exact cache state reported READY before (PO review, 5462dad7).
        const candidate = candidateFromPackage(await whisperPackage(), 'fixture.json');
        cached(WHISPER_PACKAGE_CACHE_FILES.filter(file => file !== 'config.json'));
        expect(await ModelManager.isModelDownloaded('transformers-js', localModelId, candidate.execution.cacheFiles, candidate)).toBe(false);
    });
    it('FALSE-READY (92b53931 Codex P1): the derived set includes tokenizer_config.json and generation_config.json, so the old five-file cache is not ready', async () => {
        // The loader requests both (tokenizer_config.json fatally); with only the old five cached, initialization still downloaded.
        expect(WHISPER_PACKAGE_CACHE_FILES).toEqual(expect.arrayContaining(['tokenizer_config.json', 'generation_config.json']));
        const candidate = candidateFromPackage(await whisperPackage(), 'fixture.json');
        cached(WHISPER_PACKAGE_CACHE_FILES.filter(file => file !== 'tokenizer_config.json' && file !== 'generation_config.json'));
        expect(await ModelManager.isModelDownloaded('transformers-js', localModelId, candidate.execution.cacheFiles, candidate)).toBe(false);
        // A declared list from before the fix (no tokenizer_config.json / generation_config.json) is refused at admission.
        const oldFive = ['config.json', 'tokenizer.json', 'preprocessor_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
        await expect(whisperPackage(oldFive)).rejects.toThrow('UNSUPPORTED_WHISPER_CACHE_FILES');
    });
    it('FALSE-READY 2: a declared list that omits required files is refused at admission, so it can never report ready', async () => {
        // Before: admitted, and with only these two files cached the probe reported READY (PO review, 5462dad7).
        const partial = ['config.json', 'onnx/encoder_model_quantized.onnx'];
        await expect(whisperPackage(partial)).rejects.toThrow('UNSUPPORTED_WHISPER_CACHE_FILES');
    });
    it('keeps a declared list that is exactly the supported loader set (any order); refuses empty, duplicated, unshipped or non-array lists', async () => {
        const declared = [...WHISPER_PACKAGE_CACHE_FILES].reverse();
        const valid = await whisperPackage(declared);
        expect(candidateFromPackage(valid, 'fixture.json').execution.cacheFiles).toEqual(declared);
        for (const bad of [[], [...WHISPER_PACKAGE_CACHE_FILES, 'config.json'], [...WHISPER_PACKAGE_CACHE_FILES, 'onnx/decoder_model_merged_q4.onnx'], 'config.json']) {
            const changed = { ...valid, execution: { ...valid.execution, cacheFiles: bad } };
            await expect(verifyModelPackage(changed)).rejects.toThrow('UNSUPPORTED_WHISPER_CACHE_FILES');
        }
    });
    /**
     * Codex P2 on 26cd4fde: an extra declared entry (here vocab.json, which the package ships) was admitted, but the Xenova
     * loader only fetches the supported files, so readiness required a file that is never cached and stayed CACHE_MISS.
     */
    it('refuses a declared list with an extra file the loader never fetches, even one the package ships', async () => {
        await expect(whisperPackage([...WHISPER_PACKAGE_CACHE_FILES, 'vocab.json'])).rejects.toThrow('UNSUPPORTED_WHISPER_CACHE_FILES');
    });
});
