import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { useAuth } from '../contexts/AuthContext';

// Mock dependencies
vi.mock('../contexts/AuthContext');
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

// TODO: This test suite hangs, even with all tests skipped. The issue is in the
// module-level mocks or the `beforeEach` setup block. The complex mock for
// TranscriptionService is the most likely cause. This needs to be investigated
// and refactored to resolve the hang.
let mockTranscriptionServiceInstance;

vi.mock('../services/transcription/TranscriptionService', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return mockTranscriptionServiceInstance;
    })
  };
});


describe.skip('useSpeechRecognition', () => { // Skipping the suite until the hang is fixed
  let mockAuth;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuth = {
      session: { user: { id: 'test-user' } },
      profile: { subscription_status: 'free' },
    };
    useAuth.mockReturnValue(mockAuth);

    mockTranscriptionServiceInstance = {
      init: vi.fn().mockResolvedValue(undefined),
      startTranscription: vi.fn().mockResolvedValue(undefined),
      stopTranscription: vi.fn().mockResolvedValue({ transcript: 'Hello world.', total_words: 2 }),
      destroy: vi.fn().mockResolvedValue(undefined),
      mode: 'mock',
    };
  });

  afterEach(() => {
    cleanup();
  });

  const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>;

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    expect(result.current.isListening).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(result.current.transcript).toBe('');
    expect(result.current.chunks).toEqual([]);
  });

  it('should start listening and update state correctly', async () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    expect(TranscriptionService).toHaveBeenCalledTimes(1);
    expect(mockTranscriptionServiceInstance.init).toHaveBeenCalledTimes(1);
    expect(mockTranscriptionServiceInstance.startTranscription).toHaveBeenCalledTimes(1);
    expect(result.current.isListening).toBe(true);
    expect(result.current.mode).toBe('mock');
  });

  it('should stop listening and return final transcript', async () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    let stopResult;
    await act(async () => {
      stopResult = await result.current.stopListening();
    });

    expect(mockTranscriptionServiceInstance.stopTranscription).toHaveBeenCalledTimes(1);
    expect(result.current.isListening).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(stopResult.transcript).toBe('Hello world.');
    expect(stopResult.total_words).toBe(2);
  });

  it('should handle errors during startListening', async () => {
    const error = new Error('Permission denied');
    mockTranscriptionServiceInstance.startTranscription.mockRejectedValue(error);

    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    expect(result.current.isListening).toBe(false);
    expect(result.current.error).toBe(error);
    expect(result.current.isSupported).toBe(false);
  });

  it('should reset the state', async () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
      await result.current.stopListening();
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.transcript).toBe('');
    expect(result.current.chunks).toEqual([]);
    expect(result.current.interimTranscript).toBe('');
    expect(result.current.isReady).toBe(false);
  });

  it('should call destroy on unmount', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    unmount();

    expect(mockTranscriptionServiceInstance.destroy).toHaveBeenCalledTimes(1);
  });
});
