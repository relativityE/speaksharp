import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import TranscriptionService from '../services/transcription/TranscriptionService';

// Mock the TranscriptionService module
vi.mock('../services/transcription/TranscriptionService');

describe('useSpeechRecognition', () => {
  let mockServiceInstance;
  let onUpdateCallback;

  beforeEach(() => {
    vi.clearAllMocks();

    mockServiceInstance = {
      init: vi.fn().mockResolvedValue(undefined),
      startTranscription: vi.fn().mockResolvedValue(undefined),
      stopTranscription: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
    };

    // Capture the onUpdate callback passed to the constructor
    TranscriptionService.mockImplementation((mode, { onUpdate }) => {
      onUpdateCallback = onUpdate;
      return mockServiceInstance;
    });
  });

  it('should not initialize on render, but on startListening', async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(TranscriptionService).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);

    await act(async () => {
      await result.current.startListening();
    });

    expect(TranscriptionService).toHaveBeenCalledTimes(1);
    expect(mockServiceInstance.init).toHaveBeenCalledTimes(1);
  });

  it('should start and stop listening', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startListening();
    });
    expect(result.current.isListening).toBe(true);
    expect(mockServiceInstance.startTranscription).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.stopListening();
    });
    expect(result.current.isListening).toBe(false);
    expect(mockServiceInstance.stopTranscription).toHaveBeenCalledTimes(1);
  });

  it('should handle transcript results and count filler words', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startListening();
    });

    act(() => {
      onUpdateCallback({ transcript: 'um, like, this is a test', isFinal: true });
    });

    await waitFor(() => {
      expect(result.current.transcript).toContain('um, like, this is a test');
      expect(result.current.fillerData.um.count).toBe(1);
      expect(result.current.fillerData.like.count).toBe(1);
    });
  });

  it('should count custom filler words', async () => {
    const { result } = renderHook(() => useSpeechRecognition({ customWords: ['actually'] }));

    await act(async () => {
      await result.current.startListening();
    });

    act(() => {
      onUpdateCallback({ transcript: 'so actually this is a test', isFinal: true });
    });

    await waitFor(() => {
      expect(result.current.fillerData.actually.count).toBe(1);
      expect(result.current.fillerData.so.count).toBe(1);
    });
  });

  it('should handle errors during start', async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    mockServiceInstance.startTranscription.mockRejectedValue(new Error('Start failed'));

    await act(async () => {
      await result.current.startListening();
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to start speech recognition. Please check microphone permissions.');
    });
    expect(result.current.isListening).toBe(false);
  });

  it('should handle errors during initialization', async () => {
    mockServiceInstance.init.mockRejectedValue(new Error('Init failed'));
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
        await result.current.startListening();
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to start speech recognition. Please check microphone permissions.');
    });
  });

  it('should reset the state', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startListening();
    });

    act(() => {
      onUpdateCallback({ transcript: 'um test', isFinal: true });
    });

    await waitFor(() => {
      expect(result.current.transcript).toBe('um test');
      expect(result.current.fillerData.um.count).toBe(1);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.transcript).toBe('');
    expect(result.current.fillerData.um.count).toBe(0);
  });
});
