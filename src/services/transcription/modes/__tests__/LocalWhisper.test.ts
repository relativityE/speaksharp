import { vi, describe, it, expect, beforeEach } from 'vitest';
import LocalWhisper from '../LocalWhisper';

// The mock implementation is defined directly inside the factory
// to ensure it is available when vi.mock is hoisted.
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn().mockImplementation(async (task, model, { progress_callback }) => {
    if (progress_callback) {
      progress_callback({ status: 'progress', progress: 50 });
      progress_callback({ status: 'done' });
    }
    return vi.fn().mockResolvedValue({ text: 'mocked transcript' });
  }),
}));

describe('LocalWhisper Transcription Mode', () => {
  let localWhisper: LocalWhisper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize correctly by creating a pipeline', async () => {
    const { pipeline } = await import('@xenova/transformers');
    localWhisper = new LocalWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
    await localWhisper.init();
    expect(pipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny.en',
      expect.any(Object)
    );
  });

  it('should call onModelLoadProgress during initialization', async () => {
    const onModelLoadProgress = vi.fn();
    localWhisper = new LocalWhisper({
      onTranscriptUpdate: vi.fn(),
      onModelLoadProgress,
      onReady: vi.fn(),
    });
    await localWhisper.init();
    expect(onModelLoadProgress).toHaveBeenCalledWith({ status: 'progress', progress: 50 });
    expect(onModelLoadProgress).toHaveBeenCalledWith({ status: 'done' });
  });

  it('should fall back to local model if hub fails', async () => {
    const { pipeline } = await import('@xenova/transformers');
    const mockPipeline = pipeline as ReturnType<typeof vi.fn>;

    // Make the first call (hub) fail, and the second (local) succeed
    mockPipeline
      .mockRejectedValueOnce(new Error('Hub failed'))
      .mockResolvedValue(vi.fn().mockResolvedValue({ text: 'local model transcript' }));

    localWhisper = new LocalWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
    await localWhisper.init();

    expect(mockPipeline).toHaveBeenCalledTimes(2);
    expect(mockPipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'Xenova/whisper-tiny.en', expect.any(Object));
    expect(mockPipeline).toHaveBeenCalledWith('automatic-speech-recognition', '/models/whisper-tiny.en/', expect.any(Object));
  });
});
