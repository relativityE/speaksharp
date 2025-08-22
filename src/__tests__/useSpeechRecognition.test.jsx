import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the TranscriptionService BEFORE importing the hook
const mockTranscriptionService = {
  init: vi.fn().mockResolvedValue(),
  startTranscription: vi.fn(),
  stopTranscription: vi.fn(),
  destroy: vi.fn(),
  setLanguage: vi.fn(),
  onTranscriptionUpdate: vi.fn(),
  onError: vi.fn(),
  onStatusChange: vi.fn(),
};

// Use vi.hoisted to ensure this runs before imports
vi.mock('../services/transcription/TranscriptionService', () => ({
  default: vi.fn().mockImplementation(() => mockTranscriptionService),
  TranscriptionService: vi.fn().mockImplementation(() => mockTranscriptionService),
}));

// Mock @xenova/transformers completely
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
  env: { allowRemoteModels: false, allowLocalModels: false },
}));

// Import the hook AFTER mocking
const { useSpeechRecognition } = await import('../hooks/useSpeechRecognition');

describe('useSpeechRecognition', () => {
  let mockGetUserMedia;
  let mockSpeechRecognition;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock getUserMedia
    mockGetUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }]
    });

    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: mockGetUserMedia,
      },
      writable: true,
      configurable: true,
    });

    // Mock SpeechRecognition
    mockSpeechRecognition = {
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      continuous: false,
      interimResults: false,
      lang: 'en-US',
    };

    global.SpeechRecognition = vi.fn(() => mockSpeechRecognition);
    global.webkitSpeechRecognition = vi.fn(() => mockSpeechRecognition);

    // Reset TranscriptionService mock calls
    Object.values(mockTranscriptionService).forEach(mock => {
      if (typeof mock === 'function') {
        mock.mockClear();
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial Render - No Permissions', () => {
    it('should not call getUserMedia on initial render', () => {
      renderHook(() => useSpeechRecognition());

      expect(mockGetUserMedia).not.toHaveBeenCalled();
    });

    it('should return initial state values', () => {
      const { result } = renderHook(() => useSpeechRecognition());

      expect(result.current.isListening).toBe(false);
      expect(result.current.transcript).toBe('');
      expect(result.current.interimTranscript).toBe('');
      expect(result.current.error).toBeNull();
      expect(typeof result.current.startListening).toBe('function');
      expect(typeof result.current.stopListening).toBe('function');
      expect(typeof result.current.reset).toBe('function');
    });
  });

  describe('Start Listening - Permissions and Service Initialization', () => {
    it('should call getUserMedia when startListening is invoked', async () => {
      const { result } = renderHook(() => useSpeechRecognition());

      await act(async () => {
        await result.current.startListening();
      });

      expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
    });

    it('should create and initialize TranscriptionService when startListening is called', async () => {
      const { result } = renderHook(() => useSpeechRecognition());

      await act(async () => {
        await result.current.startListening();
      });

      expect(mockTranscriptionService.init).toHaveBeenCalled();
      expect(mockTranscriptionService.startTranscription).toHaveBeenCalled();
    });

    it('should set isListening to true when startListening is called', async () => {
      const { result } = renderHook(() => useSpeechRecognition());

      await act(async () => {
        await result.current.startListening();
      });

      expect(result.current.isListening).toBe(true);
    });

    it('should handle getUserMedia rejection gracefully', async () => {
      const mockError = new Error('Permission denied');
      mockGetUserMedia.mockRejectedValue(mockError);

      const { result } = renderHook(() => useSpeechRecognition());

      await act(async () => {
        await result.current.startListening();
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.isListening).toBe(false);
    });
  });

  describe('Stop Listening', () => {
    it('should set isListening to false when stopListening is called', async () => {
      const { result } = renderHook(() => useSpeechRecognition());

      // Start listening first
      await act(async () => {
        await result.current.startListening();
      });

      expect(result.current.isListening).toBe(true);

      // Stop listening
      await act(async () => {
        result.current.stopListening();
      });

      expect(result.current.isListening).toBe(false);
    });

    it('should call stopTranscription on the service when stopListening is called', async () => {
      const { result } = renderHook(() => useSpeechRecognition());

      // Start listening first
      await act(async () => {
        await result.current.startListening();
      });

      // Stop listening
      await act(async () => {
        result.current.stopListening();
      });

      expect(mockTranscriptionService.stopTranscription).toHaveBeenCalled();
    });

    it('should handle stopListening when not currently listening', async () => {
      const { result } = renderHook(() => useSpeechRecognition());

      // Try to stop without starting
      await act(async () => {
        result.current.stopListening();
      });

      expect(result.current.isListening).toBe(false);
      // Should not throw an error
    });
  });

  describe('Reset Functionality', () => {
    it('should clear transcript and related state when reset is called', async () => {
      const { result } = renderHook(() => useSpeechRecognition());

      // Simulate some transcript data
      await act(async () => {
        await result.current.startListening();
        // Simulate transcript update (this would normally come from the service)
        // We'll test the reset functionality by checking initial state restoration
      });

      await act(async () => {
        result.current.reset();
      });

      expect(result.current.transcript).toBe('');
      expect(result.current.interimTranscript).toBe('');
      expect(result.current.error).toBeNull();
    });

    it('should stop listening and reset state when reset is called during listening', async () => {
      const { result } = renderHook(() => useSpeechRecognition());

      // Start listening
      await act(async () => {
        await result.current.startListening();
      });

      expect(result.current.isListening).toBe(true);

      // Reset
      await act(async () => {
        result.current.reset();
      });

      expect(result.current.isListening).toBe(false);
      expect(result.current.transcript).toBe('');
      expect(result.current.interimTranscript).toBe('');
      expect(result.current.error).toBeNull();
    });
  });

  describe('Service Integration', () => {
    it('should set up service callbacks correctly', async () => {
      const { result } = renderHook(() => useSpeechRecognition());

      await act(async () => {
        await result.current.startListening();
      });

      // Verify that the service callbacks were set up
      expect(mockTranscriptionService.onTranscriptionUpdate).toHaveBeenCalled();
      expect(mockTranscriptionService.onError).toHaveBeenCalled();
      expect(mockTranscriptionService.onStatusChange).toHaveBeenCalled();
    });

    it('should not call getUserMedia multiple times if already listening', async () => {
      const { result } = renderHook(() => useSpeechRecognition());

      await act(async () => {
        await result.current.startListening();
      });

      await act(async () => {
        await result.current.startListening(); // Call again
      });

      // getUserMedia should only be called once
      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle service initialization errors', async () => {
      mockTranscriptionService.init.mockRejectedValue(new Error('Service init failed'));

      const { result } = renderHook(() => useSpeechRecognition());

      await act(async () => {
        await result.current.startListening();
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.isListening).toBe(false);
    });

    it('should clear errors when reset is called', async () => {
      mockGetUserMedia.mockRejectedValue(new Error('Permission denied'));

      const { result } = renderHook(() => useSpeechRecognition());

      // Trigger an error
      await act(async () => {
        await result.current.startListening();
      });

      expect(result.current.error).toBeTruthy();

      // Reset should clear the error
      await act(async () => {
        result.current.reset();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('Cleanup', () => {
    it('should clean up service when component unmounts', async () => {
      const { result, unmount } = renderHook(() => useSpeechRecognition());

      await act(async () => {
        await result.current.startListening();
      });

      unmount();

      expect(mockTranscriptionService.destroy).toHaveBeenCalled();
    });
  });
});
