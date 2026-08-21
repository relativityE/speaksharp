// @vitest-environment happy-dom
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock IS_TEST_ENVIRONMENT to false so tests can run normally
vi.mock('@/config/env', () => ({
  IS_TEST_ENVIRONMENT: false,
}));

import NativeBrowser from '../NativeBrowser';
import { Result } from '../types';
 
interface MockSpeechEvent {
  results: Array<Array<{ transcript: string; confidence: number; isFinal: boolean }> & { isFinal: boolean }>;
  resultIndex: number;
}

// Move SpeechRecognition mock outside to share instance control
const mockRecognition = {
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  onresult: null as ((event: MockSpeechEvent) => void) | null,
  onstart: null as ((event: Event) => void) | null,
  onerror: null as ((event: { error: string }) => void) | null,
  onend: null as ((event: Event) => void) | null,
  onaudiostart: null as (() => void) | null,
  onaudioend: null as (() => void) | null,
  onspeechstart: null as (() => void) | null,
  onspeechend: null as (() => void) | null,
  onsoundstart: null as (() => void) | null,
  onsoundend: null as (() => void) | null,
  onnomatch: null as (() => void) | null,
  continuous: false,
  interimResults: false,
  maxAlternatives: 0,
  lang: '',
};

const mockSpeechRecognitionStatic = vi.fn(() => mockRecognition);
vi.stubGlobal('SpeechRecognition', mockSpeechRecognitionStatic);
vi.stubGlobal('webkitSpeechRecognition', mockSpeechRecognitionStatic);

