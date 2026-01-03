// Test the service layer instead of the problematic hook

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { PROD_FREE_POLICY, PROD_PRO_POLICY, TranscriptionPolicy } from '../TranscriptionPolicy';
import { ITranscriptionMode, TranscriptionModeOptions } from '../modes/types';

// Mock the modes with proper types
vi.mock('../modes/NativeBrowser', () => ({
  default: vi.fn().mockImplementation((): ITranscriptionMode => ({
    init: vi.fn().mockResolvedValue(undefined),
    startTranscription: vi.fn().mockResolvedValue(undefined),
    stopTranscription: vi.fn().mockResolvedValue(""),
    getTranscript: vi.fn().mockResolvedValue(""),
  }))
}));

vi.mock('../modes/CloudAssemblyAI', () => ({
  default: vi.fn().mockImplementation((options: TranscriptionModeOptions): ITranscriptionMode => ({
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
  default: vi.fn().mockImplementation((): ITranscriptionMode => ({
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

describe('TranscriptionService', () => {
  let service: TranscriptionService;
  const mockOptions = {
    onTranscriptUpdate: vi.fn(),
    onModelLoadProgress: vi.fn(),
    onReady: vi.fn(),
    session: null,
    navigate: vi.fn(),
    getAssemblyAIToken: vi.fn().mockResolvedValue('mock-token'),
    policy: PROD_FREE_POLICY,
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

  it('should use CloudAssemblyAI for Pro policy', async () => {
    service = new TranscriptionService({
      ...mockOptions,
      policy: PROD_PRO_POLICY,
    });
    await service.init();
    await service.startTranscription();
    expect(service.getMode()).toBe('cloud');
  });

  it('should fallback to NativeBrowser if Cloud token fails', async () => {
    service = new TranscriptionService({
      ...mockOptions,
      policy: PROD_PRO_POLICY,
      getAssemblyAIToken: vi.fn().mockResolvedValue(null),
    });
    await service.init();
    await service.startTranscription();
    expect(service.getMode()).toBe('native');
  });

  it('should fallback to NativeBrowser if Private policy and model fails to load', async () => {
    // Force PrivateWhisper.init to fail by re-mocking with a failure implementation
    const { default: PrivateWhisperClass } = await import('../modes/PrivateWhisper');
    // Cast to Mock for mockImplementationOnce access
    const mockedClass = PrivateWhisperClass as unknown as Mock;
    mockedClass.mockImplementationOnce((): ITranscriptionMode => ({
      init: vi.fn().mockRejectedValue(new Error("Model load failed")),
      startTranscription: vi.fn().mockResolvedValue(undefined),
      stopTranscription: vi.fn().mockResolvedValue(""),
      getTranscript: vi.fn().mockResolvedValue(""),
    }));

    const privatePolicy: TranscriptionPolicy = { ...PROD_PRO_POLICY, preferredMode: 'private' };
    service = new TranscriptionService({
      ...mockOptions,
      policy: privatePolicy,
    });

    await service.init();
    await service.startTranscription();
    expect(service.getMode()).toBe('native');
  });

  it('should throw error if mic not initialized', async () => {
    await expect(service.startTranscription()).rejects.toThrow('Microphone not initialized');
  });

  it('should stop transcription after starting', async () => {
    await service.init();
    await service.startTranscription();
    const transcript = await service.stopTranscription();
    expect(typeof transcript).toBe('string');
  });
});