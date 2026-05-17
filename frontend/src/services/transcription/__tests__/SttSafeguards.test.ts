import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TranscriptionService from '../TranscriptionService';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { NavigateFunction } from 'react-router-dom';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';
import { STT_CONFIG } from '../../../config';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result } from '../modes/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';
import type { TranscriptionPolicy } from '../TranscriptionPolicy';

/**
 * @file SttSafeguards.test.ts
 * @description Verifies session lifecycle safeguards and heartbeat stability.
 */

// Top-level mock for storage to ensure deterministic resolution
vi.mock('@/lib/storage', () => ({
    saveSession: vi.fn(),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
    updateSession: vi.fn().mockResolvedValue({ success: true }),
}));

import type * as StorageModule from '@/lib/storage';
type MockedStorage = {
    [K in keyof typeof StorageModule]: import('vitest').Mock;
};

describe('STT Safeguards Unit Tests', () => {
    let service: TranscriptionService;
    let controller: import('../../SpeechRuntimeController').SpeechRuntimeController;
    let SpeechRuntimeControllerClass: typeof import('../../SpeechRuntimeController').SpeechRuntimeController;
    let ENV: { isTest: boolean };
    let storageMocks: MockedStorage;

    const mockMic = { stop: vi.fn(), onFrame: () => () => { } };
    const mockNavigate = vi.fn();
    const mockPolicy: TranscriptionPolicy = {
        allowNative: true,
        allowCloud: false,
        allowPrivate: true,
        preferredMode: 'mock',
        allowFallback: false,
        executionIntent: 'unit-safeguard'
    };

    let tsModule: { 
        resetTranscriptionService: () => Promise<void>; 
        getTranscriptionService: (opts: Partial<import('../TranscriptionService').TranscriptionServiceOptions>) => TranscriptionService;
    };

    beforeEach(async () => {
        // Step 1: Deterministic Reset
        await setupStrictZero();
        vi.useFakeTimers();
        SpeechRuntimeControllerClass = (await import('../../SpeechRuntimeController')).SpeechRuntimeController;
        SpeechRuntimeControllerClass.__resetForTests();
        controller = SpeechRuntimeControllerClass.getInstance();

        // Step 2: Supabase Mocking
        window.supabase = {
            auth: {
                getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-123' } } } })
            },
            rpc: vi.fn() // Add fallback RPC
        } as unknown as SupabaseClient;

        // Step 3: Storage Mocking
        const storage = await import('@/lib/storage');
        storageMocks = storage as unknown as MockedStorage;
        storageMocks.saveSession.mockResolvedValue({ session: { id: 'sess-123' }, usageExceeded: false });

        // Step 4: ModelManager Mocking
        const mmModule = await import('../ModelManager');
        vi.spyOn(mmModule.ModelManager, 'isModelDownloaded').mockResolvedValue(true);

        // Step 5: Service Initialization
        tsModule = await import('../TranscriptionService');
        const flagsModule = await import('../../../config/TestFlags');
        ENV = flagsModule.ENV;

        await tsModule.resetTranscriptionService();

        const { sttRegistry } = await import('../STTRegistry');
        
        class MockEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            public async checkAvailability() { return { isAvailable: true }; }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() {}
            protected async onStop() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'whisper-turbo' as EngineType; }
        }
        
        sttRegistry.register('whisper-turbo', () => new MockEngine());
        sttRegistry.register('transformers-js', () => new MockEngine());
        sttRegistry.register('mock', () => new MockEngine());

        service = tsModule.getTranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            navigate: mockNavigate as unknown as NavigateFunction,
            getAssemblyAIToken: vi.fn().mockResolvedValue('mock-token'),
            policy: mockPolicy,
            session: { user: { id: 'user-123' } } as unknown as Session,
            mockMic: mockMic as unknown as import('../utils/types').MicStream
        });

        (controller as unknown as { service: TranscriptionService }).service = service;
        controller.setSubscriberCallbacks({
            session: { user: { id: 'user-123' } } as unknown as Session,
        });
    });

    afterEach(async () => {
        vi.useRealTimers();
        if (tsModule) {
            await tsModule.resetTranscriptionService();
        }
        SpeechRuntimeControllerClass?.__resetForTests();
        delete (window as unknown as { supabase: unknown }).supabase;
        vi.clearAllMocks();
    });

    it('should generate an idempotency key and create a session at start', async () => {
        expect(ENV.isTest).toBe(true);
        storageMocks.saveSession.mockResolvedValue({ 
            session: { id: 'test-session-id' }, 
            usageExceeded: false 
        });

        await controller.startRecording(mockPolicy); 
        await controller.whenStable();

        expect(service.getSessionId()).toBe('test-session-id');
        expect(storageMocks.saveSession).toHaveBeenCalled();
    });

    it('should start heartbeat interval after session is created', async () => {
        storageMocks.saveSession.mockResolvedValue({ 
            session: { id: 'sess-123' }, 
            usageExceeded: false 
        });

        await controller.startRecording(mockPolicy);
        controller.confirmSubscriberHandshake(); 
        await controller.whenStable();

        expect(service.getSessionId()).toBe('sess-123');

        await vi.advanceTimersByTimeAsync(STT_CONFIG.HEARTBEAT_TIMEOUT_MS + 5);
        expect(storageMocks.heartbeatSession).toHaveBeenCalledWith('sess-123', expect.any(Number));
    });

    it('should complete session and stop heartbeat when transcription stops', async () => {
        storageMocks.saveSession.mockResolvedValue({ 
            session: { id: 'sess-123' }, 
            usageExceeded: false 
        });

        await controller.startRecording(mockPolicy);
        controller.confirmSubscriberHandshake(); 
        await controller.whenStable();

        expect(service.getSessionId()).toBe('sess-123');

        await vi.advanceTimersByTimeAsync(6000);
        await controller.stopRecording();
        await controller.whenStable();

        expect(storageMocks.completeSession).toHaveBeenCalled();
        expect((controller as unknown as { heartbeatInterval: unknown }).heartbeatInterval).toBeNull();
    });

    it('should not complete or analyze empty sessions when no meaningful speech is detected', async () => {
        storageMocks.saveSession.mockResolvedValue({
            session: { id: 'sess-123' },
            usageExceeded: false
        });

        vi.spyOn(service, 'stopTranscription').mockResolvedValue({
            success: true,
            transcript: '',
            stats: {
                transcript: '',
                total_words: 0,
                accuracy: 0,
                duration: 0
            }
        });

        await controller.startRecording(mockPolicy);
        controller.confirmSubscriberHandshake();
        await controller.whenStable();
        storageMocks.completeSession.mockClear();
        storageMocks.updateSession.mockClear();

        await controller.stopRecording();
        await controller.whenStable();

        expect(storageMocks.completeSession).toHaveBeenCalledWith('sess-123', expect.objectContaining({
            status: 'failed',
            reason: expect.stringMatching(/No meaningful speech/i)
        }));
        expect(storageMocks.updateSession).not.toHaveBeenCalled();
    });

    it('should persist the full analysis snapshot when transcription stops', async () => {
        storageMocks.saveSession.mockResolvedValue({
            session: { id: 'sess-123' },
            usageExceeded: false
        });

        vi.spyOn(service, 'stopTranscription').mockResolvedValue({
            success: true,
            transcript: 'um hello world this is a clear practice session',
            stats: {
                transcript: 'um hello world this is a clear practice session',
                total_words: 8,
                accuracy: 0.92,
                duration: 6
            }
        });

        await controller.startRecording(mockPolicy);
        controller.confirmSubscriberHandshake();
        await controller.whenStable();

        await vi.advanceTimersByTimeAsync(6000);
        await controller.stopRecording();
        await controller.whenStable();

        expect(storageMocks.updateSession).toHaveBeenCalledWith('sess-123', expect.objectContaining({
            total_words: 9,
            wpm: 90,
            accuracy: 0.92,
            filler_words: expect.objectContaining({
                um: expect.objectContaining({ count: 1 }),
                total: expect.objectContaining({ count: 1 })
            }),
            custom_words: expect.any(Object),
            pause_metrics: expect.any(Object),
            clarity_score: expect.any(Number)
        }));
    });
});
