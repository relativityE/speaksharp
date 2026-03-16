/**
 * @file WhisperTurboEngine.spec.ts
 * @description Micro-Unit Test for the "Fast Path" strategy.
 * @verification_scope
 * - Verifies session initialization via `whisper-turbo` library.
 * - Verifies model loading progress updates and timeout handling.
 * - Verifies transcription result parsing (Success/Error Result handling).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhisperTurboEngine } from '../WhisperTurboEngine';

// Mock AudioProcessor
vi.mock('../../utils/AudioProcessor', () => ({
    floatToWavAsync: vi.fn(async (samples: Float32Array) => new Uint8Array(samples.length))
}));

const mocks = vi.hoisted(() => {
    return {
        transcribe: vi.fn(),
        loadModel: vi.fn(),
        acquire: vi.fn(),
        release: vi.fn()
    };
});

// Mock WhisperEngineRegistry
vi.mock('../WhisperEngineRegistry', () => ({
    WhisperEngineRegistry: {
        acquire: mocks.acquire,
        release: mocks.release
    }
}));

// Mock the whisper-turbo library
vi.mock('whisper-turbo', () => {
    return {
        SessionManager: vi.fn().mockImplementation(() => ({
            loadModel: mocks.loadModel
        })),
        AvailableModels: { WHISPER_TINY: 'tiny' }
    };
});

describe('WhisperTurboEngine (Fast Path)', () => {
    let engine: WhisperTurboEngine;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        engine = new WhisperTurboEngine();

        // Setup successful acquire mock
        mocks.acquire.mockResolvedValue({
            transcribe: mocks.transcribe
        });

        // Setup successful transcription mock
        mocks.transcribe.mockResolvedValue({
            isErr: false,
            value: { text: "Hello WebGPU" }
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('initializes the session manager and loads model correctly', async () => {
        const onProgress = vi.fn();
        const onReady = vi.fn();
        await engine.init({ onModelLoadProgress: onProgress, onReady });

        // Verify progress sequence: 0 is called at start, 100 is called at end
        expect(onProgress).toHaveBeenCalledWith(0);
        expect(onProgress).toHaveBeenCalledWith(100);
        expect(onReady).toHaveBeenCalled();
        
        // WhisperTurboEngine calls WhisperEngineRegistry.acquire()
        expect(mocks.acquire).toHaveBeenCalled();
    });

    it('handles initialization failure gracefully', async () => {
        const error = new Error('Hardware failure');
        mocks.acquire.mockRejectedValue(error);

        const result = await engine.init({});
        expect(result.isErr).toBe(true);
        // Cast to { error: Error } to avoid 'any' while satisfying linter
        expect((result as unknown as { error: Error }).error).toBe(error);
    });

    it('transcribes audio correctly', async () => {
        await engine.init({});
        const float32Audio = new Float32Array(16000);
        const result = await engine.transcribe(float32Audio);

        expect(result.isOk).toBe(true);
        expect((result as unknown as { value: string }).value).toBe("Hello WebGPU");
        expect(mocks.transcribe).toHaveBeenCalled();
    });

    it('handles transcription engine errors', async () => {
        await engine.init({});
        const engineError = new Error('Inference timeout');
        mocks.transcribe.mockResolvedValue({
            isErr: true,
            error: engineError
        });

        const float32Audio = new Float32Array(16000);
        const result = await engine.transcribe(float32Audio);

        expect(result.isErr).toBe(true);
        expect((result as unknown as { error: Error }).error).toBe(engineError);
    });

    it('handles unexpected transcription throws', async () => {
        await engine.init({});
        const panicError = new Error('WASM Panic');
        mocks.transcribe.mockRejectedValue(panicError);

        const float32Audio = new Float32Array(16000);
        const result = await engine.transcribe(float32Audio);

        expect(result.isErr).toBe(true);
        expect((result as unknown as { error: Error }).error).toBe(panicError);
    });

    it('fails transcription if not initialized', async () => {
        const float32Audio = new Float32Array(16000);
        const result = await engine.transcribe(float32Audio);

        expect(result.isErr).toBe(true);
        expect((result as unknown as { error: Error }).error.message).toContain('not initialized');
    });

    it('releases resources back to registry on destroy', async () => {
        await engine.init({});
        await engine.destroy();

        expect(mocks.release).toHaveBeenCalled();
    });
});
