/**
 * #1263 — readiness must probe the SELECTED model's files.
 *
 * `isModelDownloaded` matched a fixed repository path (`whisper-base.en`) for every v4 candidate, so a
 * build configured for distil asked whether BASE was cached. It reported "downloaded" when base
 * happened to be present and distil was not, and "missing" when base was absent though distil was
 * there — in both directions the UI described a model the session would not run.
 *
 * Fixing only the reported SIZE, as the first pass did, corrected the number while leaving the answer
 * it accompanied wrong.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ModelManager } from '../ModelManager';
import { PRIV_STT_V4_VARIANTS } from '../sttConstants';

const BASE = PRIV_STT_V4_VARIANTS.base_q4.MODEL_ID;
const DISTIL = PRIV_STT_V4_VARIANTS.distil_q4.MODEL_ID;

/** A CacheStorage holding exactly one model's asset set. */
function cacheWith(modelId: string) {
    const files = [
        'config.json', 'tokenizer.json', 'preprocessor_config.json',
        'onnx/encoder_model.onnx', 'onnx/decoder_model_merged_q4.onnx',
    ];
    const keys = files.map((f) => ({ url: `https://huggingface.co/${modelId}/resolve/main/${f}` }));
    return {
        has: vi.fn(async () => true),
        open: vi.fn(async () => ({ keys: vi.fn(async () => keys) })),
    };
}

describe('v4 readiness probes the selected model', () => {
    const original = globalThis.caches;
    afterEach(() => { (globalThis as { caches?: unknown }).caches = original; vi.restoreAllMocks(); });
    beforeEach(() => { vi.restoreAllMocks(); });

    it('CASUALTY: a DISTIL build is NOT reported ready when only base is cached', async () => {
        (globalThis as { caches?: unknown }).caches = cacheWith(BASE);
        expect(await ModelManager.isModelDownloaded('transformers-js-v4', DISTIL)).toBe(false);
    });

    it('CASUALTY: a DISTIL build IS reported ready when distil is cached', async () => {
        // The other direction: base absent, distil present. The fixed path reported "missing".
        (globalThis as { caches?: unknown }).caches = cacheWith(DISTIL);
        expect(await ModelManager.isModelDownloaded('transformers-js-v4', DISTIL)).toBe(true);
    });

    it('POSITIVE CONTROL: a base build is still satisfied by base', async () => {
        (globalThis as { caches?: unknown }).caches = cacheWith(BASE);
        expect(await ModelManager.isModelDownloaded('transformers-js-v4', BASE)).toBe(true);
    });

    it('the two variants really are different repositories — otherwise this proves nothing', () => {
        expect(DISTIL).not.toBe(BASE);
    });
});
