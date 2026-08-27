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
 *   - Storage    — see the disposition below. Since #1354 this is a HARD REQUIREMENT for a signed-in
 *     user, not the recovery/analytics convenience it used to be.
 *
 * DELIBERATELY NOT GATED:
 *   - `crossOriginIsolated` / SharedArrayBuffer. These raise the WASM thread count
 *     (`computeWasmThreadCount` returns 1 when not isolated) — a performance factor, not a
 *     requirement. Gating on them would reintroduce exactly this defect in a new form: blocking
 *     browsers where Private works, only slower.
 *   - `Worker`. The engine has a main-thread fallback path, so absence is not disqualifying.
 *
 * STORAGE DISPOSITION (#1347 item 2, re-evaluated against the FINAL merged #1354/#1355 behaviour —
 * deliberately NOT inferred from the older recovery/analytics usage):
 *
 *   HARD REQUIREMENT for an authenticated user. #1354's durable reconcile queue is read on EVERY real
 *   Start: `evaluateDurableStartGate` fails closed with `queue_unreadable` when the queue cannot be
 *   read, because "we could not tell" is not "nothing is owed". Verified at the controller boundary —
 *   signed-in with a throwing `localStorage` returns `allowed: false` from the FIRST recording, before
 *   any session exists.
 *
 *   NOT a requirement for an anonymous visitor: `evaluateDurableStartGate` returns `allowed: true` when
 *   there is no owner, since owner-scoped debt cannot exist. Blocking every browser would therefore be
 *   wrong, and so would removing the check.
 *
 * THE PROBE WAS THE DEFECT. This tested `typeof Storage !== 'undefined'`, which asks whether the
 * CONSTRUCTOR exists. In Firefox private browsing, or with site data blocked, `Storage` exists while
 * `localStorage.getItem` THROWS — so the predicate returned "supported" for exactly the browsers where
 * recording is blocked. A signed-in user there got no warning and then a permanently disabled Start,
 * which is the one-time-user failure this gate exists to prevent. Usability is now probed by actually
 * writing, reading back and removing a key — the same operations the reconcile queue performs.
 */
export const useBrowserSupport = (): BrowserSupportState => {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkSupport = () => {
      const wasmSupport = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
      const mediaSupport = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      // Probe REAL usability, not the constructor's existence. A write/readback/remove mirrors what
      // the reconcile queue does on every Start, so a browser that passes here cannot fail there.
      const storageSupport = ((): boolean => {
        try {
          if (typeof localStorage === 'undefined') return false;
          const probeKey = '__ss_capability_probe__';
          localStorage.setItem(probeKey, '1');
          const readBack = localStorage.getItem(probeKey);
          localStorage.removeItem(probeKey);
          return readBack === '1';
        } catch {
          return false;
        }
      })();

      const supported = wasmSupport && mediaSupport && storageSupport;
      setIsSupported(supported);

      if (!supported) {
        if (!wasmSupport) setError('On-device Private transcription needs WebAssembly support. Use an up-to-date browser.');
        else if (!mediaSupport) setError('Microphone access not supported in this browser.');
        else if (!storageSupport) setError('This browser is blocking local storage, so a recording cannot be saved safely. Allow site data (or leave private browsing) and reload.');
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
