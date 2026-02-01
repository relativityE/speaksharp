import { describe, it, expect, vi, beforeEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import { MicStream } from '../utils/types';

// Mock dependencies
const mockOnTranscriptUpdate = vi.fn();
const mockOnModelLoadProgress = vi.fn();
const mockOnReady = vi.fn();
const mockOnStatusChange = vi.fn();
const mockOnModeChange = vi.fn();
const mockNavigate = vi.fn();
const mockGetToken = vi.fn().mockResolvedValue('mock-token');

// Mock NativeBrowser mode
const mockNativeInstance = {
    init: vi.fn(),
    startTranscription: vi.fn(),
    stopTranscription: vi.fn(),
    terminate: vi.fn(), // Include terminate for testing
    getTranscript: vi.fn(),
};

// Mock PrivateSTT mode
const mockPrivateInstance = {
    init: vi.fn(),
    startTranscription: vi.fn(),
    stopTranscription: vi.fn(),
    terminate: vi.fn(),
    getTranscript: vi.fn(),
};

vi.mock('../modes/NativeBrowser', () => ({
    default: vi.fn().mockImplementation(() => mockNativeInstance)
}));

vi.mock('../modes/PrivateWhisper', () => ({
    default: vi.fn().mockImplementation(() => mockPrivateInstance)
}));

describe('TranscriptionService', () => {
    let service: TranscriptionService;

    beforeEach(() => {
        vi.clearAllMocks();
        // Default policy allowing everything for testing
        const policy: TranscriptionPolicy = {
            allowNative: true,
            allowCloud: false,
            allowPrivate: true,
            preferredMode: 'private',
            allowFallback: true,
            executionIntent: 'test'
        };

        service = new TranscriptionService({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            onStatusChange: mockOnStatusChange,
            onModeChange: mockOnModeChange,
            session: null,
            navigate: mockNavigate,
            getAssemblyAIToken: mockGetToken,
            policy,
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                clone: vi.fn(),
            } as unknown as MicStream
        });
    });

    it('should emit fallback status with newMode when falling back', async () => {
        // Arrange: Make Private STT fail
        mockPrivateInstance.init.mockRejectedValueOnce(new Error('Init failed'));
        // Make Native succeed
        mockNativeInstance.init.mockResolvedValueOnce(undefined);

        // Act
        await service.init();
        await service.startTranscription();

        // Assert
        // Check finding: Verify we received the 'fallback' status with 'newMode: native'
        expect(mockOnStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            type: 'fallback',
            message: expect.stringContaining('Switched to Native Browser mode'),
            newMode: 'native' // THIS IS THE KEY FIX WE ARE VERIFYING
        }));

        // Verify it actually switched
        expect(mockOnModeChange).toHaveBeenCalledWith('native');
    });

    it('should call terminate() on destroy if available', async () => {
        // Arrange
        // Force service into a mode
        mockPrivateInstance.init.mockResolvedValueOnce(undefined);
        await service.init();
        await service.startTranscription();

        // Act
        await service.destroy();

        // Assert
        expect(mockPrivateInstance.terminate).toHaveBeenCalled();
    });

    it('should fall back to stopTranscription() on destroy if terminate is missing', async () => {
        // Arrange
        const legacyInstance = { ...mockPrivateInstance, terminate: undefined };


        const PrivateWhisperMock = await import('../modes/PrivateWhisper');
        // @ts-expect-error - overriding read-only mock for testing
        PrivateWhisperMock.default.mockImplementationOnce(() => legacyInstance as unknown as typeof mockPrivateInstance);

        await service.init();
        await service.startTranscription();

        // Act
        await service.destroy();

        // Assert
        expect(legacyInstance.stopTranscription).toHaveBeenCalled();
    });

    it('should release the microphone IMMEDIATELY on destroy', async () => {
        // Arrange
        const mockMicStop = vi.fn();
        const policy: TranscriptionPolicy = {
            allowNative: true,
            allowCloud: false,
            allowPrivate: true,
            preferredMode: 'native',
            allowFallback: true,
            executionIntent: 'test'
        };

        const fastService = new TranscriptionService({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            onStatusChange: mockOnStatusChange,
            onModeChange: mockOnModeChange,
            session: null,
            navigate: mockNavigate,
            getAssemblyAIToken: mockGetToken,
            policy,
            mockMic: {
                stream: {} as MediaStream,
                stop: mockMicStop,
                clone: vi.fn(),
            } as unknown as MicStream
        });

        // Setup engine that takes a while to terminate
        mockNativeInstance.init.mockResolvedValueOnce(undefined);
        mockNativeInstance.terminate.mockImplementation(() => new Promise(res => setTimeout(res, 50)));

        await fastService.init();
        await fastService.startTranscription();

        // Act
        const destroyPromise = fastService.destroy();

        // Assert: Mic should be stopped IMMEDIATELY (sync/microtask), before destroy completes
        expect(mockMicStop).toHaveBeenCalled();

        await destroyPromise;
    });
});
