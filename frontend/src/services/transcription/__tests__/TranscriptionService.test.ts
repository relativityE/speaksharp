// Test the service layer instead of the problematic hook

import { describe, it, expect, vi, beforeEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { UserProfile } from '../../../types/user';

// Mock the modes
vi.mock('../modes/NativeBrowser');
vi.mock('../modes/CloudAssemblyAI');
vi.mock('../modes/LocalWhisper');
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

  // Add more focused service tests here
});