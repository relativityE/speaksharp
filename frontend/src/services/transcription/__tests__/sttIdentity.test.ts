import { describe, it, expect } from 'vitest';
import { buildSttIdentity, PRIVATE_FALLBACK_MODEL } from '../sttIdentity';
import { PRIV_STT_MODELS } from '../sttConstants';
import { NOT_AVAILABLE } from '../sttEvidence';

const DEFAULT_MODEL = PRIV_STT_MODELS.DEFAULT;

describe('buildSttIdentity', () => {
    it('private + default base.en -> release-default, v2 engine, wasm', () => {
        const id = buildSttIdentity({
            mode: 'private',
            privateModelKey: DEFAULT_MODEL,
            modelSelectionSource: 'default',
            modelOverridden: false,
            approxMB: 80,
        });
        expect(id.mode).toBe('private');
        expect(id.engine).toBe('transformers-js');
        expect(id.engineSelection).toBe('default');
        expect(id.model).toBe(DEFAULT_MODEL);
        expect(id.modelSelectionSource).toBe('default');
        expect(id.approxMB).toBe(80);
        expect(id.device).toBe('cpu');
        expect(id.backend).toBe('wasm');
        expect(id.releaseStatus).toBe('release-default');
        expect(id.userHidden).toBe(true);
    });

    it('private + tiny.en -> internal-fallback', () => {
        const id = buildSttIdentity({
            mode: 'private',
            privateModelKey: PRIVATE_FALLBACK_MODEL,
            modelSelectionSource: 'default',
            modelOverridden: false,
            approxMB: 40,
        });
        expect(id.model).toBe(PRIVATE_FALLBACK_MODEL);
        expect(id.releaseStatus).toBe('internal-fallback');
    });

    it('private + explicit override -> override status + override selection', () => {
        const id = buildSttIdentity({
            mode: 'private',
            privateModelKey: 'whisper-small.en',
            modelSelectionSource: 'url',
            modelOverridden: true,
            approxMB: 244,
        });
        expect(id.releaseStatus).toBe('override');
        expect(id.modelSelectionSource).toBe('url');
        expect(id.modelOverridden).toBe(true);
    });

    it('private + v4 runtime -> hidden-experimental with device/backend/dtype/runtime', () => {
        const id = buildSttIdentity({
            mode: 'private',
            privateModelKey: DEFAULT_MODEL, // ignored when v4 is present
            v4: {
                resolvedDevice: 'webgpu',
                backend: 'webgpu',
                dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
                modelId: 'onnx-community/whisper-base.en',
                transformersVersion: '3.7.5',
                onnxRuntimeVersion: '1.x',
            },
        });
        expect(id.engine).toBe('transformers-js-v4');
        expect(id.model).toBe('onnx-community/whisper-base.en');
        expect(id.device).toBe('webgpu');
        expect(id.backend).toBe('webgpu');
        expect(id.dtype).toBe('encoder_model=fp32,decoder_model_merged=q4');
        expect(id.runtimeVersion).toBe('3.7.5 / 1.x');
        expect(id.releaseStatus).toBe('hidden-experimental');
        expect(id.userHidden).toBe(true);
    });

    it('engine override flag flips engineSelection to override', () => {
        const id = buildSttIdentity({ mode: 'private', privateModelKey: DEFAULT_MODEL, engineOverride: 'transformers-js-v4' });
        expect(id.engineSelection).toBe('override');
    });

    it('cloud mode -> assemblyai, not user-hidden', () => {
        const id = buildSttIdentity({ mode: 'cloud' });
        expect(id.engine).toBe('assemblyai');
        expect(id.model).toBe('universal-streaming');
        expect(id.device).toBe('cloud');
        expect(id.releaseStatus).toBe('release-default');
        expect(id.userHidden).toBe(false);
    });

    it('native mode -> web-speech-api', () => {
        const id = buildSttIdentity({ mode: 'native' });
        expect(id.engine).toBe('web-speech-api');
        expect(id.model).toBe('browser-native');
        expect(id.userHidden).toBe(false);
    });

    it('unknown/absent mode -> NOT_AVAILABLE engine, no crash', () => {
        const id = buildSttIdentity({});
        expect(id.mode).toBe(NOT_AVAILABLE);
        expect(id.engine).toBe(NOT_AVAILABLE);
        expect(id.engineSelection).toBe('default');
        expect(id.userHidden).toBe(false);
    });
});
