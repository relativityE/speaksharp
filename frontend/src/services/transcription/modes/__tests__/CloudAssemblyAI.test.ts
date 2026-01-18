import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import CloudAssemblyAI from '../CloudAssemblyAI';
import { MicStream } from '../../utils/types';

// Mock the global WebSocket
class MockWebSocket {
    url: string;
    readyState: number = 0; // CONNECTING
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    send = vi.fn();
    close = vi.fn(function (this: MockWebSocket, code?: number) {
        this.readyState = 3; // CLOSED
        if (this.onclose) this.onclose({ code: code || 1000, reason: 'Normal Closure', wasClean: true });
    });

    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
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

describe('CloudAssemblyAI (Success Path & Resilience)', () => {
    let mode: CloudAssemblyAI;
    const onTranscriptUpdate = vi.fn();
    const onReady = vi.fn();
    const getAssemblyAIToken = vi.fn();
    const onConnectionStateChange = vi.fn();
    const onError = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetAllMocks();
        getAssemblyAIToken.mockResolvedValue('test-token');

        mode = new CloudAssemblyAI({
            onTranscriptUpdate,
            onReady,
            getAssemblyAIToken,
            onConnectionStateChange,
            onError,
            onModelLoadProgress: vi.fn(),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const createMockMicStream = (): MicStream => ({
        sampleRate: 16000,
        onFrame: vi.fn(),
        offFrame: vi.fn(),
        close: vi.fn(),
        stop: vi.fn(),
        _mediaStream: new MediaStream(),
    });

    describe('Core Transcription Logic', () => {
        it('should get a token and open a websocket on startTranscription', async () => {
            const micStream = createMockMicStream();
            const startPromise = mode.startTranscription(micStream);
            await vi.advanceTimersByTimeAsync(0);

            expect(getAssemblyAIToken).toHaveBeenCalled();
            expect(MockWebSocket.lastInstance?.url).toContain('token=test-token');

            // The startPromise resolves when onReady is called (simulated by timeout in MockWebSocket constructor)
            await startPromise;
            expect(onReady).toHaveBeenCalled();
            expect(micStream.onFrame).toHaveBeenCalled();
        });

        it('should send audio data when the websocket is open', async () => {
            const micStream = createMockMicStream();
            await mode.startTranscription(micStream);
            await vi.advanceTimersByTimeAsync(0);

            // Capture the frame handler
            const mockOnFrame = micStream.onFrame as ReturnType<typeof vi.fn>;
            const frameHandler = mockOnFrame.mock.calls[0][0];

            // Send enough samples to trigger buffer flush (800 samples = 50ms @ 16kHz)
            const samples = new Float32Array(800);
            samples.fill(0.1);
            frameHandler(samples);

            expect(MockWebSocket.lastInstance?.send).toHaveBeenCalled();
        });

        it('should handle incoming transcript messages', async () => {
            const micStream = createMockMicStream();
            await mode.startTranscription(micStream);
            await vi.advanceTimersByTimeAsync(0);

            // Simulate partial result
            const partialEvent = { data: JSON.stringify({ type: 'Turn', transcript: 'hello', turn_is_formatted: false }) } as MessageEvent;
            MockWebSocket.lastInstance!.onmessage!(partialEvent);
            expect(onTranscriptUpdate).toHaveBeenCalledWith(expect.objectContaining({
                transcript: { partial: 'hello' }
            }));

            // Simulate final result
            const finalEvent = { data: JSON.stringify({ type: 'Turn', transcript: 'hello world', turn_is_formatted: true, words: [] }) } as MessageEvent;
            MockWebSocket.lastInstance!.onmessage!(finalEvent);
            expect(onTranscriptUpdate).toHaveBeenCalledWith(expect.objectContaining({
                transcript: { final: 'hello world' }
            }));
        });
    });

    describe('Resilience & Reconnection', () => {
        it('should reconnect with exponential backoff on unplanned closure', async () => {
            const micStream = createMockMicStream();
            await mode.startTranscription(micStream);
            await vi.runOnlyPendingTimersAsync();

            expect(onConnectionStateChange).toHaveBeenCalledWith('connected');
            onConnectionStateChange.mockClear();

            // 1st failure: Reconnect after 3s
            MockWebSocket.lastInstance!.onclose!({ code: 1006, reason: 'Abnormal Closure', wasClean: false });
            expect(onConnectionStateChange).toHaveBeenCalledWith('reconnecting');
            await vi.advanceTimersByTimeAsync(4000);
            expect(getAssemblyAIToken).toHaveBeenCalledTimes(2);

            // 2nd failure: Reconnect after 6s
            MockWebSocket.lastInstance!.onclose!({ code: 1006, reason: 'Abnormal Closure', wasClean: false });
            await vi.advanceTimersByTimeAsync(7000);
            expect(getAssemblyAIToken).toHaveBeenCalledTimes(3);
        });

        it('should stop reconnecting after max attempts', async () => {
            getAssemblyAIToken
                .mockResolvedValueOnce('token-1') // Initial
                .mockResolvedValue(null);  // All reconnects fail

            const micStream = createMockMicStream();
            await mode.startTranscription(micStream);
            await vi.runOnlyPendingTimersAsync();

            // Trigger initial failure
            MockWebSocket.lastInstance!.onclose!({ code: 1006, reason: 'Abnormal Closure', wasClean: false });

            // Run through 5 attempts
            for (let i = 0; i < 5; i++) {
                // Delay: 3000, 6000, 12000, 24000, 30000(cap)
                const delay = Math.min(3000 * Math.pow(2, i), 30000);
                await vi.advanceTimersByTimeAsync(delay + 1000);
            }

            expect(getAssemblyAIToken).toHaveBeenCalledTimes(6); // 1 initial + 5 attempts
            expect(onError).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('Max reconnection attempts reached')
            }));
            expect(onConnectionStateChange).toHaveBeenLastCalledWith('disconnected');
        });

        it('should NOT reconnect if stop was manual', async () => {
            const micStream = createMockMicStream();
            await mode.startTranscription(micStream);
            await vi.runOnlyPendingTimersAsync();

            onConnectionStateChange.mockClear();
            await mode.stopTranscription();

            const states = onConnectionStateChange.mock.calls.map(call => call[0]);
            expect(states).toContain('disconnected');
            expect(states).not.toContain('reconnecting');
            expect(getAssemblyAIToken).toHaveBeenCalledTimes(1);
        });
    });
});
