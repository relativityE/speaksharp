import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1. Hoist the vi.mock calls.
vi.mock('./modes/CloudAssemblyAI');
vi.mock('./modes/NativeBrowser');

// [JULES] Mock the audioUtils module with a factory to handle the new dynamic import architecture.
vi.mock('./utils/audioUtils', () => ({
  createMicStream: vi.fn(),
}));

// 2. Import everything needed for the tests AFTER the hoist.
import TranscriptionService from './TranscriptionService';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
import { createMicStream } from './utils/audioUtils';

describe('TranscriptionService', () => {
  let service;
  const mockOnTranscriptUpdate = vi.fn();
  const mockMicStream = { stop: vi.fn(), on: vi.fn(), removeListener: vi.fn() };

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    createMicStream.mockResolvedValue(mockMicStream);
  });

  afterEach(async () => {
    if (service) {
      await service.destroy();
    }
  });

  describe('Cloud-First, Native-Fallback Logic', () => {
    it('should use CloudAssemblyAI when it initializes successfully', async () => {
      // Arrange
      const mockCloudInstance = {
        init: vi.fn().mockResolvedValue(),
        startTranscription: vi.fn().mockResolvedValue(),
        destroy: vi.fn(),
      };
      CloudAssemblyAI.mockImplementation(() => mockCloudInstance);
      NativeBrowser.mockImplementation(() => { throw new Error('Should not be called'); });

      service = new TranscriptionService({ onTranscriptUpdate: mockOnTranscriptUpdate });
      await service.init();
      await service.startTranscription();

      // Assert
      expect(CloudAssemblyAI).toHaveBeenCalledTimes(1);
      expect(mockCloudInstance.startTranscription).toHaveBeenCalledWith(mockMicStream);
      expect(service.mode).toBe('cloud');
    });

    it('should fall back to NativeBrowser when CloudAssemblyAI fails to initialize', async () => {
      // Arrange
      const mockFailedCloudInstance = {
        init: vi.fn().mockRejectedValue(new Error('Cloud AI failed')),
        destroy: vi.fn(),
      };
      CloudAssemblyAI.mockImplementation(() => mockFailedCloudInstance);

      const mockNativeInstance = {
        init: vi.fn().mockResolvedValue(),
        startTranscription: vi.fn().mockResolvedValue(),
        destroy: vi.fn(),
      };
      NativeBrowser.mockImplementation(() => mockNativeInstance);

      service = new TranscriptionService({ onTranscriptUpdate: mockOnTranscriptUpdate });
      await service.init();
      await service.startTranscription();

      // Assert
      expect(NativeBrowser).toHaveBeenCalledTimes(1);
      expect(mockNativeInstance.startTranscription).toHaveBeenCalledWith(mockMicStream);
      expect(service.mode).toBe('native');
    });

    it('should throw an error if both Cloud and Native modes fail', async () => {
        // Arrange
        CloudAssemblyAI.mockImplementation(() => ({
            init: vi.fn().mockRejectedValue(new Error('Cloud AI failed')),
            destroy: vi.fn(),
        }));
        NativeBrowser.mockImplementation(() => ({
            init: vi.fn().mockRejectedValue(new Error('Native fallback failed')),
            destroy: vi.fn(),
        }));

        service = new TranscriptionService({ onTranscriptUpdate: mockOnTranscriptUpdate });
        await service.init();

        // Act & Assert
        await expect(service.startTranscription()).rejects.toThrow('Native fallback failed');
        expect(service.mode).toBe(null);
    });
  });
});
