/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBrowserSupport } from '../useBrowserSupport';

// Beta first-impression: the unsupported-browser messaging must be CORRECT. A false "unsupported"
// on the landing page is worse than none — it turns a working browser away before the user starts.
//
// #1323/#1184 CURRENTIZED. These previously asserted that a missing Web Speech API meant unsupported.
// That encoded the defect: #1184 retired Web Speech, and Private STT is WebAssembly and never calls it.
// The old contract told Firefox users the product would not work for them, when it would.
type MutableWin = { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };

describe('useBrowserSupport', () => {
  const win = window as unknown as MutableWin;
  let originalMediaDevices: unknown;
  const realWebAssembly = globalThis.WebAssembly;

  beforeEach(() => {
    delete win.SpeechRecognition;
    delete win.webkitSpeechRecognition;
    originalMediaDevices = (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  });
  afterEach(() => {
    delete win.SpeechRecognition;
    delete win.webkitSpeechRecognition;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices });
    Object.defineProperty(globalThis, 'WebAssembly', { configurable: true, writable: true, value: realWebAssembly });
  });

  const setMedia = (value: unknown) =>
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value });
  const setWasm = (value: unknown) =>
    Object.defineProperty(globalThis, 'WebAssembly', { configurable: true, writable: true, value });

  it('THE DEFECT: a browser WITHOUT Web Speech is supported, because Private STT never uses it', () => {
    // Firefox does not enable SpeechRecognition by default. Under the old gate it saw
    // "On-device Private transcription needs a supported browser" on the landing page — a false claim,
    // since Private runs in WebAssembly. This is the case the previous test asserted backwards.
    setMedia({ getUserMedia: () => Promise.resolve() });
    const { result } = renderHook(() => useBrowserSupport());
    expect(result.current.isSupported).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('reports supported when WASM + media + storage are available', () => {
    setMedia({ getUserMedia: () => Promise.resolve() });
    const { result } = renderHook(() => useBrowserSupport());
    expect(result.current.isSupported).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('presence of Web Speech changes NOTHING either way', () => {
    // Guards against a partial revert that reintroduces the retired engine as a signal.
    setMedia({ getUserMedia: () => Promise.resolve() });
    const without = renderHook(() => useBrowserSupport()).result.current;
    win.webkitSpeechRecognition = class {};
    const with_ = renderHook(() => useBrowserSupport()).result.current;
    expect(with_.isSupported).toBe(without.isSupported);
    expect(with_.error).toBe(without.error);
  });

  it('reports the WebAssembly message when WASM is genuinely missing', () => {
    // The real hard requirement: without WASM there is no Private engine at all.
    setMedia({ getUserMedia: () => Promise.resolve() });
    setWasm(undefined);
    const { result } = renderHook(() => useBrowserSupport());
    expect(result.current.isSupported).toBe(false);
    expect(result.current.error).toMatch(/WebAssembly/i);
  });

  it('reports the microphone message when mediaDevices is missing', () => {
    setMedia(undefined);
    const { result } = renderHook(() => useBrowserSupport());
    expect(result.current.isSupported).toBe(false);
    expect(result.current.error).toMatch(/Microphone access not supported/i);
  });

  it('never names a specific browser — the product is not Chromium-only', () => {
    // The old copy said "use the latest version of Chrome or Edge", inherited from the Web Speech era.
    setMedia({ getUserMedia: () => Promise.resolve() });
    setWasm(undefined);
    const { result } = renderHook(() => useBrowserSupport());
    expect(result.current.error).not.toMatch(/chrome|edge|safari|firefox/i);
  });
});
