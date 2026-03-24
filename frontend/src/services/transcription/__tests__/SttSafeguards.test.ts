import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { speechRuntimeController } from '../../SpeechRuntimeController';
import TranscriptionService, { resetTranscriptionService, getTranscriptionService } from '../TranscriptionService';
import { TranscriptionPolicy, TranscriptionMode } from '../TranscriptionPolicy';
import { MicStream } from '../utils/types';

import { createMockEngine } from '../../../../tests/unit/factories/engineFactory';

// Pattern 14: Use vi.hoisted for shared constants in hoisted mocks
const { storageSpies } = vi.hoisted(() => ({
    storageSpies: {
        saveSession: vi.fn(),
        heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
        completeSession: vi.fn().mockResolvedValue({ success: true }),
        updateSession: vi.fn().mockResolvedValue({ success: true }),
    }
}));

// Setup default mock values
storageSpies.saveSession.mockResolvedValue({ session: { id: 'sess-123' }, usageExceeded: false });
// storageSpies.completeSession.mockResolvedValue({ success: true }); // This is now set in vi.hoisted

vi.mock('../../../lib/storage', () => ({
    saveSession: storageSpies.saveSession,
    heartbeatSession: storageSpies.heartbeatSession,
    completeSession: storageSpies.completeSession,
    updateSession: storageSpies.updateSession,
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

        // Inject mock mic
        (service as unknown as { mic: MicStream }).mic = mockMic;
    });

    afterEach(async () => {
        vi.useRealTimers();
        await speechRuntimeController.reset();
        resetTranscriptionService();
    });

    it('should generate an idempotency key and create a session at start', async () => {
        await speechRuntimeController.warmUp();
        await service.init();
        await speechRuntimeController.startRecording();

        // Wait for sessionId to be set in store (handled by Controller)
        await vi.waitFor(() => {
            if (service.getSessionId()) return;
            throw new Error('Session not set');
        });

        expect(storageSpies.saveSession).toHaveBeenCalledWith(
            expect.any(Object), // sessionData
            expect.any(Object), // profile
            'private',          // engineType
            expect.any(String), // idempotencyKey
            expect.any(Object)  // metadata
        );
    });

    it('should start heartbeat interval after session is created', async () => {
        await speechRuntimeController.warmUp();
        await service.init();
        await speechRuntimeController.startRecording();
        speechRuntimeController.confirmSubscriberHandshake(); // ✅ 3-Way Handshake

        await vi.waitFor(() => {
            if (service.getSessionId()) return;
            throw new Error('Session not set');
        });

        await vi.waitFor(() => {
            expect(storageSpies.heartbeatSession).toHaveBeenCalledWith('sess-123', expect.any(Number));
        });
    });

    it('should complete session and stop heartbeat when transcription stops', async () => {
        await speechRuntimeController.warmUp();
        await service.init();
        await speechRuntimeController.startRecording();
        speechRuntimeController.confirmSubscriberHandshake(); // ✅ 3-Way Handshake

        await vi.waitFor(() => {
            if (service.getSessionId()) return;
            throw new Error('Session not set');
        });

        // Wait at least MIN_RECORDING_DURATION_MS (5000ms) to allow stopping
        await vi.advanceTimersByTimeAsync(6000);

        await speechRuntimeController.stopRecording();

        expect(storageSpies.completeSession).toHaveBeenCalledWith(
            'sess-123',
            expect.objectContaining({
                duration: expect.any(Number),
                transcript: expect.any(String)
            })
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
