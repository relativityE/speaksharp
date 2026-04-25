import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TranscriptionService from '../TranscriptionService';
import type { TranscriptionServiceOptions } from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import type { MicStream } from '../utils/types';
import type { PracticeSession } from '../../../types/session';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result, TranscriptionModeOptions } from '../modes/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';

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
                preferredMode: 'private',
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
        expect(service.getMode()).toBe('private');
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
        sttRegistry.registerStatic('whisper-turbo', mockEngine);

        await service.init();
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

    it('should transition to RECORDING state when started', async () => {
        await service.init();
        await service.startTranscription();
        expect(service.getState()).toBe('RECORDING');
    });

    it('should handle initialization failure gracefully', async () => {
        const { sttRegistry } = await import('../STTRegistry');
        
        // Register a mock that always fails checkAvailability
        sttRegistry.register('whisper-turbo', () => ({
            checkAvailability: async () => ({ isAvailable: false, reason: 'UNKNOWN', message: 'Injected failure' }),
            init: async () => Result.ok(undefined),
            getEngineType: () => 'whisper-turbo'
        } as unknown as STTEngine));

        await expect(service.init()).resolves.toEqual({ success: false });
        expect(service.getState()).toBe('FAILED');
    });
});
