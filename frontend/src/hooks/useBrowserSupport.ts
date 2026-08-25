import { useState, useEffect } from 'react';

interface BrowserSupportState {
  isSupported: boolean;
  error: string | null;
}

/**
 * Capability gate for the landing/main pages.
 *
 * #1323/#1184 CORRECTION. This previously gated on the Web Speech API:
 *
 *     'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
 *
 * That is the engine #1184 RETIRED. The product is Private-only — Transformers.js running Whisper in
 * WebAssembly — and never calls Web Speech at all. The copy had already been updated to say "on-device
 * Private transcription" while the CHECK still tested the removed engine, so a browser without Web
 * Speech (Firefox most notably, which still does not enable `SpeechRecognition` by default) was told on
 * the landing page that Private transcription would not work — when it would. A false "unsupported"
 * claim at the top of the funnel, invisible to every existing test because they all run in Chromium
 * where the property happens to exist.
 *
 * WHAT PRIVATE STT ACTUALLY NEEDS:
 *   - WebAssembly — the model executes as WASM; without it there is no engine.
 *   - getUserMedia — we must be able to capture the microphone.
 *   - Storage    — model artifacts and session state are cached locally.
 *
 * DELIBERATELY NOT GATED:
 *   - `crossOriginIsolated` / SharedArrayBuffer. These raise the WASM thread count
 *     (`computeWasmThreadCount` returns 1 when not isolated) — a performance factor, not a
 *     requirement. Gating on them would reintroduce exactly this defect in a new form: blocking
 *     browsers where Private works, only slower.
 *   - `Worker`. The engine has a main-thread fallback path, so absence is not disqualifying.
 */
export const useBrowserSupport = (): BrowserSupportState => {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkSupport = () => {
      const wasmSupport = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
      const mediaSupport = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      const storageSupport = typeof Storage !== 'undefined';

      const supported = wasmSupport && mediaSupport && storageSupport;
      setIsSupported(supported);

      if (!supported) {
        if (!wasmSupport) setError('On-device Private transcription needs WebAssembly support. Use an up-to-date browser.');
        else if (!mediaSupport) setError('Microphone access not supported in this browser.');
        else if (!storageSupport) setError('Local storage not supported in this browser.');
      } else {
        // A previously-failing capability that now passes must clear the warning; otherwise a stale
        // error string keeps `BrowserWarning` reasoning about a condition that no longer holds.
        setError(null);
      }
    };

    checkSupport();
  }, []);

  return { isSupported, error };
};
