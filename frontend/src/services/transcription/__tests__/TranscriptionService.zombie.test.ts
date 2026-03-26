/**
 * @file TranscriptionService.zombie.test.ts
 * @description Verification test for zombie instance prevention in TranscriptionService
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService, { TranscriptionServiceOptions } from '../TranscriptionService';
import { TranscriptionPolicy, PROD_FREE_POLICY } from '../TranscriptionPolicy';
import { STTEngine } from '@/contracts/STTEngine';
import { Result } from '../modes/types';
import { EngineType } from '@/contracts/IPrivateSTTEngine';
import { EngineFactory } from '../EngineFactory';
import { MicStream } from '../utils/types';

class MockEngine extends STTEngine {
    constructor(private name: string) {
        super();
    }
    public get type(): EngineType { return this.name as EngineType; }

    onInit = vi.fn().mockResolvedValue(Result.ok(undefined));
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn().mockResolvedValue(Result.ok(''));

    terminate = vi.fn().mockResolvedValue(undefined);
}

// Testable subclass to expose protected methods if needed
class TestTranscriptionService extends TranscriptionService {
    public getEngineInstance() { return this.engine; }
    public async triggerStartTranscription(runtimePolicy: TranscriptionPolicy) {
        return this.startTranscription(runtimePolicy);
    }
}

describe('TranscriptionService - Zombie Prevention', () => {
    let service: TestTranscriptionService;

    // Base options with valid policy
    const mockOptions: TranscriptionServiceOptions = {
        onTranscriptUpdate: vi.fn(),
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn(),
        session: null,
        navigate: vi.fn(),
        getAssemblyAIToken: vi.fn().mockResolvedValue('mock-token'),
        onModeChange: vi.fn(),
        onStatusChange: vi.fn(),
        mockMic: {
            stream: {} as MediaStream,
            stop: vi.fn(),
            clone: vi.fn(),
            onFrame: vi.fn().mockReturnValue(() => { }),
        } as unknown as MicStream,
        policy: {
            ...PROD_FREE_POLICY,
            allowNative: true,
            allowCloud: true,
            allowPrivate: true,
            preferredMode: 'native'
        }
    };

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        service = new TestTranscriptionService(mockOptions);
        await service.init();
    });

    afterEach(async () => {
        // ✅ Always clean up, even if test fails
        if (service && !service.isServiceDestroyed()) {
            await service.destroy();
        }
        vi.useRealTimers();
    });

    it('should terminate old instance before switching modes (Behavior-based)', async () => {
        // Arrange
        const cloudEngine = new MockEngine('cloud');
        const privateEngine = new MockEngine('private');
        // 1. Mock the EngineFactory to return our specific mock instances
        vi.spyOn(EngineFactory, 'create').mockImplementation(async (mode) => {
            if (mode === 'cloud') return cloudEngine;
            if (mode === 'private') return privateEngine;
            throw new Error(`Unexpected mode: ${mode}`);
        });

        // 1. Initialize Cloud mode
        // Note: Using a valid policy with preferredMode passed in
        await service.triggerStartTranscription({ ...mockOptions.policy!, preferredMode: 'cloud' });
        expect(service.getEngineInstance()).toBe(cloudEngine);
        expect(service.getState()).toBe('RECORDING');

        // 2. Initialize Private mode (should trigger terminate on cloud)
        await service.triggerStartTranscription({ ...mockOptions.policy!, preferredMode: 'private' });

        // ASSERT BEHAVIOR: Old instance terminated, new instance set
        expect(cloudEngine.terminate).toHaveBeenCalled();
        expect(service.getEngineInstance()?.getEngineType()).toBe('private');
    });

    it('should handle concurrent terminate calls gracefully (Behavior-based)', async () => {
        // Arrange
        const cloudEngine = new MockEngine('cloud');
        // Make terminate take some time
        cloudEngine.terminate.mockImplementation(() => new Promise(res => setTimeout(res, 50)));
        
        vi.spyOn(EngineFactory, 'create').mockResolvedValue(cloudEngine);

        await service.triggerStartTranscription({ ...mockOptions.policy!, preferredMode: 'cloud' });
        expect(service.getEngineInstance()).toBe(cloudEngine);

        // RAPID DESTROY CALLS
        const p1 = service.destroy();
        const p2 = service.destroy();
        const p3 = service.destroy();

        await vi.advanceTimersByTimeAsync(100);
        const results = await Promise.allSettled([p1, p2, p3]);

        // ✅ TEST BEHAVIOR: All calls should fulfill
        results.forEach(result => {
            expect(result.status).toBe('fulfilled');
        });

        // ✅ TEST STATE: Service should be IDLE and instance nulled
        expect(service.isServiceDestroyed()).toBe(true);
        expect(service.getEngineInstance()).toBeNull();
    });

    it('should be idempotent: additional destroy calls are safe', async () => {
        // Arrange
        const cloudEngine = new MockEngine('cloud');

        vi.spyOn(EngineFactory, 'create').mockResolvedValue(cloudEngine);

        await service.triggerStartTranscription({ ...mockOptions.policy!, preferredMode: 'cloud' });
        await service.destroy();

        expect(service.getEngineInstance()).toBeNull();
        expect(service.isServiceDestroyed()).toBe(true);

        // Call again
        await expect(service.destroy()).resolves.not.toThrow();
        expect(service.getEngineInstance()).toBeNull();
    });
});
