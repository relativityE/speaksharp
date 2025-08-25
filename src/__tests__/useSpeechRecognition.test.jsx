import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// 1. Hoist all mocks using vi.hoisted()
const { mockTranscriptionServiceInstance } = vi.hoisted(() => {
  // Define the mock instance that the tests will need to access.
  const mockInstance = {
    init: vi.fn(),
    startTranscription: vi.fn(),
    stopTranscription: vi.fn(),
    destroy: vi.fn(),
    onTranscriptUpdateCallback: null,
  };

  // Mock the dependencies. These calls are for side-effects and don't return anything.
  vi.mock('../services/transcription/TranscriptionService', () => ({
    default: vi.fn().mockImplementation((options) => {
      // When the service is constructed, we store the callback it was given
      // so we can simulate the service calling it.
      mockInstance.onTranscriptUpdateCallback = options.onTranscriptUpdate;
      return mockInstance;
    }),
  }));
  vi.mock('../contexts/AuthContext', () => ({
    useAuth: () => ({
      user: { id: 'test-user-id' },
      profile: { subscription_status: 'free' },
    }),
  }));

  // Return ONLY the mock instance that the test file's top-level scope needs.
  return { mockTranscriptionServiceInstance: mockInstance };
});

// 2. Import the hook AFTER the hoisted mocks.
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

describe('useSpeechRecognition (vi.hoisted)', () => {

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    mockTranscriptionServiceInstance.init.mockResolvedValue(undefined);
    mockTranscriptionServiceInstance.startTranscription.mockResolvedValue(undefined);
    mockTranscriptionServiceInstance.stopTranscription.mockResolvedValue(undefined);
    mockTranscriptionServiceInstance.onTranscriptUpdateCallback = null;
  });

  it('should have correct initial state', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isListening).toBe(false);
    expect(result.current.transcript).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('should initialize and start the transcription service on startListening', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startListening();
    });

    expect(mockTranscriptionServiceInstance.init).toHaveBeenCalledOnce();
    expect(mockTranscriptionServiceInstance.startTranscription).toHaveBeenCalledOnce();
    expect(result.current.isListening).toBe(true);
  });

  it('should stop the transcription service on stopListening', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startListening();
    });
    expect(result.current.isListening).toBe(true);

    await act(async () => {
      await result.current.stopListening();
    });

    expect(mockTranscriptionServiceInstance.stopTranscription).toHaveBeenCalledOnce();
    expect(result.current.isListening).toBe(false);
  });

  it('should update transcript when the service sends a final transcript update', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startListening();
    });

    expect(mockTranscriptionServiceInstance.onTranscriptUpdateCallback).toBeInstanceOf(Function);

    const transcriptData = { transcript: { final: 'Hello world.' } };
    await act(async () => {
      mockTranscriptionServiceInstance.onTranscriptUpdateCallback(transcriptData);
    });

    expect(result.current.transcript).toBe('Hello world.');
    expect(result.current.chunks).toEqual([{ text: 'Hello world.', id: expect.any(Number) }]);
  });

  it('should reset the transcript and state on reset()', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startListening();
      mockTranscriptionServiceInstance.onTranscriptUpdateCallback({ transcript: { final: 'Initial transcript.' } });
    });

    expect(result.current.transcript).toBe('Initial transcript.');

    await act(async () => {
      result.current.reset();
    });

    expect(result.current.transcript).toBe('');
    expect(result.current.chunks).toEqual([]);
    expect(result.current.isListening).toBe(true);
  });
});
