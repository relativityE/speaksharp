import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import { MicStream } from '../utils/types';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';
import { sttRegistry } from '@/services/transcription/STTRegistry';

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

class MockRaceEngine extends STTEngine {
    public readonly type = 'whisper-turbo' as const;
    
    protected async onInit() { return Result.ok(undefined); }
    protected async onStart() {}
    protected async onStop() {}
    protected async onDestroy() {}
    async transcribe() { return Result.ok('test'); }

    // Race Test: Simulate slow termination
    terminate = vi.fn().mockImplementation(() => new Promise(res => setTimeout(res, 50)));

    public override async getTranscript() { return 'test'; }
}

import { setupStrictZero } from '../../../../../tests/setupStrictZero';

vi.mock('../ModelManager', () => ({
    ModelManager: {
        isModelDownloaded: vi.fn().mockResolvedValue(true),
        getModelSizeMB: vi.fn().mockReturnValue(100)
    }
}));

describe('TranscriptionService - Race Conditions', () => {
    let service: TranscriptionService;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        // 1. Setup T=0 Environment
        await setupStrictZero();
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
        const engine = new MockRaceEngine();
        
        await setupStrictZero();
        sttRegistry.register('whisper-turbo', () => engine);
        sttRegistry.register('transformers-js', () => engine);
        sttRegistry.register('mock', () => engine);

        const policy: TranscriptionPolicy = {
            allowCloud: false,
            allowPrivate: true,
            allowNative: false,
            allowFallback: false,
            preferredMode: 'private',
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
                prepare: vi.fn().mockResolvedValue(undefined),
                clone: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });

        await service.init();

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
        const engine = new MockRaceEngine();
        const initPromiseResolves = new Promise(resolve => setTimeout(resolve, 50));
        vi.spyOn(engine, 'init').mockImplementation(() => initPromiseResolves as Promise<Result<void, Error>>);
        
        // 1. Inject into STTRegistry
        await setupStrictZero();
        sttRegistry.register('whisper-turbo', () => engine);
        
        vi.stubGlobal('navigator', {
            gpu: {},
            permissions: { query: vi.fn().mockResolvedValue({ state: 'granted' }) }
        });

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
        await vi.advanceTimersByTimeAsync(100);

        // Assert
        await expect(initPromise).resolves.not.toThrow();
        await expect(destroyPromise).resolves.not.toThrow();
    });
});
