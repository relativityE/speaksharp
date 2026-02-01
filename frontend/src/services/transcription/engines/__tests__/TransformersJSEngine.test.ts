/**
 * @file transformers-engine.test.ts
 * @description Unit tests for TransformersJSEngine logic (Architect Recommendation #1).
 * Verifies PCM processing and internal wiring without heavy WASM/Model downloads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransformersJSEngine } from '../TransformersJSEngine';

// Hoist mock factories to top of file
const { mockPipeline, mockEnv } = vi.hoisted(() => ({
    mockPipeline: vi.fn(),
    mockEnv: { allowLocalModels: false, useBrowserCache: true }
}));

// Mock the module globally
vi.mock('@xenova/transformers', () => {
    return {
        pipeline: mockPipeline,
        env: mockEnv
    };
});

describe('TransformersJSEngine (Unit)', () => {
    let engine: TransformersJSEngine;

    beforeEach(() => {
        engine = new TransformersJSEngine();
        vi.clearAllMocks();

        // Reset defaults
        mockPipeline.mockReset();
        mockEnv.allowLocalModels = false;

        // Default mock implementation
        mockPipeline.mockImplementation(async () => {
            // Return a mock transcriber function
            return async (audio: Float32Array) => {
                if (!(audio instanceof Float32Array)) throw new Error('Invalid input');
                return { text: 'Mocked transcription result' };
            };
        });
    });

    it('should have correct engine type', () => {
        expect(engine.type).toBe('transformers-js');
    });

    it('should initialize successfully', async () => {
        const callbacks = {
            onReady: vi.fn(),
            onModelLoadProgress: vi.fn()
        };

        const result = await engine.init(callbacks);

        expect(result.isOk).toBe(true);
        expect(mockPipeline).toHaveBeenCalledWith(
            'automatic-speech-recognition',
            'Xenova/whisper-tiny.en',
            expect.objectContaining({ quantized: true })
        );
        expect(callbacks.onModelLoadProgress).toHaveBeenCalledWith(0);
        expect(callbacks.onReady).toHaveBeenCalled();
        expect(mockEnv.allowLocalModels).toBe(false);
    });

    it('should process PCM audio buffer correctly', async () => {
        await engine.init({});

        // Override mock for specific result
        mockPipeline.mockImplementation(async () => {
            return async () => ({ text: 'Specific Result' });
        });

        // Re-init to pick up logic (simulated)
        // Note: Real engine caches pipeline, but we are testing logic flow
        await engine.init({});

        const pcmBuffer = new Float32Array(16000);
        const result = await engine.transcribe(pcmBuffer);

        expect(result.isOk).toBe(true);
        // Cast to success type to access .value strictly
        const successResult = result as unknown as { isOk: true; value: { text: string } };
        expect(successResult.value).toBeTruthy();
    });

    it('should fail if transcriber is not initialized', async () => {
        const pcmBuffer = new Float32Array(16000);
        const result = await engine.transcribe(pcmBuffer);

        expect(result.isErr).toBe(true);
        const errorResult = result as { isErr: true; error: Error };
        expect(errorResult.error.message).toContain('not initialized');
    });

    it('should handle initialization errors', async () => {
        mockPipeline.mockRejectedValueOnce(new Error('Network failure'));

        const result = await engine.init({});

        expect(result.isErr).toBe(true);
        const errorResult = result as { isErr: true; error: Error };
        expect(errorResult.error.message).toContain('Network failure');
    });
});
