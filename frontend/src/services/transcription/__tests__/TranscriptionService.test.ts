// Test the service layer instead of the problematic hook

/* eslint-disable @typescript-eslint/no-explicit-any, vitest/expect-expect */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { UserProfile } from '../../../types/user';

// Mock the modes
vi.mock('../modes/NativeBrowser', () => ({
  default: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    startTranscription: vi.fn().mockResolvedValue(undefined),
    stopTranscription: vi.fn().mockResolvedValue(""),
    getTranscript: vi.fn().mockResolvedValue(""),
  }))
}));

vi.mock('../modes/CloudAssemblyAI', () => ({
  default: vi.fn().mockImplementation((options) => ({
    init: vi.fn().mockResolvedValue(undefined),
    startTranscription: vi.fn().mockImplementation(async () => {
      if (options.getAssemblyAIToken) {
        const token = await options.getAssemblyAIToken();
        if (!token) throw new Error("Mock token failure");
      }
    }),
    stopTranscription: vi.fn().mockResolvedValue(""),
    getTranscript: vi.fn().mockResolvedValue(""),
  }))
}));

vi.mock('../modes/PrivateWhisper', () => ({
  default: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    startTranscription: vi.fn().mockResolvedValue(undefined),
    stopTranscription: vi.fn().mockResolvedValue(""),
    getTranscript: vi.fn().mockResolvedValue(""),
  }))
}));
vi.mock('../utils/audioUtils', () => ({
  createMicStream: vi.fn().mockResolvedValue({
    stop: vi.fn(),
    stream: {},
  })
}));

// Mock getTestConfig to return isTestMode: false so we can test Cloud/Private modes
// In real tests, VITE_TEST_MODE=true would force Native mode
vi.mock('@/config/test.config', () => ({
  getTestConfig: vi.fn(() => ({
    isTestMode: false,
    useMockOnDeviceWhisper: false,
    mockSession: false,
    shouldSkipMicInit: false,
  })),
}));

describe('TranscriptionService', () => {
  let service: TranscriptionService;
  const mockOptions = {
    onTranscriptUpdate: vi.fn(),
    onModelLoadProgress: vi.fn(),
    onReady: vi.fn(),
    profile: null as UserProfile | null,
    session: null,
    navigate: vi.fn(),
    getAssemblyAIToken: vi.fn().mockResolvedValue('mock-token'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TranscriptionService(mockOptions);
  });

  it('should initialize successfully', async () => {
    const result = await service.init();
    expect(result.success).toBe(true);
  });

  it('should return correct mode', () => {
    const mode = service.getMode();
    expect(mode).toBeNull(); // Before starting transcription
  });

  it('should handle destroy gracefully', async () => {
    await expect(service.destroy()).resolves.not.toThrow();
  });

  it('should use NativeBrowser by default', async () => {
    await service.init();
    await service.startTranscription();
    expect(service.getMode()).toBe('native');
  });

  it('should use CloudAssemblyAI for Pro users', async () => {
    service = new TranscriptionService({
      ...mockOptions,
      profile: { subscription_status: 'pro' } as any,
    });
    await service.init();
    await service.startTranscription();
    expect(service.getMode()).toBe('cloud');
  });

  it('should fallback to NativeBrowser if Cloud token fails', async () => {
    service = new TranscriptionService({
      ...mockOptions,
      profile: { subscription_status: 'pro' } as any,
      getAssemblyAIToken: vi.fn().mockResolvedValue(null),
    });
    await service.init();
    await service.startTranscription();
    expect(service.getMode()).toBe('native');
  });

  it('should fallback to NativeBrowser if Private model fails to load', async () => {
    // Force PrivateWhisper.init to fail
    const { default: PrivateWhisperClass } = await import('../modes/PrivateWhisper');
    (PrivateWhisperClass as any).mockImplementationOnce(() => ({
      init: vi.fn().mockRejectedValue(new Error("Model load failed")),
    }));

    service = new TranscriptionService({
      ...mockOptions,
      profile: { subscription_status: 'pro', preferred_mode: 'private' } as any,
    });

    await service.init();
    await service.startTranscription();
    expect(service.getMode()).toBe('native');
  });

  it('should throw error if mic not initialized', async () => {
    await expect(service.startTranscription()).rejects.toThrow('Microphone not initialized');
  });

  it('should stop transcription', async () => {
    await service.init();
    await service.startTranscription();
    await service.stopTranscription();
    // Verify internal state or mock calls if possible
  });
});