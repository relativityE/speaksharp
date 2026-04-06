/**
 * @file TranscriptionService.zombie.test.ts
 * @description Verification test for zombie instance prevention in TranscriptionService
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavigateFunction } from 'react-router-dom';
import TranscriptionService, { TranscriptionServiceOptions } from '../TranscriptionService';
import { TranscriptionPolicy, PROD_FREE_POLICY } from '../TranscriptionPolicy';
import { STTEngine } from '@/contracts/STTEngine';
import { Result } from '../modes/types';
import { EngineType } from '@/contracts/IPrivateSTTEngine';
import { MicStream } from '../utils/types';

import { setupStrictZero } from '../../../../../tests/setupStrictZero';

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
    // Explicitly override to satisfy the test's getTranscript() expectation if any
    public override async getTranscript() { return ''; }
}

// Testable subclass to expose protected methods if needed
class TestTranscriptionService extends TranscriptionService {
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
        navigate: vi.fn() as unknown as NavigateFunction,
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
        
        // 1. Setup T=0 Environment
        await setupStrictZero();

        // 2. Inject core mock engines so that beforeEach init() bypasses checkAvailability
        const win = window as unknown as { __SS_E2E__: { registry: Record<string, unknown>, instances: Record<string, MockEngine> } };
        win.__SS_E2E__.instances = {
            assemblyai: new MockEngine('cloud'),
            'native-browser': new MockEngine('native'),
            'whisper-turbo': new MockEngine('private')
        };
        win.__SS_E2E__.registry = {
            ...(win.__SS_E2E__.registry || {}),
            assemblyai: () => win.__SS_E2E__.instances.assemblyai,
            'native-browser': () => win.__SS_E2E__.instances['native-browser'],
            'whisper-turbo': () => win.__SS_E2E__.instances['whisper-turbo']
        };

        service = new TestTranscriptionService(mockOptions);
        // Start init with a valid mock environment already present
        await service.init();
    });

    afterEach(async () => {
        // ✅ Always clean up, even if test fails
        if (service && !service.isServiceDestroyed()) {
            const destroyPromise = service.destroy();
            // Advance timers to allow any mocked timeouts (like in terminate) to resolve
            await vi.advanceTimersByTimeAsync(1000);
            await destroyPromise;
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should terminate old instance before switching modes (Behavior-based)', async () => {
        // Arrange
        // The cloud engine and private engine mocks are already registered in beforeEach
        const cloudEngine = (window as unknown as { __SS_E2E__: { instances: Record<string, any> } }).__SS_E2E__.instances['assemblyai'];
        // Spies on the newly created Cloud mock 
        const cloudSpy = vi.spyOn(cloudEngine, 'terminate');

        // 1. Initialize Cloud mode
        await service.triggerStartTranscription({ ...mockOptions.policy!, preferredMode: 'cloud' });
        expect(service.getState()).toBe('RECORDING');

        // 2. Initialize Private mode (should trigger terminate on cloud)
        await service.triggerStartTranscription({ ...mockOptions.policy!, preferredMode: 'private' });

        // ASSERT BEHAVIOR: Old instance terminated
        expect(cloudSpy).toHaveBeenCalled();
        expect(service.getMode()).toBe('private');
    });

    it('should handle concurrent terminate calls gracefully (Behavior-based)', async () => {
        // Arrange
        // The cloud engine is already registered in beforeEach. Let's get it and mock its terminate.
        const win = window as unknown as { __SS_E2E__: { instances: Record<string, any> } };
        const cloudEngine = win.__SS_E2E__.instances['assemblyai'];
        // Make terminate take some time
        cloudEngine.terminate.mockImplementation(() => new Promise(res => setTimeout(res, 50)));

        await service.triggerStartTranscription({ ...mockOptions.policy!, preferredMode: 'cloud' });
        expect(service.getState()).toBe('RECORDING');

        // RAPID DESTROY CALLS
        const p1 = service.destroy();
        const p2 = service.destroy();
        const p3 = service.destroy();

        await Promise.all([p1, p2, p3]);

        // Terminate should only be fully executed once, but concurrent promises resolve safely
        expect(cloudEngine.terminate).toHaveBeenCalled();
        expect(service.isServiceDestroyed()).toBe(true);
    });

    it('should be idempotent: additional destroy calls are safe', async () => {
        // Arrange
        const cloudEngine = new MockEngine('cloud');

        // 1. Inject into TestRegistry
        const e2eBridge = (window as unknown as { __SS_E2E__: { registry: Record<string, () => STTEngine> } }).__SS_E2E__;
        e2eBridge.registry = {
            assemblyai: () => cloudEngine
        };

        await service.triggerStartTranscription({ ...mockOptions.policy!, preferredMode: 'cloud' });
        await service.destroy();

        expect(service.isServiceDestroyed()).toBe(true);

        // Call again
        await expect(service.destroy()).resolves.not.toThrow();
        expect(cloudEngine.terminate).toHaveBeenCalledTimes(1);
    });
});
