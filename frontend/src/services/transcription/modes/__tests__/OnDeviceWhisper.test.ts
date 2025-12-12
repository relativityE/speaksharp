import { describe, it, expect, vi, beforeEach } from 'vitest';
import OnDeviceWhisper from '../OnDeviceWhisper';
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

describe('OnDeviceWhisper (whisper-turbo backend)', () => {
  let onDeviceWhisper: OnDeviceWhisper;
  const mockOnTranscriptUpdate = vi.fn();
  const mockOnModelLoadProgress = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onDeviceWhisper = new OnDeviceWhisper({
      onTranscriptUpdate: mockOnTranscriptUpdate,
      onModelLoadProgress: mockOnModelLoadProgress,
      onReady: vi.fn()
    });
  });

  it('initializes correctly', async () => {
    await expect(onDeviceWhisper.init()).resolves.not.toThrow();
  });

  it('starts transcription and emits update', async () => {
    await onDeviceWhisper.init();

    const mockMic = {
      onFrame: vi.fn((callback) => {
        // Simulate some audio frames
        callback(new Float32Array(16000)); // 1 second of silence
      }),
      offFrame: vi.fn()
    } as unknown as MicStream;

    // We need to mock setTimeout to speed up the 5s recording
    vi.useFakeTimers();
    const startPromise = onDeviceWhisper.startTranscription(mockMic);

    vi.advanceTimersByTime(5000);
    await startPromise;

    expect(mockOnTranscriptUpdate).toHaveBeenCalledWith({
      transcript: { final: 'Test transcript' }
    });

    vi.useRealTimers();
  });
});
