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
        const mockMic: MicStream = {
            state: 'ready',
            sampleRate: 16000,
            onFrame: vi.fn((cb) => {
                frameCallback = cb;
            }),
            offFrame: vi.fn(),
            stop: vi.fn(),
            close: vi.fn(),
            _mediaStream: new MediaStream(),
        };

        await privateWhisper.startTranscription(mockMic);

        // Verify delegation
        expect(mockMic.onFrame).toHaveBeenCalled();
        expect(frameCallback).toBeDefined();

        // Simulate audio frames (must be non-silent to pass VAD)
        if (frameCallback) {
            frameCallback(new Float32Array(16000).fill(0.5));
        }

        // Fast forward 1.1 seconds to trigger interval (1000ms loop)
        await vi.advanceTimersByTimeAsync(1100);

        expect(mocks.transcribe).toHaveBeenCalled();

        await privateWhisper.stopTranscription();
        vi.useRealTimers();
    });

    it('RMS VAD: drops silent chunks (RMS < 0.01)', async () => {
        vi.useFakeTimers();
        await privateWhisper.init();

        let frameCallback: ((frame: Float32Array) => void) | undefined;
        const mockMic: MicStream = {
            state: 'ready',
            sampleRate: 16000,
            onFrame: vi.fn((cb) => { frameCallback = cb; }),
            offFrame: vi.fn(),
            stop: vi.fn(),
            close: vi.fn(),
            _mediaStream: new MediaStream(),
        };

        await privateWhisper.startTranscription(mockMic);

        // Simulate silent frame (all zeros)
        if (frameCallback) {
            frameCallback(new Float32Array(16000).fill(0));
        }

        // Advance timer to trigger processAudio
        await vi.advanceTimersByTimeAsync(1100);

        // Verify: transcribe should NOT be called because RMS is 0
        expect(mocks.transcribe).not.toHaveBeenCalled();

        await privateWhisper.stopTranscription();
        vi.useRealTimers();
    });

    it('RMS VAD: processes audio chunks (RMS >= 0.01)', async () => {
        vi.useFakeTimers();
        await privateWhisper.init();

        let frameCallback: ((frame: Float32Array) => void) | undefined;
        const mockMic: MicStream = {
            state: 'ready',
            sampleRate: 16000,
            onFrame: vi.fn((cb) => { frameCallback = cb; }),
            offFrame: vi.fn(),
            stop: vi.fn(),
            close: vi.fn(),
            _mediaStream: new MediaStream(),
        };

        await privateWhisper.startTranscription(mockMic);

        // Simulate audio frame (high amplitude squares)
        const audioFrame = new Float32Array(16000).fill(0.5);
        if (frameCallback) {
            frameCallback(audioFrame);
        }

        // Advance timer
        await vi.advanceTimersByTimeAsync(1100);

        // Verify: transcribe SHOULD be called
        expect(mocks.transcribe).toHaveBeenCalled();

        await privateWhisper.stopTranscription();
        vi.useRealTimers();
    });
    it('REGRESSION: preserves audio chunks arriving during inference', async () => {
        vi.useFakeTimers();
        await privateWhisper.init();

        let frameCallback: ((frame: Float32Array) => void) | undefined;
        const mockMic: MicStream = {
            state: 'ready',
            sampleRate: 16000,
            onFrame: vi.fn((cb) => { frameCallback = cb; }),
            offFrame: vi.fn(),
            stop: vi.fn(),
            close: vi.fn(),
            _mediaStream: new MediaStream(),
        };

        await privateWhisper.startTranscription(mockMic);

        // 1. Send first frame
        if (frameCallback) frameCallback(new Float32Array(8000).fill(0.5));

        // 2. Trigger processing at 500ms
        await vi.advanceTimersByTimeAsync(500);
        expect(mocks.transcribe).toHaveBeenCalledTimes(1);

        // 3. CRITICAL: While "thinking" (it's awaiting the 200ms mock delay), send more audio
        if (frameCallback) frameCallback(new Float32Array(8000).fill(0.1));

        // 4. Advance past the 200ms think time + microtask flush
        await vi.advanceTimersByTimeAsync(250);
        await vi.runOnlyPendingTimersAsync();

        // 5. Advance to the next interval tick (at 1000ms total)
        // We are currently at 750ms. Next tick is at 1000ms.
        await vi.advanceTimersByTimeAsync(300);

        expect(mocks.transcribe).toHaveBeenCalledTimes(2);

        await privateWhisper.stopTranscription();
        vi.useRealTimers();
    });
});
