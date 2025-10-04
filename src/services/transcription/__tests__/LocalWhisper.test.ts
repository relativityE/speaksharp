import LocalWhisper from '../modes/LocalWhisper';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { pipeline } from '@xenova/transformers';
import { MicStream } from '../utils/types';

// Mock the transformers pipeline - prevent any real model loading
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
}));

const mockPipeline = vi.mocked(pipeline);

describe('LocalWhisper Transcription Mode', () => {
  let localWhisper: LocalWhisper;
  const onTranscriptUpdate = vi.fn();
  const onModelLoadProgress = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    localWhisper = new LocalWhisper({
      onTranscriptUpdate,
      onModelLoadProgress,
      onReady: vi.fn(),
      session: null,
      navigate: vi.fn(),
      getAssemblyAIToken: vi.fn(),
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Ensure LocalWhisper is properly cleaned up
    if (localWhisper) {
      try {
        await localWhisper.stopTranscription();
      } catch {
        // Ignore cleanup errors
      }
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  });

  it('should initialize and load the model from the hub', async () => {
    const mockPipelineInstance = vi.fn().mockResolvedValue({ text: 'test' });
    mockPipeline.mockResolvedValue(mockPipelineInstance as unknown as Awaited<ReturnType<typeof pipeline>>);

    await localWhisper.init();

    expect(mockPipeline).toHaveBeenCalledExactlyOnceWith('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      progress_callback: onModelLoadProgress,
    });
  });

  it('should fall back to local model if hub fails', async () => {
    mockPipeline
      .mockRejectedValueOnce(new Error('Hub failed'))
      .mockResolvedValue(vi.fn().mockResolvedValue({ text: 'test' }) as unknown as Awaited<ReturnType<typeof pipeline>>);

    await localWhisper.init();

    expect(mockPipeline).toHaveBeenCalledTimes(2);
    expect(mockPipeline).toHaveBeenLastCalledWith('automatic-speech-recognition', '/models/whisper-tiny.en/', {
      progress_callback: onModelLoadProgress,
    });
  });

  it('should throw an error if both hub and local models fail to load', async () => {
    mockPipeline.mockRejectedValue(new Error('Failed to load'));

    await expect(localWhisper.init()).rejects.toThrow('Failed to load');
  });

  it('should call the pipeline with audio data on startTranscription', async () => {
    const mockPipelineInstance = vi.fn().mockResolvedValue({
      text: 'transcript',
      chunks: []
    });
    mockPipeline.mockResolvedValue(mockPipelineInstance as unknown as Awaited<ReturnType<typeof pipeline>>);

    await localWhisper.init();
    let frameHandlerCalled = false;
    const mockMicStream: MicStream = {
      onFrame: vi.fn((handler) => {
        frameHandlerCalled = true;
        // Immediately call handler with minimal data to simulate audio
        handler(new Float32Array(16)); // Very small buffer
      }),
      offFrame: vi.fn(),
      stop: vi.fn(),
      close: vi.fn(),
      sampleRate: 16000,
      _mediaStream: new MediaStream(),
    };

    // Start transcription (this will start the getAudioData process)
    const transcriptionPromise = localWhisper.startTranscription(mockMicStream);

    // Fast-forward through the 5-second timeout in getAudioData
    vi.advanceTimersByTime(5000);

    // Wait for transcription to complete
    await transcriptionPromise;

    expect(frameHandlerCalled).toBe(true);
    expect(mockMicStream.onFrame).toHaveBeenCalled();
    expect(mockMicStream.offFrame).toHaveBeenCalled();
    expect(mockPipelineInstance).toHaveBeenCalledExactlyOnceWith(expect.any(Float32Array), expect.any(Object));
    expect(onTranscriptUpdate).toHaveBeenCalledExactlyOnceWith({
      transcript: { final: 'transcript' },
      chunks: [],
    });
    // Restore real timers
    vi.useRealTimers();
  });
});