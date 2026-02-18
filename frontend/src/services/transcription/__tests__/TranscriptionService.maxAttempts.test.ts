import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy, PROD_FREE_POLICY } from '../TranscriptionPolicy';
import { ITranscriptionMode } from '../modes/types';
import { MicStream } from '../utils/types';
import { testRegistry } from '../TestRegistry';
import { FailureManager } from '../FailureManager';

// Mock dependencies
vi.mock('../../lib/logger', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../utils/audioUtils', () => ({
    createMicStream: vi.fn().mockResolvedValue({
        stop: vi.fn(),
        onFrame: vi.fn(),
    }),
}));

describe('TranscriptionService - Max Attempts', () => {
    let service: TranscriptionService;
    const onStatusChange = vi.fn();

    class MockPrivateEngine implements ITranscriptionMode {
        init = vi.fn().mockRejectedValue(new Error('Persistent Fail'));
        startTranscription = vi.fn().mockResolvedValue(undefined);
        stopTranscription = vi.fn().mockResolvedValue('test');
        getTranscript = vi.fn().mockResolvedValue('test');
        terminate = vi.fn().mockResolvedValue(undefined);
        getEngineType = () => 'whisper-turbo' as const;
    }

    class MockNativeEngine implements ITranscriptionMode {
        init = vi.fn().mockResolvedValue(undefined);
        startTranscription = vi.fn().mockResolvedValue(undefined);
        stopTranscription = vi.fn().mockResolvedValue('test');
        getTranscript = vi.fn().mockResolvedValue('test');
        terminate = vi.fn().mockResolvedValue(undefined);
        getEngineType = () => 'native' as const;
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
        FailureManager.getInstance().resetFailureCount();

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

        // 1. First Attempt - Fails
        try {
            const promise = service.startTranscription();
            await vi.advanceTimersByTimeAsync(500);
            await promise;
        } catch (e) { /* ignore fallback errors */ }

        await service.stopTranscription();

        // 2. Second Attempt - Fails
        try {
            const promise = service.startTranscription();
            await vi.advanceTimersByTimeAsync(500);
            await promise;
        } catch (e) { /* ignore fallback errors */ }

        await service.stopTranscription();

        // 3. Third Attempt - Fails
        try {
            const promise = service.startTranscription();
            await vi.advanceTimersByTimeAsync(500);
            await promise;
        } catch (e) { /* ignore fallback errors */ }

        await service.stopTranscription();

        // Reset mocks to clear previous calls
        privateEngine.init.mockClear();
        onStatusChange.mockClear();

        // 4. Fourth Attempt - Should NOT try Private, should Force Native directly
        // The max attempts is 3 (default), so 4th attempt should be blocked
        await service.startTranscription();

        // EXPECTATIONS - Behavior-based
        // Should NOT have tried to init private engine again
        expect(privateEngine.init).not.toHaveBeenCalled();

        // Should be in native mode
        expect(service.getMode()).toBe('native');

        // Should have emitted fallback status
        expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            type: 'fallback',
            newMode: 'native'
        }));
    });
});
