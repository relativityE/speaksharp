/**
 * @file TranscriptionService.zombie.test.ts
 * @description Verification test for zombie instance prevention in TranscriptionService
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavigateFunction } from 'react-router-dom';
import TranscriptionService, { TranscriptionServiceOptions } from '../TranscriptionService';
import { TranscriptionPolicy, PROD_FREE_POLICY } from '../TranscriptionPolicy';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result } from '../modes/types';
import { sttRegistry } from '../STTRegistry';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';
import { MicStream } from '../utils/types';
import { TranscriptionModeOptions } from '../modes/types';

import { setupStrictZero } from '../../../../../tests/setupStrictZero';

class MockEngine extends STTEngine {
    public override get type() { return this.name as EngineType; }
    public async checkAvailability() { return { isAvailable: true }; }

    constructor(private name: string, options?: TranscriptionModeOptions) {
        super(options);
    }

    protected async onInit() { return Result.ok(undefined); }
    protected async onStart() { return Promise.resolve(); }
    protected async onStop() { return Promise.resolve(); }
    protected async onDestroy() { return Promise.resolve(); }
    async transcribe() { return Result.ok('test'); }

    public override async getTranscript() { return 'test'; }
    public override getEngineType() { return this.name as EngineType; }

    terminate = vi.fn().mockImplementation(() => super.terminate());
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
            prepare: vi.fn().mockResolvedValue(undefined),
            start: vi.fn().mockResolvedValue(undefined),
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
        const instances = {
            assemblyai: new MockEngine('cloud'),
            'native-browser': new MockEngine('native'),
            'whisper-turbo': new MockEngine('private')
        };
        
        sttRegistry.register('assemblyai', (opts: TranscriptionModeOptions) => { instances.assemblyai = new MockEngine('cloud', opts); return instances.assemblyai; });
        sttRegistry.register('native-browser', (opts: TranscriptionModeOptions) => { instances['native-browser'] = new MockEngine('native', opts); return instances['native-browser']; });
        sttRegistry.register('whisper-turbo', (opts: TranscriptionModeOptions) => { instances['whisper-turbo'] = new MockEngine('transformers-js', opts); return instances['whisper-turbo']; });

        service = new TestTranscriptionService(mockOptions);
        // Start init with a valid mock environment already present
        await service.init();
    });

    afterEach(async () => {
        // ✅ Always clean up, even if test fails
        if (service && !service.isServiceDestroyed()) {
            await service.destroy();
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should terminate old instance before switching modes (Behavior-based)', async () => {
        // Arrange
        const cloudEngine = new MockEngine('cloud');
        sttRegistry.register('assemblyai', (opts: TranscriptionModeOptions) => { (cloudEngine as unknown as { options: TranscriptionModeOptions }).options = opts; return cloudEngine; });
        
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
        const cloudEngine = new MockEngine('cloud');
        sttRegistry.register('assemblyai', (opts: TranscriptionModeOptions) => { (cloudEngine as unknown as { options: TranscriptionModeOptions }).options = opts; return cloudEngine; });
        
        // Make terminate take some time
        cloudEngine.terminate.mockImplementation(() => new Promise(res => setTimeout(res, 50)));

        await service.triggerStartTranscription({ ...PROD_FREE_POLICY, allowCloud: true, allowPrivate: true, preferredMode: 'cloud' });
        expect(service.getState()).toBe('RECORDING');

        // RAPID DESTROY CALLS
        const p1 = service.destroy();
        const p2 = service.destroy();
        const p3 = service.destroy();

        // Advance timers to allow the mocked terminate promise to resolve
        await vi.advanceTimersByTimeAsync(100);

        await Promise.all([p1, p2, p3]);

        // Terminate should only be fully executed once, but concurrent promises resolve safely
        expect(cloudEngine.terminate).toHaveBeenCalled();
        expect(service.isServiceDestroyed()).toBe(true);
    });

    it('should be idempotent: additional destroy calls are safe', async () => {
        // Arrange
        const cloudEngine = new MockEngine('cloud');

        // 1. Inject into STTRegistry - share the same instance
        sttRegistry.register('assemblyai', (opts: TranscriptionModeOptions) => { (cloudEngine as unknown as { options: TranscriptionModeOptions }).options = opts; return cloudEngine; });

        await service.triggerStartTranscription({ ...mockOptions.policy!, preferredMode: 'cloud' });
        await service.destroy();

        expect(service.isServiceDestroyed()).toBe(true);

        // Call again
        await expect(service.destroy()).resolves.not.toThrow();
        expect(cloudEngine.terminate).toHaveBeenCalledTimes(1);
    });
});
