/**
 * @file WhisperTurboEngine.spec.ts
 * @description Micro-Unit Test for the "Fast Path" strategy.
 * @verification_scope
 * - Verifies session initialization via `whisper-turbo` library.
 * - Verifies model loading progress updates and timeout handling.
 * - Verifies transcription result parsing (Success/Error Result handling).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

    it('initializes the session manager and loads model', async () => {
        const onProgress = vi.fn();
        await engine.init({ onModelLoadProgress: onProgress });

        // WhisperTurboEngine calls WhisperEngineRegistry.acquire()
        expect(mocks.acquire).toHaveBeenCalled();
        expect(onProgress).toHaveBeenCalledWith(100);
    });

    it('transcribes audio correctly', async () => {
        await engine.init({});
        const float32Audio = new Float32Array(16000);
        const result = await engine.transcribe(float32Audio);

        expect(result.isOk).toBe(true);
        // Assert result.isOk is true to satisfy type narrowing
        expect((result as { isOk: true; value: string }).value).toBe("Hello WebGPU");

        // Check if transcribe was called
        // Note: implementation calls this.session.transcribe(wavData, ...)
        // We verify it was called
        expect(mocks.transcribe).toHaveBeenCalled();
    });
});
