import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TranscriptionService from '../TranscriptionService';
import { sanitizeTranscriptText } from '../TranscriptionService';
import type { TranscriptionServiceOptions } from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import type { MicStream } from '../utils/types';
import type { PracticeSession } from '../../../types/session';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result, TranscriptionModeOptions } from '../modes/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';

vi.mock('@/lib/toast', () => ({
    toast: {
        info: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        dismiss: vi.fn(),
    },
}));

describe('TranscriptionService', () => {
    let service: TranscriptionService;
    let TranscriptionServiceClass: typeof TranscriptionService;
    let resetTranscriptionService: () => void;
    let ENV: { isTest: boolean; disableWasm: boolean };
    
    const mockOnTranscriptUpdate = vi.fn();
    const mockOnModelLoadProgress = vi.fn();
    const mockOnReady = vi.fn();
    const mockGetToken = vi.fn().mockResolvedValue('mock-token');

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        // 1. Reset $+$ Enrollment (Harness is post-reset authoritative)
        await setupStrictZero();

        // 2. Dynamic Import (Captures post-reset registry)
        const tsModule = (await import('../TranscriptionService')) as unknown as { 
          default: typeof TranscriptionService, 
          resetTranscriptionService: () => void 
        };
        TranscriptionServiceClass = tsModule.default;
        resetTranscriptionService = tsModule.resetTranscriptionService;
        resetTranscriptionService();

        const flagsModule = await import('../../../config/TestFlags');
        ENV = flagsModule.ENV;

        const storageModule = await import('../../../lib/storage');
        vi.spyOn(storageModule, 'saveSession').mockResolvedValue({ 
            session: { id: 'test-sess', user_id: 'u1', created_at: '', duration: 0 } as unknown as PracticeSession, 
            usageExceeded: false 
        });

        service = new (TranscriptionServiceClass as unknown as new (o: TranscriptionServiceOptions) => TranscriptionService)({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            session: null,
            navigate: vi.fn(),
            getAssemblyAIToken: mockGetToken,
            policy: {
                allowNative: true,
                allowCloud: false,
                allowPrivate: true,
                preferredMode: 'mock',
                allowFallback: true,
                executionIntent: 'test'
            } as TranscriptionPolicy,
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                clone: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });
    });

    afterEach(async () => {
        if (service) {
            await service.destroy();
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
        if (resetTranscriptionService) resetTranscriptionService();
        
        // Dynamic cleanup (Identity alignment)
        const { sttRegistry } = await import('../STTRegistry');
        sttRegistry.clear();
    });

    it('should initialize successfully with ST=0 registry-injected mock', async () => {
        expect(ENV.isTest).toBe(true);
        expect(ENV.disableWasm).toBe(true);

        await service.init();
        expect(service.getState()).toBe('READY');
        expect(service.getMode()).toBe('mock');
    });

    it('toasts alternative STT guidance once during Private download and ready state on completion', async () => {
        const { toast } = await import('@/lib/toast');
        const privateService = new (TranscriptionServiceClass as unknown as new (o: TranscriptionServiceOptions) => TranscriptionService)({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            session: null,
            navigate: vi.fn(),
            getAssemblyAIToken: mockGetToken,
            policy: {
                allowNative: true,
                allowCloud: true,
                allowPrivate: true,
                preferredMode: 'private',
                allowFallback: false,
                executionIntent: 'private-download-toast-test'
            } as TranscriptionPolicy,
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                clone: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });

        (privateService as unknown as { processModelLoadProgress: (progress: number | null) => void }).processModelLoadProgress(12);
        (privateService as unknown as { processModelLoadProgress: (progress: number | null) => void }).processModelLoadProgress(42);
        (privateService as unknown as { processModelLoadProgress: (progress: number | null) => void }).processModelLoadProgress(100);

        expect(toast.info).toHaveBeenCalledTimes(1);
        expect(toast.info).toHaveBeenCalledWith(
            expect.stringMatching(/choose Browser, or Cloud if included in your plan/i),
            expect.objectContaining({ id: 'private-model-alternative-stt', duration: 5000 })
        );
        expect(toast.success).toHaveBeenCalledWith(
            expect.stringMatching(/Private is ready/i),
            expect.objectContaining({ id: 'private-model-ready', duration: 5000 })
        );

        await privateService.destroy();
    });

    it('should sanitize transcripts effectively', async () => {
        const { sttRegistry } = await import('../STTRegistry');
        
        class MockEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            public async checkAvailability() { return { isAvailable: true }; }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() {}
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'whisper-turbo' as EngineType; }
            
            public triggerTranscript(data: { transcript: { final?: string; partial?: string } }) {
                (this.options as TranscriptionModeOptions)?.onTranscriptUpdate?.(data);
            }
        }
        
        const mockEngine = new MockEngine({} as unknown as TranscriptionModeOptions);
        sttRegistry.registerStatic('mock', mockEngine);

        await service.startTranscription();
        
        mockEngine.triggerTranscript({
            transcript: {
                final: '[BLANK_AUDIO]  Hello world [MUSIC]  ',
                partial: 'thinking...'
            }
        });

        expect(mockOnTranscriptUpdate).toHaveBeenCalledWith(expect.objectContaining({
            transcript: {
                final: 'Hello world',
                partial: ''
            }
        }));
    });

    it('should reject startTranscription when strategy start fails', async () => {
        const { sttRegistry } = await import('../STTRegistry');
        const startError = new Error('SIMULATED_ENGINE_START_FAILURE');

        class FailingStartEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            public async checkAvailability() { return { isAvailable: true }; }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() { throw startError; }
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'whisper-turbo' as EngineType; }
        }

        const failingEngine = new FailingStartEngine({} as unknown as TranscriptionModeOptions);
        sttRegistry.registerStatic('transformers-js', failingEngine);
        sttRegistry.registerStatic('mock', failingEngine);

        await expect(service.startTranscription()).rejects.toThrow('SIMULATED_ENGINE_START_FAILURE');
        expect(service.getState()).toBe('FAILED');
    });

    it('should sanitize bracketed and parenthetical transcript metadata tags', () => {
        expect(sanitizeTranscriptText('[MUSIC] Hello  (applause) world [BLANK_AUDIO]')).toBe('Hello world');
        expect(sanitizeTranscriptText('Testing (laughter) one [SILENCE] two')).toBe('Testing one two');
    });

    it('should synchronously rehydrate transcript and recording status on subscription', () => {
        const internal = service as unknown as {
            currentTranscript: string;
            partialTranscript: string;
            fsm: { setState: (state: string) => void };
        };
        internal.currentTranscript = 'Hello persistent world';
        internal.partialTranscript = '';
        internal.fsm.setState('RECORDING');

        let capturedTranscript: string | null = null;
        let capturedStatus: string | null = null;
        const unsubscribe = service.subscribe({
            onTranscriptUpdate: (update) => {
                capturedTranscript = update.transcript.final ?? null;
            },
            onStatusChange: (status) => {
                capturedStatus = status.type;
            },
        }, 'rehydration-unit-test');

        expect(capturedTranscript).toBe('Hello persistent world');
        expect(capturedStatus).toBe('recording');
        unsubscribe();
    });

    it('should keep deterministic mock service ready for execution', async () => {
        await service.init();
        expect(service.getState()).toBe('READY');
    });

    it('should pump cloud microphone frames into analytics and the streaming engine', async () => {
        const { sttRegistry } = await import('../STTRegistry');
        sttRegistry.clear();

        let frameListener: ((frame: Float32Array) => void) | null = null;
        const disposeFrameListener = vi.fn();
        const onAudioData = vi.fn();

        class MockCloudEngine extends STTEngine {
            public override readonly type = 'cloud' as EngineType;
            public async checkAvailability() { return { isAvailable: true }; }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() {}
            protected async onStop() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok(''); }
            public override getEngineType() { return 'cloud' as EngineType; }
        }

        sttRegistry.register('assemblyai', (options) => new MockCloudEngine(options));

        const cloudService = new (TranscriptionServiceClass as unknown as new (o: TranscriptionServiceOptions) => TranscriptionService)({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            onAudioData,
            session: null,
            navigate: vi.fn(),
            getAssemblyAIToken: mockGetToken,
            policy: {
                allowNative: false,
                allowCloud: true,
                allowPrivate: false,
                preferredMode: 'cloud',
                allowFallback: false,
                executionIntent: 'test-cloud-audio-pump'
            } as TranscriptionPolicy,
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                clone: vi.fn(),
                onFrame: vi.fn((listener: (frame: Float32Array) => void) => {
                    frameListener = listener;
                    return disposeFrameListener;
                }),
            } as unknown as MicStream
        });

        try {
            await cloudService.startTranscription();
            expect(frameListener).toBeTypeOf('function');

            const processAudioSpy = vi.spyOn(
                cloudService.strategy as unknown as { processAudio: (data: Float32Array) => void },
                'processAudio'
            );
            const frame = new Float32Array([0.05, 0.2, 0.3]);

            const emitFrame = frameListener as unknown as (data: Float32Array) => void;
            emitFrame(frame);

            expect(onAudioData).toHaveBeenCalledWith(expect.any(Float32Array));
            expect(processAudioSpy).toHaveBeenCalledWith(expect.any(Float32Array));
        } finally {
            await cloudService.destroy();
        }
    });

    it('should handle unavailable private initialization without throwing', async () => {
        const { sttRegistry } = await import('../STTRegistry');
        
        // Register a mock that always fails checkAvailability
        sttRegistry.register('mock', () => ({
            checkAvailability: async () => ({ isAvailable: false, reason: 'UNKNOWN', message: 'Injected failure' }),
            init: async () => Result.ok(undefined),
            getEngineType: () => 'whisper-turbo'
        } as unknown as STTEngine));

        const failingService = new (TranscriptionServiceClass as unknown as new (o: TranscriptionServiceOptions) => TranscriptionService)({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            session: null,
            navigate: vi.fn(),
            getAssemblyAIToken: mockGetToken,
            policy: {
                allowNative: false,
                allowCloud: false,
                allowPrivate: true,
                preferredMode: 'private',
                allowFallback: false,
                executionIntent: 'test-private-failure'
            } as TranscriptionPolicy,
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                clone: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });

        await expect(failingService.init()).resolves.toEqual({ success: true });
        expect(['READY', 'DOWNLOAD_REQUIRED']).toContain(failingService.getState());
        await failingService.destroy();
    });
});
