import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import CloudAssemblyAI from '../CloudAssemblyAI';


// Mock the global WebSocket
class MockWebSocket {
    url: string;
    readyState: number = 0; // CONNECTING
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    send = vi.fn();
    close = vi.fn(function (this: MockWebSocket, code?: number) {
        this.readyState = 3; // CLOSED
        if (this.onclose) this.onclose({ code: code || 1000, reason: 'Normal Closure', wasClean: true });
    });

    static OPEN = 1;
    static CLOSED = 3;

    constructor(url: string) {
        this.url = url;
        MockWebSocket.lastInstance = this;
        // Simulate async open
        setTimeout(() => {
            // Only open if we haven't been closed already
            if (this.readyState === 0) {
                this.readyState = 1; // OPEN
                if (this.onopen) this.onopen();
            }
        }, 0);
    }

    static lastInstance: MockWebSocket | null = null;
}

vi.stubGlobal('WebSocket', MockWebSocket);

describe('CloudAssemblyAI Resilience', () => {
    let mode: CloudAssemblyAI;
    const onTranscriptUpdate = vi.fn();
    const onReady = vi.fn();
    const getAssemblyAIToken = vi.fn();
    const onConnectionStateChange = vi.fn();
    const onError = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetAllMocks(); // Use resetAllMocks to clear implementations
        getAssemblyAIToken.mockResolvedValue('test-token'); // Default implementation

        mode = new CloudAssemblyAI({
            onTranscriptUpdate,
            onReady,
            getAssemblyAIToken,
            onConnectionStateChange,
            onError
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const mockMic = {
        sampleRate: 16000,
        onFrame: vi.fn(),
        offFrame: vi.fn(),
    };

    it('should reconnect with exponential backoff on unplanned closure', async () => {
        // @ts-expect-error - mockMic is partial
        await mode.startTranscription(mockMic);
        await vi.runOnlyPendingTimersAsync();

        // Initial connection
        expect(onConnectionStateChange).toHaveBeenCalledWith('connected');
        onConnectionStateChange.mockClear();

        // 1st failure: 1006 -> Reconnect after 1s
        MockWebSocket.lastInstance!.onclose!({ code: 1006, reason: 'Abnormal Closure', wasClean: false });
        expect(onConnectionStateChange).toHaveBeenCalledWith('reconnecting');
        await vi.advanceTimersByTimeAsync(1000);
        expect(getAssemblyAIToken).toHaveBeenCalledTimes(2);

        // 2nd failure: 1006 -> Reconnect after 2s
        MockWebSocket.lastInstance!.onclose!({ code: 1006, reason: 'Abnormal Closure', wasClean: false });
        await vi.advanceTimersByTimeAsync(2000);
        expect(getAssemblyAIToken).toHaveBeenCalledTimes(3);

        // 3rd failure: 1006 -> Reconnect after 4s
        MockWebSocket.lastInstance!.onclose!({ code: 1006, reason: 'Abnormal Closure', wasClean: false });
        await vi.advanceTimersByTimeAsync(4000);
        expect(getAssemblyAIToken).toHaveBeenCalledTimes(4);
    });

    it('should stop reconnecting after max attempts', async () => {
        // Make token fetch fail for subsequent attempts to prevent onopen reset
        getAssemblyAIToken
            .mockResolvedValueOnce('token-1') // Initial
            .mockResolvedValue(null);  // All reconnects fail

        // @ts-expect-error - mockMic is partial
        await mode.startTranscription(mockMic);
        await vi.runOnlyPendingTimersAsync();

        // Trigger initial failure
        MockWebSocket.lastInstance!.onclose!({ code: 1006, reason: 'Abnormal Closure', wasClean: false });

        // Attempt 1 (1s)
        await vi.advanceTimersByTimeAsync(1000);
        // Attempt 2 (2s)
        await vi.advanceTimersByTimeAsync(2000);
        // Attempt 3 (4s)
        await vi.advanceTimersByTimeAsync(4000);
        // Attempt 4 (8s)
        await vi.advanceTimersByTimeAsync(8000);
        // Attempt 5 (16s)
        await vi.advanceTimersByTimeAsync(16000);

        // After 5 attempts, it should give up
        expect(getAssemblyAIToken).toHaveBeenCalledTimes(6); // 1 initial + 5 attempts
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Max reconnection attempts reached. Please check your network connection.'
        }));
        expect(onConnectionStateChange).toHaveBeenLastCalledWith('disconnected');
    });

    it('should NOT reconnect if stop was manual', async () => {
        // @ts-expect-error - mockMic is partial
        await mode.startTranscription(mockMic);
        await vi.runOnlyPendingTimersAsync();

        // Check instance is captured
        expect(MockWebSocket.lastInstance).toBeDefined();
        onConnectionStateChange.mockClear();

        // Manual stop
        await mode.stopTranscription();

        // Check transitions: should only be 'disconnected' (possibly multiple times but NO 'reconnecting')
        const states = onConnectionStateChange.mock.calls.map(call => call[0]);
        expect(states).toContain('disconnected');
        expect(states).not.toContain('reconnecting');

        expect(getAssemblyAIToken).toHaveBeenCalledTimes(1);
    });
});
