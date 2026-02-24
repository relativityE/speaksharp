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

    it('should prevent double-initialization during rapid start/stop/start cycles (Phase 1: Adversarial)', async () => {
        // Arrange
        const engine = new SuccessNativeEngine();
        testRegistry.register('native', () => engine);
        testRegistry.register('private', () => new SuccessNativeEngine()); // Dummy private

        // Make start take a bit
        engine.startTranscription.mockImplementation(() => new Promise(res => setTimeout(res, 20)));
        // Make terminate take a bit
        engine.terminate.mockImplementation(() => new Promise(res => setTimeout(res, 50)));

        service.updatePolicy({
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'test'
        });

        // Act & Assert

        // 1. Initial start
        const firstStart = service.startTranscription();
        expect(service.fsm.getState()).toBe('INITIALIZING_ENGINE');

        await vi.advanceTimersByTimeAsync(30);
        await firstStart;
        expect(service.fsm.getState()).toBe('RECORDING');

        // 2. Immediate destroy (entering CLEANING_UP)
        const destroyPromise = service.destroy();
        expect(service.fsm.getState()).toBe('CLEANING_UP');

        // 3. MALICIOUS: Immediate start while still cleaning up
        await service.startTranscription();

        // Should STILL be in cleaning up (rejected start)
        expect(service.fsm.getState()).toBe('CLEANING_UP');
        expect(engine.init).toHaveBeenCalledTimes(1); // Should NOT have been called a second time

        // 4. Let cleanup finish
        await vi.advanceTimersByTimeAsync(100);
        await destroyPromise;
        expect(service.fsm.getState()).toBe('IDLE');

        // 5. Normal start after termination should now work
        const secondStart = service.startTranscription();
        await vi.advanceTimersByTimeAsync(50);
        await secondStart;
        expect(service.fsm.getState()).toBe('RECORDING');
        expect(engine.init).toHaveBeenCalledTimes(2); // Second call now allowed
    });

    it('should maintain hardware resource balance (acquire/release) across cycles', async () => {
        // Arrange
        const engine = new SuccessNativeEngine();
        testRegistry.register('native', () => engine);

        const nativePolicy: TranscriptionPolicy = {
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'test'
        };

        // Act: Run through 3 cycles of start/stop
        for (let i = 0; i < 3; i++) {
            await service.startTranscription(nativePolicy);
            expect(service.fsm.getState()).toBe('RECORDING');

            // ✅ CRITICAL: Satisfy MIN_RECORDING_DURATION_MS = 100
            await vi.advanceTimersByTimeAsync(200);

            await service.stopTranscription();

            // Small tick to ensure FSM settled
            await vi.advanceTimersByTimeAsync(1);
            expect(service.fsm.getState()).toBe('READY'); // stopTranscription keeps mic hot
        }

        // Assert: 
        expect(engine.stopTranscription).toHaveBeenCalledTimes(3);

        // Final cleanup
        await service.destroy();
        expect(service.isServiceDestroyed()).toBe(true);
    });
});
