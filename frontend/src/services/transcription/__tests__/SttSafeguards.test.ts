import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TranscriptionService from '../TranscriptionService';
import { SpeechRuntimeController } from '../../SpeechRuntimeController';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { NavigateFunction } from 'react-router-dom';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';
import { STT_CONFIG } from '../../../config';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result } from '../modes/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';

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
    let controller: SpeechRuntimeController;
    let ENV: { isTest: boolean };
    let storageMocks: MockedStorage;

    const mockMic = { stop: vi.fn(), onFrame: () => () => { } };
    const mockNavigate = vi.fn();

    let tsModule: { 
        resetTranscriptionService: () => Promise<void>; 
        getTranscriptionService: (opts: Partial<import('../TranscriptionService').TranscriptionServiceOptions>) => TranscriptionService;
    };

    beforeEach(async () => {
        // Step 1: Deterministic Reset
        await setupStrictZero();
        vi.useFakeTimers();
        SpeechRuntimeController.__resetForTests();
        controller = SpeechRuntimeController.getInstance();

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

        await tsModule.resetTranscriptionService();

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
        SpeechRuntimeController.__resetForTests();
        delete (window as unknown as { supabase: unknown }).supabase;
        vi.clearAllMocks();
    });

    it('should generate an idempotency key and create a session at start', async () => {
        expect(ENV.isTest).toBe(true);
        storageMocks.saveSession.mockResolvedValue({ 
            session: { id: 'test-session-id' }, 
            usageExceeded: false 
        });

        await controller.warmUp();
        await controller.startRecording(); 
        await controller.whenStable();

        expect(service.getSessionId()).toBe('test-session-id');
        expect(storageMocks.saveSession).toHaveBeenCalled();
    });

    it('should start heartbeat interval after session is created', async () => {
        storageMocks.saveSession.mockResolvedValue({ 
            session: { id: 'sess-123' }, 
            usageExceeded: false 
        });

        await controller.warmUp();
        await controller.startRecording();
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

        await controller.warmUp();
        await controller.startRecording();
        controller.confirmSubscriberHandshake(); 
        await controller.whenStable();

        expect(service.getSessionId()).toBe('sess-123');

        await vi.advanceTimersByTimeAsync(6000);
        await controller.stopRecording();
        await controller.whenStable();

        expect(storageMocks.completeSession).toHaveBeenCalled();
        expect((controller as unknown as { heartbeatInterval: unknown }).heartbeatInterval).toBeNull();
    });
});
