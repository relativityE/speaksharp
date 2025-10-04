import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useSpeechRecognition } from '../index';
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
            profile: { id: 'pro-user', subscription_status: 'pro' },
      session: null
    }), { wrapper });

    expect(useTranscriptState).toHaveBeenCalled();
    expect(useFillerWords).toHaveBeenCalledExactlyOnceWith([], '', ['like', 'um']);
    expect(useTranscriptionService).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        profile: { id: 'pro-user', subscription_status: 'pro' },
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
});