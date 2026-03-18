import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { speechRuntimeController } from '../../SpeechRuntimeController';
import TranscriptionService, { resetTranscriptionService, getTranscriptionService } from '../TranscriptionService';
import { TranscriptionPolicy, TranscriptionMode } from '../TranscriptionPolicy';
import { MicStream } from '../utils/types';

import { createMockEngine } from '../../../../tests/unit/factories/engineFactory';

// Mock storage
vi.mock('../../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'sess-123' }, usageExceeded: false }),
    heartbeatSession: vi.fn(),
    completeSession: vi.fn(),
}));

vi.mock('../../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn().mockReturnValue({
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-123' } } } })
        }
    })
}));


// Mock EngineFactory - using the factory function to avoid reference errors
vi.mock('../EngineFactory', () => ({
    EngineFactory: {
        create: vi.fn().mockImplementation(() => Promise.resolve(createMockEngine({ getEngineType: () => 'private' as TranscriptionMode })))
    }
}));


const { STTServiceFactory } = vi.hoisted(() => ({
    STTServiceFactory: {
        createService: vi.fn()
    }
}));

vi.mock('../STTServiceFactory', () => ({
    STTServiceFactory
}));

describe('STT Safeguards Unit Tests', () => {
    let service: TranscriptionService;
    const mockMic = { stop: vi.fn(), onFrame: () => () => { } } as unknown as MicStream;

    const basePolicy: TranscriptionPolicy = {
        allowNative: true,
        allowCloud: true,
        allowPrivate: true,
        preferredMode: 'private',
        allowFallback: true,
        executionIntent: 'test'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        resetTranscriptionService();
        service = getTranscriptionService({
            policy: basePolicy,
            session: { user: { id: 'user-123' } } as unknown as Parameters<typeof TranscriptionService.prototype['updateCallbacks']>[0]['session'],
        });

        // Ensure controller uses the same instance
        vi.mocked(STTServiceFactory.createService).mockReturnValue(service);

        // Inject mock db handlers
        service.setDbHandlers({
            initDbSession: async () => 'sess-123',
            heartbeatSession: async () => {},
            completeSession: async () => {}
        });

        // Inject mock mic
        (service as unknown as { mic: MicStream }).mic = mockMic;
    });

    afterEach(async () => {
        vi.useRealTimers();
        await speechRuntimeController.reset();
        resetTranscriptionService();
    });

    it('should generate an idempotency key and create a session at start', async () => {
        const initDbSession = vi.fn().mockResolvedValue('sess-123');
        service.setDbHandlers({
            initDbSession,
            heartbeatSession: async () => {},
            completeSession: async () => {}
        });

        await speechRuntimeController.warmUp();
        await service.init();
        await speechRuntimeController.startRecording();

        // Wait for sessionId to be set (async RPC)
        await vi.waitFor(() => {
            if (service.getSessionId()) return;
            throw new Error('Session not set');
        });

        expect(initDbSession).toHaveBeenCalledWith(
            'private',
            expect.any(String), // idempotencyKey
            expect.any(Object)  // metadata
        );
    });

    it('should start heartbeat interval after session is created', async () => {
        const heartbeatSession = vi.fn().mockResolvedValue(undefined);
        service.setDbHandlers({
            initDbSession: async () => 'sess-123',
            heartbeatSession,
            completeSession: async () => {}
        });

        await speechRuntimeController.warmUp();
        await service.init();
        await speechRuntimeController.startRecording();

        await vi.waitFor(() => {
            if (service.getSessionId()) return;
            throw new Error('Session not set');
        });

        // Heartbeat takes (sessionId)
        const { heartbeatSession: globalHeartbeat } = await import('../../../lib/storage');
        await vi.waitFor(() => {
            expect(globalHeartbeat).toHaveBeenCalledWith('sess-123', expect.any(Number));
        });
    });

    it('should complete session and stop heartbeat when transcription stops', async () => {
        const completeSession = vi.fn().mockResolvedValue(undefined);
        service.setDbHandlers({
            initDbSession: async () => 'sess-123',
            heartbeatSession: async () => {},
            completeSession
        });

        await speechRuntimeController.warmUp();
        await service.init();
        await speechRuntimeController.startRecording();

        await vi.waitFor(() => {
            if (service.getSessionId()) return;
            throw new Error('Session not set');
        });

        // Wait at least MIN_RECORDING_DURATION_MS (5000ms) to allow stopping
        await vi.advanceTimersByTimeAsync(6000);

        await speechRuntimeController.stopRecording();

        const { completeSession: globalComplete } = await import('../../../lib/storage');
        expect(globalComplete).toHaveBeenCalledWith(
            'sess-123',
            expect.any(String),
            expect.any(Number)
        );

        expect((speechRuntimeController as unknown as { heartbeatInterval: unknown }).heartbeatInterval).toBeNull();
    });

    it('should verify idempotency key is generated during transcription', async () => {
        await service.startTranscription();
        const key = service.getIdempotencyKey();
        expect(key).toBeTruthy();
        expect(typeof key).toBe('string');
    });
});
