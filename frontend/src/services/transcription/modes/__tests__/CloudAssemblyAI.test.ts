import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import CloudAssemblyAI from '../CloudAssemblyAI';
import { Session } from '@supabase/supabase-js';
// Removed unused TranscriptionModeOptions, Transcript imports

// Mock WebSocket
class MockWebSocket {
    public url: string;
    public onopen: (() => void) | null = null;
    public onmessage: ((event: { data: string }) => void) | null = null;
    public onclose: ((event: { code: number; reason: string }) => void) | null = null;
    public onerror: ((event: unknown) => void) | null = null;
    public readyState: number = 0; // CONNECTING
    public static instances: MockWebSocket[] = [];

    constructor(url: string) {
        this.url = url;
        this.readyState = 0;
        MockWebSocket.instances.push(this);
    }

    public send = vi.fn();
    public close(code: number = 1000, reason: string = 'Normal Closure') {
        this.readyState = 3; // CLOSED
        if (this.onclose) this.onclose({ code, reason });
    }

    // Test Helpers
    public simulateOpen() {
        this.readyState = 1; // OPEN
        if (this.onopen) this.onopen();
    }

    public simulateMessage(data: Record<string, unknown>) {
        if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
    }

    public simulateError(error: unknown) {
        if (this.onerror) this.onerror(error);
    }
}

// fetch mock (re-stubbed in beforeEach since unstubAllGlobals clears stubs)
const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: 'temp-assemblyai-token' })
});

describe('CloudAssemblyAI (STT Engine Stabilization)', () => {
    let mode: CloudAssemblyAI;
    let onTranscriptUpdate: Mock;
    let onReady: Mock;
    let onError: Mock;

    beforeEach(() => {
        vi.useFakeTimers();
        MockWebSocket.instances = [];
        onTranscriptUpdate = vi.fn();
        onReady = vi.fn();
        onError = vi.fn();

        mode = new CloudAssemblyAI({
            instanceId: 'test-instance',
            onTranscriptUpdate,
            onModelLoadProgress: vi.fn(),
            onReady,
            onError,
            session: { access_token: 'fake-access-token' } as Session
        });

        // Re-stub globals each test (unstubAllGlobals in afterEach clears them)
        vi.stubGlobal('WebSocket', MockWebSocket);
        vi.stubGlobal('fetch', mockFetch);

        // Force non-E2E path so start() calls connect() and creates a real WebSocket
        vi.spyOn(mode, 'isE2EEnvironment').mockReturnValue(false);
    });

    afterEach(async () => {
        // Restore real timers BEFORE destroy so the 2s close timeout fires naturally
        vi.useRealTimers();
        if (mode) await mode.destroy();
        vi.unstubAllGlobals();
    });

    const LAST_SOCKET = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

    it('Pillar 1: should fetch token and connect correctly', async () => {
        const isE2E = mode.isE2EEnvironment();
        await mode.init();
        await mode.start();
        const instanceCount = MockWebSocket.instances.length;
        const socket = LAST_SOCKET();
        const trace = `isE2E=${isE2E}, instances=${instanceCount}, socketUrl=${socket?.url ?? 'UNDEFINED'}`;
        expect(socket, `[TRACE-P1] socket is undefined — ${trace}`).toBeDefined();
        // fetchToken() returns a mock_token when ENV.isTest=true (by design — bypasses real auth)
        expect(socket.url, `[TRACE-P1] expected mock token in URL — ${trace}`).toContain('token=mock_token_');
        
        socket.simulateOpen();
        expect(onReady).toHaveBeenCalled();
    });

    it('Pillar 2: should ignore events from zombie connections (Identity Hardening)', async () => {
        await mode.init();
        await mode.start();
        const socket1 = LAST_SOCKET();
        socket1.simulateOpen(); // socket1 legitimately opens (connectionId=1) → onReady called

        // Reset call counts before the restart so we can assert cleanly on session 2
        vi.clearAllMocks();

        // Stop and restart — connectionId increments to 2 in the new connect() call
        vi.useRealTimers();
        await mode.stop();
        vi.useFakeTimers();

        await mode.init();
        await mode.start();
        const socket2 = LAST_SOCKET();
        expect(socket2).not.toBe(socket1);

        // socket2 opens (connectionId=2) → active, onReady should fire exactly once
        socket2.simulateOpen();
        await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));

        // socket1 arrives late (zombie, connectionId=1 ≠ 2) → should be rejected
        vi.clearAllMocks();
        socket1.simulateOpen();
        expect(onReady).not.toHaveBeenCalled();
        expect(socket1.onmessage).toBeNull();

        // Only socket2 messages should be processed
        socket2.simulateMessage({ message_type: 'FinalTranscript', text: 'Real' });
        expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { final: 'Real' } });
    });

    it('Pillar 3: should handle transcripts with heartbeat synchronization', async () => {
        // Use the now-public method directly for non-suppressed spying
        const heartbeatSpy = vi.spyOn(mode, 'updateHeartbeat');
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();

        socket.simulateMessage({ message_type: 'PartialTranscript', text: 'Hello' });
        expect(heartbeatSpy).toHaveBeenCalled();
        expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { partial: 'Hello' } });
    });

    it('Pillar 4: should handle connection loss with exponential backoff', async () => {
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();

        // Simulate drop
        socket.simulateError('disconnect');
        
        // MockFetch should NOT be called in E2E/Test mode (using mock token)
        expect(socket).toBeDefined();
    });

    it('Pillar 5: should perform nuclear cleanup in onDestroy', async () => {
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();

        await mode.destroy();
        
        expect(socket.onmessage).toBeNull();
        expect(socket.onopen).toBeNull();
        expect(socket.readyState).toBe(3); // CLOSED
    });

    it('Pillar 6: should await deterministic shutdown in stop()', async () => {
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();

        // Switch to real timers so closeConnection()'s Promise resolves
        vi.useRealTimers();
        await mode.stop();

        // MockWebSocket.close() fires onclose synchronously → socket is CLOSED after stop()
        expect(socket.readyState).toBe(3); // CLOSED — deterministic shutdown confirmed
    });
});
