import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TranscriptionService from '../TranscriptionService';
import type { SpeechRuntimeController } from '../../SpeechRuntimeController';
import type { Session } from '@supabase/supabase-js';
import type { NavigateFunction } from 'react-router-dom';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';
import { STT_CONFIG } from '@/config';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result } from '../modes/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';

/**
 * @file SttSafeguards.test.ts
 * @description Verifies session lifecycle safeguards and heartbeat stability.
 */

describe('STT Safeguards Unit Tests', () => {
    let service: TranscriptionService;
    let speechRuntimeController: SpeechRuntimeController;
    let ENV: { isTest: boolean };

    const mockMic = { stop: vi.fn(), onFrame: () => () => { } };
    const mockNavigate = vi.fn();

    const storageSpies = {
        saveSession: vi.fn(),
        heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
        completeSession: vi.fn().mockResolvedValue({ success: true }),
        updateSession: vi.fn().mockResolvedValue({ success: true }),
    };
    let tsModule: { 
        resetTranscriptionService: () => void; 
        getTranscriptionService: (opts: Partial<import('../TranscriptionService').TranscriptionServiceOptions>) => TranscriptionService;
    };
    let factoryModule: { STTServiceFactory: { createService: () => TranscriptionService } };

    beforeEach(async () => {
        // Step 1: Reset + Set Globals at T=0
        await setupStrictZero();
        vi.useFakeTimers();

        // Step 3: Dynamic Import AFTER setup to ensure instance identity parity
        const supabaseModule = await import('../../../lib/supabaseClient');
        vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue({
            auth: {
                getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-123' } } } })
            }
        } as unknown as ReturnType<typeof supabaseModule.getSupabaseClient>);

        const storageModule = await import('../../../lib/storage');
        vi.spyOn(storageModule, 'saveSession').mockImplementation(storageSpies.saveSession);
        vi.spyOn(storageModule, 'heartbeatSession').mockImplementation(storageSpies.heartbeatSession);
        vi.spyOn(storageModule, 'completeSession').mockImplementation(storageSpies.completeSession);
        vi.spyOn(storageModule, 'updateSession').mockImplementation(storageSpies.updateSession);

        tsModule = await import('../TranscriptionService');
        const srcModule = await import('../../SpeechRuntimeController');
        factoryModule = await import('../STTServiceFactory');
        const flagsModule = await import('../../../config/TestFlags');

        await tsModule.resetTranscriptionService();

        speechRuntimeController = srcModule.speechRuntimeController;
        ENV = flagsModule.ENV;

        storageSpies.saveSession.mockResolvedValue({ session: { id: 'sess-123' }, usageExceeded: false });

        // Step 4: Setup Mock Registry using SSOT sttRegistry
        const { sttRegistry } = await import('../STTRegistry');
        
        class MockEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() {}
            protected async onStop() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'whisper-turbo' as EngineType; }
        }
        
        const mockEngine = new MockEngine();
        sttRegistry.register('whisper-turbo', () => mockEngine);

        service = tsModule.getTranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            navigate: mockNavigate as unknown as NavigateFunction,
            getAssemblyAIToken: vi.fn().mockResolvedValue('mock-token'),
            policy: {
                allowNative: true,
                allowCloud: true,
                allowPrivate: true,
                preferredMode: 'private',
                allowFallback: true,
                executionIntent: 'test'
            },
            session: { user: { id: 'user-123' } } as unknown as Session,
            mockMic: mockMic as unknown as import('../utils/types').MicStream
        });

        // Ensure controller uses the same instance
        vi.spyOn(factoryModule.STTServiceFactory, 'createService').mockReturnValue(service);
        (speechRuntimeController as unknown as { service: TranscriptionService }).service = service;

        // Inject mock mic
        // (Handled by constructor options now)
    });

    afterEach(async () => {
        if (typeof window !== 'undefined') {
            const win = window as unknown as Record<string, unknown>;
            delete win.__SS_E2E__;
        }
        vi.useRealTimers();
        if (speechRuntimeController) {
          await speechRuntimeController.reset();
        }
        if (tsModule) {
            await tsModule.resetTranscriptionService();
        }
    });

    it('should generate an idempotency key and create a session at start', async () => {
        expect(ENV.isTest).toBe(true);
        await speechRuntimeController.warmUp();
        await service.init();
        await speechRuntimeController.startRecording();

        await vi.waitFor(() => {
            if (service.getSessionId()) return;
            throw new Error('Session not set');
        });

        expect(storageSpies.saveSession).toHaveBeenCalled();
    });

    it('should start heartbeat interval after session is created', async () => {
        await speechRuntimeController.warmUp();
        await service.init();
        await speechRuntimeController.startRecording();
        speechRuntimeController.confirmSubscriberHandshake(); 

        await vi.waitFor(() => {
            if (service.getSessionId()) return;
            throw new Error('Session not set');
        });

        await vi.advanceTimersByTimeAsync(STT_CONFIG.HEARTBEAT_TIMEOUT_MS + 5);

        await vi.waitFor(() => {
            expect(storageSpies.heartbeatSession).toHaveBeenCalledWith('sess-123', expect.any(Number));
        });
    });

    it('should complete session and stop heartbeat when transcription stops', async () => {
        await speechRuntimeController.warmUp();
        await service.init();
        await speechRuntimeController.startRecording();
        speechRuntimeController.confirmSubscriberHandshake(); 

        await vi.waitFor(() => {
            if (service.getSessionId()) return;
            throw new Error('Session not set');
        });

        await vi.advanceTimersByTimeAsync(6000);
        await speechRuntimeController.stopRecording();

        expect(storageSpies.completeSession).toHaveBeenCalled();
        expect((speechRuntimeController as unknown as { heartbeatInterval: unknown }).heartbeatInterval).toBeNull();
    });
});