describe('NativeBrowser Transcription Mode', () => {
  let nativeBrowser: NativeBrowser;
  const onTranscriptUpdate = vi.fn();
  const onReady = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    );
    // Reset mutable properties
    mockRecognition.continuous = false;
    mockRecognition.interimResults = false;
    mockRecognition.maxAlternatives = 0;
    mockRecognition.lang = '';
    mockRecognition.onresult = null;
    mockRecognition.onstart = null;
    mockRecognition.onerror = null;
    mockRecognition.onend = null;
    mockRecognition.onaudiostart = null;
    mockRecognition.onaudioend = null;
    mockRecognition.onspeechstart = null;
    mockRecognition.onspeechend = null;
    mockRecognition.onsoundstart = null;
    mockRecognition.onsoundend = null;
    mockRecognition.onnomatch = null;
    delete (window as Window & { dispatchMockTranscript?: unknown }).dispatchMockTranscript;
    delete (window as Window & { __SS_E2E__?: unknown }).__SS_E2E__;
    delete window.__activeSpeechRecognition;
    delete window.__NATIVE_PARALLEL_CAPTURE_TRACE__;
    delete window.__NATIVE_PARALLEL_CAPTURE__;

    nativeBrowser = new NativeBrowser({
      onTranscriptUpdate,
      onReady,
      onError,
      onModelLoadProgress: vi.fn(),
      session: null,
      navigate: vi.fn(),
    });
  });

  describe('Lifecycle Management', () => {
    it('should initialize and set up recognition properties', async () => {
      await nativeBrowser.init();
      expect(mockSpeechRecognitionStatic).toHaveBeenCalled();
      expect(mockRecognition.continuous).toBe(true);
      expect(mockRecognition.interimResults).toBe(true);
      expect(mockRecognition.maxAlternatives).toBe(1);
      expect(mockRecognition.lang).toBe('en-US');
    });
 
    it('should call start on the recognition object when start is called', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      
      // Manually trigger the async onstart event
      if (mockRecognition.onstart) mockRecognition.onstart({} as Event);
      
      await startPromise;
      expect(mockRecognition.start).toHaveBeenCalledTimes(1);
    });
 
    it('should call stop on the recognition object when stop is called', async () => {
      await nativeBrowser.init();
      
      const startPromise = nativeBrowser.start();
      if (mockRecognition.onstart) mockRecognition.onstart({} as Event);
      await startPromise;

      const stopPromise = nativeBrowser.stop();
      if (mockRecognition.onend) mockRecognition.onend({} as Event);
      await stopPromise;

      expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
    });

    it('REGRESSION: stop clears E2E recognition bridge and native event handlers', async () => {
      (window as Window & { __SS_E2E__?: unknown }).__SS_E2E__ = { isActive: true };
      await nativeBrowser.init();

      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;
      expect(window.__activeSpeechRecognition).toBe(mockRecognition);

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      expect(window.__activeSpeechRecognition).toBeUndefined();
      expect(mockRecognition.onresult).toBeTypeOf('function');
      expect(mockRecognition.onerror).toBeTypeOf('function');
      expect(mockRecognition.onend).toBeTypeOf('function');
      expect(mockRecognition.onstart).toBeTypeOf('function');
    });

    it('contract: start fails with actionable error when SpeechRecognition never fires onstart', async () => {
      vi.useFakeTimers();
      await nativeBrowser.init();

      const startPromise = nativeBrowser.start();
      const handledStart = startPromise.then(
        () => ({ ok: true as const }),
        (error: Error) => ({ ok: false as const, error }),
      );
      await vi.advanceTimersByTimeAsync(3000);

      const outcome = await handledStart;
      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? '' : outcome.error.message).toMatch(/did not start/i);
      vi.useRealTimers();
    });

    it('REGRESSION: start failure disposes parallel capture and clears E2E recognition bridge', async () => {
      vi.useFakeTimers();
      const dispose = vi.fn();
      const mic = {
        sampleRate: 16000,
        onFrame: vi.fn(() => dispose),
      };
      window.__NATIVE_PARALLEL_CAPTURE_TRACE__ = true;
      (window as Window & { __SS_E2E__?: unknown }).__SS_E2E__ = { isActive: true };
      await nativeBrowser.init();

      const startPromise = nativeBrowser.start(mic as never);
      const handledStart = startPromise.then(
        () => ({ ok: true as const }),
        (error: Error) => ({ ok: false as const, error }),
      );
      expect(window.__activeSpeechRecognition).toBe(mockRecognition);

      await vi.advanceTimersByTimeAsync(3000);

      const outcome = await handledStart;
      expect(outcome.ok).toBe(false);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(window.__activeSpeechRecognition).toBeUndefined();
      expect(mockRecognition.onresult).toBeNull();
      expect(mockRecognition.onend).toBeNull();
      vi.useRealTimers();
    });

    it('contract: start fails when SpeechRecognition reports an immediate startup error', async () => {
      await nativeBrowser.init();

      const startPromise = nativeBrowser.start();
      mockRecognition.onerror?.({ error: 'network' });

      await expect(startPromise).rejects.toThrow(/failed to start: network/i);
    });

    it('contract: stop resolves even if SpeechRecognition never emits onend', async () => {
      vi.useFakeTimers();
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const stopPromise = nativeBrowser.stop();
      await vi.advanceTimersByTimeAsync(1000);

      await expect(stopPromise).resolves.toBeUndefined();
      expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('REGRESSION: can start again on the same NativeBrowser instance after stop', async () => {
      await nativeBrowser.init();
      const firstStart = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await firstStart;

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      const secondStart = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await secondStart;

      expect(mockRecognition.start).toHaveBeenCalledTimes(2);
    });

    it('REGRESSION: stop timeout restores the original onend handler before late onend', async () => {
      vi.useFakeTimers();
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;
      const originalOnEnd = mockRecognition.onend;

      const stopPromise = nativeBrowser.stop();
      await vi.advanceTimersByTimeAsync(1000);
      await stopPromise;

      expect(mockRecognition.onend).toBe(originalOnEnd);
      mockRecognition.onend?.({} as Event);
      await vi.advanceTimersByTimeAsync(310);
      expect(mockRecognition.start).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('contract: stop resolves when SpeechRecognition.stop throws', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;
      mockRecognition.stop.mockImplementationOnce(() => {
        throw new Error('already stopped');
      });

      await expect(nativeBrowser.stop()).resolves.toBeUndefined();
    });

    it('contract: acoustic readiness fires once across audiostart and speechstart', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      mockRecognition.onaudiostart?.();
      mockRecognition.onspeechstart?.();

      expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('REGRESSION: delegates transcribe calls to the injected mock engine', async () => {
      const audio = new Float32Array([0.1, 0.2]);
      const mockEngine = {
        type: 'mock',
        checkAvailability: vi.fn(),
        init: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        transcribe: vi.fn(async () => Result.ok('mock transcript')),
        destroy: vi.fn(),
        terminate: vi.fn(),
        updateOptions: vi.fn(),
        getLastHeartbeatTimestamp: vi.fn(() => Date.now()),
      };
      const nativeWithMock = new NativeBrowser({
        onTranscriptUpdate,
        onReady,
        onError,
        onModelLoadProgress: vi.fn(),
        session: null,
        navigate: vi.fn(),
      }, mockEngine as never);

      const result = await nativeWithMock.transcribe(audio);

      expect(mockEngine.transcribe).toHaveBeenCalledWith(audio);
      expect(result).toEqual(Result.ok('mock transcript'));
    });
  });
 
  describe('Result Handling', () => {
    it('should handle final transcript results correctly', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      if (mockRecognition.onstart) mockRecognition.onstart({} as Event);
      await startPromise;

      const resultItem = { transcript: 'hello world', confidence: 0.9, isFinal: true };
      const resultList = Object.assign([resultItem], { isFinal: true });
      const event = { results: [resultList], resultIndex: 0 };
 
      // Simulate the onresult event
      if (mockRecognition.onresult) {
        mockRecognition.onresult(event as unknown as MockSpeechEvent);
      }
 
      expect(onTranscriptUpdate).toHaveBeenCalledWith({
        transcript: { final: 'hello world', replacesRollingTranscript: true },
      });
    });

    it('#NATIVE-SHADOW-TELEMETRY (Phase 2): publishes Native lifecycle + transcript.final to the telemetry bus', async () => {
      const { getSessionTelemetryBus } = await import('@/services/telemetry/sessionTelemetryBus');
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const r0 = Object.assign([{ transcript: 'shadow bus proof', confidence: 0.9, isFinal: true }], { isFinal: true });
      mockRecognition.onresult?.({ results: [r0], resultIndex: 0 } as unknown as MockSpeechEvent);

      const events = getSessionTelemetryBus().getBufferedEvents();
      expect(events.some(e => e.type === 'webspeech.lifecycle' && e.event === 'start')).toBe(true);
      expect(events.some(e => e.type === 'transcript.final' && e.text === 'shadow bus proof')).toBe(true);
    });

    it('preserves native browser punctuation when Chrome provides it', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const resultItem = { transcript: 'hello, world.', confidence: 0.9, isFinal: true };
      const resultList = Object.assign([resultItem], { isFinal: true });
      const event = { results: [resultList], resultIndex: 0 };

      mockRecognition.onresult?.(event as unknown as MockSpeechEvent);

      expect(onTranscriptUpdate).toHaveBeenCalledWith({
        transcript: { final: 'hello, world.', replacesRollingTranscript: true },
      });
    });
 
    it('should handle interim transcript results correctly', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      if (mockRecognition.onstart) mockRecognition.onstart({} as Event);
      await startPromise;

      const resultItem = { transcript: 'hello', confidence: 0.8, isFinal: false };
      const resultList = Object.assign([resultItem], { isFinal: false });
      const event = { results: [resultList], resultIndex: 0 };
 
      // Simulate the onresult event
      if (mockRecognition.onresult) {
        mockRecognition.onresult(event as unknown as MockSpeechEvent);
      }
 
      expect(onTranscriptUpdate).toHaveBeenCalledWith({
        transcript: { partial: 'hello' },
      });
    });

    it('does not re-emit already finalized browser results', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      if (mockRecognition.onstart) mockRecognition.onstart({} as Event);
      await startPromise;

      const resultItem = { transcript: 'hello world', confidence: 0.9, isFinal: true };
      const resultList = Object.assign([resultItem], { isFinal: true });
      const event = { results: [resultList], resultIndex: 0 };

      mockRecognition.onresult?.(event as unknown as MockSpeechEvent);
      mockRecognition.onresult?.(event as unknown as MockSpeechEvent);

      expect(onTranscriptUpdate).toHaveBeenCalledTimes(1);
      expect(await nativeBrowser.getTranscript()).toBe('hello world');
    });

    it('REGRESSION: allows final result index 0 again after browser recognition restart', async () => {
      vi.useFakeTimers();
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      if (mockRecognition.onstart) mockRecognition.onstart({} as Event);
      await startPromise;

      const firstResult = Object.assign([{ transcript: 'first phrase', confidence: 0.9, isFinal: true }], { isFinal: true });
      mockRecognition.onresult?.({ results: [firstResult], resultIndex: 0 } as unknown as MockSpeechEvent);

      mockRecognition.onend?.({} as Event);
      await vi.advanceTimersByTimeAsync(310);
      expect(mockRecognition.start).toHaveBeenCalledTimes(2);

      mockRecognition.onstart?.({} as Event);
      const secondResult = Object.assign([{ transcript: 'second phrase', confidence: 0.9, isFinal: true }], { isFinal: true });
      mockRecognition.onresult?.({ results: [secondResult], resultIndex: 0 } as unknown as MockSpeechEvent);

      // #NATIVE-APPEND-ONLY: cycle 2 (resultIndex reset to 0 after restart) must APPEND to cycle 1,
      // not replace it. Native emits the ACCUMULATED transcript each time, so call 2 = both phrases.
      expect(onTranscriptUpdate).toHaveBeenCalledTimes(2);
      expect(onTranscriptUpdate).toHaveBeenNthCalledWith(1, {
        transcript: { final: 'first phrase', replacesRollingTranscript: true },
      });
      expect(onTranscriptUpdate).toHaveBeenNthCalledWith(2, {
        transcript: { final: 'first phrase second phrase', replacesRollingTranscript: true },
      });
      expect(await nativeBrowser.getTranscript()).toBe('first phrase second phrase');

      vi.useRealTimers();
    });

    it('uses the latest interim hypothesis when the browser revises text', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      if (mockRecognition.onstart) mockRecognition.onstart({} as Event);
      await startPromise;

      const firstResult = Object.assign([{ transcript: 'um I think', confidence: 0.8, isFinal: false }], { isFinal: false });
      const retractedResult = Object.assign([{ transcript: 'um', confidence: 0.8, isFinal: false }], { isFinal: false });

      mockRecognition.onresult?.({ results: [firstResult], resultIndex: 0 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [retractedResult], resultIndex: 0 } as unknown as MockSpeechEvent);

      expect(onTranscriptUpdate).toHaveBeenLastCalledWith({
        transcript: { partial: 'um' },
      });
    });

    it('REGRESSION: promotes meaningful interim transcript on stop when Chrome never finalizes', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const interimResult = Object.assign([{ transcript: 'but you keep', confidence: 0.8, isFinal: false }], { isFinal: false });
      mockRecognition.onresult?.({ results: [interimResult], resultIndex: 0 } as unknown as MockSpeechEvent);

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      expect(onTranscriptUpdate).toHaveBeenLastCalledWith({
        transcript: { final: 'but you keep' },
      });
      expect(await nativeBrowser.getTranscript()).toBe('but you keep');
    });

    it('does not promote one-word interim noise on stop', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const interimResult = Object.assign([{ transcript: 'the', confidence: 0.8, isFinal: false }], { isFinal: false });
      mockRecognition.onresult?.({ results: [interimResult], resultIndex: 0 } as unknown as MockSpeechEvent);

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      expect(onTranscriptUpdate).toHaveBeenCalledTimes(1);
      expect(onTranscriptUpdate).toHaveBeenLastCalledWith({
        transcript: { partial: 'the' },
      });
      expect(await nativeBrowser.getTranscript()).toBe('');
    });

    it('REGRESSION: does not promote stopword-heavy interim noise on stop', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const interimResult = Object.assign([{ transcript: 'on the way', confidence: 0.8, isFinal: false }], { isFinal: false });
      mockRecognition.onresult?.({ results: [interimResult], resultIndex: 0 } as unknown as MockSpeechEvent);

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      expect(await nativeBrowser.getTranscript()).toBe('');
    });

    it('REGRESSION: getTranscript returns meaningful Native interim before finalization', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const interimResult = Object.assign([{ transcript: 'quick brown fox', confidence: 0.8, isFinal: false }], { isFinal: false });
      mockRecognition.onresult?.({ results: [interimResult], resultIndex: 0 } as unknown as MockSpeechEvent);

      expect(await nativeBrowser.getTranscript()).toBe('quick brown fox');
    });

    it('REGRESSION: final-only result emits the current Web Speech final window only', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const firstWindow = Object.assign([{ transcript: 'native chrome microphone proof', confidence: 0.8, isFinal: false }], { isFinal: false });
      const secondWindow = Object.assign([{ transcript: 'the quick brown fox', confidence: 0.8, isFinal: false }], { isFinal: false });
      const finalWindow = Object.assign([{ transcript: 'the quick brown fox', confidence: 0.9, isFinal: true }], { isFinal: true });

      mockRecognition.onresult?.({ results: [firstWindow], resultIndex: 0 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [secondWindow], resultIndex: 0 } as unknown as MockSpeechEvent);
      onTranscriptUpdate.mockClear();
      mockRecognition.onresult?.({ results: [finalWindow], resultIndex: 0 } as unknown as MockSpeechEvent);

      expect(onTranscriptUpdate).toHaveBeenCalledTimes(1);
      expect(onTranscriptUpdate).toHaveBeenCalledWith({
        transcript: { final: 'the quick brown fox', replacesRollingTranscript: true },
      });
    });

    it('REGRESSION: preserves the best meaningful interim when Chrome later shortens its hypothesis', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const strongInterim = Object.assign([{ transcript: 'native chrome microphone proof', confidence: 0.8, isFinal: false }], { isFinal: false });
      const shorterInterim = Object.assign([{ transcript: 'native chrome mic', confidence: 0.8, isFinal: false }], { isFinal: false });
      mockRecognition.onresult?.({ results: [strongInterim], resultIndex: 0 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [shorterInterim], resultIndex: 0 } as unknown as MockSpeechEvent);

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      expect(onTranscriptUpdate).toHaveBeenLastCalledWith({
        transcript: { final: 'native chrome microphone proof' },
      });
      expect(await nativeBrowser.getTranscript()).toBe('native chrome microphone proof');
    });

    it('REGRESSION: a short final wins over a richer pending interim (finals are authoritative)', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      // #NATIVE-APPEND-ONLY rule 1: the browser's isFinal result is authoritative. A longer/stale
      // pending interim must NOT be substituted over a shorter final, even on stop.
      const richInterim = Object.assign([{ transcript: 'native chrome microphone release validation native chrome microphone release validation', confidence: 0.8, isFinal: false }], { isFinal: false });
      const shortFinal = Object.assign([{ transcript: 'validation', confidence: 0.9, isFinal: true }], { isFinal: true });

      mockRecognition.onresult?.({ results: [richInterim], resultIndex: 0 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [shortFinal], resultIndex: 0 } as unknown as MockSpeechEvent);

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      expect(onTranscriptUpdate).toHaveBeenLastCalledWith({
        transcript: { final: 'validation', replacesRollingTranscript: true },
      });
      expect(await nativeBrowser.getTranscript()).toBe('validation');
    });

    it('REGRESSION: repeated speech survives — appends finals verbatim without overlap deletion', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      // #NATIVE-APPEND-ONLY: the old fuzzy append dropped a segment when the base ended with it or
      // stripped prefix overlap, deleting legitimately repeated speech. Two genuine finals with a
      // repeated phrase must BOTH survive, exactly as spoken. (Web Speech results are cumulative;
      // resultIndex advances to the newly-final result.)
      const mkFinal = (t: string) => Object.assign([{ transcript: t, confidence: 0.9, isFinal: true }], { isFinal: true });
      const r0 = mkFinal('the third thing');
      const r1 = mkFinal('the third thing is evidence');

      mockRecognition.onresult?.({ results: [r0], resultIndex: 0 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [r0, r1], resultIndex: 1 } as unknown as MockSpeechEvent);

      expect(onTranscriptUpdate).toHaveBeenLastCalledWith({
        transcript: { final: 'the third thing the third thing is evidence', replacesRollingTranscript: true },
      });
      expect(await nativeBrowser.getTranscript()).toBe('the third thing the third thing is evidence');
    });

    it('REGRESSION: saved transcript contains every final segment exactly once, in order', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const mkFinal = (t: string) => Object.assign([{ transcript: t, confidence: 0.9, isFinal: true }], { isFinal: true });
      const r0 = mkFinal('first sentence');
      const r1 = mkFinal('second sentence');
      const r2 = mkFinal('third sentence');

      mockRecognition.onresult?.({ results: [r0], resultIndex: 0 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [r0, r1], resultIndex: 1 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [r0, r1, r2], resultIndex: 2 } as unknown as MockSpeechEvent);

      expect(onTranscriptUpdate).toHaveBeenCalledTimes(3);
      expect(onTranscriptUpdate).toHaveBeenLastCalledWith({
        transcript: { final: 'first sentence second sentence third sentence', replacesRollingTranscript: true },
      });
      expect(await nativeBrowser.getTranscript()).toBe('first sentence second sentence third sentence');
    });

    it('REGRESSION: does not append a stale full interim after Chrome already committed the final', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const pendingInterimText = 'native Chrome microphone proof Starts Now basically I want to make one simple point before we move on the puppy like chewed up the new shoes and that change the whole plan we find joy in the seamless things when the message is clear';
      const finalText = 'native Chrome microphone proof Starts Now basically I want to make one simple point before we move on the puppy like chewed up the new shoes and that change the whole plan we find joy in the simplest things when the message is clear';
      const pendingInterim = Object.assign([{ transcript: pendingInterimText, confidence: 0.8, isFinal: false }], { isFinal: false });
      const finalResult = Object.assign([{ transcript: finalText, confidence: 0.9, isFinal: true }], { isFinal: true });

      mockRecognition.onresult?.({ results: [pendingInterim], resultIndex: 0 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [finalResult], resultIndex: 0 } as unknown as MockSpeechEvent);
      const updatesBeforeStop = onTranscriptUpdate.mock.calls.length;

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      expect(onTranscriptUpdate.mock.calls.length).toBe(updatesBeforeStop);
      expect(await nativeBrowser.getTranscript()).toBe(finalText);
    });

    it('REGRESSION: treats case and punctuation variants of pending interim as duplicate after final', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const pendingInterim = Object.assign([{ transcript: 'Native chrome microphone proof starts now basically I want to make one simple point', confidence: 0.8, isFinal: false }], { isFinal: false });
      const finalResult = Object.assign([{ transcript: 'native Chrome microphone proof starts now. Basically, I want to make one simple point.', confidence: 0.9, isFinal: true }], { isFinal: true });

      mockRecognition.onresult?.({ results: [pendingInterim], resultIndex: 0 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [finalResult], resultIndex: 0 } as unknown as MockSpeechEvent);
      const updatesBeforeStop = onTranscriptUpdate.mock.calls.length;

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      expect(onTranscriptUpdate.mock.calls.length).toBe(updatesBeforeStop);
      expect(await nativeBrowser.getTranscript()).toBe('native Chrome microphone proof starts now. Basically, I want to make one simple point.');
    });

    it('REGRESSION: treats rolling Native interim windows as replaceable hypotheses', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const firstWindow = Object.assign([{ transcript: 'native chrome microphone proof', confidence: 0.8, isFinal: false }], { isFinal: false });
      const secondWindow = Object.assign([{ transcript: 'the quick brown fox reads clearly', confidence: 0.8, isFinal: false }], { isFinal: false });

      mockRecognition.onresult?.({ results: [firstWindow], resultIndex: 0 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [secondWindow], resultIndex: 0 } as unknown as MockSpeechEvent);

      expect(onTranscriptUpdate).toHaveBeenLastCalledWith({
        transcript: { partial: 'the quick brown fox reads clearly' },
      });

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      expect(onTranscriptUpdate).toHaveBeenLastCalledWith({
        transcript: { final: 'the quick brown fox reads clearly' },
      });
      expect(await nativeBrowser.getTranscript()).toBe('the quick brown fox reads clearly');
    });

    it('REGRESSION: commits the later Web Speech final window without stale interim accumulation', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const firstWindow = Object.assign([{ transcript: 'native chrome microphone proof', confidence: 0.8, isFinal: false }], { isFinal: false });
      const rollingWindow = Object.assign([{ transcript: 'proof the quick brown', confidence: 0.8, isFinal: false }], { isFinal: false });
      const finalWindow = Object.assign([{ transcript: 'the quick brown fox', confidence: 0.9, isFinal: true }], { isFinal: true });

      mockRecognition.onresult?.({ results: [firstWindow], resultIndex: 0 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [rollingWindow], resultIndex: 0 } as unknown as MockSpeechEvent);
      mockRecognition.onresult?.({ results: [finalWindow], resultIndex: 0 } as unknown as MockSpeechEvent);

      expect(onTranscriptUpdate).toHaveBeenLastCalledWith({
        transcript: { final: 'the quick brown fox', replacesRollingTranscript: true },
      });
      expect(await nativeBrowser.getTranscript()).toBe('the quick brown fox');
    });

    it('CANONICAL: does NOT force-restart a stalled cycle mid-utterance (removed anti-pattern)', async () => {
      // A 2.5s "result stall" timer used to call recognition.stop() to force a restart, cutting
      // Chrome off mid-utterance and dropping speech (the owner's "kept overwriting / missed so
      // much"). Phase 3 removes that anti-pattern: no timer-driven stop() may fire, no matter how
      // long a meaningful interim sits without a following result. Only the reactive onend restart
      // (which does not stop() a live cycle) keeps the session alive.
      vi.useFakeTimers();
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const firstWindow = Object.assign([{ transcript: 'native chrome microphone', confidence: 0.8, isFinal: false }], { isFinal: false });
      mockRecognition.onresult?.({ results: [firstWindow], resultIndex: 0 } as unknown as MockSpeechEvent);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockRecognition.stop).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('CANONICAL: does NOT force-restart when speech is detected but Chrome withholds results (removed anti-pattern)', async () => {
      // A 3.5s "no result speech" timer used to call recognition.stop() when onspeechstart fired
      // without a following result. Phase 3 removes it: Chrome is trusted to emit results on its
      // own; forcing a stop here cut off the utterance the user was still speaking.
      vi.useFakeTimers();
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      mockRecognition.onspeechstart?.();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockRecognition.stop).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('CANONICAL: preserves the stopping cycle trailing final flushed after Stop (not dropped)', async () => {
      // Chrome flushes a trailing FINAL for speech spoken before Stop, in the SAME recognition
      // cycle that was active at Stop. Previously the hard-stop guard dropped it (lost last phrase).
      // It must now be appended; only results from a LATER cycle (a new utterance after Stop) drop.
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const mkResult = (t: string) =>
        Object.assign([{ transcript: t, confidence: 0.9, isFinal: true }], { isFinal: true });
      const r0 = mkResult('closing remarks');
      const r1 = mkResult('thank you all');

      mockRecognition.onresult?.({ results: [r0], resultIndex: 0 } as unknown as MockSpeechEvent);
      expect(await nativeBrowser.getTranscript()).toBe('closing remarks');

      const stopPromise = nativeBrowser.stop();
      // Trailing flush of the SAME cycle at a new result index, after Stop was requested.
      mockRecognition.onresult?.({ results: [r0, r1], resultIndex: 1 } as unknown as MockSpeechEvent);
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      expect(await nativeBrowser.getTranscript()).toBe('closing remarks thank you all');
    });

    it('REGRESSION: should handle rapid onend events without redundant starts', async () => {
      vi.useFakeTimers();
      await nativeBrowser.init();
      
      const startPromise = nativeBrowser.start();
      if (mockRecognition.onstart) mockRecognition.onstart({} as Event);
      await startPromise;
 
      // Simulate onend (crash)
      if (mockRecognition.onend) {
        mockRecognition.onend({} as Event);
      }
 
      // Fast forward past the production restart debounce.
      await vi.advanceTimersByTimeAsync(310);
 
      // Should have started again
      expect(mockRecognition.start).toHaveBeenCalledTimes(2);
      
      // Settle 2nd onstart
      if (mockRecognition.onstart) mockRecognition.onstart({} as Event);
 
      // Simulate another onend immediately
      if (mockRecognition.onend) {
        mockRecognition.onend({} as Event);
      }
 
      await vi.advanceTimersByTimeAsync(310);
 
      // Should have started a 3rd time
      expect(mockRecognition.start).toHaveBeenCalledTimes(3);
 
      vi.useRealTimers();
    });

    it('contract: duplicate onend events before the debounce schedule only one restart', async () => {
      vi.useFakeTimers();
      await nativeBrowser.init();

      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      mockRecognition.onend?.({} as Event);
      mockRecognition.onend?.({} as Event);

      await vi.advanceTimersByTimeAsync(299);
      expect(mockRecognition.start).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(mockRecognition.start).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('contract: pending restart is cancelled when the user stops before debounce fires', async () => {
      vi.useFakeTimers();
      await nativeBrowser.init();

      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      mockRecognition.onend?.({} as Event);
      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      await vi.advanceTimersByTimeAsync(310);

      expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
      expect(mockRecognition.start).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('REGRESSION: terminate performs Native shutdown once without double cleanup', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const terminatePromise = nativeBrowser.terminate();
      mockRecognition.onend?.({} as Event);
      await terminatePromise;

      expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
      await nativeBrowser.terminate();
      expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
    });

    it('REGRESSION: concurrent terminate calls share one shutdown', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const firstTerminate = nativeBrowser.terminate();
      const secondTerminate = nativeBrowser.terminate();
      mockRecognition.onend?.({} as Event);
      await Promise.all([firstTerminate, secondTerminate]);

      expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
    });

    it('REGRESSION: drops post-stop final results so a stray recognition cycle cannot contaminate the transcript', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const committed = Object.assign([{ transcript: 'the quick brown fox', confidence: 0.9, isFinal: true }], { isFinal: true });
      mockRecognition.onresult?.({ results: [committed], resultIndex: 0 } as unknown as MockSpeechEvent);
      expect(await nativeBrowser.getTranscript()).toBe('the quick brown fox');

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      const updatesAfterStop = onTranscriptUpdate.mock.calls.length;

      // A stray second recognition cycle fires a final after the user pressed Stop
      // (the real-world "Hey Dad" contamination). The handler is still bound, so the
      // hard-stop guard must drop it rather than append it to the completed transcript.
      const postStopFinal = Object.assign([{ transcript: 'Hey Dad', confidence: 0.9, isFinal: true }], { isFinal: true });
      mockRecognition.onresult?.({ results: [postStopFinal], resultIndex: 0 } as unknown as MockSpeechEvent);

      expect(onTranscriptUpdate.mock.calls.length).toBe(updatesAfterStop);
      expect(await nativeBrowser.getTranscript()).toBe('the quick brown fox');
    });

    it('REGRESSION: a NEW recognition cycle after Stop cannot mutate the stopped transcript (cycle-id guard)', async () => {
      // #925 permits a SAME-cycle trailing final after Stop so Chrome can flush speech spoken BEFORE
      // Stop. This test closes the adjacent risk: a stray SECOND cycle actually STARTS after Stop
      // (onstart fires -> recognitionCycleId increments, finalizedResultIndexes cleared) and emits a
      // final at a FRESH index, so index-dedup alone would NOT catch it. The cycle-id guard
      // (recognitionCycleId !== stopRequestedCycleId) must still drop it.
      //
      // Why same-cycle-vs-new-cycle is a SAFE distinction (documented limitation): recognition.stop()
      // halts Chrome's audio capture, so Chrome cannot produce NEW same-cycle speech after Stop — a
      // same-cycle trailing final is therefore always the flush of pre-Stop audio. Genuinely new
      // speech requires a new cycle, which this guard drops. The safety rests on that stop() semantic.
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const committed = Object.assign([{ transcript: 'the quick brown fox', confidence: 0.9, isFinal: true }], { isFinal: true });
      mockRecognition.onresult?.({ results: [committed], resultIndex: 0 } as unknown as MockSpeechEvent);
      expect(await nativeBrowser.getTranscript()).toBe('the quick brown fox');

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      const updatesAfterStop = onTranscriptUpdate.mock.calls.length;

      // Stray new cycle starts AND emits a fresh-index final after Stop — must be dropped.
      mockRecognition.onstart?.({} as Event);
      const strayNewCycleFinal = Object.assign([{ transcript: 'brand new sentence after stop', confidence: 0.9, isFinal: true }], { isFinal: true });
      mockRecognition.onresult?.({ results: [strayNewCycleFinal], resultIndex: 0 } as unknown as MockSpeechEvent);

      expect(onTranscriptUpdate.mock.calls.length).toBe(updatesAfterStop);
      expect(await nativeBrowser.getTranscript()).toBe('the quick brown fox');
    });

    it('REGRESSION: drops post-stop interim results (no trailing partials after Stop)', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      const committed = Object.assign([{ transcript: 'release validation transcript', confidence: 0.9, isFinal: true }], { isFinal: true });
      mockRecognition.onresult?.({ results: [committed], resultIndex: 0 } as unknown as MockSpeechEvent);

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      const updatesAfterStop = onTranscriptUpdate.mock.calls.length;

      const postStopInterim = Object.assign([{ transcript: 'hey dad are you there', confidence: 0.8, isFinal: false }], { isFinal: false });
      mockRecognition.onresult?.({ results: [postStopInterim], resultIndex: 0 } as unknown as MockSpeechEvent);

      expect(onTranscriptUpdate.mock.calls.length).toBe(updatesAfterStop);
      expect(await nativeBrowser.getTranscript()).toBe('release validation transcript');
    });

    it('REGRESSION: re-accepts results after a fresh start following a prior stop', async () => {
      await nativeBrowser.init();
      const firstStart = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await firstStart;

      const first = Object.assign([{ transcript: 'first session', confidence: 0.9, isFinal: true }], { isFinal: true });
      mockRecognition.onresult?.({ results: [first], resultIndex: 0 } as unknown as MockSpeechEvent);

      const stopPromise = nativeBrowser.stop();
      mockRecognition.onend?.({} as Event);
      await stopPromise;

      // Dropped while stopped.
      const stray = Object.assign([{ transcript: 'stray', confidence: 0.9, isFinal: true }], { isFinal: true });
      mockRecognition.onresult?.({ results: [stray], resultIndex: 0 } as unknown as MockSpeechEvent);

      // New session clears the guard so results flow again.
      const secondStart = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await secondStart;

      const second = Object.assign([{ transcript: 'second session', confidence: 0.9, isFinal: true }], { isFinal: true });
      mockRecognition.onresult?.({ results: [second], resultIndex: 0 } as unknown as MockSpeechEvent);

      expect(await nativeBrowser.getTranscript()).toContain('second session');
      expect(await nativeBrowser.getTranscript()).not.toContain('stray');
    });

    it('contract: recoverable no-speech errors are traced without surfacing a fatal error', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      mockRecognition.onerror?.({ error: 'no-speech' });

      expect(onError).not.toHaveBeenCalled();
    });

    it('contract: permission errors surface a user-actionable transcription error', async () => {
      await nativeBrowser.init();
      const startPromise = nativeBrowser.start();
      mockRecognition.onstart?.({} as Event);
      await startPromise;

      mockRecognition.onerror?.({ error: 'not-allowed' });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[0]?.message).toMatch(/microphone permission denied/i);
    });
  });
});
