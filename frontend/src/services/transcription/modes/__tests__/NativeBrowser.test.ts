// @vitest-environment happy-dom
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock IS_TEST_ENVIRONMENT to false so tests can run normally
vi.mock('@/config/env', () => ({
  IS_TEST_ENVIRONMENT: false,
}));

import NativeBrowser from '../NativeBrowser';
 
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

    nativeBrowser = new NativeBrowser({
      onTranscriptUpdate,
      onReady,
      onError,
      onModelLoadProgress: vi.fn(),
      session: null,
      navigate: vi.fn(),
      getAssemblyAIToken: vi.fn(),
    });
  });

  describe('Lifecycle Management', () => {
    it('should initialize and set up recognition properties', async () => {
      await nativeBrowser.init();
      expect(mockSpeechRecognitionStatic).toHaveBeenCalled();
      expect(mockRecognition.continuous).toBe(false);
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
        transcript: { final: 'hello world' },
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

      expect(onTranscriptUpdate).toHaveBeenCalledTimes(2);
      expect(onTranscriptUpdate).toHaveBeenNthCalledWith(1, {
        transcript: { final: 'first phrase' },
      });
      expect(onTranscriptUpdate).toHaveBeenNthCalledWith(2, {
        transcript: { final: 'second phrase' },
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
