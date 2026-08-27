/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/**
 * #1347 item 2 — the Storage disposition, re-evaluated against the FINAL merged #1354/#1355 runtime.
 *
 * The old probe asked whether the `Storage` CONSTRUCTOR exists. That is true in Firefox private
 * browsing and with site data blocked — the exact states where `localStorage.getItem` THROWS and, since
 * #1354, `evaluateDurableStartGate` fails closed with `queue_unreadable` on every real Start. So the
 * gate said "supported" for precisely the browsers where a signed-in user cannot record, and they met a
 * permanently disabled Start with no warning.
 *
 * Verified at the controller boundary before this was written:
 *   signed-in + throwing localStorage -> allowed: false (blocked from the FIRST recording)
 *   anonymous  + throwing localStorage -> allowed: true  (no owner-scoped debt can exist)
 *   typeof Storage !== 'undefined'     -> true in BOTH cases — it cannot see the difference
 */
describe('#1347 Storage is probed for USABILITY, not for the constructor', () => {
    // jsdom has no navigator.mediaDevices, and the predicate short-circuits on mic support before it
    // ever reaches storage — so without this the assertions below silently test the wrong branch.
    beforeEach(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true, value: { getUserMedia: () => Promise.resolve({}) },
        });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    });

    it('reports UNSUPPORTED when localStorage throws, even though `Storage` exists', () => {
        expect(typeof Storage !== 'undefined', 'precondition: the constructor is present').toBe(true);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });

        const { result } = renderHook(() => useBrowserSupport());
        expect(result.current.isSupported).toBe(false);
        expect(result.current.error).toMatch(/blocking local storage/i);
    });

    it('reports UNSUPPORTED when a write silently fails to read back', () => {
        // Some privacy modes accept the write and return null on read. Absence of an exception is not
        // evidence the value persisted, so the probe asserts the READBACK rather than the call.
        vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
        const { result } = renderHook(() => useBrowserSupport());
        expect(result.current.isSupported).toBe(false);
    });

    it('reports SUPPORTED on working storage, and leaves no probe key behind', () => {
        const { result } = renderHook(() => useBrowserSupport());
        expect(result.current.isSupported).toBe(true);
        expect(result.current.error).toBeNull();
        expect(localStorage.getItem('__ss_capability_probe__'), 'the probe must clean up after itself').toBeNull();
    });

    it('the error names the user ACTION, not the internal condition', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        const { result } = renderHook(() => useBrowserSupport());
        expect(result.current.error).toMatch(/allow site data|private browsing/i);
    });
});

/**
 * #1347 item 4 — optional capabilities must STAY optional.
 *
 * Gating on a performance factor reintroduces the original defect in a new form: blocking browsers
 * where Private works, only slower. `crossOriginIsolated` / SharedArrayBuffer raise the WASM thread
 * count (`computeWasmThreadCount` returns 1 without them), and the engine has a main-thread path when
 * `Worker` is absent. None of that is disqualifying.
 *
 * Without these, promoting an optional capability to a hard requirement failed NO test — verified by
 * mutation before they were written.
 */
describe('#1347 optional capabilities are not requirements', () => {
    beforeEach(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true, value: { getUserMedia: () => Promise.resolve({}) },
        });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    });

    it.each([
        ['Worker', 'Worker'],
        ['SharedArrayBuffer', 'SharedArrayBuffer'],
    ])('a browser WITHOUT %s is still supported', (_label, globalName) => {
        const original = (globalThis as Record<string, unknown>)[globalName];
        Object.defineProperty(globalThis, globalName, { configurable: true, writable: true, value: undefined });
        try {
            const { result } = renderHook(() => useBrowserSupport());
            expect(result.current.isSupported, `${globalName} must not be a hard requirement`).toBe(true);
            expect(result.current.error).toBeNull();
        } finally {
            Object.defineProperty(globalThis, globalName, { configurable: true, writable: true, value: original });
        }
    });

    it('a browser that is NOT cross-origin isolated is still supported', () => {
        // Only affects thread count. Gating here would block Firefox and Safari for a perf factor.
        Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, writable: true, value: false });
        const { result } = renderHook(() => useBrowserSupport());
        expect(result.current.isSupported).toBe(true);
    });

    it('a browser without WebGPU is still supported — v4 is hard-off and not in the release path', () => {
        const original = (globalThis as Record<string, unknown>).navigator;
        Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
        const { result } = renderHook(() => useBrowserSupport());
        expect(result.current.isSupported).toBe(true);
        expect(original).toBeDefined();
    });
});
