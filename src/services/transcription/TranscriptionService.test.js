import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from './TranscriptionService';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
import { createMicStream } from './utils/audioUtils';

// Mock the dependencies
vi.mock('./modes/CloudAssemblyAI');
vi.mock('./modes/NativeBrowser');
vi.mock('./utils/audioUtils');

describe('TranscriptionService', () => {
  let service;
  const mockOnTranscriptUpdate = vi.fn();
  const mockMicStream = { stop: vi.fn() };

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
      // Arrange: Cloud mode succeeds
      const mockCloudInstance = {
        init: vi.fn().mockResolvedValue(),
        startTranscription: vi.fn().mockResolvedValue(),
        stopTranscription: vi.fn().mockResolvedValue('cloud transcript'),
      };
      CloudAssemblyAI.mockImplementation(() => mockCloudInstance);

      // We don't need a NativeBrowser mock here, but let's prevent it from being called.
      NativeBrowser.mockImplementation(() => {
        throw new Error('NativeBrowser should not be instantiated in this test');
      });

      service = new TranscriptionService({ onTranscriptUpdate: mockOnTranscriptUpdate });
      await service.init(); // Init the mic

      // Act
      await service.startTranscription();

      // Assert
      expect(CloudAssemblyAI).toHaveBeenCalledTimes(1);
      expect(mockCloudInstance.startTranscription).toHaveBeenCalledWith(mockMicStream);
      expect(NativeBrowser).not.toHaveBeenCalled();
      expect(service.mode).toBe('cloud');
    });

    it('should fall back to NativeBrowser when CloudAssemblyAI fails to initialize', async () => {
      // Arrange: Cloud mode fails
      const cloudError = new Error('Cloud AI initialization failed');
      const mockFailedCloudInstance = {
        init: vi.fn().mockRejectedValue(cloudError),
        startTranscription: vi.fn(),
        destroy: vi.fn(),
      };
      CloudAssemblyAI.mockImplementation(() => mockFailedCloudInstance);

      // Arrange: Native mode succeeds
      const mockNativeInstance = {
        init: vi.fn().mockResolvedValue(),
        startTranscription: vi.fn().mockResolvedValue(),
        destroy: vi.fn(),
      };
      NativeBrowser.mockImplementation(() => mockNativeInstance);

      service = new TranscriptionService({ onTranscriptUpdate: mockOnTranscriptUpdate });
      await service.init();

      // Act
      await service.startTranscription();

      // Assert
      expect(CloudAssemblyAI).toHaveBeenCalledTimes(1);
      expect(NativeBrowser).toHaveBeenCalledTimes(1);
      expect(mockNativeInstance.startTranscription).toHaveBeenCalledWith(mockMicStream);
      expect(service.mode).toBe('native');
      expect(mockFailedCloudInstance.destroy).toHaveBeenCalledTimes(1);
    });

    it('should throw an error if both Cloud and Native modes fail', async () => {
        // Arrange: Both modes fail
        const cloudError = new Error('Cloud AI failed');
        CloudAssemblyAI.mockImplementation(() => ({
            init: vi.fn().mockRejectedValue(cloudError),
            destroy: vi.fn(),
        }));

        const nativeError = new Error('Native fallback failed');
        NativeBrowser.mockImplementation(() => ({
            init: vi.fn().mockRejectedValue(nativeError),
            destroy: vi.fn(),
        }));

        service = new TranscriptionService({ onTranscriptUpdate: mockOnTranscriptUpdate });
        await service.init();

        // Act & Assert
        await expect(service.startTranscription()).rejects.toThrow(nativeError);
        expect(service.mode).toBe(null); // Mode should not be set
    });
  });
});
