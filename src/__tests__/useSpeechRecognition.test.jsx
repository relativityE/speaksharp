// src/__tests__/useSpeechRecognition.test.jsx
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('useSpeechRecognition Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('transitions from idle to listening state', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    // Initially, not listening
    expect(result.current.isListening).toBe(false);

    // Start listening
    act(() => {
      result.current.startListening();
    });

    // Advance timers to allow onstart to fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(result.current.isListening).toBe(true);

    // Simulate speech end
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(result.current.isListening).toBe(false);
  });

  it('handles recognition results correctly', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
    });

    // Advance timers enough for onstart and onresult
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(result.current.transcript).toContain('test phrase');
  });
});
