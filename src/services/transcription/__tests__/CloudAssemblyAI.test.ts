import CloudAssemblyAI from '../modes/CloudAssemblyAI';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Hold a reference to the latest mock instance
let mockSocketInstance: MockWebSocket | null = null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState: number = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  // Spies for methods
  send = vi.fn();
  // The close method will be spied on via the prototype
  close() {}

  constructor(url: string) {
    this.url = url;
    mockSocketInstance = this;
    MockWebSocket.instances.push(this);
  }

  // Helper to simulate server opening the connection
  _open() {
    this.readyState = 1; // OPEN
    if (this.onopen) {
      this.onopen();
    }
  }
}

// Mock the global WebSocket
vi.stubGlobal('WebSocket', MockWebSocket);

const mockGetAssemblyAIToken = vi.fn();

describe('CloudAssemblyAI Transcription Mode', () => {
  let cloudAI: CloudAssemblyAI;
  let mockMicStream: any;
  const onReady = vi.fn();
  let mockClose: vi.SpyInstance;

  beforeEach(() => {
    mockClose = vi.spyOn(MockWebSocket.prototype, 'close');
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    mockSocketInstance = null;
    mockGetAssemblyAIToken.mockResolvedValue('fake-token');

    mockMicStream = {
      onFrame: vi.fn(),
      offFrame: vi.fn(),
      sampleRate: 16000
    };

    cloudAI = new CloudAssemblyAI({
      onTranscriptUpdate: vi.fn(),
      onReady,
      onModelLoadProgress: vi.fn(),
      session: null,
      navigate: vi.fn(),
      getAssemblyAIToken: mockGetAssemblyAIToken,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create a WebSocket and fetch a token on startTranscription', async () => {
    await cloudAI.startTranscription(mockMicStream);
    expect(mockGetAssemblyAIToken).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances.length).toBe(1);
    expect(mockSocketInstance?.url).toContain('wss://streaming.assemblyai.com');
  });

  it('should throw an error if token fetch fails', async () => {
    mockGetAssemblyAIToken.mockResolvedValue(null);
    await expect(cloudAI.startTranscription(mockMicStream)).rejects.toThrow("Failed to retrieve AssemblyAI token.");
  });

  it('should call onReady and attach frame handler when WebSocket opens', async () => {
    await cloudAI.startTranscription(mockMicStream);
    mockSocketInstance?._open(); // Manually trigger the open event
    expect(onReady).toHaveBeenCalled();
    expect(mockMicStream.onFrame).toHaveBeenCalled();
  });

  it('should close the WebSocket on stopTranscription', async () => {
    await cloudAI.startTranscription(mockMicStream);
    expect(mockSocketInstance).not.toBeNull();

    // Ensure the socket is open before trying to close it
    mockSocketInstance?._open();

    // Log the state right before the call
    console.log('Socket state before stop:', {
      readyState: mockSocketInstance?.readyState,
      instance: mockSocketInstance ? 'exists' : 'null'
    });

    await cloudAI.stopTranscription();

    // Check that the close method on our specific instance was called
    expect(mockClose).toHaveBeenCalledWith(1000);
  });
});
