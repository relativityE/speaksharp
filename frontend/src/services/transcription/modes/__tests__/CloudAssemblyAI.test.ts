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

// Global WebSocket Mock
vi.stubGlobal('WebSocket', MockWebSocket);

// Mock fetch
const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: 'temp-assemblyai-token' })
});
vi.stubGlobal('fetch', mockFetch);

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

        // Use the now-public method directly for non-suppressed spying
        vi.spyOn(mode, 'isE2EEnvironment').mockReturnValue(false);
    });

    afterEach(async () => {
        if (mode) await mode.destroy();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    const LAST_SOCKET = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

    it('Pillar 1: should fetch token and connect correctly', async () => {
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        expect(socket.url).toContain('token=temp-assemblyai-token');
        
        socket.simulateOpen();
        expect(onReady).toHaveBeenCalled();
    });

    it('Pillar 2: should ignore events from zombie connections (Identity Hardening)', async () => {
        await mode.init();
        await mode.start();
        const socket1 = LAST_SOCKET();

        // Simulate manual restart
        await mode.stop();
        await mode.init();
        await mode.start();
        const socket2 = LAST_SOCKET();
        expect(socket2).not.toBe(socket1);

        // socket1 (Stale) opens -> should be closed and ignored
        socket1.simulateOpen();
        expect(onReady).not.toHaveBeenCalled();
        expect(socket1.onmessage).toBeNull(); // Hardening verification

        // socket2 (Active) opens -> should handshake
        socket2.simulateOpen();
        await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
        
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
        
        // Tick for backoff
        await vi.advanceTimersByTimeAsync(1500); // Default base 1000 + jitter
        expect(mockFetch).toHaveBeenCalledTimes(2); // Second attempt
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

        const stopPromise = mode.stop();
        
        // Socket should NOT be nullified immediately until it closes
        expect(socket.readyState).toBe(1); // Still open (closing)
        
        socket.close();
        await stopPromise;
        
        expect(socket.readyState).toBe(3); // CLOSED
    });
});
