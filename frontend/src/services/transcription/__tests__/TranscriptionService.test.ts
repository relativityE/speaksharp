import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import { MicStream } from '../utils/types';
import { testRegistry } from '../TestRegistry';
import { ITranscriptionMode, TranscriptionModeOptions } from '../modes/types';

// Mock dependencies
const mockOnTranscriptUpdate = vi.fn();
const mockOnModelLoadProgress = vi.fn();
const mockOnReady = vi.fn();
const mockOnStatusChange = vi.fn();
const mockOnModeChange = vi.fn();
const mockNavigate = vi.fn();
const mockGetToken = vi.fn().mockResolvedValue('mock-token');

class SuccessNativeEngine implements ITranscriptionMode {
    public updateCb?: (upd: { transcript: { final: string, partial: string } }) => void;

    constructor(options?: TranscriptionModeOptions) {
        if (options?.onTranscriptUpdate) {
            this.updateCb = options.onTranscriptUpdate;
        }
    }

    init = vi.fn().mockImplementation((opts) => {
        if (opts?.onTranscriptUpdate) this.updateCb = opts.onTranscriptUpdate;
        return Promise.resolve();
    });

    startTranscription = vi.fn().mockImplementation((opts) => {
        if (opts?.onTranscriptUpdate) this.updateCb = opts.onTranscriptUpdate;
        return Promise.resolve();
    });

    stopTranscription = vi.fn().mockResolvedValue('test');
    getTranscript = vi.fn().mockResolvedValue('test');
    terminate = vi.fn().mockResolvedValue(undefined);
    getEngineType = () => 'native' as const;

    simulateUpdate(final: string, partial: string) {
        if (!this.updateCb) {
            throw new Error('SUCCESS_NATIVE_ENGINE: No update callback registered!');
        }
        this.updateCb({
            transcript: { final, partial }
        });
    }
}

class FailingPrivateEngine implements ITranscriptionMode {
    constructor(private errorMsg: string) { }
    init = vi.fn().mockImplementation(() => Promise.reject(new Error(this.errorMsg)));
    startTranscription = vi.fn().mockResolvedValue(undefined);
    stopTranscription = vi.fn().mockResolvedValue('');
    getTranscript = vi.fn().mockResolvedValue('');
    terminate = vi.fn().mockResolvedValue(undefined);
    getEngineType = () => 'whisper-turbo' as const;
}

describe('TranscriptionService', () => {
    let service: TranscriptionService;

    const basePolicy: TranscriptionPolicy = {
        allowNative: true,
        allowCloud: false,
        allowPrivate: true,
        preferredMode: 'private',
        allowFallback: true,
        executionIntent: 'test'
    };

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        testRegistry.clear();

        // Default success engines - factories must accept opts
        testRegistry.register('native', (opts: TranscriptionModeOptions | undefined) => new SuccessNativeEngine(opts));
        testRegistry.register('private', (opts: TranscriptionModeOptions | undefined) => new SuccessNativeEngine(opts));

        service = new TranscriptionService({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            onStatusChange: mockOnStatusChange,
            onModeChange: mockOnModeChange,
            session: null,
            navigate: mockNavigate,
            getAssemblyAIToken: mockGetToken,
            policy: { ...basePolicy },
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                clone: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });
    });

    afterEach(() => {
        testRegistry.clear();
        vi.useRealTimers();
    });

    it('should emit fallback status when implementation fails', async () => {
        testRegistry.register('private', () => new FailingPrivateEngine('GPU_CRASH'));

        await service.init();
        await service.startTranscription();
        await vi.runAllTicks();

        expect(mockOnStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            type: 'fallback',
            message: 'Falling back to Native browser mode',
            newMode: 'native'
        }));
    });

    it('should provide honest status message on cache miss fallback', async () => {
        testRegistry.register('private', () => new FailingPrivateEngine('CACHE_MISS'));

        await service.init();
        await service.startTranscription();

        // Ensure microtasks for the async handleCacheMiss call are flushed
        await vi.runAllTicks();
        await Promise.resolve();

        const calls = mockOnStatusChange.mock.calls.map(c => c[0]);
        const fallbackCall = calls.find(c =>
            c?.type === 'fallback' &&
            /browser stt/i.test(c?.message)
        );
        expect(fallbackCall).toBeDefined();
        expect(calls.some(c => c?.type === 'downloading')).toBe(false);
    });

    it('should sanitize transcripts effectively', async () => {
        let engineInstance: SuccessNativeEngine | undefined;
        testRegistry.register('native', (opts: TranscriptionModeOptions | undefined) => {
            engineInstance = new SuccessNativeEngine(opts);
            return engineInstance;
        });

        service.updatePolicy({
            ...basePolicy,
            preferredMode: 'native',
            allowPrivate: false
        });

        await service.init();
        await service.startTranscription();

        if (!engineInstance) throw new Error('Engine not created');

        const rawFinal = '[BLANK_AUDIO]  Hello (applause) [SILENCE]  world [MUSIC]  ';
        const rawPartial = '[MUSIC] thinking...';
        engineInstance.simulateUpdate(rawFinal, rawPartial);

        // Assert
        expect(mockOnTranscriptUpdate).toHaveBeenCalledWith(expect.objectContaining({
            transcript: {
                final: 'Hello world',
                partial: 'thinking...'
            }
        }));
    });

    it('should release the microphone IMMEDIATELY on destroy', async () => {
        const mockMicStop = vi.fn();
        const fastService = new TranscriptionService({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onStatusChange: mockOnStatusChange,
            policy: { ...basePolicy, preferredMode: 'native', allowNative: true, allowPrivate: false },
            mockMic: { stop: mockMicStop, onFrame: () => () => { } } as unknown as MicStream
        } as unknown as ConstructorParameters<typeof TranscriptionService>[0]);
        await fastService.init();
        await fastService.startTranscription();
        const destroyPromise = fastService.destroy();
        expect(mockMicStop).toHaveBeenCalled();
        await vi.runAllTicks();
        await destroyPromise;
    });
});
