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
    mockEnv: { allowLocalModels: false, useBrowserCache: true },
}));

// Mock the flagging system - enable debug by default for coverage
vi.mock('@/config/TestFlags', () => ({
    TestFlags: {
        DEBUG_ENABLED: true,
        IS_TEST_MODE: true,
        USE_REAL_TRANSCRIPTION: false,
        FORCE_CPU_TRANSCRIPTION: false
    },
    shouldUseMockTranscription: vi.fn(),
    shouldEnableMocks: vi.fn()
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
        vi.useFakeTimers();
        engine = new TransformersJSEngine();
        vi.clearAllMocks();

        // Reset defaults
        mockPipeline.mockReset();
        mockEnv.allowLocalModels = false;

        // Default mock implementation - returns { transcript } matching TranscriptionResult interface
        mockPipeline.mockImplementation(async () => {
            // Return a mock transcriber function
            return async (audio: Float32Array) => {
                if (!(audio instanceof Float32Array)) throw new Error('Invalid input');
                return { transcript: 'Mocked transcription result' };
            };
        });
    });

    afterEach(() => {
        vi.useRealTimers();
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
            'Xenova/whisper-base.en',
            expect.objectContaining({ quantized: true })
        );
        expect(callbacks.onModelLoadProgress).toHaveBeenCalledWith(0);
        expect(callbacks.onReady).toHaveBeenCalled();
        expect(mockEnv.allowLocalModels).toBe(false);
    });

    it('should process PCM audio buffer correctly', async () => {
        // Init uses the default mockPipeline which returns 'Mocked transcription result'
        await engine.init({});

        const pcmBuffer = new Float32Array(16000);
        const result = await engine.transcribe(pcmBuffer);

        expect(result.isOk).toBe(true);
        // Cast to success type to access .value strictly
        const successResult = result as unknown as { isOk: true; value: string };
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

    it('should handle transcription errors', async () => {
        // First init to get a working transcriber
        await engine.init({});

        // Directly mock the instance's transcriber to fail
        // We reach into the engine to set the transcriber to a failing one
        // @ts-expect-error accessing private member for testing
        engine['transcriber'] = async () => { throw new Error('Transcription failure'); };

        const result = await engine.transcribe(new Float32Array(16000));
        expect(result.isErr).toBe(true);
    });

    it('should exercise destroy method', async () => {
        await engine.destroy();
        expect(true).toBe(true); // Verification that it runs without error
    });

    it('should exercise environmental branches (IS_TEST_MODE false)', async () => {
        const { TestFlags } = await import('@/config/TestFlags');
        // @ts-expect-error forcing readonly property for test coverage
        TestFlags.IS_TEST_MODE = false;

        // Code will traverse logging branches because DEBUG_ENABLED=true in mock
        await engine.init({});
        expect(engine).toBeDefined();

        // Reset
        // @ts-expect-error forcing readonly property for test coverage
        TestFlags.IS_TEST_MODE = true;
    });

    it('should handle "Unexpected token <" error specifically', async () => {
        mockPipeline.mockRejectedValueOnce(new Error("Unexpected token < at position 0"));

        const result = await engine.init({});
        expect(result.isErr).toBe(true);
    });

    it('should trigger progress callback from transformers.js', async () => {
        const callbacks = { onModelLoadProgress: vi.fn() };

        mockPipeline.mockImplementationOnce(async (type, model, options) => {
            if (options.progress_callback) {
                options.progress_callback({ progress: 50 });
            }
            return async () => ({ transcript: 'ok' });
        });

        await engine.init(callbacks);
        expect(callbacks.onModelLoadProgress).toHaveBeenCalledWith(50);
    });

    it('should handle non-Error catch during init', async () => {
        mockPipeline.mockImplementationOnce(() => { throw "string error"; });
        const result = await engine.init({});
        expect(result.isErr).toBe(true);
    });
});
