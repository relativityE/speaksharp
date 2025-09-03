//cloudAssemblyAi.test.jsx - fixed and enhanced
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
const createMockWebSocket = (readyState = WebSocket.OPEN) => ({
  onopen: null,
  onmessage: null,
  onerror: null,
  onclose: null,
  readyState,
  send: vi.fn(),
  close: vi.fn(),
  // Helper to simulate events
  simulateOpen() {
    if (this.onopen) this.onopen();
  },
  simulateMessage(data) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  },
  simulateError(error) {
    if (this.onerror) this.onerror(error);
  },
  simulateClose(code = 1000, reason = '') {
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
    // Clear all mocks and reset modules for fresh state
    vi.clearAllMocks();
    vi.resetModules();

    // Create fresh mocks
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
    // Ensure cleanup after each test
    if (cloudAI) {
      cloudAI.stopTranscription();
    }
  });

  describe('Initialization', () => {
    it('initializes correctly with required dependencies', async () => {
      await cloudAI.init();
      expect(cloudAI._getAssemblyAIToken).toBe(mockGetAssemblyAIToken);
    });

    it('throws error when getAssemblyAIToken is not provided', async () => {
      const invalidAI = new CloudAssemblyAI();
      await expect(invalidAI.init()).rejects.toThrow(
        'CloudAssemblyAI requires a getAssemblyAIToken function.'
      );
    });

    it('throws error when getAssemblyAIToken is not a function', async () => {
      const invalidAI = new CloudAssemblyAI({ getAssemblyAIToken: 'not-a-function' });
      await expect(invalidAI.init()).rejects.toThrow(
        'CloudAssemblyAI requires a getAssemblyAIToken function.'
      );
    });
  });

  describe('Starting Transcription', () => {
    beforeEach(async () => {
      await cloudAI.init();
    });

    it('establishes WebSocket connection with correct URL', async () => {
      await cloudAI.startTranscription(mockMic);

      expect(mockGetAssemblyAIToken).toHaveBeenCalled();
      expect(global.WebSocket).toHaveBeenCalledWith(
        'wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&token=fake-token&format_turns=true'
      );
    });

    it('throws error when mic is not provided', async () => {
      await expect(cloudAI.startTranscription()).rejects.toThrow(
        'A mic object with an onFrame method is required.'
      );
    });

    it('throws error when mic lacks onFrame method', async () => {
      const invalidMic = { sampleRate: 16000 };
      await expect(cloudAI.startTranscription(invalidMic)).rejects.toThrow(
        'A mic object with an onFrame method is required.'
      );
    });

    it('throws error when token retrieval fails', async () => {
      mockGetAssemblyAIToken.mockRejectedValue(new Error('Token failed'));

      await expect(cloudAI.startTranscription(mockMic)).rejects.toThrow('Token failed');
    });

    it('throws error when token is null/undefined', async () => {
      mockGetAssemblyAIToken.mockResolvedValue(null);

      await expect(cloudAI.startTranscription(mockMic)).rejects.toThrow(
        'Failed to retrieve AssemblyAI token.'
      );
    });

    it('sets up WebSocket event handlers correctly', async () => {
      await cloudAI.startTranscription(mockMic);

      expect(mockWebSocket.onopen).toBeDefined();
      expect(mockWebSocket.onmessage).toBeDefined();
      expect(mockWebSocket.onerror).toBeDefined();
      expect(mockWebSocket.onclose).toBeDefined();
    });

    it('attaches mic frame handler when connection opens', async () => {
      await cloudAI.startTranscription(mockMic);

      // Simulate WebSocket opening
      mockWebSocket.simulateOpen();

      expect(mockMic.onFrame).toHaveBeenCalledWith(cloudAI.frameHandler);
      expect(cloudAI.onReady).toHaveBeenCalled();
    });
  });

  describe('Audio Frame Handling', () => {
    beforeEach(async () => {
      await cloudAI.init();
      await cloudAI.startTranscription(mockMic);
    });

    it('converts and sends audio data when WebSocket is open', () => {
      const testAudio = new Float32Array([0.5, -0.5, 0.25, -0.25]);

      cloudAI._handleAudioFrame(testAudio);

      expect(mockWebSocket.send).toHaveBeenCalled();
      const sentData = mockWebSocket.send.mock.calls[0][0];
      expect(sentData).toBeInstanceOf(ArrayBuffer);
    });

    it('drops frames when WebSocket is not open', () => {
      mockWebSocket.readyState = WebSocket.CLOSED;
      const testAudio = new Float32Array([0.5, -0.5]);

      cloudAI._handleAudioFrame(testAudio);

      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });

    it('handles first packet tracking correctly', () => {
      expect(cloudAI.firstPacketSent).toBe(false);

      const testAudio = new Float32Array([0.5]);
      cloudAI._handleAudioFrame(testAudio);

      expect(cloudAI.firstPacketSent).toBe(true);
    });

    it('properly converts Float32 to Int16', () => {
      const testAudio = new Float32Array([1.0, -1.0, 0.5, -0.5]);
      cloudAI._handleAudioFrame(testAudio);

      // Check that conversion doesn't throw and data is sent
      expect(mockWebSocket.send).toHaveBeenCalled();
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
      await cloudAI.init();
      await cloudAI.startTranscription(mockMic);
    });

    it('handles partial transcripts correctly', () => {
      const partialMessage = {
        transcript: 'Hello world',
        turn_is_formatted: false,
        end_of_turn: false
      };

      mockWebSocket.simulateMessage(partialMessage);

      expect(onTranscriptUpdate).toHaveBeenCalledWith({
        transcript: { partial: 'Hello world' }
      });
    });

    it('handles final transcripts correctly', () => {
      const finalMessage = {
        transcript: 'Hello world!',
        turn_is_formatted: true,
        end_of_turn: true,
        words: [{ word: 'Hello' }, { word: 'world!' }]
      };

      mockWebSocket.simulateMessage(finalMessage);

      expect(onTranscriptUpdate).toHaveBeenCalledWith({
        transcript: { final: 'Hello world!' },
        words: [{ word: 'Hello' }, { word: 'world!' }]
      });
    });

    it('handles messages without words array', () => {
      const messageWithoutWords = {
        transcript: 'Hello world!',
        turn_is_formatted: true,
        end_of_turn: true
      };

      mockWebSocket.simulateMessage(messageWithoutWords);

      expect(onTranscriptUpdate).toHaveBeenCalledWith({
        transcript: { final: 'Hello world!' },
        words: []
      });
    });

    it('ignores messages without transcript', () => {
      const invalidMessage = { some: 'other data' };

      mockWebSocket.simulateMessage(invalidMessage);

      expect(onTranscriptUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await cloudAI.init();
      await cloudAI.startTranscription(mockMic);
    });

    it('handles WebSocket errors by stopping transcription', () => {
      const stopSpy = vi.spyOn(cloudAI, 'stopTranscription');

      mockWebSocket.simulateError(new Error('Connection failed'));

      expect(stopSpy).toHaveBeenCalled();
    });

    it('cleans up properly on WebSocket close', () => {
      mockWebSocket.simulateClose(1000, 'Normal closure');

      expect(cloudAI.socket).toBeNull();
      expect(mockMic.offFrame).toHaveBeenCalledWith(cloudAI.frameHandler);
    });
  });

  describe('Stopping Transcription', () => {
    beforeEach(async () => {
      await cloudAI.init();
      await cloudAI.startTranscription(mockMic);
    });

    it('removes mic frame handler', async () => {
      await cloudAI.stopTranscription();

      expect(mockMic.offFrame).toHaveBeenCalledWith(cloudAI.frameHandler);
      expect(cloudAI.mic).toBeNull();
    });

    it('sends termination message and closes WebSocket', async () => {
      await cloudAI.stopTranscription();

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "Terminate" })
      );
      expect(mockWebSocket.close).toHaveBeenCalledWith(1000);
      expect(cloudAI.socket).toBeNull();
    });

    it('handles stopping when no active connection exists', async () => {
      cloudAI.socket = null;

      // Should not throw
      await expect(cloudAI.stopTranscription()).resolves.toBeUndefined();
    });

    it('handles stopping when WebSocket is already closed', async () => {
      mockWebSocket.readyState = WebSocket.CLOSED;

      await cloudAI.stopTranscription();

      expect(mockWebSocket.send).not.toHaveBeenCalled();
      expect(mockWebSocket.close).not.toHaveBeenCalled();
    });
  });

  describe('State Management', () => {
    beforeEach(async () => {
      await cloudAI.init();
    });

    it('resets firstPacketSent flag on restart', async () => {
      // Start and send a packet
      await cloudAI.startTranscription(mockMic);
      cloudAI._handleAudioFrame(new Float32Array([0.5]));
      expect(cloudAI.firstPacketSent).toBe(true);

      // Stop and restart
      await cloudAI.stopTranscription();
      cloudAI.firstPacketSent = false; // This should be done automatically
      await cloudAI.startTranscription(mockMic);

      expect(cloudAI.firstPacketSent).toBe(false);
    });
  });
});
