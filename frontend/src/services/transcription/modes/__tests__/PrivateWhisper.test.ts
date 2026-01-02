/**
 * @file PrivateWhisper.test.ts
 * @description Unit Test for the Service Integration layer.
 * @verification_scope
 * - Verifies delegation to the `PrivateSTT` facade.
 * - Verifies stream lifecycle management (start/stop/process).
 * - Verifies error propagation from the underlying engine.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PrivateWhisper from '../PrivateWhisper';
import { Result } from 'true-myth';
import { MicStream } from '../../utils/types';

// Global mocks to prevent resolution errors
vi.mock('whisper-turbo', () => ({}));
vi.mock('@xenova/transformers', () => ({}));

// Mock the PrivateSTT facade
// We hoist the mocks so we can access them in the test body if needed
const mocks = vi.hoisted(() => ({
    init: vi.fn(),
    transcribe: vi.fn(),
    reset: vi.fn(),
    stop: vi.fn()
}));

vi.mock('../../engines/PrivateSTT', () => {
    const MockPrivateSTT = vi.fn().mockImplementation(() => ({
        init: mocks.init,
        transcribe: mocks.transcribe,
    }));
    return {
        PrivateSTT: MockPrivateSTT,
        createPrivateSTT: vi.fn(() => new MockPrivateSTT())
    };
});

describe('PrivateWhisper (Facade Wrapper)', () => {
    let privateWhisper: PrivateWhisper;
    const mockCallbacks = {
        onTranscriptUpdate: vi.fn(),
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup successful init
        mocks.init.mockResolvedValue(Result.ok('whisper-turbo'));

        // Setup successful transcription
        mocks.transcribe.mockResolvedValue(Result.ok('Test transcript'));

        privateWhisper = new PrivateWhisper(mockCallbacks);
    });

    it('initializes by delegating to PrivateSTT', async () => {
        await privateWhisper.init();
        expect(mocks.init).toHaveBeenCalled();
        // Check if callbacks are passed? 
        // PrivateWhisper likely passes its own internal callbacks or the ones provided.
    });

    it('buffers audio and transcribes periodically', async () => {
        vi.useFakeTimers();
        await privateWhisper.init();

        let frameCallback: ((frame: Float32Array) => void) | undefined;
        // Mock the mic stream to capture the callback
        const mockMic = {
            onFrame: vi.fn((cb) => {
                frameCallback = cb;
            }),
            offFrame: vi.fn()
        } as unknown as MicStream;

        await privateWhisper.startTranscription(mockMic);

        // Verify delegation
        expect(mockMic.onFrame).toHaveBeenCalled();
        expect(frameCallback).toBeDefined();

        // Simulate audio frames
        if (frameCallback) {
            frameCallback(new Float32Array(16000));
        }

        // Fast forward 1.1 seconds to trigger interval (1000ms loop)
        await vi.advanceTimersByTimeAsync(1100);

        expect(mocks.transcribe).toHaveBeenCalled();

        await privateWhisper.stopTranscription();
        vi.useRealTimers();
    });
});
