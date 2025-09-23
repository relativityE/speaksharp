import CloudAssemblyAI from '../modes/CloudAssemblyAI';
import { vi } from 'vitest';

// Create spies outside the class to ensure they are stable references
const mockSend = vi.fn();
const mockClose = vi.fn();
let onOpenCallback: () => void;

// A more robust mock for WebSocket
class MockWebSocket {
  public send = mockSend;
  public close = mockClose;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public readyState: number = 0; // CONNECTING

  constructor(public url: string) {
    // Assign the onopen handler so we can call it from the test
    onOpenCallback = () => {
      this.readyState = 1; // OPEN
      if (this.onopen) {
        this.onopen();
      }
    };
  }
}

vi.stubGlobal('WebSocket', vi.fn((url) => new MockWebSocket(url)));

const mockGetAssemblyAIToken = vi.fn();

describe('CloudAssemblyAI Transcription Mode', () => {
  let cloudAI: CloudAssemblyAI;
  let mockMicStream: any;
  const onReady = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('should create a WebSocket and fetch a token on startTranscription', async () => {
    await cloudAI.startTranscription(mockMicStream);
    expect(mockGetAssemblyAIToken).toHaveBeenCalledTimes(1);
    expect(vi.mocked(WebSocket).mock.instances.length).toBe(1);
    expect(vi.mocked(WebSocket).mock.instances[0].url).toContain('wss://streaming.assemblyai.com');
  });

  it('should throw an error if token fetch fails', async () => {
    mockGetAssemblyAIToken.mockResolvedValue(null);
    await expect(cloudAI.startTranscription(mockMicStream)).rejects.toThrow("Failed to retrieve AssemblyAI token.");
  });

  it('should call onReady and attach frame handler when WebSocket opens', async () => {
    await cloudAI.startTranscription(mockMicStream);
    // Manually trigger the onopen callback
    onOpenCallback();
    expect(onReady).toHaveBeenCalled();
    expect(mockMicStream.onFrame).toHaveBeenCalled();
  });

  it('should close the WebSocket on stopTranscription', async () => {
    await cloudAI.startTranscription(mockMicStream);
    onOpenCallback(); // Make sure the socket is considered open
    await cloudAI.stopTranscription();
    expect(mockClose).toHaveBeenCalledWith(1000);
  });
});
