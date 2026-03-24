import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy, PROD_FREE_POLICY } from '../TranscriptionPolicy';
import { STTEngine } from '@/contracts/STTEngine';
import { Result } from '../modes/types';
import { MicStream } from '../utils/types';
import { testRegistry } from '../TestRegistry';



vi.mock('../utils/audioUtils', () => ({
    createMicStream: vi.fn().mockResolvedValue({
        stop: vi.fn(),
        onFrame: vi.fn(),
    }),
}));

describe('TranscriptionService - Max Attempts', () => {
    let service: TranscriptionService;
    const onStatusChange = vi.fn();

    class MockPrivateEngine extends STTEngine {
        public readonly type = 'whisper-turbo' as const;
        protected async onInit() { return Result.err(new Error('Persistent Fail')); }
        protected async onStart() {}
        protected async onStop() {}
        protected async onDestroy() {}
        async transcribe() { return Result.ok('test'); }

        public override async getTranscript() { return 'test'; }
    }

    class MockNativeEngine extends STTEngine {
        public readonly type = 'native' as const;
        protected async onInit() { return Result.ok(undefined); }
        protected async onStart() {}
        protected async onStop() {}
        protected async onDestroy() {}
        async transcribe() { return Result.ok('test'); }

        public override async getTranscript() { return 'test'; }
    }

    const privatePolicy: TranscriptionPolicy = {
        ...PROD_FREE_POLICY,
        allowNative: true,
        allowCloud: false,
        allowPrivate: true,
        preferredMode: 'private',
        allowFallback: true,
        executionIntent: 'test-max-attempts'
    };

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        testRegistry.clear();
        // FailureManager is now instance-bound to the service

        service = new TranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            onStatusChange,
            navigate: vi.fn(),
            getAssemblyAIToken: vi.fn(),
            session: null,
            policy: privatePolicy,
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
        testRegistry.clear();
        vi.useRealTimers();
    });

    it('should enforce Native fallback after max private attempts', async () => {
        const privateEngine = new MockPrivateEngine();
        testRegistry.register('private', () => privateEngine);
        testRegistry.register('native', () => new MockNativeEngine());

        const failureManager = service.getFailureManager();

        // 1. Force max attempts directly to ensure clean state
        for (let i = 0; i < 3; i++) {
            failureManager.recordPrivateFailure();
        }

        // 2. Prepare spy for validation
        const initSpy = vi.spyOn(privateEngine, 'init');
        initSpy.mockClear();
        onStatusChange.mockClear();

        // 3. Attempt transcription - Should NOT try Private, should Force Native directly
        // We re-apply the private policy to ensure mode resolution *starts* as private
        await service.startTranscription(privatePolicy);

        // EXPECTATIONS - Behavior-based
        // Should NOT have tried to init private engine again
        expect(initSpy).not.toHaveBeenCalled();

        // Should be in native mode
        expect(service.getMode()).toBe('native');

        // Should have emitted fallback status
        expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            type: 'fallback',
            newMode: 'native'
        }));
    });
});
