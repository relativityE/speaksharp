import { describe, it, expect, vi, beforeEach } from 'vitest';
import PrivateWhisper from '../PrivateWhisper';
import { MicStream } from '../../utils/types';

// Mock the whisper-turbo library
vi.mock('whisper-turbo', () => {
  return {
    SessionManager: vi.fn().mockImplementation(() => ({
      loadModel: vi.fn().mockResolvedValue({
        isErr: false,
        value: {
          transcribe: vi.fn().mockResolvedValue({
            isErr: false,
            value: { text: 'Test transcript' }
          })
        }
      })
    })),
    AvailableModels: {
      WHISPER_TINY: 'tiny'
    }
  };
});

describe('PrivateWhisper (whisper-turbo backend)', () => {
  let privateWhisper: PrivateWhisper;
  const mockOnTranscriptUpdate = vi.fn();
  const mockOnModelLoadProgress = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    privateWhisper = new PrivateWhisper({
      onTranscriptUpdate: mockOnTranscriptUpdate,
      onModelLoadProgress: mockOnModelLoadProgress,
      onReady: vi.fn()
    });
  });

  it('initializes correctly', async () => {
    await expect(privateWhisper.init()).resolves.not.toThrow();
  });

  it('starts transcription and emits update', async () => {
    await privateWhisper.init();

    const mockMic = {
      onFrame: vi.fn((callback) => {
        // Simulate some audio frames
        callback(new Float32Array(16000)); // 1 second of silence
      }),
      offFrame: vi.fn()
    } as unknown as MicStream;

    // We need to mock setTimeout to speed up the 5s recording
    vi.useFakeTimers();
    const startPromise = privateWhisper.startTranscription(mockMic);

    vi.advanceTimersByTime(5000);
    await startPromise;

    expect(mockOnTranscriptUpdate).toHaveBeenCalledWith({
      transcript: { final: 'Test transcript' }
    });

    vi.useRealTimers();
  });
});
