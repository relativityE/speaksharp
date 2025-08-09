import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

// Mock the global SpeechRecognition API
const mockSpeechRecognition = {
  start: vi.fn(),
  stop: vi.fn(),
  onresult: null,
  onerror: null,
  onend: null,
  continuous: false,
  interimResults: false,
  lang: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  global.window.SpeechRecognition = vi.fn(() => mockSpeechRecognition);
});

afterEach(() => {
  // Restore original if it exists
  if (global.window.SpeechRecognition) {
    global.window.SpeechRecognition = undefined;
  }
});

describe('useSpeechRecognition', () => {
  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isListening).toBe(false);
    expect(result.current.transcript).toBe('');
    expect(Object.values(result.current.fillerCounts).every(c => c === 0)).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it('should start and stop listening', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    // Start listening
    act(() => {
      result.current.startListening();
    });
    expect(result.current.isListening).toBe(true);
    expect(mockSpeechRecognition.start).toHaveBeenCalledTimes(1);

    // Stop listening
    act(() => {
      result.current.stopListening();
    });
    // onend should be called by stop()
    act(() => {
      mockSpeechRecognition.onend();
    })
    expect(result.current.isListening).toBe(false);
    expect(mockSpeechRecognition.stop).toHaveBeenCalledTimes(1);
  });

  it('should handle transcript results', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.startListening();
    });

    const mockEvent = {
      resultIndex: 0,
      results: [{ 0: { transcript: 'hello world' }, isFinal: true }],
    };
    act(() => {
      mockSpeechRecognition.onresult(mockEvent);
    });

    expect(result.current.transcript).toContain('hello world');
  });

  it('should count default filler words', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.startListening();
    });
    const mockEvent = {
      resultIndex: 0,
      results: [{ 0: { transcript: 'um, like, you know, ah' }, isFinal: true }],
    };
    act(() => {
      mockSpeechRecognition.onresult(mockEvent);
    });
    expect(result.current.fillerCounts.um).toBe(1);
    expect(result.current.fillerCounts.like).toBe(1);
    expect(result.current.fillerCounts.youKnow).toBe(1);
    expect(result.current.fillerCounts.ah).toBe(1);
  });

  it('should count custom filler words', () => {
    const { result } = renderHook(() => useSpeechRecognition({ customWords: ['customword'] }));
    act(() => {
      result.current.startListening();
    });
    const mockEvent = {
      resultIndex: 0,
      results: [{ 0: { transcript: 'this is a customword test' }, isFinal: true }],
    };
    act(() => {
      mockSpeechRecognition.onresult(mockEvent);
    });
    expect(result.current.fillerCounts.customword).toBe(1);
  });

  it('should correctly detect variations of "uh"', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.startListening();
    });
    const mockEvent = {
      resultIndex: 0,
      results: [{ 0: { transcript: 'uh, uhh, er, erm' }, isFinal: true }],
    };
    act(() => {
      mockSpeechRecognition.onresult(mockEvent);
    });
    expect(result.current.fillerCounts.uh).toBe(4);
  });

  it('should handle multiple and case-insensitive filler words', () => {
    const { result } = renderHook(() => useSpeechRecognition({ customWords: ['Basically'] }));
    act(() => {
      result.current.startListening();
    });
    const mockEvent = {
      resultIndex: 0,
      results: [{ 0: { transcript: 'Um, so, like, basically... Uh, LIKE, you know. basically.' }, isFinal: true }],
    };
    act(() => {
      mockSpeechRecognition.onresult(mockEvent);
    });
    expect(result.current.fillerCounts.um).toBe(1);
    expect(result.current.fillerCounts.so).toBe(1);
    expect(result.current.fillerCounts.like).toBe(2);
    expect(result.current.fillerCounts.uh).toBe(1);
    expect(result.current.fillerCounts.youKnow).toBe(1);
    expect(result.current.fillerCounts.Basically).toBe(2);
  });

  it('should implement keep-alive on unexpected end', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.startListening();
    });
    expect(mockSpeechRecognition.start).toHaveBeenCalledTimes(1);

    // Simulate unexpected end
    act(() => {
      mockSpeechRecognition.onend();
    });

    // Should try to restart
    expect(mockSpeechRecognition.start).toHaveBeenCalledTimes(2);
    expect(result.current.isListening).toBe(true); // Should remain listening
  });

  it('should handle errors', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.startListening();
    });
    const errorEvent = { error: 'network-error' };
    act(() => {
      mockSpeechRecognition.onerror(errorEvent);
    });
    expect(result.current.error).toBe('Speech recognition error: network-error');
    expect(result.current.isListening).toBe(false);
  });

  it('should reset the state', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.startListening();
    });
    act(() => {
      mockSpeechRecognition.onresult({
        resultIndex: 0,
        results: [{ 0: { transcript: 'um' }, isFinal: true }],
      });
    });
    expect(result.current.fillerCounts.um).toBe(1);
    expect(result.current.transcript).toContain('um');

    act(() => {
      result.current.reset();
    });
    expect(result.current.fillerCounts.um).toBe(0);
    expect(result.current.transcript).toBe('');
  });
});
