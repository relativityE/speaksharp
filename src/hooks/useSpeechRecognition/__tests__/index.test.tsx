import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
// Import the exported prod hook and alias it as useSpeechRecognition for the test suite
import { useSpeechRecognition_prod as useSpeechRecognition } from '../index';
import { useTranscriptState } from '../useTranscriptState';
import { useFillerWords } from '../useFillerWords';
import { useTranscriptionService } from '../useTranscriptionService';

vi.mock('../useTranscriptState');
vi.mock('../useFillerWords');
vi.mock('../useTranscriptionService');

vi.mock('../../../contexts/useAuth', () => ({
  useAuth: vi.fn(() => ({ session: null }))
}));

vi.mock('../../../utils/fillerWordUtils', () => ({
  calculateTranscriptStats: vi.fn(() => ({
    transcript: 'test',
    total_words: 1,
    accuracy: 0.9,
    duration: 30
  }))
}));

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useSpeechRecognition', () => {
  const mockUseTranscriptState = {
    finalChunks: [],
    interimTranscript: '',
    transcript: '',
    addChunk: vi.fn(),
    setInterimTranscript: vi.fn(),
    reset: vi.fn()
  };

  const mockUseFillerWords = {
    fillerData: { total: { count: 0, color: '' } },
    finalFillerData: { total: { count: 0, color: '' } },
    reset: vi.fn()
  };

  const mockUseTranscriptionService = {
    isListening: false,
    isReady: false,
    error: null,
    isSupported: true,
    mode: null,
    startListening: vi.fn(),
    stopListening: vi.fn().mockResolvedValue({ success: true }),
    reset: vi.fn(),
    setIsReady: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTranscriptState).mockReturnValue(mockUseTranscriptState);
    vi.mocked(useFillerWords).mockReturnValue(mockUseFillerWords);
    vi.mocked(useTranscriptionService).mockReturnValue(mockUseTranscriptionService);
  });

  it('should initialize and return expected interface', () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    expect(result.current).toHaveProperty('transcript');
    expect(result.current).toHaveProperty('chunks');
    expect(result.current).toHaveProperty('interimTranscript');
    expect(result.current).toHaveProperty('fillerData');
    expect(result.current).toHaveProperty('isListening');
    expect(result.current).toHaveProperty('isReady');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('isSupported');
    expect(result.current).toHaveProperty('mode');
    expect(result.current).toHaveProperty('startListening');
    expect(result.current).toHaveProperty('stopListening');
    expect(result.current).toHaveProperty('reset');
  });

  it('should call sub-hooks with correct parameters', () => {
    renderHook(() => useSpeechRecognition({
      customWords: ['like', 'um'],
            profile: { id: 'pro-user', email: 'test@example.com', subscription_status: 'pro' },
      session: null
    }), { wrapper });

    expect(useTranscriptState).toHaveBeenCalled();
    expect(useFillerWords).toHaveBeenCalledExactlyOnceWith([], '', ['like', 'um']);
    expect(useTranscriptionService).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        profile: { id: 'pro-user', email: 'test@example.com', subscription_status: 'pro' },
        session: null,
        onTranscriptUpdate: expect.any(Function),
        onReady: expect.any(Function),
        onModelLoadProgress: expect.any(Function),
        navigate: expect.any(Function),
      })
    );
  });

  it('should handle stopListening with stats', async () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      const stats = await result.current.stopListening();
      expect(stats).toEqual(expect.objectContaining({
        transcript: 'test',
        total_words: 1,
        filler_words: { total: { count: 0, color: '' } }
      }));
    });
  });

  it('should call reset on all sub-hooks when startListening is called', async () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      await result.current.startListening();
    });

    expect(mockUseTranscriptState.reset).toHaveBeenCalled();
    expect(mockUseFillerWords.reset).toHaveBeenCalled();
    expect(mockUseTranscriptionService.reset).toHaveBeenCalled();
    expect(mockUseTranscriptionService.startListening).toHaveBeenCalled();
  });

  it('should call reset on all sub-hooks when reset is called', () => {
    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    act(() => {
      result.current.reset();
    });

    expect(mockUseTranscriptState.reset).toHaveBeenCalled();
    expect(mockUseFillerWords.reset).toHaveBeenCalled();
    expect(mockUseTranscriptionService.reset).toHaveBeenCalled();
  });

  it('should handle partial transcript updates from the service', () => {
    renderHook(() => useSpeechRecognition(), { wrapper });

    // Get the onTranscriptUpdate callback passed to the service
    const onTranscriptUpdate = vi.mocked(useTranscriptionService).mock.calls[0][0].onTranscriptUpdate;
    act(() => {
        onTranscriptUpdate({ transcript: { partial: 'hello' } });
    });

    expect(mockUseTranscriptState.setInterimTranscript).toHaveBeenCalledWith('hello');
  });

  it('should handle final transcript updates from the service', () => {
    renderHook(() => useSpeechRecognition(), { wrapper });

    const onTranscriptUpdate = vi.mocked(useTranscriptionService).mock.calls[0][0].onTranscriptUpdate;
    act(() => {
      onTranscriptUpdate({ transcript: { final: 'hello world' } });
    });

    expect(mockUseTranscriptState.addChunk).toHaveBeenCalledWith('hello world', undefined);
    expect(mockUseTranscriptState.setInterimTranscript).toHaveBeenCalledWith('');
  });

  it('should return null from stopListening on failure', async () => {
    vi.mocked(useTranscriptionService).mockReturnValue({
      ...mockUseTranscriptionService,
      stopListening: vi.fn().mockResolvedValue({ success: false }),
    });

    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      const stats = await result.current.stopListening();
      expect(stats).toBeNull();
    });
  });

  it('should handle errors during startListening', async () => {
    const error = new Error('Permission denied');
    vi.mocked(useTranscriptionService).mockReturnValue({
      ...mockUseTranscriptionService,
      startListening: vi.fn().mockRejectedValue(new Error('Permission denied')),
      error: error,
      isSupported: false,
    });

    const { result } = renderHook(() => useSpeechRecognition(), { wrapper });

    await act(async () => {
      try {
        await result.current.startListening();
      } catch {
        // Expected rejection
      }
    });

    expect(result.current.error).toEqual(error);
    expect(result.current.isListening).toBe(false);
    expect(result.current.isSupported).toBe(false);
  });
});
