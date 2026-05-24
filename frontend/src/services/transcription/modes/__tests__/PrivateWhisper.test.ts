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

    it('REGRESSION: tolerates brief low-energy dips during speech start', async () => {
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

        const speechFrame = new Float32Array(1_000).fill(0.5);
        const quietDip = new Float32Array(1_600).fill(0.001);

        frameCallback?.(speechFrame);
        frameCallback?.(quietDip);
        frameCallback?.(speechFrame);
        frameCallback?.(quietDip);
        frameCallback?.(speechFrame);
        frameCallback?.(quietDip);
        frameCallback?.(speechFrame);

        const remainingSamples = PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES - ((speechFrame.length * 4) + (quietDip.length * 3));
        frameCallback?.(new Float32Array(remainingSamples).fill(0.5));

        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        expect(mocks.transcribe).toHaveBeenCalledTimes(1);
        const firstAudio = mocks.transcribe.mock.calls[0][0] as Float32Array;
        expect(firstAudio[0]).toBeCloseTo(0.5);
        expect(firstAudio[speechFrame.length]).toBeCloseTo(0.001);
        expect(firstAudio[speechFrame.length + quietDip.length]).toBeCloseTo(0.5);

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    it('REGRESSION: preserves a short failed speech-start candidate as preroll', async () => {
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

        const shortOpener = new Float32Array(1_900).fill(0.5);
        const toleratedQuiet = new Float32Array(PRIV_STT_DERIVED.SPEECH_START_RESET_TOLERANCE_SAMPLES).fill(0.001);
        const resetQuiet = new Float32Array(80).fill(0.001);
        const realSpeech = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.4);

        frameCallback?.(shortOpener);
        frameCallback?.(toleratedQuiet);
        frameCallback?.(resetQuiet);
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mocks.transcribe).not.toHaveBeenCalled();

        frameCallback?.(realSpeech);
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        expect(mocks.transcribe).toHaveBeenCalledTimes(1);
        const firstAudio = mocks.transcribe.mock.calls[0][0] as Float32Array;
        const openerIndex = firstAudio.findIndex((sample) => sample > 0.49 && sample < 0.51);
        const speechIndex = firstAudio.findIndex((sample) => sample > 0.39 && sample < 0.41);

        expect(openerIndex).toBeGreaterThanOrEqual(0);
        expect(speechIndex).toBeGreaterThan(openerIndex);
        expect(firstAudio[openerIndex]).toBeCloseTo(0.5);
        expect(firstAudio[speechIndex]).toBeCloseTo(0.4);

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    it('REGRESSION: drops short forced stop tail after transcript exists', async () => {
        vi.useFakeTimers();
        mocks.transcribe.mockResolvedValue(Result.ok('the stale smell of old beer'));
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

        frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.5));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.5));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        expect(mocks.transcribe).toHaveBeenCalledTimes(2);

        const shortTail = new Float32Array(PRIV_STT_DERIVED.FORCE_FINAL_MIN_SAMPLES - 1).fill(0.02);
        frameCallback?.(shortTail);

        await privateWhisper.stop();

        expect(mocks.transcribe).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('REGRESSION: drops tiny forced stop transcript fragments after transcript exists', async () => {
        vi.useFakeTimers();
        mocks.transcribe
            .mockResolvedValueOnce(Result.ok('the stale smell of old beer'))
            .mockResolvedValueOnce(Result.ok('the stale smell of old beer continues'))
            .mockResolvedValueOnce(Result.ok(' or'));
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

        frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.5));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.5));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        expect(mocks.transcribe).toHaveBeenCalledTimes(2);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledTimes(2);

        const tailLongEnoughToForce = new Float32Array(PRIV_STT_DERIVED.FORCE_FINAL_MIN_SAMPLES + 100).fill(0.05);
        frameCallback?.(tailLongEnoughToForce);

        await privateWhisper.stop();

        expect(mocks.transcribe).toHaveBeenCalledTimes(3);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('REGRESSION: caps repeated pre-transcript metadata retries so bad context cannot snowball', async () => {
        vi.useFakeTimers();
        mocks.transcribe
            .mockResolvedValueOnce(Result.ok('[MUSIC PLAYING]'))
            .mockResolvedValueOnce(Result.ok('[inaudible]'))
            .mockResolvedValueOnce(Result.ok('(speaking in foreign language)'))
            .mockResolvedValueOnce(Result.ok('Fresh transcript has enough words'));
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

        const chunkA = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.11);
        const chunkB = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.22);
        const chunkC = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.33);
        const chunkD = new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.44);

        frameCallback?.(chunkA);
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        frameCallback?.(chunkB);
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        frameCallback?.(chunkC);
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        frameCallback?.(chunkD);
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        expect(mocks.transcribe).toHaveBeenCalledTimes(4);
        expect((mocks.transcribe.mock.calls[0][0] as Float32Array).length).toBe(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES);
        expect((mocks.transcribe.mock.calls[1][0] as Float32Array).length).toBe(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES * 2);
        expect((mocks.transcribe.mock.calls[2][0] as Float32Array).length).toBe(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES * 3);
        expect((mocks.transcribe.mock.calls[3][0] as Float32Array).length).toBeGreaterThanOrEqual(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledTimes(1);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledWith({
            transcript: { partial: 'Fresh transcript has enough words' },
        });

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    it('REGRESSION: holds first transcript until overlapping decode locally agrees', async () => {
        vi.useFakeTimers();
        mocks.transcribe
            .mockResolvedValueOnce(Result.ok('unconfirmed opener has words'))
            .mockResolvedValueOnce(Result.ok('different opener text continues'))
            .mockResolvedValueOnce(Result.ok('different opener text continues here'));
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

        frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.11));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledTimes(1);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { partial: 'unconfirmed opener has words' },
        });

        frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.22));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledTimes(2);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { partial: 'different opener text continues' },
        });

        frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.33));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledTimes(3);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledWith({
            transcript: { final: 'different opener text continues' },
        });

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

        // 4. Advance past the post-transcript paint grace and next production poll.
        await vi.advanceTimersByTimeAsync(
            PRIV_STT.POST_TRANSCRIPT_PAINT_GRACE_MS + PRIV_STT.PROCESSING_INTERVAL_MS
        );
        await vi.runOnlyPendingTimersAsync();

        expect(mocks.transcribe).toHaveBeenCalledTimes(2);

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    it('REGRESSION: holds exact first-result hallucinations but allows real thanks phrases as partials', async () => {
        vi.useFakeTimers();
        mocks.transcribe
            .mockResolvedValueOnce(Result.ok('Thanks.'))
            .mockResolvedValueOnce(Result.ok('Thanks everyone for joining today'));
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

        frameCallback?.(new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.5));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mockCallbacks.onTranscriptUpdate).not.toHaveBeenCalled();

        frameCallback?.(new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.5));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledWith({
            transcript: { partial: 'Thanks everyone for joining today' },
        });

        await privateWhisper.stop();
        vi.useRealTimers();
    });
});
