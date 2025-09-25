import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CloudAssemblyAI from '../modes/CloudAssemblyAI';
import { MicStream } from '../utils/types';

// Hold onto the original WebSocket
const RealWebSocket = global.WebSocket;

// Create a mock WebSocket class instance that we can control in tests
const mockSocketInstance = {
  send: vi.fn(),
  close: vi.fn(),
  readyState: 0, // This will be updated in tests
  onopen: vi.fn(),
  onmessage: vi.fn(),
  onerror: vi.fn(),
  onclose: vi.fn(),
};

// The mock WebSocket constructor returns our controllable instance
const MockWebSocket = Object.assign(vi.fn(() => mockSocketInstance), {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
});

describe('CloudAssemblyAI', () => {
  let cloudAI: CloudAssemblyAI;
  const onTranscriptUpdate = vi.fn();
  const getAssemblyAIToken = vi.fn();
  const onReady = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    // Reset all mocks before each test
    vi.clearAllMocks();
    getAssemblyAIToken.mockResolvedValue('fake-token');
    // Reset the mock socket instance state for a clean slate
    Object.assign(mockSocketInstance, {
      send: vi.fn(),
      close: vi.fn(),
      readyState: MockWebSocket.CONNECTING,
      onopen: vi.fn(),
      onmessage: vi.fn(),
      onerror: vi.fn(),
      onclose: vi.fn(),
    });

    cloudAI = new CloudAssemblyAI({
      onTranscriptUpdate,
      onReady,
      getAssemblyAIToken,
      onModelLoadProgress: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    global.WebSocket = RealWebSocket;
  });

  const createMockMicStream = (): MicStream => ({
    sampleRate: 16000,
    onFrame: vi.fn(),
    offFrame: vi.fn(),
    close: vi.fn(),
    stop: vi.fn(),
    _mediaStream: new MediaStream(),
  });

  it('should get a token and open a websocket on startTranscription', async () => {
    const micStream = createMockMicStream();
    const startPromise = cloudAI.startTranscription(micStream);

    await vi.advanceTimersByTimeAsync(0); // Allow promises like getAssemblyAIToken to resolve

    expect(getAssemblyAIToken).toHaveBeenCalled();
    expect(MockWebSocket).toHaveBeenCalledWith(expect.stringContaining('token=fake-token'));

    // Simulate the connection opening
    mockSocketInstance.readyState = MockWebSocket.OPEN;
    mockSocketInstance.onopen();

    await startPromise; // The promise should now resolve

    expect(onReady).toHaveBeenCalled();
    expect(micStream.onFrame).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should send audio data when the websocket is open', async () => {
    const micStream = createMockMicStream();
    cloudAI.startTranscription(micStream);
    await vi.advanceTimersByTimeAsync(0);

    // Simulate socket opening to attach the frame handler
    mockSocketInstance.readyState = MockWebSocket.OPEN;
    mockSocketInstance.onopen();

    // The onFrame method on the mock should have been called with the handler
    const frameHandler = (micStream.onFrame as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(frameHandler).toBeInstanceOf(Function);

    // Call the handler to simulate receiving an audio frame
    frameHandler(new Float32Array([0.1, 0.2, 0.3]));

    expect(mockSocketInstance.send).toHaveBeenCalled();
  });

  it('should handle incoming partial transcript messages', async () => {
    const micStream = createMockMicStream();
    cloudAI.startTranscription(micStream);
    await vi.advanceTimersByTimeAsync(0);

    const messageEvent = { data: JSON.stringify({ transcript: 'hello', turn_is_formatted: false }) };
    mockSocketInstance.onmessage(messageEvent as MessageEvent);

    expect(onTranscriptUpdate).toHaveBeenCalledWith({
      transcript: { partial: 'hello' },
    });
  });

  it('should handle incoming final transcript messages', async () => {
    const micStream = createMockMicStream();
    cloudAI.startTranscription(micStream);
    await vi.advanceTimersByTimeAsync(0);

    const messageEvent = { data: JSON.stringify({ transcript: 'hello world', turn_is_formatted: true, end_of_turn: true, words: [] }) };
    mockSocketInstance.onmessage(messageEvent as MessageEvent);

    expect(onTranscriptUpdate).toHaveBeenCalledWith({
      transcript: { final: 'hello world' },
      words: [],
    });
  });

  it('should close the websocket and unregister frame handler on stopTranscription', async () => {
    const micStream = createMockMicStream();
    cloudAI.startTranscription(micStream);
    await vi.advanceTimersByTimeAsync(0);

    // The socket must be OPEN for close to be called
    mockSocketInstance.readyState = MockWebSocket.OPEN;
    mockSocketInstance.onopen();

    await cloudAI.stopTranscription();

    expect(micStream.offFrame).toHaveBeenCalled();
    expect(mockSocketInstance.close).toHaveBeenCalledWith(1000);
  });
});