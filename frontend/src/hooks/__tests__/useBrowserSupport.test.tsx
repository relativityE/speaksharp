/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBrowserSupport } from '../useBrowserSupport';

// Beta first-impression: the unsupported-browser messaging must be correct so a new user on an
// unsupported browser gets the right guidance instead of a silent failure.
type MutableWin = { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };

describe('useBrowserSupport', () => {
  const win = window as unknown as MutableWin;
  let originalMediaDevices: unknown;

  beforeEach(() => {
    delete win.SpeechRecognition;
    delete win.webkitSpeechRecognition;
    originalMediaDevices = (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  });
  afterEach(() => {
    delete win.SpeechRecognition;
    delete win.webkitSpeechRecognition;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices });
  });

  const setMedia = (value: unknown) =>
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value });

  it('reports supported when speech + media + storage are all available', () => {
    win.webkitSpeechRecognition = class {};
    setMedia({ getUserMedia: () => Promise.resolve() });
    const { result } = renderHook(() => useBrowserSupport());
    expect(result.current.isSupported).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('reports the speech-unsupported message when SpeechRecognition is missing', () => {
    setMedia({ getUserMedia: () => Promise.resolve() });
    const { result } = renderHook(() => useBrowserSupport());
    expect(result.current.isSupported).toBe(false);
    expect(result.current.error).toMatch(/Browser transcription isn't available/i);
  });

  it('reports the microphone message when speech is present but mediaDevices is missing', () => {
    win.SpeechRecognition = class {};
    setMedia(undefined);
    const { result } = renderHook(() => useBrowserSupport());
    expect(result.current.isSupported).toBe(false);
    expect(result.current.error).toMatch(/Microphone access not supported/i);
  });
});
