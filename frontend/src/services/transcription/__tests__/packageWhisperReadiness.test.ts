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
    const keys = files.map(file => ({ url: `http://localhost/models/${localModelId}/${file}` }));
    vi.stubGlobal('caches', {
        has: vi.fn(async (name: string) => name === 'speaksharp-verified-model-v1'),
        open: vi.fn(async () => ({ keys: vi.fn(async () => keys) })),
    } as unknown as CacheStorage);
}

describe('an admitted Whisper package always carries its readiness requirements', () => {
    it('derives the supported layout when the optional list is absent: the same five files the incumbent requires', async () => {
        const candidate = candidateFromPackage(await whisperPackage(), 'fixture.json');
        expect(candidate.execution.cacheFiles).toEqual(WHISPER_PACKAGE_CACHE_FILES);
        expect([...WHISPER_PACKAGE_CACHE_FILES]).toEqual([...CANDIDATES['v2:base.en'].execution.cacheFiles!]);
    });
    it('reports READY through the real probe once every derived file is cached, and not before', async () => {
        const candidate = candidateFromPackage(await whisperPackage(), 'fixture.json');
        cached(WHISPER_PACKAGE_CACHE_FILES);
        expect(await ModelManager.isModelDownloaded('transformers-js', localModelId, candidate.execution.cacheFiles)).toBe(true);
        // Missing the encoder. (Dropping config.json would not be detected: the probe's suffix match lets
        // preprocessor_config.json satisfy it, a pre-existing ModelManager weakness tracked separately.)
        cached(WHISPER_PACKAGE_CACHE_FILES.filter(file => file !== 'onnx/encoder_model_quantized.onnx'));
        expect(await ModelManager.isModelDownloaded('transformers-js', localModelId, candidate.execution.cacheFiles)).toBe(false);
    });
    it('keeps a valid declared list, and refuses a declared list that is empty, duplicated or names an unshipped file', async () => {
        const declared = ['config.json', 'onnx/encoder_model_quantized.onnx'];
        expect(candidateFromPackage(await whisperPackage(declared), 'fixture.json').execution.cacheFiles).toEqual(declared);
        const valid = await whisperPackage(declared);
        for (const bad of [[], ['config.json', 'config.json'], ['onnx/decoder_model_merged_q4.onnx'], 'config.json']) {
            const changed = { ...valid, execution: { ...valid.execution, cacheFiles: bad } };
            await expect(verifyModelPackage(changed)).rejects.toThrow('UNSUPPORTED_WHISPER_CACHE_FILES');
        }
    });
});
