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

describe('useSpeechRecognition', () => {
  let mockAuth;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockAuth = {
      session: { user: { id: 'test-user' } },
      profile: { subscription_status: 'free' },
    };
    useAuth.mockReturnValue(mockAuth);
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
    expect(result.current.interimTranscript).toBe('');
    expect(result.current.error).toBeNull();
    expect(result.current.isSupported).toBe(true);
    expect(result.current.mode).toBeNull();
  });

  it('should start listening and update state correctly', async () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    const mockInstance = TranscriptionService.mock.instances[0];
    expect(TranscriptionService).toHaveBeenCalledTimes(1);
    expect(mockInstance.init).toHaveBeenCalledTimes(1);
    expect(mockInstance.startTranscription).toHaveBeenCalledTimes(1);
    expect(result.current.isListening).toBe(true);
    // The mode is now 'mock' because of our updated mock
    expect(result.current.mode).toBe('mock');
  });

  it('should stop listening and return final transcript', async () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    const mockInstance = TranscriptionService.mock.instances[0];

    // Simulate transcript updates
    act(() => {
      // The onTranscriptUpdate callback is passed to the constructor
      const onTranscriptUpdateCallback = vi.mocked(TranscriptionService).mock.calls[0][0].onTranscriptUpdate;
      onTranscriptUpdateCallback({ transcript: { final: 'Hello world.' } });
    });

    let stopResult;
    await act(async () => {
      stopResult = await result.current.stopListening();
    });

    expect(mockInstance.stopTranscription).toHaveBeenCalledTimes(1);
    expect(result.current.isListening).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(stopResult.transcript).toBe('Hello world.');
    expect(stopResult.total_words).toBe(2);
  });

  it('should handle errors during startListening', async () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });
    const error = new Error('Permission denied');

    await act(async () => {
      await result.current.startListening();
    });

    const mockInstance = TranscriptionService.mock.instances[0];
    mockInstance.startTranscription.mockRejectedValue(error);

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
    });

    act(() => {
      const onTranscriptUpdateCallback = TranscriptionService.mock.calls[0][0].onTranscriptUpdate;
      onTranscriptUpdateCallback({ transcript: { final: 'Test transcript' } });
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

    const mockInstance = TranscriptionService.mock.instances[0];

    unmount();

    expect(mockInstance.destroy).toHaveBeenCalledTimes(1);
  });
});
