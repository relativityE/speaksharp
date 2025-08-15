import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import TranscriptionService from '../services/transcription/TranscriptionService';

// Mock the TranscriptionService module
vi.mock('../services/transcription/TranscriptionService');

describe('useSpeechRecognition', () => {
  let mockServiceInstance;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Create a mock instance that we can spy on
    mockServiceInstance = {
      init: vi.fn().mockResolvedValue(),
      startTranscription: vi.fn().mockResolvedValue(),
      stopTranscription: vi.fn().mockResolvedValue(),
      getTranscript: vi.fn().mockResolvedValue(''),
      destroy: vi.fn(),
    };

    // Make the TranscriptionService constructor return our mock instance
    TranscriptionService.mockImplementation(() => mockServiceInstance);
  });

  it('should initialize with correct default state', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    // Wait for the async init effect to run
    await waitFor(() => expect(TranscriptionService).toHaveBeenCalledTimes(1));

    expect(result.current.isListening).toBe(false);
    expect(result.current.transcript).toBe('');
    expect(result.current.error).toBe(null);
  });

  it('should start and stop listening', async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(mockServiceInstance.init).toHaveBeenCalledTimes(1));

    // Start listening
    await act(async () => {
      await result.current.startListening();
    });
    expect(result.current.isListening).toBe(true);
    expect(mockServiceInstance.startTranscription).toHaveBeenCalledTimes(1);

    // Stop listening
    await act(async () => {
      await result.current.stopListening();
    });
    expect(result.current.isListening).toBe(false);
    expect(mockServiceInstance.stopTranscription).toHaveBeenCalledTimes(1);
  });

  it('should handle transcript results and count filler words', async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(mockServiceInstance.init).toHaveBeenCalledTimes(1));

    // Set up the mock to return a transcript
    mockServiceInstance.getTranscript.mockResolvedValue('um, like, this is a test');

    // Start listening and wait for the polling interval
    await act(async () => {
      await result.current.startListening();
      // Wait for the interval to fire and process the transcript
      await new Promise(resolve => setTimeout(resolve, 300));
    });

    expect(result.current.transcript).toContain('um, like, this is a test');
    expect(result.current.fillerData.um.count).toBe(1);
    expect(result.current.fillerData.like.count).toBe(1);
  });

  it('should count custom filler words', async () => {
    const { result } = renderHook(() => useSpeechRecognition({ customWords: ['actually'] }));
    await waitFor(() => expect(mockServiceInstance.init).toHaveBeenCalledTimes(1));

    mockServiceInstance.getTranscript.mockResolvedValue('so actually this is a test');

    await act(async () => {
      await result.current.startListening();
      await new Promise(resolve => setTimeout(resolve, 300));
    });

    expect(result.current.fillerData.actually.count).toBe(1);
    // Default words should still work
    expect(result.current.fillerData.so.count).toBe(1);
  });

  it('should handle errors during start', async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(mockServiceInstance.init).toHaveBeenCalledTimes(1));

    // Setup mock to fail on start
    mockServiceInstance.startTranscription.mockRejectedValue(new Error('Start failed'));

    await act(async () => {
      await result.current.startListening();
    });

    expect(result.current.error).toBe('Failed to start speech recognition');
    expect(result.current.isListening).toBe(false);
  });

  it('should handle errors during initialization', async () => {
    // Setup mock to fail on init
    mockServiceInstance.init.mockRejectedValue(new Error('Init failed'));

    const { result } = renderHook(() => useSpeechRecognition());

    await waitFor(() => {
        expect(result.current.error).toBe('Failed to initialize transcription service');
    });
  });

  it('should reset the state', async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(mockServiceInstance.init).toHaveBeenCalledTimes(1));

    mockServiceInstance.getTranscript.mockResolvedValue('um test');

    await act(async () => {
      await result.current.startListening();
      await new Promise(resolve => setTimeout(resolve, 300));
    });

    expect(result.current.transcript).toBe('um test');
    expect(result.current.fillerData.um.count).toBe(1);

    await act(async () => {
      result.current.reset();
    });

    expect(result.current.transcript).toBe('');
    expect(result.current.fillerData.um.count).toBe(0);
  });
});
