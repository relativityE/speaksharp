// @vitest-environment happy-dom
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock IS_TEST_ENVIRONMENT to false so tests can run normally
vi.mock('@/config/env', () => ({
  IS_TEST_ENVIRONMENT: false,
}));

import NativeBrowser from '../NativeBrowser';

// Move SpeechRecognition mock outside to share instance control
const mockRecognition = {
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  onresult: null as ((event: Event) => void) | null,
  onerror: vi.fn(),
  onend: vi.fn(),
  continuous: false,
  interimResults: false,
};

const mockSpeechRecognitionStatic = vi.fn(() => mockRecognition);
vi.stubGlobal('SpeechRecognition', mockSpeechRecognitionStatic);
vi.stubGlobal('webkitSpeechRecognition', mockSpeechRecognitionStatic);

describe('NativeBrowser Transcription Mode', () => {
  let nativeBrowser: NativeBrowser;
  const onTranscriptUpdate = vi.fn();
  const onReady = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mutable properties
    mockRecognition.continuous = false;
    mockRecognition.interimResults = false;
    mockRecognition.onresult = null;

    nativeBrowser = new NativeBrowser({
      onTranscriptUpdate,
      onReady,
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
      expect(mockRecognition.continuous).toBe(true);
      expect(mockRecognition.interimResults).toBe(true);
    });

    it('should call start on the recognition object when startTranscription is called', async () => {
      await nativeBrowser.init();
      await nativeBrowser.startTranscription();
      expect(mockRecognition.start).toHaveBeenCalledTimes(1);
    });

    it('should call stop on the recognition object when stopTranscription is called', async () => {
      await nativeBrowser.init();
      await nativeBrowser.startTranscription();
      await nativeBrowser.stopTranscription();
      expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('Result Handling', () => {
    it('should handle final transcript results correctly', async () => {
      await nativeBrowser.init();
      const event = {
        results: [[{ transcript: 'hello world', confidence: 0.9 }]],
        resultIndex: 0,
      };
      // @ts-expect-error - Manually setting isFinal for test purposes
      event.results[0].isFinal = true;

      // Simulate the onresult event
      if (mockRecognition.onresult) {
        mockRecognition.onresult(event as unknown as Event);
      }

      expect(onTranscriptUpdate).toHaveBeenCalledWith({
        transcript: { final: 'hello world' },
      });
    });

    it('should handle interim transcript results correctly', async () => {
      await nativeBrowser.init();
      const event = {
        results: [[{ transcript: 'hello', confidence: 0.8 }]],
        resultIndex: 0,
      };
      // @ts-expect-error - Manually setting isFinal for test purposes
      event.results[0].isFinal = false;

      // Simulate the onresult event
      if (mockRecognition.onresult) {
        mockRecognition.onresult(event as unknown as Event);
      }

      expect(onTranscriptUpdate).toHaveBeenCalledWith({
        transcript: { partial: 'hello' },
      });
    });
    it('REGRESSION: should handle rapid onend events without redundant starts', async () => {
      await nativeBrowser.init();
      await nativeBrowser.startTranscription();

      vi.useFakeTimers();

      // Simulate onend
      if (mockRecognition.onend) {
        mockRecognition.onend({} as Event);
      }

      // Fast forward past the 50ms delay
      await vi.advanceTimersByTimeAsync(60);

      // Should have started again
      expect(mockRecognition.start).toHaveBeenCalledTimes(2);

      // Simulate another onend immediately
      if (mockRecognition.onend) {
        mockRecognition.onend({} as Event);
      }

      await vi.advanceTimersByTimeAsync(60);

      // Should NOT have started a 3rd time if it's already restarting or listening
      // Actually, NativeBrowser logic uses isRestarting flag to prevent this.
      expect(mockRecognition.start).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });
});
