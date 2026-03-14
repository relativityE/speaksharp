import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy, TranscriptionMode } from '../TranscriptionPolicy';
import { MicStream } from '../utils/types';
import { PracticeSession } from '../../../types/session';

// Define the mock factory at the top level to avoid hoisting issues with classes
const createMockEngine = () => {
    return {
        init: vi.fn().mockResolvedValue(undefined),
        startTranscription: vi.fn().mockResolvedValue(undefined),
        stopTranscription: vi.fn().mockResolvedValue('test transcript'),
        getTranscript: vi.fn().mockResolvedValue('test transcript'),
        terminate: vi.fn().mockResolvedValue(undefined),
        getEngineType: () => 'private' as TranscriptionMode,
    };
};

// Mock storage
vi.mock('../../../lib/storage', () => ({
    saveSession: vi.fn(),
    heartbeatSession: vi.fn(),
    completeSession: vi.fn(),
}));

// Mock EngineFactory - using the factory function to avoid reference errors
vi.mock('../EngineFactory', () => ({
    EngineFactory: {
        create: vi.fn().mockImplementation(() => Promise.resolve(createMockEngine()))
    }
}));

import * as storage from '../../../lib/storage';

describe('Phase 2 Safeguards Unit Tests', () => {
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

        // Create a NEW service instance for EVERY test to prevent state pollution
        service = new TranscriptionService({
            policy: basePolicy,
            session: { user: { id: 'user-123' } } as unknown as Parameters<typeof TranscriptionService.prototype['updateCallbacks']>[0]['session'],
        });

        // Inject mock mic
        (service as unknown as { mic: MicStream }).mic = mockMic;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should generate an idempotency key and create a session at start', async () => {
        const mockSaveSession = vi.mocked(storage.saveSession);
        mockSaveSession.mockResolvedValue({
            session: { id: 'sess-123' } as unknown as PracticeSession,
            usageExceeded: false
        });

        await service.init();
        await service.startTranscription();

        // Wait for sessionId to be set (async RPC)
        await vi.waitFor(() => {
            if ((service as unknown as { sessionId: string }).sessionId) return;
            throw new Error('Session not set');
        });

        expect(mockSaveSession).toHaveBeenCalledWith(
            expect.objectContaining({ user_id: 'user-123' }),
            expect.any(Object),
            'private',
            expect.any(String), // idempotencyKey
            expect.any(Object)  // metadata
        );
    });

    it('should start heartbeat interval after session is created', async () => {
        const mockHeartbeat = vi.mocked(storage.heartbeatSession);
        const mockSaveSession = vi.mocked(storage.saveSession);
        mockSaveSession.mockResolvedValue({
            session: { id: 'sess-123' } as unknown as PracticeSession,
            usageExceeded: false
        });

        await service.init();
        await service.startTranscription();

        await vi.waitFor(() => {
            if ((service as unknown as { sessionId: string }).sessionId) return;
            throw new Error('Session not set');
        });

        // Fast forward 31 seconds (HEARTBEAT_PERIOD_MS = 30000)
        await vi.advanceTimersByTimeAsync(31000);

        // Heartbeat takes (sessionId)
        expect(mockHeartbeat).toHaveBeenCalledWith('sess-123', 30);
    });

    it('should complete session and stop heartbeat when transcription stops', async () => {
        const mockComplete = vi.mocked(storage.completeSession);
        const mockSaveSession = vi.mocked(storage.saveSession);
        mockSaveSession.mockResolvedValue({
            session: { id: 'sess-123' } as unknown as PracticeSession,
            usageExceeded: false
        });

        await service.init();
        await service.startTranscription();

        await vi.waitFor(() => {
            if ((service as unknown as { sessionId: string }).sessionId) return;
            throw new Error('Session not set');
        });

        // Wait at least MIN_RECORDING_DURATION_MS (5000ms) to allow stopping
        await vi.advanceTimersByTimeAsync(6000);

        await service.stopTranscription();

        expect(mockComplete).toHaveBeenCalledWith(
            'sess-123',
            expect.any(String),
            expect.any(Number)
        );

        expect((service as unknown as { heartbeatInterval: unknown }).heartbeatInterval).toBeNull();
    });

    it('should verify idempotency key is passed to storage', async () => {
        const mockSaveSession = vi.mocked(storage.saveSession);
        mockSaveSession.mockResolvedValue({
            session: { id: 'existing-id' } as unknown as PracticeSession,
            usageExceeded: false
        });

        await service.startTranscription();
        const key = (service as unknown as { idempotencyKey: string }).idempotencyKey;

        expect(key).toBeTruthy();
        expect(mockSaveSession).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Object),
            'private',
            key, // Verify THE generated key was passed
            expect.any(Object)
        );
    });
});
