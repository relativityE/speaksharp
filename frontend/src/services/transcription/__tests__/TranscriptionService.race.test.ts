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

// Mock Instance with controllable termination delay
let terminateResolver: (() => void) | null = null;
const mockTerminate = vi.fn().mockImplementation(() => {
    return new Promise<void>((resolve) => {
        terminateResolver = resolve;
    });
});

const mockNativeInstance = {
    init: vi.fn(),
    startTranscription: vi.fn(),
    stopTranscription: vi.fn(),
    terminate: mockTerminate,
    getTranscript: vi.fn(),
};

vi.mock('../modes/NativeBrowser', () => ({
    default: vi.fn().mockImplementation(() => mockNativeInstance)
}));

describe('TranscriptionService - Race Conditions', () => {
    let service: TranscriptionService;

    beforeEach(() => {
        vi.clearAllMocks();
        terminateResolver = null;

        const policy: TranscriptionPolicy = {
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
            preferredMode: 'native',
            allowFallback: false,
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

    it('should handle concurrent destroy() calls gracefully (Double-Dispose Guard)', async () => {
        // Arrange
        await service.init();
        await service.startTranscription();

        expect(mockNativeInstance.startTranscription).toHaveBeenCalled();

        // Act: Simulate user mashing stop button (Concurrent calls)
        const p1 = service.destroy();
        const p2 = service.destroy();
        const p3 = service.destroy();

        // Allow the first termination to complete
        if (terminateResolver) terminateResolver();

        await Promise.all([p1, p2, p3]);

        // Assert
        // Should only have attempted to terminate the instance ONCE
        // The other calls should have early-returned or waited and seen it was null
        expect(mockTerminate).toHaveBeenCalledTimes(1);
    });

    it('should not throw if destroy called while initializing', async () => {
        // Arrange
        const initPromise = service.init();

        // Act
        await service.destroy();

        // Assert
        await expect(initPromise).resolves.not.toThrow();
        // Instance might not be set yet, or cleaned up immediately
    });
});
