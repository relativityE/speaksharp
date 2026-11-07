/**
 * Codex P2 on 66f048d0 (modelPackage.ts): Whisper admission required only `stride < window`, but the shipping decode builder
 * refuses `stride * 2 >= window`. A package declaring window 30 / stride 20 was sealed, verified and admitted, then failed
 * every transcription, short clips included. Admission now applies the decoder's own half-window rule.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CANDIDATES } from '../candidateRegistry';
import { candidateFromPackage, sealModelPackage } from '../modelPackage';
import { buildShippingDecodeOptions } from '../decodeOptions';

beforeAll(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('crypto', webcrypto); });

const localModelId = 'fixture-stride-whisper';
function whisperPackage(windowSeconds: number, strideSeconds: number) {
    const base = CANDIDATES['v2:base.en'];
    return sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'fixture:stride-whisper',
        engine: base.engine, runtime: base.runtime, model: { ...base.model, device: 'wasm' },
        execution: { ...base.execution, localModelId, decode: { ...base.execution.decode, windowSeconds, strideSeconds } } as never,
        assets: { servedFrom: `/models/${localModelId}`, files: base.assets.files!.map(f => ({ ...f, url: `/models/${localModelId}/${f.path}` })) },
        license: 'MIT (fixture declaration; no model copied)' } as never);
}

describe('a Whisper package is admitted only with a stride the shipping decoder can execute', () => {
    it.each([[30, 20], [30, 15], [10, 5]])('window %s s / stride %s s: refused at admission, and the decoder refuses it too', async (window, stride) => {
        await expect(whisperPackage(window, stride)).rejects.toThrow('UNSUPPORTED_WHISPER_PROFILE');
        expect(() => buildShippingDecodeOptions(60, { kind: 'whisper', windowSeconds: window, strideSeconds: stride, returnTimestamps: true } as never)).toThrow();
    });
    it.each([[30, 5], [30, 14.9], [30, 0]])('window %s s / stride %s s: admitted, and the decoder builds options for short and long audio', async (window, stride) => {
        const candidate = candidateFromPackage(await whisperPackage(window, stride), 'fixture.json');
        const profile = candidate.execution.decode as never;
        expect(buildShippingDecodeOptions(5, profile)).toMatchObject({ chunk_length_s: window, stride_length_s: 0 });
        expect(buildShippingDecodeOptions(60, profile)).toMatchObject({ chunk_length_s: window, stride_length_s: stride });
    });
});
