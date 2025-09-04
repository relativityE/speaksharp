import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CloudAssemblyAI from './CloudAssemblyAI.js';

// Mock logger to avoid console spam
vi.mock('../../../lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  }
}));

// Enhanced WebSocket mock
const createMockWebSocket = () => ({
  onopen: null,
  onmessage: null,
  onerror: null,
  onclose: null,
  readyState: 0, // CONNECTING
  send: vi.fn(),
  close: vi.fn(),
  // Helper to simulate events
  simulateOpen() {
    this.readyState = 1; // OPEN
    if (this.onopen) this.onopen();
  },
  simulateMessage(data) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  },
  simulateError(error) {
    if (this.onerror) this.onerror(error);
  },
  simulateClose(code = 1000, reason = '') {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose({ code, reason });
  }
});

global.WebSocket = vi.fn();
global.WebSocket.OPEN = 1;
global.WebSocket.CLOSED = 3;

describe('CloudAssemblyAI', () => {
  let cloudAI;
  let mockGetAssemblyAIToken;
  let mockWebSocket;
  let mockMic;

  beforeEach(() => {
    mockWebSocket = createMockWebSocket();
    global.WebSocket.mockImplementation(() => mockWebSocket);

    mockGetAssemblyAIToken = vi.fn().mockResolvedValue('fake-token');

    mockMic = {
      onFrame: vi.fn(),
      offFrame: vi.fn(),
      sampleRate: 16000
    };

    cloudAI = new CloudAssemblyAI({
      onTranscriptUpdate: vi.fn(),
      onReady: vi.fn(),
      getAssemblyAIToken: mockGetAssemblyAIToken,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('throws error when getAssemblyAIToken is not provided', () => {
      expect(() => new CloudAssemblyAI()).toThrow(
        'CloudAssemblyAI requires a getAssemblyAIToken function.'
      );
    });
  });

  describe('Starting Transcription', () => {
    it('establishes WebSocket connection with correct URL', async () => {
      await cloudAI.startTranscription(mockMic);
      expect(mockGetAssemblyAIToken).toHaveBeenCalled();
      expect(global.WebSocket).toHaveBeenCalledWith(
        'wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&token=fake-token&format_turns=true'
      );
    });

    it('attaches mic frame handler and calls onReady when connection opens', async () => {
      await cloudAI.startTranscription(mockMic);
      mockWebSocket.simulateOpen();
      expect(mockMic.onFrame).toHaveBeenCalledWith(cloudAI.frameHandler);
      expect(cloudAI.onReady).toHaveBeenCalled();
    });
  });

  describe('Audio Frame Handling', () => {
    it('queues audio data when connecting and sends when open', async () => {
      const testAudio = new Float32Array([0.5]);
      await cloudAI.startTranscription(mockMic);

      // Should be connecting, so audio is queued
      cloudAI._handleAudioFrame(testAudio);
      expect(mockWebSocket.send).not.toHaveBeenCalled();

      // Now open the connection
      mockWebSocket.simulateOpen();

      // The queued frame should be sent
      expect(mockWebSocket.send).toHaveBeenCalled();
      expect(cloudAI.firstPacketSent).toBe(true);
    });

    it('properly converts Float32 to Int16', async () => {
      await cloudAI.startTranscription(mockMic);
      mockWebSocket.simulateOpen();

      const testAudio = new Float32Array([1.0, -1.0, 0.5, -0.5]);
      cloudAI._handleAudioFrame(testAudio);

      expect(mockWebSocket.send).toHaveBeenCalled();
      const sentData = mockWebSocket.send.mock.calls[0][0];
      expect(sentData).toBeInstanceOf(ArrayBuffer);
      const view = new Int16Array(sentData);
      expect(view[0]).toBe(32767);
      expect(view[1]).toBe(-32767);
    });
  });

  describe('Message Processing', () => {
    let onTranscriptUpdate;

    beforeEach(async () => {
      onTranscriptUpdate = vi.fn();
      cloudAI = new CloudAssemblyAI({
        onTranscriptUpdate,
        onReady: vi.fn(),
        getAssemblyAIToken: mockGetAssemblyAIToken,
      });
      await cloudAI.startTranscription(mockMic);
      mockWebSocket.simulateOpen();
    });

    it('handles partial transcripts correctly', () => {
      const partialMessage = { transcript: 'Hello', turn_is_formatted: false };
      mockWebSocket.simulateMessage(partialMessage);
      expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { partial: 'Hello' } });
    });

    it('handles final transcripts correctly', () => {
      const finalMessage = { transcript: 'Hello world.', turn_is_formatted: true, end_of_turn: true, words: [{ word: 'Hello' }] };
      mockWebSocket.simulateMessage(finalMessage);
      expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { final: 'Hello world.' }, words: [{ word: 'Hello' }] });
    });
  });

  describe('Error Handling and Stopping', () => {
    it('cleans up properly on WebSocket close', async () => {
      await cloudAI.startTranscription(mockMic);
      mockWebSocket.simulateOpen();

      mockWebSocket.simulateClose(1000, 'Normal');

      expect(cloudAI.socket).toBeNull();
    });

    it('resets state on stopTranscription', async () => {
      await cloudAI.startTranscription(mockMic);
      mockWebSocket.simulateOpen();
      cloudAI._handleAudioFrame(new Float32Array([0.1]));
      expect(cloudAI.firstPacketSent).toBe(true);

      await cloudAI.stopTranscription();

      expect(mockMic.offFrame).toHaveBeenCalledWith(cloudAI.frameHandler);
      expect(cloudAI.firstPacketSent).toBe(false);
      expect(cloudAI.audioQueue.length).toBe(0);
    });
  });
});
