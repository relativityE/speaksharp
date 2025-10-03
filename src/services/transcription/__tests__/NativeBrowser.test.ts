import NativeBrowser from '../modes/NativeBrowser';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the SpeechRecognition API
const mockRecognition = {
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  onresult: null,
  onerror: null,
  onend: null,
  continuous: false,
  interimResults: false,
};

const SpeechRecognitionMock = vi.fn(() => mockRecognition);

vi.stubGlobal('window', {
  SpeechRecognition: SpeechRecognitionMock,
  webkitSpeechRecognition: SpeechRecognitionMock,
});


describe('NativeBrowser Transcription Mode', () => {
  let nativeBrowser: NativeBrowser;
  const onTranscriptUpdate = vi.fn();
  const onReady = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock before each test
    Object.assign(mockRecognition, {
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
        onresult: null,
        onerror: null,
        onend: null,
        continuous: false,
        interimResults: false,
    });
    SpeechRecognitionMock.mockClear();

    nativeBrowser = new NativeBrowser({
      onTranscriptUpdate,
      onReady,
      onModelLoadProgress: vi.fn(),
      session: null,
      navigate: vi.fn(),
      getAssemblyAIToken: vi.fn(),
    });
  });

  it('should initialize and set up recognition properties', async () => {
    await nativeBrowser.init();
    expect(SpeechRecognitionMock).toHaveBeenCalled();
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

  it('should handle final transcript results correctly', async () => {
    await nativeBrowser.init();
    const event = {
      results: [[{ transcript: 'hello world' }]],
      resultIndex: 0,
    };
    // @ts-expect-error - Manually setting isFinal for test purposes
    event.results[0].isFinal = true;

    // Simulate the onresult event
    if (mockRecognition.onresult) {
        // @ts-expect-error - Simulating event type
        mockRecognition.onresult(event);
    }

    expect(onTranscriptUpdate).toHaveBeenCalledWithExactlyOnceWith({
      transcript: { final: 'hello world' },
    });
  });

  it('should handle interim transcript results correctly', async () => {
    await nativeBrowser.init();
    const event = {
        results: [[{ transcript: 'hello' }]],
        resultIndex: 0,
      };
      // @ts-expect-error - Manually setting isFinal for test purposes
      event.results[0].isFinal = false;

      // Simulate the onresult event
      if (mockRecognition.onresult) {
          // @ts-expect-error - Simulating event type
          mockRecognition.onresult(event);
      }

      expect(onTranscriptUpdate).toHaveBeenCalledWithExactlyOnceWith({
        transcript: { partial: 'hello' },
      });
  });
});