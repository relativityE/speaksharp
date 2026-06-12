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

import PrivateWhisper, { buildPrivateTimingSummary, collapseTranscriptRepetitionLoops, hasSevereTranscriptRepetitionLoop } from '../PrivateWhisper';
import { Result } from '../types';
import { MicStream } from '../../utils/types';
import { PRIV_CLOUD_AUDIO, PRIV_STT, PRIV_STT_DERIVED, SESSION_PAUSE } from '../../sttConstants';

// Global mocks to prevent resolution errors
vi.mock('@xenova/transformers', () => ({}));

// Mock the PrivateSTT facade
// We hoist the mocks so we can access them in the test body if needed
const mocks = vi.hoisted(() => ({
    init: vi.fn(),
    checkAvailability: vi.fn(),
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
        checkAvailability: mocks.checkAvailability,
        transcribe: mocks.transcribe,
        getEngineType: vi.fn().mockReturnValue('transformers-js')
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
        onReady: vi.fn(),
        onStatusChange: vi.fn()
    };

    beforeEach(() => {
        mocks.init.mockReset();
        mocks.checkAvailability.mockReset();
        mocks.transcribe.mockReset();
        mocks.reset.mockReset();
        mocks.stop.mockReset();
        mocks.isMeaningfullySilent.mockReset();
        mocks.processAudioFrame.mockReset();

        // Setup successful init
        mocks.init.mockResolvedValue(Result.ok('transformers-js'));
        mocks.checkAvailability.mockResolvedValue({ isAvailable: false, reason: 'CACHE_MISS', message: 'Download required' });
        mocks.isMeaningfullySilent.mockReturnValue(false);

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

    it('delegates availability checks to PrivateSTT before initializing', async () => {
        const availability = await privateWhisper.checkAvailability();

        expect(mocks.checkAvailability).toHaveBeenCalledOnce();
        expect(availability).toEqual({ isAvailable: false, reason: 'CACHE_MISS', message: 'Download required' });
        expect(mocks.init).not.toHaveBeenCalled();
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

        expect(mocks.transcribe).toHaveBeenCalledTimes(3);
        vi.useRealTimers();
    });

    it('REGRESSION: defers low-energy post-transcript tail instead of wiping it before stop', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            currentTranscript: string;
            audioChunks: Float32Array[];
            bufferedSampleCount: number;
            hasDetectedSpeech: boolean;
            processAudio: (options?: { force?: boolean }) => Promise<void>;
        };
        const tailAmplitude = SESSION_PAUSE.SILENCE_RMS_THRESHOLD * 2;
        const lowEnergyTail = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES + 500).fill(tailAmplitude);

        engine.currentTranscript = 'the stale smell of old beer';
        engine.audioChunks = [lowEnergyTail];
        engine.bufferedSampleCount = lowEnergyTail.length;
        engine.hasDetectedSpeech = true;

        await engine.processAudio();

        expect(mocks.transcribe).not.toHaveBeenCalled();
        expect(engine.audioChunks).toHaveLength(1);
        expect(engine.bufferedSampleCount).toBe(lowEnergyTail.length);
    });

    it('REGRESSION: retains recognized low-energy opener audio for the next first-transcript decode', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            status: string;
            audioChunks: Float32Array[];
            bufferedSampleCount: number;
            hasDetectedSpeech: boolean;
            processAudio: (options?: { force?: boolean }) => Promise<void>;
        };
        const opener = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES + 500).fill(0.031);
        const continuation = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES + 700).fill(0.09);

        engine.status = 'transcribing';
        engine.audioChunks = [opener];
        engine.bufferedSampleCount = opener.length;
        engine.hasDetectedSpeech = true;
        mocks.transcribe.mockResolvedValueOnce(Result.ok('We'));

        await engine.processAudio();

        expect(mocks.transcribe).toHaveBeenCalledTimes(1);
        expect(mockCallbacks.onTranscriptUpdate).not.toHaveBeenCalled();

        engine.audioChunks = [continuation];
        engine.bufferedSampleCount = continuation.length;
        mocks.transcribe.mockResolvedValueOnce(Result.ok('We, um, find joy in the simplest things'));

        await engine.processAudio();

        expect(mocks.transcribe).toHaveBeenCalledTimes(2);
        const secondAudio = mocks.transcribe.mock.calls[1][0] as Float32Array;
        expect(secondAudio.length).toBe(opener.length + continuation.length);
        expect(secondAudio[0]).toBeCloseTo(0.031);
        expect(secondAudio[opener.length]).toBeCloseTo(0.09);
    });

    it('REGRESSION: drops tiny forced stop transcript fragments after transcript exists', async () => {
        vi.useFakeTimers();
        mocks.transcribe
            .mockResolvedValueOnce(Result.ok('the stale smell of old beer'))
            .mockResolvedValueOnce(Result.ok('the stale smell of old beer continues'))
            // Whole-utterance stop decode now runs FIRST and is the saved authority.
            // When it succeeds the forced-tail rolling decode is skipped, so the
            // earlier ' or' tiny-tail path is no longer exercised on this run.
            .mockResolvedValueOnce(Result.ok('the stale smell of old beer continues'));
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
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenNthCalledWith(1, {
            transcript: { partial: 'the stale smell of old beer' },
        });
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenNthCalledWith(2, {
            transcript: { final: 'the stale smell of old beer continues' },
        });

        const tailLongEnoughToForce = new Float32Array(PRIV_STT_DERIVED.FORCE_FINAL_MIN_SAMPLES + 100).fill(0.05);
        frameCallback?.(tailLongEnoughToForce);

        await privateWhisper.stop();

        // 2 live decodes + 1 whole-utterance stop decode. The forced-tail decode is
        // skipped because the whole-utterance commit succeeded (post-Stop latency fix).
        expect(mocks.transcribe).toHaveBeenCalledTimes(3);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledTimes(3);
        vi.useRealTimers();
    });

    it('REGRESSION: finalizes the best visible first provisional when local agreement shortens the final candidate', async () => {
        vi.useFakeTimers();
        mocks.transcribe
            .mockResolvedValueOnce(Result.ok('the stale smell of old beer'))
            .mockResolvedValueOnce(Result.ok('the stale smell of old beer like lingers'));
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
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { partial: 'the stale smell of old beer' },
        });

        frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.5));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { final: 'the stale smell of old beer like lingers' },
        });

        await privateWhisper.stop();
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

    it('REGRESSION: caps post-transcript live v2 decode windows while keeping full utterance audio for stop', async () => {
        vi.useFakeTimers();
        mocks.transcribe
            .mockResolvedValueOnce(Result.ok('private local preview words'))
            .mockResolvedValueOnce(Result.ok('private local full final transcript'));
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
        (privateWhisper as unknown as { currentTranscript: string }).currentTranscript = 'existing committed words';

        const longLiveChunk = new Float32Array(
            PRIV_STT_DERIVED.LIVE_DECODE_WINDOW_SAMPLES + PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES,
        ).fill(0.5);

        frameCallback?.(longLiveChunk);
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        expect(mocks.transcribe).toHaveBeenCalledTimes(1);
        expect((mocks.transcribe.mock.calls[0][0] as Float32Array).length).toBe(
            PRIV_STT_DERIVED.LIVE_DECODE_WINDOW_SAMPLES,
        );

        await privateWhisper.stop();

        expect(mocks.transcribe).toHaveBeenCalledTimes(2);
        expect((mocks.transcribe.mock.calls[1][0] as Float32Array).length).toBe(longLiveChunk.length);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { final: 'private local full final transcript', replacesRollingTranscript: true },
        });

        vi.useRealTimers();
    });

    it('REGRESSION: emits filler-only opener and low-energy provisional tail as live text', async () => {
        vi.useFakeTimers();
        mocks.transcribe
            .mockResolvedValueOnce(Result.ok('Um.'))
            .mockResolvedValueOnce(Result.ok('the stale smell of old beer.'))
            .mockResolvedValueOnce(Result.ok('like lingers.'));
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

        frameCallback?.(new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.006));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { partial: 'Um.' },
        });

        frameCallback?.(new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES * 2).fill(0.012));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { partial: 'Um. the stale smell of old beer.' },
        });

        frameCallback?.(new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES * 2).fill(0.006));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { partial: 'Um. the stale smell of old beer. like lingers.' },
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
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { final: 'different opener text continues here' },
        });

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    it('REGRESSION: rejects unsafe non-speech marker candidates before first final transcript', async () => {
        vi.useFakeTimers();
        mocks.transcribe
            .mockResolvedValueOnce(Result.ok('Stay, my told wild'))
            .mockResolvedValueOnce(Result.ok('*Spits* "Stay, my told wild tales to frightened him."'))
            .mockResolvedValueOnce(Result.ok('They, like, told wild tales to frighten him'))
            .mockResolvedValueOnce(Result.ok('They, like, told wild tales to frighten him'));
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

        for (let i = 0; i < 4; i += 1) {
            frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.5));
            await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        }

        const emitted = mockCallbacks.onTranscriptUpdate.mock.calls.map((call) => JSON.stringify(call[0]));
        expect(emitted.some((payload) => payload.includes('*Spits*'))).toBe(false);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { final: 'They, like, told wild tales to frighten him' },
        });

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    it('REGRESSION: whole-utterance stop decode sanitizes and replaces degraded rolling text', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            currentTranscript: string;
            wholeUtteranceTranscript: string;
            utteranceAudioChunks: Float32Array[];
            utteranceSampleCount: number;
            commitWholeUtteranceTranscript: () => Promise<void>;
            getTranscript: () => Promise<string>;
        };

        engine.currentTranscript = 'Happy, light, tune up the new shoes.';
        const audio = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES + 500).fill(0.25);
        engine.utteranceAudioChunks = [audio];
        engine.utteranceSampleCount = audio.length;
        mocks.transcribe.mockResolvedValueOnce(Result.ok('*Spits* The puppy, like, chewed up the new shoes. 1.2.'));

        await engine.commitWholeUtteranceTranscript();

        expect(engine.wholeUtteranceTranscript).toBe('The puppy, like, chewed up the new shoes.');
        expect(await engine.getTranscript()).toBe('The puppy, like, chewed up the new shoes.');
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { final: 'The puppy, like, chewed up the new shoes.', replacesRollingTranscript: true },
        });
    });

    it('FIX A v2: mid-utterance SOFT speech is retained (not dropped) so the second half is never lost', async () => {
        // Bug fixed: the per-frame drop deleted any continuous sub-partial-speech run
        // longer than the tail allowance, so a softly-spoken second half of a sentence
        // was lost from the buffer -> content loss. v2 keeps ALL frames during recording
        // and only trims TRAILING silence at finalize.
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            utteranceSampleCount: number;
            utteranceLastRealSpeechSamples: number;
            appendFrameToUtteranceAudio: (frame: Float32Array, energy: { rms: number; peak: number }) => void;
        };
        const FRAME = 1024;
        const realSpeech = { rms: PRIV_STT.FIRST_TRANSCRIPT_PARTIAL_MIN_RMS + 0.02, peak: 0.4 };
        const soft = { rms: SESSION_PAUSE.SILENCE_RMS_THRESHOLD + 0.01, peak: 0.1 }; // below the partial-speech bar

        // real speech -> long SOFT passage (>tail) -> real speech again.
        for (let i = 0; i < 5; i += 1) engine.appendFrameToUtteranceAudio(new Float32Array(FRAME).fill(0.3), realSpeech);
        const softFrames = Math.ceil(PRIV_STT_DERIVED.UTTERANCE_SILENCE_TAIL_SAMPLES / FRAME) + 20;
        for (let i = 0; i < softFrames; i += 1) engine.appendFrameToUtteranceAudio(new Float32Array(FRAME).fill(0.02), soft);
        for (let i = 0; i < 5; i += 1) engine.appendFrameToUtteranceAudio(new Float32Array(FRAME).fill(0.3), realSpeech);

        // The soft middle is fully retained (would have been dropped by the old code).
        expect(engine.utteranceSampleCount).toBe((10 + softFrames) * FRAME);
        // Last real speech is the final block, so finalize keeps the whole utterance.
        expect(engine.utteranceLastRealSpeechSamples).toBe((10 + softFrames) * FRAME);
    });

    it('FIX A v2: TRAILING silence after the last real speech is bounded at finalize (h1_6 stays fixed)', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            utteranceSampleCount: number;
            utteranceLastRealSpeechSamples: number;
            appendFrameToUtteranceAudio: (frame: Float32Array, energy: { rms: number; peak: number }) => void;
        };
        const FRAME = 1024;
        const realSpeech = { rms: PRIV_STT.FIRST_TRANSCRIPT_PARTIAL_MIN_RMS + 0.02, peak: 0.4 };
        const chatter = { rms: SESSION_PAUSE.SILENCE_RMS_THRESHOLD + 0.01, peak: 0.1 };

        for (let i = 0; i < 5; i += 1) engine.appendFrameToUtteranceAudio(new Float32Array(FRAME).fill(0.3), realSpeech);
        const chatterFrames = Math.ceil(PRIV_STT_DERIVED.UTTERANCE_SILENCE_TAIL_SAMPLES / FRAME) + 20;
        for (let i = 0; i < chatterFrames; i += 1) engine.appendFrameToUtteranceAudio(new Float32Array(FRAME).fill(0.02), chatter);

        // Last real speech is the 5-frame block; finalize trims chatter past last-speech + tail.
        expect(engine.utteranceLastRealSpeechSamples).toBe(5 * FRAME);
        const finalizeKeptSamples = Math.min(
            engine.utteranceSampleCount,
            engine.utteranceLastRealSpeechSamples + PRIV_STT_DERIVED.UTTERANCE_SILENCE_TAIL_SAMPLES,
        );
        expect(finalizeKeptSamples).toBeLessThanOrEqual(5 * FRAME + PRIV_STT_DERIVED.UTTERANCE_SILENCE_TAIL_SAMPLES);
        expect(finalizeKeptSamples).toBeLessThan(engine.utteranceSampleCount); // trailing chatter trimmed
    });

    it('FIX A: a real-speech frame after chatter resets the tail allowance (quiet-but-real endings preserved)', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            utteranceSampleCount: number;
            appendFrameToUtteranceAudio: (
                frame: Float32Array,
                energy: { rms: number; peak: number },
            ) => void;
        };
        const FRAME = 1024;
        const realSpeech = { rms: PRIV_STT.FIRST_TRANSCRIPT_PARTIAL_MIN_RMS + 0.05, peak: 0.5 };
        const chatter = { rms: SESSION_PAUSE.SILENCE_RMS_THRESHOLD + 0.005, peak: 0.05 };

        engine.appendFrameToUtteranceAudio(new Float32Array(FRAME).fill(0.4), realSpeech);
        // some chatter (within allowance), then real speech again, then more speech
        engine.appendFrameToUtteranceAudio(new Float32Array(FRAME).fill(0.02), chatter);
        engine.appendFrameToUtteranceAudio(new Float32Array(FRAME).fill(0.4), realSpeech);
        engine.appendFrameToUtteranceAudio(new Float32Array(FRAME).fill(0.4), realSpeech);
        // All real-speech frames + the one tolerated chatter frame are retained.
        expect(engine.utteranceSampleCount).toBe(4 * FRAME);
    });

    it('REGRESSION: whole-utterance stop decode rejects only pure hallucination after cleanup', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            currentTranscript: string;
            wholeUtteranceTranscript: string;
            utteranceAudioChunks: Float32Array[];
            utteranceSampleCount: number;
            commitWholeUtteranceTranscript: () => Promise<void>;
        };

        engine.currentTranscript = 'stable visible transcript';
        const audio = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES + 500).fill(0.25);
        engine.utteranceAudioChunks = [audio];
        engine.utteranceSampleCount = audio.length;
        mocks.transcribe.mockResolvedValueOnce(Result.ok('*noise* Thanks.'));

        await engine.commitWholeUtteranceTranscript();

        expect(engine.wholeUtteranceTranscript).toBe('');
        expect(engine.currentTranscript).toBe('stable visible transcript');
        expect(mockCallbacks.onTranscriptUpdate).not.toHaveBeenCalledWith({
            transcript: { final: 'Thanks.' },
        });
    });

    it('REGRESSION: resets whole-utterance audio at the start of each recording', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            utteranceAudioChunks: Float32Array[];
            utteranceSampleCount: number;
        };
        engine.utteranceAudioChunks = [new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.2)];
        engine.utteranceSampleCount = PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES;

        const mockMic: MicStream = {
            state: 'ready',
            sampleRate: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
            onFrame: vi.fn(() => () => { }),
            offFrame: vi.fn(),
            stop: vi.fn(),
            close: vi.fn(),
            _mediaStream: new MediaStream(),
        };

        await privateWhisper.start(mockMic);

        expect(engine.utteranceAudioChunks).toEqual([]);
        expect(engine.utteranceSampleCount).toBe(0);

        await privateWhisper.stop();
    });

    it('REGRESSION: prefers a clean visible provisional over a first-final candidate with numeric junk', async () => {
        vi.useFakeTimers();
        mocks.transcribe
            .mockResolvedValueOnce(Result.ok('Basically, a dash of peppers foil.'))
            .mockResolvedValueOnce(Result.ok('Basically, a dash of peppers, oil, beef stew. 1.2, 1.5.'));
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
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { partial: 'Basically, a dash of peppers foil.' },
        });

        frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.5));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { final: 'Basically, a dash of peppers foil.' },
        });

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    it('REGRESSION: drops unsupported forced final tails instead of appending stop hallucinations', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            status: string;
            currentTranscript: string;
            audioChunks: Float32Array[];
            bufferedSampleCount: number;
            hasDetectedSpeech: boolean;
            processAudio: (options?: { force?: boolean }) => Promise<void>;
        };
        const tailAudio = new Float32Array(PRIV_STT_DERIVED.FORCE_FINAL_MIN_SAMPLES + 200).fill(0.5);

        engine.status = 'transcribing';
        engine.currentTranscript = 'Basically, a dash of peppers, oil, beef stew.';
        engine.audioChunks = [tailAudio];
        engine.bufferedSampleCount = tailAudio.length;
        engine.hasDetectedSpeech = true;
        mocks.transcribe.mockResolvedValueOnce(Result.ok("Y'all are in each other. I'm gonna leave here."));

        await engine.processAudio({ force: true });

        expect(mockCallbacks.onTranscriptUpdate).not.toHaveBeenCalledWith({
            transcript: { final: "Y'all are in each other. I'm gonna leave here." },
        });
        expect(engine.currentTranscript).toBe('Basically, a dash of peppers, oil, beef stew.');
    });

    it('REGRESSION: drops low-energy forced tails before Whisper inference', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            status: string;
            currentTranscript: string;
            audioChunks: Float32Array[];
            bufferedSampleCount: number;
            hasDetectedSpeech: boolean;
            processAudio: (options?: { force?: boolean }) => Promise<void>;
        };
        const tailAudio = new Float32Array(PRIV_STT_DERIVED.FORCE_FINAL_MIN_SAMPLES + 200).fill(0.0001);

        engine.status = 'transcribing';
        engine.currentTranscript = 'Basically, a dash of peppers, oil, beef stew.';
        engine.audioChunks = [tailAudio];
        engine.bufferedSampleCount = tailAudio.length;
        engine.hasDetectedSpeech = true;
        mocks.transcribe.mockResolvedValueOnce(Result.ok("Y'all are in each other. I'm gonna leave here."));

        await engine.processAudio({ force: true });

        expect(mocks.transcribe).not.toHaveBeenCalled();
        expect(mockCallbacks.onTranscriptUpdate).not.toHaveBeenCalled();
        expect(engine.currentTranscript).toBe('Basically, a dash of peppers, oil, beef stew.');
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

    it('REGRESSION: stop waits for in-flight inference, then processes tail audio before teardown', async () => {
        await privateWhisper.init();

        let resolveFirst!: (value: Result<string>) => void;
        const firstInference = new Promise<Result<string>>((resolve) => {
            resolveFirst = resolve;
        });
        mocks.transcribe
            .mockReturnValueOnce(firstInference)
            // Whole-utterance stop decode runs first and is the saved authority; it
            // succeeds here, so the forced-tail rolling decode is skipped.
            .mockResolvedValueOnce(Result.ok('first stable words continue with tail'));

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

        const processAudio = (privateWhisper as unknown as {
            processAudio: (options?: { force?: boolean }) => Promise<void>;
        }).processAudio.bind(privateWhisper);
        const firstProcessing = processAudio();
        await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(1));

        frameCallback?.(new Float32Array(PRIV_STT_DERIVED.FORCE_FINAL_MIN_SAMPLES + 200).fill(0.5));

        const stopPromise = privateWhisper.stop();
        await Promise.resolve();
        expect(mocks.transcribe).toHaveBeenCalledTimes(1);

        resolveFirst(Result.ok('first stable words continue'));
        await firstProcessing;
        await stopPromise;

        // Stop still waits for the in-flight live inference (call 1), then runs the
        // whole-utterance decode (call 2) which is the saved authority. The forced
        // tail decode is skipped because the whole-utterance commit succeeded.
        expect(mocks.transcribe).toHaveBeenCalledTimes(2);
        // Finalize-status-before-wait fix: once Stop is requested (isStopping=true),
        // the in-flight live result is NOT emitted to the UI — it would otherwise
        // paint a stale partial over the "Processing speech locally…" finalizing
        // state. It still accumulates into currentTranscript (no data loss); the
        // whole-utterance commit is the only authoritative final emitted.
        expect(mockCallbacks.onTranscriptUpdate).not.toHaveBeenCalledWith({
            transcript: { partial: 'first stable words continue' },
        });
        expect(mockCallbacks.onStatusChange).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'info', message: 'Processing speech locally…' }),
        );
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { final: 'first stable words continue with tail', replacesRollingTranscript: true },
        });
    });

    it('REGRESSION: holds exact first-result hallucinations but allows real thanks phrases once confirmed', async () => {
        vi.useFakeTimers();
        mocks.transcribe
            .mockResolvedValueOnce(Result.ok('Thanks.'))
            .mockResolvedValueOnce(Result.ok('Thanks everyone for joining today'))
            .mockResolvedValueOnce(Result.ok('Thanks everyone for joining today again'));
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
        expect(mockCallbacks.onTranscriptUpdate).not.toHaveBeenCalled();

        frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.5));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledTimes(1);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { partial: 'Thanks everyone for joining today' },
        });

        frameCallback?.(new Float32Array(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ).fill(0.5));
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledTimes(2);
        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { final: 'Thanks everyone for joining today again' },
        });

        await privateWhisper.stop();
        vi.useRealTimers();
    });

    // LIVE-TRANSCRIPT-REPEATED-DISPLAY follow-up B (data-layer invariant):
    // A v4 rolling/streaming decode can loop within its window ("It's a question" x28 in the real
    // artifact). The committed transcript must represent STABLE text — it must never carry an
    // unfinalized streaming repetition loop. Before this fix, the live-final commit path appended the
    // raw rolling decode to currentTranscript and emitted { final } with no loop guard (unlike the
    // whole-utterance final, which collapses loops), so the user-visible committed transcript looped
    // during drafting/finalizing. Reproduce-first: drive a looped rolling decode into the commit path
    // and assert the loop never reaches the committed transcript / { final } emit.
    it('REGRESSION (B): withholds a severe v4 streaming loop from the live-final committed transcript', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            status: string;
            currentTranscript: string;
            audioChunks: Float32Array[];
            bufferedSampleCount: number;
            hasDetectedSpeech: boolean;
            processAudio: (options?: { force?: boolean }) => Promise<void>;
        };

        const LOOP = "It's a question. ".repeat(28).trim();
        // A first transcript is already committed (the realistic mid-recording state).
        engine.status = 'transcribing';
        engine.currentTranscript = 'Love from a return.';
        // Strong, clearly-voiced audio so the silence/low-energy gates pass and the decode commits.
        const speech = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES + 4000).fill(0.5);
        engine.audioChunks = [speech];
        engine.bufferedSampleCount = speech.length;
        engine.hasDetectedSpeech = true;
        mocks.transcribe.mockResolvedValueOnce(Result.ok(LOOP));

        await engine.processAudio();

        const countReps = (s: string) => (s.toLowerCase().match(/it'?s a question/g) || []).length;

        // INVARIANT: the committed transcript must not contain the severe streaming loop.
        expect(countReps(engine.currentTranscript)).toBeLessThan(3);

        // INVARIANT: no committed { final } emit may carry the severe loop. (A looped hypothesis may
        // still be surfaced as a { partial } interim — the display-layer withhold guard owns that —
        // but it must never be committed as { final }.)
        const finalEmits = (mockCallbacks.onTranscriptUpdate.mock.calls as Array<[{ transcript?: { final?: string } }]>)
            .map((call) => call[0]?.transcript?.final)
            .filter((v): v is string => typeof v === 'string');
        for (const emitted of finalEmits) {
            expect(countReps(emitted)).toBeLessThan(3);
        }
    });

    it('REGRESSION (B): still commits a normal (non-looped) rolling decode as { final }', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            status: string;
            currentTranscript: string;
            audioChunks: Float32Array[];
            bufferedSampleCount: number;
            hasDetectedSpeech: boolean;
            processAudio: (options?: { force?: boolean }) => Promise<void>;
        };

        engine.status = 'transcribing';
        engine.currentTranscript = 'Love from a return.';
        const speech = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES + 4000).fill(0.5);
        engine.audioChunks = [speech];
        engine.bufferedSampleCount = speech.length;
        engine.hasDetectedSpeech = true;
        mocks.transcribe.mockResolvedValueOnce(Result.ok('and the audience listened closely to every word'));

        await engine.processAudio();

        expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalledWith({
            transcript: { final: 'and the audience listened closely to every word' },
        });
        expect(engine.currentTranscript).toContain('and the audience listened closely to every word');
    });

    it('REGRESSION (B-P2): a legitimate earlier repeated phrase must NOT withhold later clean segments', async () => {
        await privateWhisper.init();
        const engine = privateWhisper as unknown as {
            status: string;
            currentTranscript: string;
            audioChunks: Float32Array[];
            bufferedSampleCount: number;
            hasDetectedSpeech: boolean;
            processAudio: (options?: { force?: boolean }) => Promise<void>;
        };

        // currentTranscript holds an EARLY, legitimate emphatic repeat ("thank you so much" x4) that
        // trips the loop detector on the FULL text, followed by enough clean speech that the early
        // repeat sits OUTSIDE the bounded commit seam. Before the seam fix the full-history scan made
        // the withhold STICKY — every later clean segment got withheld indefinitely.
        const earlyRepeat = 'thank you so much thank you so much thank you so much thank you so much';
        const cleanTail = 'and then the team reviewed the quarterly numbers carefully before we agreed on the final plan for shipping the new release to every customer region without any further delay';
        engine.status = 'transcribing';
        engine.currentTranscript = `${earlyRepeat} ${cleanTail}`;
        // Precondition proving this is a real P2 reproduction: the FULL accumulated transcript trips the
        // detector, so the old full-history scan WOULD withhold the next clean segment.
        expect(hasSevereTranscriptRepetitionLoop(engine.currentTranscript)).toBe(true);

        const speech = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES + 4000).fill(0.5);
        engine.audioChunks = [speech];
        engine.bufferedSampleCount = speech.length;
        engine.hasDetectedSpeech = true;
        mocks.transcribe.mockResolvedValueOnce(Result.ok('which the whole room applauded warmly'));

        await engine.processAudio();

        // The clean new segment MUST be committed — the stale early repeat must not withhold it.
        expect(engine.currentTranscript).toContain('which the whole room applauded warmly');
        const finalEmits = (mockCallbacks.onTranscriptUpdate.mock.calls as Array<[{ transcript?: { final?: string } }]>)
            .map((call) => call[0]?.transcript?.final)
            .filter((v): v is string => typeof v === 'string');
        expect(finalEmits.some((f) => /which the whole room applauded warmly/.test(f))).toBe(true);
    });
});

