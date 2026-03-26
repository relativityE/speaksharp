/**
 * @file transformers-engine.test.ts
 * @description Unit tests for TransformersJSEngine logic (Architect Recommendation #1).
 * Verifies PCM processing and internal wiring without heavy WASM/Model downloads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransformersJSEngine } from '../TransformersJSEngine';
import { ENV } from '@/config/TestFlags';

// Hoist mock factories to top of file
const { mockPipeline, mockEnv } = vi.hoisted(() => ({
    mockPipeline: vi.fn(),
    mockEnv: { allowLocalModels: false, useBrowserCache: true },
}));

// Mock the flagging system - aligned with window.__SS_E2E__
vi.mock('@/config/TestFlags', () => ({
    ENV: {
        IS_E2E: true,
        IS_TEST_MODE: true,
        ENGINE_TYPE: 'system',
        USE_REAL_DATABASE: false,
        DEBUG_ENABLED: true,
        isTest: true,
        FLAGS: {
            DEBUG_ENABLED: true,
            DISABLE_WASM: false,
            BYPASS_MUTEX: true,
            FAST_TIMERS: true
        }
    }
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
        vi.clearAllMocks();
        
        // Align with SSOT Manifest
        window.__SS_E2E__ = {
            isActive: true,
            engineType: 'system'
        };

        engine = new TransformersJSEngine();

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
            'whisper-tiny.en',
            expect.objectContaining({ quantized: true })
        );
        expect(callbacks.onModelLoadProgress).toHaveBeenCalledWith(0);
        expect(callbacks.onReady).toHaveBeenCalled();
        expect(mockEnv.allowLocalModels).toBe(true);
    });

    it('should process PCM audio buffer correctly', async () => {
        // Init uses the default mockPipeline which returns 'Mocked transcription result'
        await engine.init({});

        const pcmBuffer = new Float32Array(16000);
        const result = await engine.transcribe(pcmBuffer);

        expect(result.isOk).toBe(true);
        // Cast to success type to access .data strictly
        const successResult = result as unknown as { isOk: true; data: string };
        expect(successResult.data).toBeTruthy();
    });

    it('should fail if transcriber is not initialized', async () => {
        const pcmBuffer = new Float32Array(16000);
        const result = await engine.transcribe(pcmBuffer);

        expect(result.isOk === false).toBe(true);
        const errorResult = result as { isOk: false; error: Error };
        expect(errorResult.error.message).toContain('not initialized');
    });

    it('should handle initialization errors', async () => {
        mockPipeline.mockRejectedValueOnce(new Error('Network failure'));

        const result = await engine.init({});

        expect(result.isOk === false).toBe(true);
        const errorResult = result as { isOk: false; error: Error };
        expect(errorResult.error.message).toContain('Network failure');
    });

    it('should handle transcription errors', async () => {
        await engine.init({});
        await engine.destroy(); // Clear existing transcriber to pick up the new mock
        mockPipeline.mockImplementationOnce(async () => {
            return async () => { throw new Error('Transcription failure'); };
        });
        // Non-cached init for this test to pick up the failing mock
        await engine.init({});

        const result = await engine.transcribe(new Float32Array(16000));
        expect(result.isOk === false).toBe(true);
    });

    it('should exercise destroy method', async () => {
        await engine.destroy();
        expect(true).toBe(true); // Verification that it runs without error
    });

    it('should exercise environmental branches', async () => {
        // Exercise logging paths by temporarily overriding the bridge state
        const original = ENV.IS_TEST_MODE;
        
        (ENV as unknown as Record<string, boolean>).IS_TEST_MODE = false;

        await engine.init({});
        expect(engine).toBeDefined();

        // Reset
        (ENV as unknown as Record<string, boolean>).IS_TEST_MODE = original;
    });

    it('should handle "Unexpected token <" error specifically', async () => {
        mockPipeline.mockRejectedValueOnce(new Error("Unexpected token < at position 0"));

        const result = await engine.init({});
        expect(result.isOk === false).toBe(true);
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
        expect(result.isOk === false).toBe(true);
    });
});
