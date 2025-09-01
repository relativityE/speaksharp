import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { useAuth } from '../contexts/AuthContext';

// Mock dependencies
vi.mock('../services/transcription/TranscriptionService');
vi.mock('../contexts/AuthContext');
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe.skip('useSpeechRecognition', () => {
  let mockAuth;
  let mockTranscriptionServiceInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockAuth = {
      session: { user: { id: 'test-user' } },
      profile: { subscription_status: 'free' },
    };
    useAuth.mockReturnValue(mockAuth);

    // Create a mock instance that the constructor will return
    mockTranscriptionServiceInstance = {
      init: vi.fn().mockResolvedValue(undefined),
      startTranscription: vi.fn().mockResolvedValue(undefined),
      stopTranscription: vi.fn().mockResolvedValue({ transcript: 'Hello world.', total_words: 2 }),
      destroy: vi.fn(),
      mode: 'mock',
    };

    // Configure the mock constructor to return our mock instance
    vi.mocked(TranscriptionService).mockImplementation(() => mockTranscriptionServiceInstance);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
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

    // Directly call the mocked stop function
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
    // Setup the mock to reject for this specific test
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

    // Set some initial state by starting and stopping
    await act(async () => {
      await result.current.startListening();
      await result.current.stopListening();
    });

    // Now reset
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

    // Start listening to create the service instance
    await act(async () => {
      await result.current.startListening();
    });

    // Now unmount the hook, which should trigger the cleanup effect
    unmount();

    expect(mockTranscriptionServiceInstance.destroy).toHaveBeenCalledTimes(1);
  });
});
