import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import { MicStream } from '../utils/types';
import { testRegistry } from '../TestRegistry';
import { ITranscriptionMode } from '../modes/types';

// Mock dependencies
const mockOnTranscriptUpdate = vi.fn();
const mockOnModelLoadProgress = vi.fn();
const mockOnReady = vi.fn();
const mockOnStatusChange = vi.fn();
const mockOnModeChange = vi.fn();
const mockNavigate = vi.fn();
const mockGetToken = vi.fn().mockResolvedValue('mock-token');

class SuccessNativeEngine implements ITranscriptionMode {
    init = vi.fn().mockResolvedValue(undefined);
    startTranscription = vi.fn().mockResolvedValue(undefined);
    stopTranscription = vi.fn().mockResolvedValue('test');
    getTranscript = vi.fn().mockResolvedValue('test');
    terminate = vi.fn().mockResolvedValue(undefined);
    getEngineType = () => 'native' as const;
}

class FailingPrivateEngine implements ITranscriptionMode {
    init = vi.fn().mockRejectedValue(new Error('Init failed'));
    startTranscription = vi.fn().mockResolvedValue(undefined);
    stopTranscription = vi.fn().mockResolvedValue('');
    getTranscript = vi.fn().mockResolvedValue('');
    terminate = vi.fn().mockResolvedValue(undefined);
    getEngineType = () => 'whisper-turbo' as const;
}

describe('TranscriptionService', () => {
    let service: TranscriptionService;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        testRegistry.clear();

        // Default policy
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
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });

        await service.init();
    });

    afterEach(() => {
        testRegistry.clear();
        vi.useRealTimers();
    });

    it('should emit fallback status with newMode when falling back', async () => {
        // Arrange
        testRegistry.register('private', () => new FailingPrivateEngine());
        testRegistry.register('native', () => new SuccessNativeEngine());

        // Act
        const promise = service.startTranscription();
        await vi.advanceTimersByTimeAsync(100);
        await promise;

        // Assert
        expect(mockOnStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            type: 'fallback',
            message: expect.stringContaining('Falling back to Native browser mode'),
            newMode: 'native'
        }));

        expect(service.getMode()).toBe('native');
    });

    it('should call terminate() on destroy', async () => {
        // Arrange
        const engine = new SuccessNativeEngine();
        testRegistry.register('native', () => engine);

        // Force native mode for this test to avoid fallback complexity
        service.updatePolicy({
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'test-native'
        });

        await service.startTranscription();

        // Act
        await service.destroy();

        // Assert
        expect(engine.terminate).toHaveBeenCalled();
    });

    it('should release the microphone IMMEDIATELY on destroy', async () => {
        // Arrange
        const mockMicStop = vi.fn();
        const engine = new SuccessNativeEngine();
        testRegistry.register('native', () => engine);

        // Make terminate take a while
        engine.terminate.mockImplementation(() => new Promise(res => setTimeout(res, 50)));

        const fastService = new TranscriptionService({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            onStatusChange: mockOnStatusChange,
            onModeChange: mockOnModeChange,
            session: null,
            navigate: mockNavigate,
            getAssemblyAIToken: mockGetToken,
            policy: {
                allowNative: true,
                allowCloud: false,
                allowPrivate: true,
                preferredMode: 'native',
                allowFallback: true,
                executionIntent: 'test'
            },
            mockMic: {
                stream: {} as MediaStream,
                stop: mockMicStop,
                clone: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });

        await fastService.init();
        await fastService.startTranscription();

        // Act
        const destroyPromise = fastService.destroy();

        // Assert: Mic should be stopped IMMEDIATELY (sync/microtask), before destroy completes
        expect(mockMicStop).toHaveBeenCalled();

        vi.advanceTimersByTime(100);
        await destroyPromise;
    });

    it('should reject startTranscription if in CLEANING_UP state', async () => {
        // Arrange
        const engine = new SuccessNativeEngine();
        testRegistry.register('native', () => engine);

        // Make terminate take a while so we stay in CLEANING_UP
        engine.terminate.mockImplementation(() => new Promise(res => setTimeout(res, 100)));

        service.updatePolicy({
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'test'
        });

        await service.startTranscription();
        expect(service.fsm.getState()).toBe('RECORDING');

        // Start destroy but don't await yet
        const destroyPromise = service.destroy();

        // Assert: should be in CLEANING_UP
        expect(service.fsm.getState()).toBe('CLEANING_UP');

        // Act
        await service.startTranscription();

        // Assert: engine should not be re-initialized (still 1 call from initial start)
        expect(engine.init).toHaveBeenCalledTimes(1);

        // Cleanup
        vi.advanceTimersByTime(200);
        await destroyPromise;
    });
});
