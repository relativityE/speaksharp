import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useSpeechRecognition } from '../index';

vi.mock('../../../contexts/useAuth', () => ({
  useAuth: vi.fn(() => ({ session: null }))
}));

vi.mock('../../../services/transcription/TranscriptionService', () => ({
  default: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue({ success: true }),
    startTranscription: vi.fn().mockResolvedValue(undefined),
    stopTranscription: vi.fn().mockResolvedValue({ success: true }),
    destroy: vi.fn().mockResolvedValue(undefined),
    getMode: vi.fn().mockReturnValue('native')
  }))
}));

vi.mock('../../../utils/fillerWordUtils', () => ({
  createInitialFillerData: vi.fn(() => ({ total: 0, um: 0 })),
  countFillerWords: vi.fn(() => ({ total: 1, um: 1 })),
  calculateTranscriptStats: vi.fn(() => ({
    transcript: 'test transcript',
    total_words: 2,
    accuracy: 0.95,
    duration: 30
  })),
  limitArray: vi.fn((arr) => arr)
}));

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useSpeechRecognition Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should reset all state when reset is called', () => {
    const { result } = renderHook(() =>
      useSpeechRecognition({ customWords: ['um'] }),
      { wrapper }
    );

    act(() => {
      result.current.reset();
    });

    expect(result.current.transcript).toBe('');
    expect(result.current.chunks).toEqual([]);
    expect(result.current.interimTranscript).toBe('');
    expect(result.current.fillerData).toEqual({ total: 0, um: 0 });
  });
});