describe('hasSevereTranscriptRepetitionLoop (committed-store loop guard, follow-up B)', () => {
    it('flags a severe v4 streaming repetition loop', () => {
        expect(hasSevereTranscriptRepetitionLoop("It's a question. ".repeat(28))).toBe(true);
    });
    it('does NOT flag clean varied text', () => {
        expect(hasSevereTranscriptRepetitionLoop('The quick brown fox jumps over the lazy dog and then it runs far away today.')).toBe(false);
    });
    it('does NOT flag a clean whole-utterance-style transcript', () => {
        expect(hasSevereTranscriptRepetitionLoop('Love from a return. I want to talk about why questions matter and how we should ask them.')).toBe(false);
    });
    it('does NOT flag short text (below the min-token floor)', () => {
        expect(hasSevereTranscriptRepetitionLoop("It's a question.")).toBe(false);
    });
    it('does NOT flag a benign 2x phrase repeat', () => {
        expect(hasSevereTranscriptRepetitionLoop('I think I think we should go to the store and buy some milk today')).toBe(false);
    });
});

describe('collapseTranscriptRepetitionLoops (Private saved-transcript duplication, verdict A)', () => {
    it('collapses an immediately-repeated phrase loop (>=3x) to one instance', () => {
        expect(collapseTranscriptRepetitionLoops('we should wait we should wait we should wait'))
            .toBe('we should wait');
    });

    it('collapses a repeated full sentence (the Whisper-loop signature)', () => {
        const looped = 'Um. Basically, we should literally, like, wait. '
            + 'Um. Basically, we should literally, like, wait. '
            + 'Um. Basically, we should literally, like, wait.';
        expect(collapseTranscriptRepetitionLoops(looped))
            .toBe('Um. Basically, we should literally, like, wait.');
    });

    it('collapses an exact verbatim whole-text doubling', () => {
        expect(collapseTranscriptRepetitionLoops('alpha beta gamma delta alpha beta gamma delta'))
            .toBe('alpha beta gamma delta');
    });

    it('does NOT touch a normal transcript with no contiguous loop', () => {
        const normal = 'The quick brown fox jumps over the lazy dog and then it runs away.';
        expect(collapseTranscriptRepetitionLoops(normal)).toBe(normal);
    });

    it('preserves a 2x phrase repeat (not a clear loop)', () => {
        expect(collapseTranscriptRepetitionLoops('I think I think therefore I am'))
            .toBe('I think I think therefore I am');
    });

    it('preserves single-word repeats like "no no no"', () => {
        expect(collapseTranscriptRepetitionLoops('no no no')).toBe('no no no');
        expect(collapseTranscriptRepetitionLoops('that is very very good')).toBe('that is very very good');
    });

    it('collapses a loop embedded mid-transcript but keeps the surrounding text', () => {
        expect(collapseTranscriptRepetitionLoops('intro words then the same then the same then the same outro words'))
            .toBe('intro words then the same outro words');
    });

    it('leaves a short single-word repeat (3-5x) alone but collapses a long stutter', () => {
        expect(collapseTranscriptRepetitionLoops('it was so so so good')).toBe('it was so so so good');
        // A 6x single-word stutter reduces to a 2-word floor (still conservative, removes the loop).
        expect(collapseTranscriptRepetitionLoops('start here go go go go go go end here'))
            .toBe('start here go go end here');
    });

    it('handles empty / short input safely', () => {
        expect(collapseTranscriptRepetitionLoops('')).toBe('');
        expect(collapseTranscriptRepetitionLoops('hi there')).toBe('hi there');
    });
});

