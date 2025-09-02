import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CloudAssemblyAI from './CloudAssemblyAI';

// A robust mock for WebSocket
const mockSend = vi.fn();
const mockClose = vi.fn();
let mockSocketInstance;

const MockWebSocket = vi.fn((url) => {
  mockSocketInstance = {
    url,
    send: mockSend,
    close: mockClose,
    readyState: 1, // Default to OPEN
    onopen: () => {},
    onmessage: () => {},
    onerror: () => {},
    onclose: () => {},
  };
  // Simulate the onopen event being called asynchronously
  setTimeout(() => mockSocketInstance.onopen(), 0);
  return mockSocketInstance;
});

// Add static properties to the mock class
MockWebSocket.OPEN = 1;

vi.stubGlobal('WebSocket', MockWebSocket);

// Mock Mic
const mockMic = {
  onFrame: vi.fn(),
  offFrame: vi.fn(),
  sampleRate: 16000,
};

describe('CloudAssemblyAI', () => {
  let getAssemblyAITokenMock;
  const onTranscriptUpdate = vi.fn();
  const onReady = vi.fn();
  let cloudAI;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Create a fresh mock for each test
    getAssemblyAITokenMock = vi.fn().mockResolvedValue('fake-token-123');
    cloudAI = null;
  });

  afterEach(async () => {
    // Clean up any running instance to prevent leaks
    if (cloudAI && typeof cloudAI.stopTranscription === 'function') {
      await cloudAI.stopTranscription();
    }
    vi.useRealTimers();
  });

  it('should initialize correctly and not throw', async () => {
    cloudAI = new CloudAssemblyAI({ getAssemblyAIToken: getAssemblyAITokenMock });
    await expect(cloudAI.init()).resolves.toBeUndefined();
  });

  it('should throw an error if getAssemblyAIToken is not a function', async () => {
    // Instantiate without the required function
    cloudAI = new CloudAssemblyAI();
    await expect(cloudAI.init()).rejects.toThrow('CloudAssemblyAI requires a getAssemblyAIToken function.');
  });

  describe('startTranscription', () => {
    it('should create a WebSocket with the correct URL', async () => {
      cloudAI = new CloudAssemblyAI({
        getAssemblyAIToken: getAssemblyAITokenMock,
        onReady,
      });
      await cloudAI.init();
      await cloudAI.startTranscription(mockMic);

      // Allow the async onopen to fire
      await vi.runAllTimersAsync();

      expect(getAssemblyAITokenMock).toHaveBeenCalledOnce();
      const wsURL = MockWebSocket.mock.calls[0][0];
      const url = new URL(wsURL);

      expect(url.protocol).toBe('wss:');
      expect(url.host).toBe('streaming.assemblyai.com');
      expect(url.pathname).toBe('/v3/ws');
      expect(url.searchParams.get('sample_rate')).toBe('16000');
      expect(url.searchParams.get('token')).toBe('fake-token-123');
      expect(url.searchParams.get('format_turns')).toBe('true');
      expect(onReady).toHaveBeenCalledOnce();
      expect(mockMic.onFrame).toHaveBeenCalledOnce();
    });
  });

  describe('_handleAudioFrame', () => {
    it('should convert Float32Array to Int16Array and send', async () => {
      cloudAI = new CloudAssemblyAI({ getAssemblyAIToken: getAssemblyAITokenMock });
      await cloudAI.init();
      await cloudAI.startTranscription(mockMic);
      await vi.runAllTimersAsync();

      const float32Array = new Float32Array([0.1, -0.2, 0.3]);
      const expectedInt16Array = new Int16Array([3276, -6553, 9830]);

      cloudAI._handleAudioFrame(float32Array);

      expect(mockSend).toHaveBeenCalledWith(expectedInt16Array.buffer);
    });
  });

  describe('onmessage', () => {
    it('should handle final transcripts', async () => {
      cloudAI = new CloudAssemblyAI({
        getAssemblyAIToken: getAssemblyAITokenMock,
        onTranscriptUpdate,
      });
      await cloudAI.init();
      await cloudAI.startTranscription(mockMic);
      await vi.runAllTimersAsync();

      const finalTranscript = { transcript: 'hello world', turn_is_formatted: true, end_of_turn: true, words: [] };
      mockSocketInstance.onmessage({ data: JSON.stringify(finalTranscript) });

      expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { final: 'hello world' }, words: [] });
    });
  });

  describe('stopTranscription', () => {
    it('should detach from mic, send terminate message, and close socket', async () => {
      cloudAI = new CloudAssemblyAI({ getAssemblyAIToken: getAssemblyAITokenMock });
      await cloudAI.init();
      await cloudAI.startTranscription(mockMic);
      await vi.runAllTimersAsync();

      await cloudAI.stopTranscription();

      expect(mockMic.offFrame).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledWith(JSON.stringify({ type: 'Terminate' }));
      expect(mockClose).toHaveBeenCalledWith(1000);
    });
  });
});
