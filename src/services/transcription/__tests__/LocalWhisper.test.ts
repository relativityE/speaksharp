import LocalWhisper from '../modes/LocalWhisper';
import { vi } from 'vitest';
import { pipeline } from '@xenova/transformers';

// Mock the transformers pipeline
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
}));

const mockPipeline = vi.mocked(pipeline);

describe('LocalWhisper Transcription Mode', () => {
  let localWhisper: LocalWhisper;
  const onTranscriptUpdate = vi.fn();
  const onModelLoadProgress = vi.fn();

  beforeEach(() => {
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

  it('should initialize and load the model from the hub', async () => {
    const mockPipelineInstance = vi.fn().mockResolvedValue({ text: 'test' }) as any;
    mockPipeline.mockResolvedValue(mockPipelineInstance);

    await localWhisper.init();

    expect(mockPipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      progress_callback: onModelLoadProgress,
    });
  });

  it('should fall back to local model if hub fails', async () => {
    mockPipeline
      .mockRejectedValueOnce(new Error('Hub failed'))
      .mockResolvedValue(vi.fn().mockResolvedValue({ text: 'test' }) as any);

    await localWhisper.init();

    expect(mockPipeline).toHaveBeenCalledTimes(2);
    expect(mockPipeline).toHaveBeenCalledWith('automatic-speech-recognition', '/models/whisper-tiny.en/', {
      progress_callback: onModelLoadProgress,
    });
  });

  it('should throw an error if both hub and local models fail to load', async () => {
    mockPipeline.mockRejectedValue(new Error('Failed to load'));
    await expect(localWhisper.init()).rejects.toThrow('Failed to load');
  });

  it('should call the pipeline with audio data on startTranscription', async () => {
    const mockPipelineInstance = vi.fn().mockResolvedValue({ text: 'transcript', chunks: [] }) as any;
    mockPipeline.mockResolvedValue(mockPipelineInstance);

    await localWhisper.init();

    const mockMicStream = {
      onFrame: vi.fn((handler) => {
        // Simulate a few frames of audio data
        setTimeout(() => handler(new Float32Array(1024)), 10);
        setTimeout(() => handler(new Float32Array(1024)), 20);
      }),
      offFrame: vi.fn(),
      stop: vi.fn(),
    };
    // @ts-expect-error - We are passing a mock mic stream
    await localWhisper.startTranscription(mockMicStream);

    // Check that the pipeline was called with some audio data
    expect(mockPipelineInstance).toHaveBeenCalledWith(expect.any(Float32Array), expect.any(Object));
    expect(onTranscriptUpdate).toHaveBeenCalledWith({
      transcript: { final: 'transcript' },
      chunks: [],
    });
  });
});