describe('buildPrivateTimingSummary (window.__PRIVATE_TIMING__, Quality-Push Slice 1)', () => {
    const SR = PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ; // 16000

    it('returns null timings + null anchor before recording starts', () => {
        const s = buildPrivateTimingSummary({
            streamStartAtMs: null, speechStartAtMs: null,
            firstProvisionalAtMs: null, firstFinalAtMs: null, finalizeDecodeMs: null,
            finalizeWaitMs: null, finalizePrepMs: null,
            utteranceSampleCount: 0, peakBufferedSamples: 0, nowMs: 1234,
        });
        expect(s.anchor).toBeNull();
        expect(s.timeToFirstProvisionalMs).toBeNull();
        expect(s.timeToFirstFinalMs).toBeNull();
        expect(s.finalizeDecodeMs).toBeNull();
        expect(s.finalizeWaitMs).toBeNull();
        expect(s.finalizePrepMs).toBeNull();
        expect(s.utteranceSeconds).toBe(0);
        expect(s.peakBufferedSeconds).toBe(0);
        expect(s.updatedAtMs).toBe(1234);
    });

    it('measures timeToFirst* from speech-start when available', () => {
        const s = buildPrivateTimingSummary({
            streamStartAtMs: 1000, speechStartAtMs: 1500,
            firstProvisionalAtMs: 2500, firstFinalAtMs: 4500, finalizeDecodeMs: 800,
            finalizeWaitMs: 9962, finalizePrepMs: 120,
            utteranceSampleCount: SR, peakBufferedSamples: 3 * SR, nowMs: 9000,
        });
        expect(s.anchor).toBe('speech');
        expect(s.timeToFirstProvisionalMs).toBe(1000); // 2500 - 1500
        expect(s.timeToFirstFinalMs).toBe(3000);        // 4500 - 1500
        expect(s.finalizeDecodeMs).toBe(800);   // branch 3 (model decode)
        expect(s.finalizeWaitMs).toBe(9962);    // branch 1 (drain + cleanup)
        expect(s.finalizePrepMs).toBe(120);     // branch 2 (concat/capture prep)
        expect(s.utteranceSeconds).toBe(1);
        expect(s.peakBufferedSeconds).toBe(3);
    });

    it('falls back to stream-start anchor when speech-start is unset', () => {
        const s = buildPrivateTimingSummary({
            streamStartAtMs: 1000, speechStartAtMs: null,
            firstProvisionalAtMs: 2000, firstFinalAtMs: null, finalizeDecodeMs: null,
            finalizeWaitMs: null, finalizePrepMs: null,
            utteranceSampleCount: 0, peakBufferedSamples: 0, nowMs: 5000,
        });
        expect(s.anchor).toBe('stream');
        expect(s.timeToFirstProvisionalMs).toBe(1000); // 2000 - 1000
        expect(s.timeToFirstFinalMs).toBeNull();
    });

    it('clamps a pre-anchor timestamp to 0 (never negative)', () => {
        const s = buildPrivateTimingSummary({
            streamStartAtMs: 1000, speechStartAtMs: 2000,
            firstProvisionalAtMs: 1500, firstFinalAtMs: null, finalizeDecodeMs: null,
            finalizeWaitMs: null, finalizePrepMs: null,
            utteranceSampleCount: 0, peakBufferedSamples: 0, nowMs: 3000,
        });
        expect(s.timeToFirstProvisionalMs).toBe(0); // 1500 < 2000 anchor -> clamped
    });
});
