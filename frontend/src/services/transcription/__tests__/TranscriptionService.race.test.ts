import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy, PROD_FREE_POLICY } from '../TranscriptionPolicy';
import { MicStream } from '../utils/types';
import { EngineFactory } from '../EngineFactory';
import { STTEngine } from '@/contracts/STTEngine';
import { Result, ITranscriptionEngine } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';

/**
 * @file TranscriptionService.race.test.ts
 * @description Verifies handling of race conditions during service lifecycle.
 */

// Mock dependencies
const mockOnTranscriptUpdate = vi.fn();
const mockOnModelLoadProgress = vi.fn();
const mockOnReady = vi.fn();
const mockOnStatusChange = vi.fn();
const mockOnModeChange = vi.fn();
const mockNavigate = vi.fn() as unknown as NavigateFunction;
const mockGetToken = vi.fn().mockResolvedValue('mock-token');

class SuccessNativeEngine extends STTEngine {
    public readonly type = 'native' as const;
    
    protected async onInit() { return Result.ok(undefined); }
    protected async onStart() {}
    protected async onStop() {}
    protected async onDestroy() {}
    async transcribe() { return Result.ok('test'); }

    // Race Test: Simulate slow termination
    terminate = vi.fn().mockImplementation(() => new Promise(res => setTimeout(res, 50)));

    public override async getTranscript() { return 'test'; }
}

describe('TranscriptionService - Race Conditions', () => {
    let service: TranscriptionService;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        const policy: TranscriptionPolicy = {
            ...PROD_FREE_POLICY,
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
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

    afterEach(async () => {
        if (service && !service.isServiceDestroyed()) {
            await service.destroy();
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should handle concurrent destroy() calls gracefully (Double-Dispose Guard)', async () => {
        // Arrange
        const engine = new SuccessNativeEngine();
        vi.spyOn(EngineFactory, 'create').mockResolvedValue(engine as unknown as ITranscriptionEngine);

        await service.startTranscription();

        // Spy on the engine's terminate method
        const terminateSpy = vi.spyOn(engine, 'terminate');

        // Act: Simulate user mashing stop button (Concurrent calls)
        const p1 = service.destroy();
        const p2 = service.destroy();
        const p3 = service.destroy();

        // Advance timers to allow the interval check in destroy() to proceed and termination to complete
        await vi.advanceTimersByTimeAsync(100);

        const results = await Promise.allSettled([p1, p2, p3]);

        // ✅ TEST BEHAVIOR: All calls should fulfill
        results.forEach(result => {
            expect(result.status).toBe('fulfilled');
        });

        // ✅ TEST IDEMPOTENCY: Terminate should be called EXACTLY ONCE
        expect(terminateSpy).toHaveBeenCalledTimes(1);

        // ✅ TEST STATE: Service should be DESTROYED
        expect(service.isServiceDestroyed()).toBe(true);
    });

    it('should not throw if destroy called while initializing', async () => {
        // Arrange: Start a new service where init takes a while
        const engine = new SuccessNativeEngine();
        const initPromiseResolves = new Promise(resolve => setTimeout(resolve, 50));
        vi.spyOn(engine, 'init').mockImplementation(() => initPromiseResolves as Promise<Result<void, Error>>);
        vi.spyOn(EngineFactory, 'create').mockResolvedValue(engine as unknown as ITranscriptionEngine);

        const freshService = new TranscriptionService({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            onStatusChange: mockOnStatusChange,
            onModeChange: mockOnModeChange,
            session: null,
            navigate: mockNavigate,
            getAssemblyAIToken: mockGetToken,
            policy: service.getPolicy(),
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                clone: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });

        const initPromise = freshService.init();

        // Act
        const destroyPromise = freshService.destroy();

        // Advance timers
        vi.advanceTimersByTime(100);

        // Assert
        await expect(initPromise).resolves.not.toThrow();
        await expect(destroyPromise).resolves.not.toThrow();
    });
});
