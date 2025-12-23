import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock IS_TEST_ENVIRONMENT to false so tests can run normally
vi.mock('@/config/env', () => ({
  IS_TEST_ENVIRONMENT: false,
}));

import NativeBrowser from '../NativeBrowser';

// Mock the global SpeechRecognition object
const mockSpeechRecognition = {
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  onresult: null as ((event: Event) => void) | null,
  onerror: vi.fn(),
  onend: vi.fn(),
};

// Define a mock constructor for the SpeechRecognition API
const mockSpeechRecognitionStatic = vi.fn(() => mockSpeechRecognition);

vi.stubGlobal('SpeechRecognition', mockSpeechRecognitionStatic);
vi.stubGlobal('webkitSpeechRecognition', mockSpeechRecognitionStatic);

describe('NativeBrowser Transcription Mode', () => {
  let nativeBrowser: NativeBrowser;
  const onTranscriptUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    nativeBrowser = new NativeBrowser({
      onTranscriptUpdate,
      onReady: vi.fn(),
    });
  });

  it('should initialize correctly', async () => {
    await nativeBrowser.init();
    expect(mockSpeechRecognitionStatic).toHaveBeenCalled();
  });

  it('should start transcription', async () => {
    await nativeBrowser.init();
    await nativeBrowser.startTranscription();
    expect(mockSpeechRecognition.start).toHaveBeenCalled();
  });

  it('should stop transcription', async () => {
    await nativeBrowser.init();
    await nativeBrowser.startTranscription();
    await nativeBrowser.stopTranscription();
    expect(mockSpeechRecognition.stop).toHaveBeenCalled();
  });

  it('should handle transcript updates', async () => {
    await nativeBrowser.init();
    const mockResult = {
      results: [
        [
          {
            transcript: 'hello world',
            confidence: 0.9,
          },
        ],
      ],
      resultIndex: 0,
    };
    // Simulate a final result
    (mockResult.results[0] as { isFinal?: boolean }).isFinal = true;

    // Ensure the onresult handler is assigned before calling it
    if (mockSpeechRecognition.onresult) {
      mockSpeechRecognition.onresult(mockResult as unknown as Event);
    }

    expect(onTranscriptUpdate).toHaveBeenCalledWith({
      transcript: { final: 'hello world' },
    });
  });
});
