/**
 * @file transformers-engine.test.ts
 * @description Unit tests for TransformersJSEngine logic (Architect Recommendation #1).
 * Verifies PCM processing and internal wiring without heavy WASM/Model downloads.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TransformersJSEngine } from '../TransformersJSEngine';
import { ENV } from '@/config/TestFlags';
import { PRIV_STT } from '../../sttConstants';
import { setupStrictZero } from '../../../../../../tests/setupStrictZero';

// Hoist mock factories to top of file
const { mockPipeline, mockEnv } = vi.hoisted(() => ({
    mockPipeline: vi.fn(),
    mockEnv: { allowLocalModels: false, allowRemoteModels: false, localModelPath: '/models/', useBrowserCache: true },
}));

// Mock the flagging system - aligned with window.__SS_E2E__
vi.mock('@/config/TestFlags', () => ({
    ENV: {
        IS_E2E: false,
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

    beforeEach(async () => {
        vi.clearAllMocks();
        
        // Final Architectural Directive: Test Harness owns mutation at T=0
        await setupStrictZero();

        window.__SS_E2E__ = {
            isActive: true,
            engineType: 'system',
            registry: {}
        };

        engine = new TransformersJSEngine({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });

        // Reset defaults
        mockPipeline.mockReset();
        mockEnv.allowLocalModels = false;

        // Default mock implementation - mirrors transformers.js ASR output shape.
        mockPipeline.mockImplementation(async (_task, _model, options) => {
            // Trigger the progress callback to satisfy the "trigger progress" test case
            if (options?.progress_callback) {
                options.progress_callback({ progress: 50 });
            }
            
            // Return a mock transcriber function
            return async (audio: Float32Array) => {
                if (!(audio instanceof Float32Array)) throw new Error('Invalid input');
                return { text: 'Mocked transcription result' };
            };
        });
    });

    afterEach(async () => {
        if (engine) {
            await engine.destroy();
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should have correct engine type', () => {
        expect(engine.type).toBe('transformers-js');
    });

    it('should initialize successfully', async () => {
        const callbacks = {
            onReady: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onTranscriptUpdate: vi.fn()
        };
        engine = new TransformersJSEngine(callbacks);
        const result = await engine.init();

        expect(result.isOk).toBe(true);
        expect(mockPipeline).toHaveBeenCalledWith(
            'automatic-speech-recognition',
            'whisper-base.en', // resolved local default (base.en), local-only — strict no-HF
            expect.objectContaining({ quantized: true })
        );
        expect(mockPipeline.mock.calls[0]?.[2]).not.toEqual(expect.objectContaining({ revision: 'main' }));
        expect(callbacks.onModelLoadProgress).toHaveBeenCalledWith(0);
        expect(callbacks.onReady).toHaveBeenCalled();
        expect(mockEnv.allowLocalModels).toBe(true);
    });

    it('should process PCM audio buffer correctly', async () => {
        // Init uses the default mockPipeline which returns 'Mocked transcription result'
        await engine.init();

        const pcmBuffer = new Float32Array(16000);
        const result = await engine.transcribe(pcmBuffer);

        expect(result.isOk).toBe(true);
        // Cast to success type to access .data strictly
        const successResult = result as unknown as { isOk: true; data: string };
        expect(successResult.data).toBe('Mocked transcription result');
    });

    it('uses short-chunk transcription options for live private updates', async () => {
        const transcriber = vi.fn(async () => ({ text: 'short live chunk' }));
        mockPipeline.mockImplementationOnce(async () => transcriber);

        await engine.init();
        const result = await engine.transcribe(new Float32Array(24000));

        expect(result.isOk).toBe(true);
        expect(transcriber).toHaveBeenCalledWith(expect.any(Float32Array), expect.objectContaining({
            chunk_length_s: PRIV_STT.WHISPER_WINDOW_SECONDS,
            stride_length_s: 0,
            return_timestamps: true,
        }));
    });

    it('uses Whisper stride only when the audio exceeds the model window', async () => {
        const transcriber = vi.fn(async () => ({ text: 'long chunk with stride' }));
        mockPipeline.mockImplementationOnce(async () => transcriber);

        await engine.init();
        const result = await engine.transcribe(new Float32Array((PRIV_STT.WHISPER_WINDOW_SECONDS + 1) * 16000));

        expect(result.isOk).toBe(true);
        expect(transcriber).toHaveBeenCalledWith(expect.any(Float32Array), expect.objectContaining({
            chunk_length_s: PRIV_STT.WHISPER_WINDOW_SECONDS,
            stride_length_s: PRIV_STT.WHISPER_STRIDE_SECONDS,
            return_timestamps: true,
        }));
    });

    it('does not reload the model when initialized twice', async () => {
        const callbacks = {
            onReady: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onTranscriptUpdate: vi.fn(),
        };
        engine = new TransformersJSEngine(callbacks);

        await expect(engine.init()).resolves.toEqual(expect.objectContaining({ isOk: true }));
        await expect(engine.init()).resolves.toEqual(expect.objectContaining({ isOk: true }));

        expect(mockPipeline).toHaveBeenCalledTimes(1);
        expect(callbacks.onReady).toHaveBeenCalled();
    });

    it('should read transformers.js ASR text output shape', async () => {
        mockPipeline.mockImplementationOnce(async () => {
            return async () => ({ text: 'And so my fellow Americans' });
        });

        await engine.init();

        const result = await engine.transcribe(new Float32Array(16000));

        expect(result.isOk).toBe(true);
        const successResult = result as unknown as { isOk: true; data: string };
        expect(successResult.data).toBe('And so my fellow Americans');
    });

    it('should read bare string ASR output shape', async () => {
        mockPipeline.mockImplementationOnce(async () => {
            return async () => 'Bare string transcription result';
        });

        await engine.init();

        const result = await engine.transcribe(new Float32Array(16000));

        expect(result.isOk).toBe(true);
        const successResult = result as unknown as { isOk: true; data: string };
        expect(successResult.data).toBe('Bare string transcription result');
    });

    it('should return an empty transcript for unknown object output shapes', async () => {
        mockPipeline.mockImplementationOnce(async () => {
            return async () => ({ chunks: [] });
        });

        await engine.init();

        const result = await engine.transcribe(new Float32Array(16000));

        expect(result.isOk).toBe(true);
        const successResult = result as unknown as { isOk: true; data: string };
        expect(successResult.data).toBe('');
    });

    it('should keep backward compatibility with legacy transcript output shape', async () => {
        mockPipeline.mockImplementationOnce(async () => {
            return async () => ({ transcript: 'Legacy transcription result' });
        });

        await engine.init();

        const result = await engine.transcribe(new Float32Array(16000));

        expect(result.isOk).toBe(true);
        const successResult = result as unknown as { isOk: true; data: string };
        expect(successResult.data).toBe('Legacy transcription result');
    });

    it('should fail if transcriber is not initialized', async () => {
        const pcmBuffer = new Float32Array(16000);
        const result = await engine.transcribe(pcmBuffer);

        expect(result.isOk === false).toBe(true);
        const errorResult = result as { isOk: false; error: Error };
        expect(errorResult.error.message).toContain('not initialized');
    });

    it('fails closed with a clear no-HF error when the local model is missing (no Hugging Face fallback)', async () => {
        mockPipeline.mockRejectedValueOnce(new Error('Local model missing'));

        const result = await engine.init();

        expect(result.isOk === false).toBe(true);
        const errorResult = result as { isOk: false; error: Error };
        expect(errorResult.error.message).toContain('PRIVATE_LOCAL_MODEL_UNAVAILABLE');
        // Exactly ONE load attempt (local); strict no-HF means no remote retry.
        expect(mockPipeline).toHaveBeenCalledTimes(1);
        expect(mockPipeline.mock.calls[0]?.[1]).not.toMatch(/^Xenova\//);
        expect(mockEnv.allowRemoteModels).not.toBe(true);
    });

    it('does NOT fall back to Hugging Face when the bundled local model is missing/corrupt (strict no-HF)', async () => {
        mockPipeline.mockRejectedValueOnce(new Error('Unexpected token < at position 0'));

        const result = await engine.init();

        expect(result.isOk === false).toBe(true);
        // Only the local attempt happened; no remote (Xenova / Hugging Face) retry.
        expect(mockPipeline).toHaveBeenCalledTimes(1);
        const calledModels = mockPipeline.mock.calls.map((c) => c[1]);
        expect(calledModels.some((m) => typeof m === 'string' && m.startsWith('Xenova/'))).toBe(false);
        expect(mockEnv.allowRemoteModels).not.toBe(true);
    });

    it('loads the resolved local model (base.en default), not a hardcoded model, and never enables remote', async () => {
        const result = await engine.init();

        expect(result.isOk).toBe(true);
        expect(mockPipeline).toHaveBeenCalledWith(
            'automatic-speech-recognition',
            'whisper-base.en',
            expect.objectContaining({ quantized: true })
        );
        // Strict no-HF: remote models are never enabled on the happy path.
        expect(mockEnv.allowRemoteModels).toBe(false);
    });

    it('should handle transcription errors', async () => {
        await engine.init();
        await engine.destroy(); // Clear existing transcriber to pick up the new mock
        mockPipeline.mockImplementationOnce(async () => {
            return async () => { throw new Error('Transcription failure'); };
        });
        // Non-cached init for this test to pick up the failing mock
        await engine.init();

        const result = await engine.transcribe(new Float32Array(16000));
        expect(result.isOk === false).toBe(true);
    });

    it('should exercise destroy method', async () => {
        await engine.init();
        await engine.destroy();
        await expect(engine.transcribe(new Float32Array(16000))).resolves.toEqual(expect.objectContaining({
            isOk: false,
        }));
    });

    it('exposes pause, resume, and terminate lifecycle methods without mutating transcript output', async () => {
        await engine.init();
        await expect(engine.pause()).resolves.toBeUndefined();
        await expect(engine.resume()).resolves.toBeUndefined();
        await expect(engine.terminate()).resolves.toBeUndefined();
        await expect(engine.transcribe(new Float32Array(16000))).resolves.toEqual(expect.objectContaining({
            isOk: false,
        }));
    });

    it('should exercise environmental branches', async () => {
        // Exercise logging paths by temporarily overriding the bridge state
        const original = ENV.IS_TEST_MODE;
        
        (ENV as unknown as Record<string, boolean>).IS_TEST_MODE = false;

        await engine.init();
        expect(engine).toBeDefined();

        // Reset
        (ENV as unknown as Record<string, boolean>).IS_TEST_MODE = original;
    });

    it('should handle "Unexpected token <" error specifically', async () => {
        mockPipeline
            .mockRejectedValueOnce(new Error("Unexpected token < at position 0"))
            .mockRejectedValueOnce(new Error("Remote model failed too"));

        const result = await engine.init();
        expect(result.isOk === false).toBe(true);
    });

    it('should trigger progress callback from transformers.js', async () => {
        const callbacks = { 
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            onTranscriptUpdate: vi.fn()
        };
        engine = new TransformersJSEngine(callbacks);
        await engine.init();
        expect(callbacks.onModelLoadProgress).toHaveBeenCalledWith(50);
    });

    it('should handle non-Error catch during init', async () => {
        mockPipeline
            .mockImplementationOnce(() => { throw "string error"; })
            .mockRejectedValueOnce(new Error('Remote model failed too'));
        const result = await engine.init();
        expect(result.isOk === false).toBe(true);
    });

    // MAXDEPTH Part 1 (observability): leaf engines must inherit the owning
    // service identity at construction so init logs are attributable. Before the
    // base-constructor fix they always reported serviceId='unknown', making a
    // single facade->leaf decorator init look like multiple orphan/"probe" engines.
    it('inherits serviceId/runId from constructor options (no orphan "unknown")', () => {
        const identified = new TransformersJSEngine({
            onTranscriptUpdate: vi.fn(),
            onReady: vi.fn(),
            serviceId: 'svc-abc',
            runId: 'run-xyz',
        } as unknown as ConstructorParameters<typeof TransformersJSEngine>[0]);
        expect((identified as unknown as { serviceId: string }).serviceId).toBe('svc-abc');
        expect((identified as unknown as { runId: string }).runId).toBe('run-xyz');
    });

    it('defaults serviceId/runId to "unknown" when options omit identity', () => {
        const anon = new TransformersJSEngine({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        expect((anon as unknown as { serviceId: string }).serviceId).toBe('unknown');
        expect((anon as unknown as { runId: string }).runId).toBe('unknown');
    });
});
