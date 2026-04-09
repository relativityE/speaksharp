import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import type { TranscriptionServiceOptions } from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import type { MicStream } from '../utils/types';
import type { PracticeSession } from '../../../types/session';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result } from '../modes/types';
import { TranscriptionModeOptions } from '../modes/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';
import { sttRegistry } from '@/services/transcription/STTRegistry';

/**
 * ARCHITECTURE:
 * STT REGISTRY SYNC (Task 5.0.1)
 * Tests use registerStatic() to ensure identity parity between 
 * the test suite and the TranscriptionService instance.
 */

describe('TranscriptionService', () => {
    let service: TranscriptionService;
    let getTranscriptionService: (options: Partial<TranscriptionServiceOptions>) => TranscriptionService;
    let resetTranscriptionService: () => void;
    let ENV: { isTest: boolean; disableWasm: boolean };
    
    // Captured Mock References
    const mockOnTranscriptUpdate = vi.fn();
    const mockOnModelLoadProgress = vi.fn();
    const mockOnReady = vi.fn();
    const mockGetToken = vi.fn().mockResolvedValue('mock-token');

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        // Step 1: Reset + Set Globals at T=0
        await setupStrictZero();

        // Step 2: Dynamic Import AFTER setup
        const tsModule = await import('../TranscriptionService');
        getTranscriptionService = tsModule.getTranscriptionService;
        resetTranscriptionService = tsModule.resetTranscriptionService;

        // Reset singleton to ensure state isolation
        resetTranscriptionService();

        const flagsModule = await import('../../../config/TestFlags');
        ENV = flagsModule.ENV;

        const storageModule = await import('../../../lib/storage');
        vi.spyOn(storageModule, 'saveSession').mockResolvedValue({ 
            session: { id: 'test-sess', user_id: 'u1', created_at: '', duration: 0 } as unknown as PracticeSession, 
            usageExceeded: false 
        });

        service = getTranscriptionService({
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
        resetTranscriptionService();
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
        // 1. Setup Sticky Mock
        const { sttRegistry } = await import('@/services/transcription/STTRegistry');
        
        class MockEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() {}
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'whisper-turbo' as EngineType; }
            
            // Allow test to trigger transcription update
            public triggerTranscript(data: { transcript: { final?: string; partial?: string } }) {
                (this.options as TranscriptionModeOptions)?.onTranscriptUpdate?.(data);
            }
        }
        
        const mockEngine = new MockEngine({} as unknown as TranscriptionModeOptions);
        sttRegistry.registerStatic('whisper-turbo', mockEngine);

        await service.init();
        await service.startTranscription();
        
        // 2. Act: Simulate a transcript event through the wired mock
        mockEngine.triggerTranscript({
            transcript: {
                final: '[BLANK_AUDIO]  Hello world [MUSIC]  ',
                partial: 'thinking...'
            }
        });

        // 3. Verify: Behavioral assertion on the Service's public callback
        expect(mockOnTranscriptUpdate).toHaveBeenCalledWith(expect.objectContaining({
            transcript: {
                final: 'Hello world',
                partial: 'thinking...'
            }
        }));
    });

    it('should transition to DOWNLOAD_REQUIRED on CACHE_MISS', async () => {
        // 1. Setup Sticky Mock with CACHE_MISS
        const { sttRegistry } = await import('@/services/transcription/STTRegistry');
        
        class CacheMissEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            public override async checkAvailability(): Promise<import('../STTStrategy').AvailabilityResult> {
                return { isAvailable: false, reason: 'CACHE_MISS', message: 'Download required' };
            }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() {}
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'whisper-turbo' as EngineType; }
        }
        
        const mockEngine = new CacheMissEngine();
        sttRegistry.registerStatic('whisper-turbo', mockEngine);

        // 2. Act: Attempt to init (should transition to DOWNLOAD_REQUIRED)
        // Note: initializeStrategy throws internally when blocked to stop the init chain,
        // so we must catch it to continue to the state assertion.
        try {
            await service.init();
        } catch (e) {
            // Error is expected as the strategy is BLOCKED
        }

        // 3. Verify FSM State transition
        expect(service.getState()).toBe('DOWNLOAD_REQUIRED');
    });

    it('should transition to FAILED and NOT switch modes on engine failure', async () => {
        // 1. Setup Sticky Mock that fails during start
        const { sttRegistry } = await import('@/services/transcription/STTRegistry');
        
        class FailureEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() { throw new Error('Start failed'); }
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'whisper-turbo' as EngineType; }
        }
        
        const mockEngine = new FailureEngine();
        sttRegistry.registerStatic('whisper-turbo', mockEngine);

        await service.init();
        
        // 2. Act
        await service.startTranscription();

        // 3. Verify terminal failure state and ZERO fallback (Mode Lock Integrity)
        expect(service.getState()).toBe('FAILED');
        expect(service.getMode()).toBe('private');
    });
});
