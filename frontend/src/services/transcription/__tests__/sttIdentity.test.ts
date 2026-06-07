import { describe, it, expect } from 'vitest';
import { buildSttIdentity, PRIVATE_FALLBACK_MODEL } from '../sttIdentity';
import { PRIV_STT_MODELS } from '../sttConstants';
import { NOT_AVAILABLE } from '../sttEvidence';

const DEFAULT_MODEL = PRIV_STT_MODELS.DEFAULT;

describe('buildSttIdentity', () => {
    it('private + default base.en -> default status, v2 engine, local, wasm', () => {
        const id = buildSttIdentity({
            mode: 'private',
            privateModelKey: DEFAULT_MODEL,
            modelSelectionSource: 'default',
            modelOverridden: false,
            approxMB: 80,
        });
        expect(id.mode).toBe('private');
        expect(id.provider).toBe('transformers.js');
        expect(id.engine).toBe('transformers-js');
        expect(id.engineSelection).toBe('default');
        expect(id.modelId).toBe(DEFAULT_MODEL);
        expect(id.selectionSource).toBe('default');
        expect(id.approxMB).toBe(80);
        expect(id.modelSource).toBe('local'); // base.en is self-hosted
        expect(id.resolvedDevice).toBe('cpu');
        expect(id.backend).toBe('wasm');
        expect(id.fallbackOccurred).toBe(false);
        expect(id.releaseStatus).toBe('default');
        expect(id.userHidden).toBe(true);
    });

    it('private + tiny.en -> fallback status, local', () => {
        const id = buildSttIdentity({
            mode: 'private',
            privateModelKey: PRIVATE_FALLBACK_MODEL,
            modelSelectionSource: 'default',
            modelOverridden: false,
            approxMB: 40,
        });
        expect(id.modelId).toBe(PRIVATE_FALLBACK_MODEL);
        expect(id.modelSource).toBe('local');
        expect(id.releaseStatus).toBe('fallback');
    });

    it('private + explicit override -> override status, remote-only candidate', () => {
        const id = buildSttIdentity({
            mode: 'private',
            privateModelKey: 'whisper-small.en',
            modelSelectionSource: 'url',
            modelOverridden: true,
            approxMB: 244,
        });
        expect(id.releaseStatus).toBe('override');
        expect(id.selectionSource).toBe('url');
        expect(id.modelOverridden).toBe(true);
        expect(id.modelSource).toBe('remote'); // small.en is not self-hosted
    });

    it('private + v4 runtime -> experimental, webgpu, dtype/runtime/modelSource/fallback', () => {
        const id = buildSttIdentity({
            mode: 'private',
            privateModelKey: DEFAULT_MODEL, // ignored when v4 is present
            v4: {
                resolvedDevice: 'webgpu',
                backend: 'webgpu',
                dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
                modelId: 'onnx-community/whisper-base.en',
                modelSource: 'hf',
                fallbackOccurred: false,
                transformersVersion: '3.7.5',
                onnxRuntimeVersion: '1.x',
            },
        });
        expect(id.provider).toBe('transformers.js (webgpu)');
        expect(id.engine).toBe('transformers-js-v4');
        expect(id.modelId).toBe('onnx-community/whisper-base.en');
        expect(id.modelSource).toBe('remote'); // hf -> remote
        expect(id.resolvedDevice).toBe('webgpu');
        expect(id.backend).toBe('webgpu');
        expect(id.dtype).toBe('encoder_model=fp32,decoder_model_merged=q4');
        expect(id.fallbackOccurred).toBe(false);
        expect(id.runtimeVersion).toBe('3.7.5 / 1.x');
        expect(id.releaseStatus).toBe('experimental');
        expect(id.userHidden).toBe(true);
    });

    it('engine override flag flips engineSelection to override', () => {
        const id = buildSttIdentity({ mode: 'private', privateModelKey: DEFAULT_MODEL, engineOverride: 'transformers-js-v4' });
        expect(id.engineSelection).toBe('override');
    });

    it('cloud mode -> assemblyai, remote, not user-hidden', () => {
        const id = buildSttIdentity({ mode: 'cloud' });
        expect(id.provider).toBe('assemblyai');
        expect(id.engine).toBe('assemblyai');
        expect(id.modelId).toBe('universal-streaming');
        expect(id.modelSource).toBe('remote');
        expect(id.resolvedDevice).toBe('cloud');
        expect(id.releaseStatus).toBe('default');
        expect(id.userHidden).toBe(false);
    });

    it('native mode -> web-speech-api', () => {
        const id = buildSttIdentity({ mode: 'native' });
        expect(id.provider).toBe('web-speech-api');
        expect(id.engine).toBe('web-speech-api');
        expect(id.modelId).toBe('browser-native');
        expect(id.userHidden).toBe(false);
    });

    it('unknown/absent mode -> NOT_AVAILABLE engine, no crash', () => {
        const id = buildSttIdentity({});
        expect(id.mode).toBe(NOT_AVAILABLE);
        expect(id.provider).toBe(NOT_AVAILABLE);
        expect(id.engine).toBe(NOT_AVAILABLE);
        expect(id.modelSource).toBe(NOT_AVAILABLE);
        expect(id.fallbackOccurred).toBe(NOT_AVAILABLE);
        expect(id.engineSelection).toBe('default');
        expect(id.userHidden).toBe(false);
    });
});
