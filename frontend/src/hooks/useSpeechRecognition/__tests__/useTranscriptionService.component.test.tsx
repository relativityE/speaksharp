import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTranscriptionService } from '../useTranscriptionService';
import { E2E_DETERMINISTIC_NATIVE } from '../types';

// Mock the TranscriptionService
const mockService = {
  init: vi.fn().mockResolvedValue({ success: true }),
  startTranscription: vi.fn().mockResolvedValue(undefined),
  stopTranscription: vi.fn().mockResolvedValue(''),
  destroy: vi.fn().mockResolvedValue(undefined),
  getMode: vi.fn().mockReturnValue('native')
};

vi.mock('../../../services/transcription/TranscriptionService', () => ({
  default: vi.fn().mockImplementation(() => mockService)
}));

vi.mock('../../../lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  }
}));

describe('useTranscriptionService', () => {
  const mockOptions = {
    onTranscriptUpdate: vi.fn(),
    onModelLoadProgress: vi.fn(),
    onReady: vi.fn(),
    session: null,
    navigate: vi.fn(),
    getAssemblyAIToken: vi.fn().mockResolvedValue('token')
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useTranscriptionService(mockOptions));

    expect(result.current.isListening).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isSupported).toBe(true);
    expect(result.current.mode).toBeNull();
  });

  it('should start listening successfully', async () => {
    const { result } = renderHook(() => useTranscriptionService(mockOptions));

    await act(async () => {
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });

    expect(mockService.init).toHaveBeenCalled();
    expect(mockService.startTranscription).toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
    expect(result.current.mode).toBe('native');
  });

  it('should stop listening successfully', async () => {
    const { result } = renderHook(() => useTranscriptionService(mockOptions));

    // Start listening
    await act(async () => {
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });
    expect(result.current.isListening).toBe(true);

    // Stop listening
    await act(async () => {
      const response = await result.current.stopListening();
      expect(response).toEqual({ success: true });
    });

    // The useEffect cleanup which calls destroy is asynchronous.
    // We need to wait for the mock to be called.
    await vi.waitFor(() => {
      expect(mockService.destroy).toHaveBeenCalled();
    });

    expect(result.current.isListening).toBe(false);
  });

  it('should handle start listening errors', async () => {
    mockService.init.mockRejectedValueOnce(new Error('Permission denied'));
    const { result } = renderHook(() => useTranscriptionService(mockOptions));

    await act(async () => {
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.error?.message).toContain('Microphone permission denied');
    expect(result.current.isListening).toBe(false);
    expect(result.current.isSupported).toBe(false);
  });

  it('should cleanup on unmount', async () => {
    const { result, unmount } = renderHook(() => useTranscriptionService(mockOptions));

    await act(async () => {
      await result.current.startListening(E2E_DETERMINISTIC_NATIVE);
    });

    unmount();

    expect(mockService.destroy).toHaveBeenCalled();
  });
});