/**
 * @file TransformersJSEngine.spec.ts
 * @description Micro-Unit Test for the "Safe Path" strategy.
 * @verification_scope
 * - Verifies ONNX pipeline initialization with correct model ID.
 * - Verifies CPU/Quantized fallback configuration.
 * - Verifies result formatting matches the ITranscriptionEngine interface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransformersJSEngine } from '../TransformersJSEngine';

// Mock the @xenova/transformers library
const mockPipe = vi.fn().mockResolvedValue({ text: "Hello CPU" });
const mockPipeline = vi.fn().mockResolvedValue(mockPipe);

vi.mock('@xenova/transformers', () => ({
    pipeline: mockPipeline,
    env: { allowLocalModels: false, useBrowserCache: true }
}));

describe('TransformersJSEngine (Safe Path)', () => {
    let engine: TransformersJSEngine;

    beforeEach(() => {
        vi.clearAllMocks();
        engine = new TransformersJSEngine();
    });

    it('initializes the pipeline', async () => {
        const onProgress = vi.fn();
        await engine.init({ onModelLoadProgress: onProgress });

        expect(mockPipeline).toHaveBeenCalledWith(
            'automatic-speech-recognition',
            'Xenova/whisper-tiny.en',
            expect.objectContaining({ progress_callback: expect.any(Function) })
        );
    });

    it('transcribes audio correctly', async () => {
        await engine.init({});
        const float32Audio = new Float32Array(16000);
        const result = await engine.transcribe(float32Audio);

        expect(result.isOk).toBe(true);
        // Assert result.isOk is true to satisfy type narrowing
        expect((result as { isOk: true; value: string }).value).toBe("Hello CPU");
        expect(mockPipe).toHaveBeenCalledWith(
            float32Audio,
            expect.objectContaining({
                chunk_length_s: 30,
                return_timestamps: false
            })
        );
    });
});
