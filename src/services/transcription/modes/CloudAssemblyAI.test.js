import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: CloudAssemblyAI is dynamically imported to bust the cache.

// Mock the global WebSocket
global.WebSocket = vi.fn(() => ({
  onopen: vi.fn(),
  onmessage: vi.fn(),
  onerror: vi.fn(),
  onclose: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
}));

describe('CloudAssemblyAI', () => {
  let CloudAssemblyAI;
  let cloudAI;
  let mockGetAssemblyAIToken;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import(`./CloudAssemblyAI.js?t=${Date.now()}`);
    CloudAssemblyAI = module.default;

    mockGetAssemblyAIToken = vi.fn().mockResolvedValue('fake-token');
    cloudAI = new CloudAssemblyAI({
      onTranscriptUpdate: vi.fn(),
      onReady: vi.fn(),
      getAssemblyAIToken: mockGetAssemblyAIToken,
    });
  });

  it('initializes correctly', async () => {
    await cloudAI.init();
    expect(cloudAI._getAssemblyAIToken).toBeDefined();
  });

  it('throws an error if getAssemblyAIToken is not provided', async () => {
    const invalidAI = new CloudAssemblyAI();
    await expect(invalidAI.init()).rejects.toThrow('CloudAssemblyAI requires a getAssemblyAIToken function.');
  });

  it('startTranscription establishes a WebSocket connection', async () => {
    const mockMic = { onFrame: vi.fn(), sampleRate: 16000 };
    await cloudAI.init();
    await cloudAI.startTranscription(mockMic);

    expect(mockGetAssemblyAIToken).toHaveBeenCalled();
    expect(global.WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&token=fake-token')
    );
  });
});
