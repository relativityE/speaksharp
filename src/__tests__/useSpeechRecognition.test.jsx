import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import TranscriptionService from '../services/transcription/TranscriptionService';

// Mock the TranscriptionService module
jest.mock('../services/transcription/TranscriptionService');
jest.mock('@xenova/transformers', () => ({
  pipeline: jest.fn().mockResolvedValue(() => Promise.resolve({ text: 'mocked transcription' })),
}));

describe('useSpeechRecognition', () => {
  let mockServiceInstance;
  let onTranscriptUpdateCallback = null;

  beforeAll(() => {
    global.SpeechRecognition = jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));

    global.webkitSpeechRecognition = global.SpeechRecognition;
  });

  beforeEach(() => {
    // Clear all mocks and reset callback
    jest.clearAllMocks();
    onTranscriptUpdateCallback = null;

    // Create a fresh mock instance for each test
    mockServiceInstance = {
      init: jest.fn().mockResolvedValue(undefined),
      startTranscription: jest.fn().mockResolvedValue(undefined),
      stopTranscription: jest.fn().mockResolvedValue(undefined),
      getTranscript: jest.fn().mockResolvedValue(''),
      destroy: jest.fn().mockResolvedValue(undefined), // Make destroy async-aware
      mode: 'web-api', // Add mode property
      // Helper to simulate transcript updates
      simulateTranscriptUpdate: (data) => {
        if (onTranscriptUpdateCallback) {
          // Use act() when calling the callback to ensure React state updates are handled
          act(() => {
            onTranscriptUpdateCallback(data);
          });
        }
      },
    };

    // Mock the TranscriptionService constructor
    TranscriptionService.mockImplementation((mode, options) => {
      // Capture the callback
      if (options && options.onTranscriptUpdate) {
        onTranscriptUpdateCallback = options.onTranscriptUpdate;
      }
      // Set the mode on the instance
      mockServiceInstance.mode = mode || 'web-api';
      return mockServiceInstance;
    });
  });

  afterEach(() => {
    // Clean up any remaining timers or async operations
    jest.clearAllTimers();
    jest.clearAllMocks();
    onTranscriptUpdateCallback = null;
  });

  it('should not initialize on render, but on startListening', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition());

    expect(TranscriptionService).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);

    await act(async () => {
      await result.current.startListening();
    });

    expect(TranscriptionService).toHaveBeenCalledTimes(1);
    expect(mockServiceInstance.init).toHaveBeenCalledTimes(1);

    // Clean up
    if (result.current.isListening) {
      await act(async () => {
        await result.current.stopListening();
      });
    }
    unmount();
  });

  it('should start and stop listening', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition());

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

    unmount();
  });

  it('should handle transcript results and count filler words', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startListening();
    });

    // Simulate partial transcript
    mockServiceInstance.simulateTranscriptUpdate({
      transcript: { partial: 'um, like, this is a test' }
    });

    // Wait for state updates to complete
    await waitFor(() => {
      expect(result.current.fillerData.um.count).toBe(1);
      expect(result.current.fillerData.like.count).toBe(1);
    });

    // Simulate final transcript
    mockServiceInstance.simulateTranscriptUpdate({
      transcript: { final: 'um, like, this is a test' }
    });

    await act(async () => {
      const finalResult = await result.current.stopListening();
      expect(finalResult.transcript).toContain('um, like, this is a test');
    });

    expect(result.current.transcript).toContain('um, like, this is a test');

    unmount();
  });

  it('should count custom filler words', async () => {
    const { result, unmount } = renderHook(() =>
      useSpeechRecognition({ customWords: ['actually'] })
    );

    await act(async () => {
      await result.current.startListening();
    });

    mockServiceInstance.simulateTranscriptUpdate({
      transcript: { partial: 'so actually this is a test' }
    });

    // Wait for filler word counting to complete
    await waitFor(() => {
      expect(result.current.fillerData.actually.count).toBe(1);
      expect(result.current.fillerData.so.count).toBe(1);
    });

    await act(async () => {
      await result.current.stopListening();
    });

    unmount();
  });

  it('should handle errors during start', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition());

    mockServiceInstance.startTranscription.mockRejectedValueOnce(new Error('Start failed'));

    await act(async () => {
      await result.current.startListening();
    });

    expect(result.current.error.message).toBe('Start failed');
    expect(result.current.isListening).toBe(false);

    unmount();
  });

  it('should handle errors during initialization', async () => {
    mockServiceInstance.init.mockRejectedValueOnce(new Error('Init failed'));
    const { result, unmount } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startListening();
    });

    await waitFor(() => {
      expect(result.current.error?.message).toBe('Init failed');
      expect(result.current.isListening).toBe(false);
    }, { timeout: 1000 });

    unmount();
  });

  it('should reset the state', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startListening();
    });

    mockServiceInstance.simulateTranscriptUpdate({
      transcript: { partial: 'um test' }
    });

    // Wait for state updates
    await waitFor(() => {
      expect(result.current.fillerData.um.count).toBe(1);
    });

    await act(async () => {
      await result.current.stopListening();
    });

    expect(result.current.transcript).toBe('um test');

    act(() => {
      result.current.reset();
    });

    expect(result.current.transcript).toBe('');
    expect(result.current.fillerData.um.count).toBe(0);

    unmount();
  });

  it('should not count "a" as a filler word for "ah"', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startListening();
    });

    mockServiceInstance.simulateTranscriptUpdate({
      transcript: { final: 'this is a test' }
    });

    // Wait for processing
    await waitFor(() => {
      expect(result.current.transcript).toBe('this is a test');
    });

    await act(async () => {
      await result.current.stopListening();
    });

    expect(result.current.fillerData.ah.count).toBe(0);

    unmount();
  });
});
