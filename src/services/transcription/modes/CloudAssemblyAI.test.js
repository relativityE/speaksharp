import { describe, it, expect, vi, beforeEach } from 'vitest';
import CloudAssemblyAI from './CloudAssemblyAI';

// A robust mock for WebSocket
const mockSend = vi.fn();
const mockClose = vi.fn();
const MockWebSocket = vi.fn(() => ({
  send: mockSend,
  close: mockClose,
  readyState: 1, // Default to OPEN
  onopen: () => {},
  onmessage: () => {},
  onerror: () => {},
  onclose: () => {},
}));
// Add static properties to the mock class
MockWebSocket.OPEN = 1;
MockWebSocket.CONNECTING = 0;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

vi.stubGlobal('WebSocket', MockWebSocket);


// Mock Mic
const mockMic = {
  onFrame: vi.fn(),
  offFrame: vi.fn(),
  sampleRate: 16000,
};

describe('CloudAssemblyAI', () => {
  let cloudAI;
  const onTranscriptUpdate = vi.fn();
  const onReady = vi.fn();
  const getAssemblyAIToken = vi.fn().mockResolvedValue('fake-token');

  beforeEach(() => {
    vi.clearAllMocks();
    cloudAI = new CloudAssemblyAI({
      onTranscriptUpdate,
      onReady,
      getAssemblyAIToken,
    });
  });

  it('should initialize correctly', async () => {
    await cloudAI.init();
    expect(cloudAI).toBeDefined();
  });

  it('should throw an error if getAssemblyAIToken is not a function', async () => {
    const invalidCloudAI = new CloudAssemblyAI();
    await expect(invalidCloudAI.init()).rejects.toThrow('CloudAssemblyAI requires a getAssemblyAIToken function.');
  });

  describe('startTranscription', () => {
    it('should create a WebSocket with the correct URL', async () => {
      await cloudAI.startTranscription(mockMic);
      expect(getAssemblyAIToken).toHaveBeenCalled();
      expect(WebSocket).toHaveBeenCalledWith(
        'wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&token=fake-token&format_turns=true'
      );
    });
  });

  describe('_handleAudioFrame', () => {
    it('should convert Float32Array to Int16Array and send', async () => {
      await cloudAI.startTranscription(mockMic);
      const float32Array = new Float32Array([0.1, -0.2, 0.3]);
      const expectedInt16Array = new Int16Array([3276, -6553, 9830]);

      cloudAI._handleAudioFrame(float32Array);

      expect(mockSend).toHaveBeenCalledWith(expectedInt16Array.buffer);
    });
  });

  describe('onmessage', () => {
    it('should handle final transcripts', async () => {
      await cloudAI.startTranscription(mockMic);
      const finalTranscript = { transcript: 'hello world', turn_is_formatted: true, end_of_turn: true, words: [] };
      cloudAI.socket.onmessage({ data: JSON.stringify(finalTranscript) });
      expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { final: 'hello world' }, words: [] });
    });
  });

  describe('stopTranscription', () => {
    it('should detach from mic, send terminate message, and close socket', async () => {
      await cloudAI.startTranscription(mockMic);
      await cloudAI.stopTranscription();

      expect(mockMic.offFrame).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledWith(JSON.stringify({ type: 'Terminate' }));
      expect(mockClose).toHaveBeenCalledWith(1000);
    });
  });
});
