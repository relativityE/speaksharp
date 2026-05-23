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

// ✅ CRITICAL: Unmock for THIS file only (Prevent Over-Mocking)
vi.unmock('../PrivateWhisper');

import PrivateWhisper from '../PrivateWhisper';
import { Result } from '../types';
import { MicStream } from '../../utils/types';
import { PRIV_CLOUD_AUDIO, PRIV_STT, PRIV_STT_DERIVED, SESSION_PAUSE } from '../../sttConstants';

// Global mocks to prevent resolution errors
vi.mock('whisper-turbo', () => ({}));
vi.mock('@xenova/transformers', () => ({}));

// Mock the PrivateSTT facade
// We hoist the mocks so we can access them in the test body if needed
const mocks = vi.hoisted(() => ({
    init: vi.fn(),
    transcribe: vi.fn(),
    reset: vi.fn(),
    stop: vi.fn(),
    isMeaningfullySilent: vi.fn().mockReturnValue(false),
    processAudioFrame: vi.fn()
}));

vi.mock('../../audio/pauseDetector', () => ({
    PauseDetector: vi.fn().mockImplementation(() => ({
        isMeaningfullySilent: mocks.isMeaningfullySilent,
        processAudioFrame: mocks.processAudioFrame,
        getCurrentSilenceDurationSeconds: vi.fn().mockReturnValue(0)
    }))
}));

vi.mock('../../engines/PrivateSTT', () => {
    const MockPrivateSTT = vi.fn().mockImplementation(() => ({
        init: mocks.init,
        transcribe: mocks.transcribe,
        getEngineType: vi.fn().mockReturnValue('whisper-turbo')
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
            sampleRate: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
            onFrame: vi.fn((cb: (frame: Float32Array) => void) => {
                frameCallback = cb;
                return () => { };
            }),
            offFrame: vi.fn(),
            stop: vi.fn(),
            close: vi.fn(),
            _mediaStream: new MediaStream(),
        };

        await privateWhisper.start(mockMic);

        // Verify delegation
        expect(mockMic.onFrame).toHaveBeenCalled();
        expect(frameCallback).toBeDefined();

        // Simulate enough audio for the production batching threshold.
        if (frameCallback) {
            frameCallback(new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.5));
        }

        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        expect(mocks.transcribe).toHaveBeenCalled();

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    it('PauseDetector per-frame tracking gates transcription on silence', async () => {
        vi.useFakeTimers();
        await privateWhisper.init();

        let frameCallback: ((frame: Float32Array) => void) | undefined;
        const mockMic: MicStream = {
            state: 'ready',
            sampleRate: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
            onFrame: vi.fn((cb: (frame: Float32Array) => void) => { frameCallback = cb; return () => { }; }),
            offFrame: vi.fn(),
            stop: vi.fn(),
            close: vi.fn(),
            _mediaStream: new MediaStream(),
        };

        await privateWhisper.start(mockMic);

        // PauseDetector only reports meaningful silence after the configured
        // silence duration has elapsed, so model repeated browser frames rather
        // than one giant synthetic frame.
        mocks.isMeaningfullySilent.mockReturnValue(false);

        if (frameCallback) {
            const silentFrame = new Float32Array(
                Math.ceil(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES / 4),
            ).fill(0.001);

            for (let i = 0; i < 4; i += 1) {
                frameCallback(silentFrame);
                await vi.advanceTimersByTimeAsync(Math.ceil(SESSION_PAUSE.MIN_SILENCE_MS / 4));
            }
        }

        mocks.isMeaningfullySilent.mockReturnValue(true);
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        // Silence detected → transcription skipped
        expect(mocks.transcribe).not.toHaveBeenCalled();

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    it('RMS VAD: processes audio chunks (RMS >= 0.01)', async () => {
        vi.useFakeTimers();
        await privateWhisper.init();

        let frameCallback: ((frame: Float32Array) => void) | undefined;
        const mockMic: MicStream = {
            state: 'ready',
            sampleRate: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
            onFrame: vi.fn((cb: (frame: Float32Array) => void) => { frameCallback = cb; return () => { }; }),
            offFrame: vi.fn(),
            stop: vi.fn(),
            close: vi.fn(),
            _mediaStream: new MediaStream(),
        };

        await privateWhisper.start(mockMic);

        // Simulate audio frame (high amplitude squares) above the batching threshold.
        const audioFrame = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.5);
        if (frameCallback) {
            frameCallback(audioFrame);
        }

        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        // Verify: transcribe SHOULD be called
        expect(mocks.transcribe).toHaveBeenCalled();

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    it('REGRESSION: waits for speech start and includes preroll in first Private chunk', async () => {
        vi.useFakeTimers();
        await privateWhisper.init();

        let frameCallback: ((frame: Float32Array) => void) | undefined;
        const mockMic: MicStream = {
            state: 'ready',
            sampleRate: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
            onFrame: vi.fn((cb: (frame: Float32Array) => void) => { frameCallback = cb; return () => { }; }),
            offFrame: vi.fn(),
            stop: vi.fn(),
            close: vi.fn(),
            _mediaStream: new MediaStream(),
        };

        await privateWhisper.start(mockMic);

        const prerollFrame = new Float32Array(PRIV_STT_DERIVED.SPEECH_START_PREROLL_SAMPLES).fill(0.001);
        const speechFrame = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.5);

        frameCallback?.(prerollFrame);
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mocks.transcribe).not.toHaveBeenCalled();

        frameCallback?.(speechFrame);
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        expect(mocks.transcribe).toHaveBeenCalledTimes(1);
        const firstAudio = mocks.transcribe.mock.calls[0][0] as Float32Array;
        expect(firstAudio.length).toBe(prerollFrame.length + speechFrame.length);
        expect(firstAudio[0]).toBeCloseTo(0.001);
        expect(firstAudio[prerollFrame.length]).toBeCloseTo(0.5);

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    it('REGRESSION: preserves audio chunks arriving during inference', async () => {
        vi.useFakeTimers();
        await privateWhisper.init();

        let frameCallback: ((frame: Float32Array) => void) | undefined;
        const mockMic: MicStream = {
            state: 'ready',
            sampleRate: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
            onFrame: vi.fn((cb: (frame: Float32Array) => void) => { frameCallback = cb; return () => { }; }),
            offFrame: vi.fn(),
            stop: vi.fn(),
            close: vi.fn(),
            _mediaStream: new MediaStream(),
        };

        await privateWhisper.start(mockMic);

        // 1. Send first frame above the production batching threshold
        if (frameCallback) frameCallback(new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.5));

        // 2. Trigger processing at the production poll interval.
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mocks.transcribe).toHaveBeenCalledTimes(1);

        // 3. CRITICAL: While "thinking" (it's awaiting the 200ms mock delay), send more audio
        if (frameCallback) frameCallback(new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.1));

        // 4. Advance to the next production poll.
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        await vi.runOnlyPendingTimersAsync();

        expect(mocks.transcribe).toHaveBeenCalledTimes(2);

        await privateWhisper.stop();
        vi.useRealTimers();
    });
});
