import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useSpeechRecognition } from '../index';

// Mock dependencies that are not the target of the test
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

// Wrapper component for the hook
function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useSpeechRecognition Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('should reset all state when reset is called', async () => {
    const { result } = renderHook(() =>
      useSpeechRecognition({ customWords: ['um'] }),
      { wrapper }
    );

    // Call startListening to change the hook's internal state from its initial values.
    await act(async () => {
      await result.current.startListening();
    });

    // Verify that some state has indeed changed (this is optional but good practice)
    expect(result.current.isListening).toBe(true);

    // Reset the state
    await act(async () => {
      result.current.reset();
    });

    // Assert that all relevant state properties are reset to their initial values
    expect(result.current.isListening).toBe(false);
    expect(result.current.transcript.transcript).toBe('');
    expect(result.current.transcript.total_words).toBe(0);
    expect(result.current.transcript.wpm).toBe(0);
    expect(result.current.transcript.clarity_score).toBe(0);
    expect(result.current.chunks).toEqual([]);
    expect(result.current.interimTranscript).toBe('');
    expect(result.current.fillerData.total.count).toBe(0);
  });
});
