import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock AudioProcessor - MUST BE AT TOP LEVEL FOR HOISTING
vi.mock('@/services/transcription/utils/AudioProcessor', () => ({
    floatToInt16Async: vi.fn(async (input: Float32Array) => ({
        result: new Int16Array(input.length),
        base64: 'fake-base64'
    })),
    floatToInt16: vi.fn((input: Float32Array) => new Int16Array(input.length)),
    concatenateFloat32Arrays: vi.fn((_arrays: Float32Array[]) => new Float32Array(0)),
    AudioBuffer: class {
        addSamples = vi.fn(() => null);
        flush = vi.fn(() => new Int16Array(0));
        clear = vi.fn();
    }
}));

// Mock Supabase client
const mockGetSession = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        auth: {
            getSession: mockGetSession
        }
    })
}));

import CloudAssemblyAI from '@/services/transcription/modes/CloudAssemblyAI';
import { Session } from '@supabase/supabase-js';



// Mock Global WebSocket
class MockWebSocket {
    static instances: MockWebSocket[] = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    url: string;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    readyState: number = MockWebSocket.CONNECTING;
    send = vi.fn();
    close = vi.fn(() => {
        this.readyState = MockWebSocket.CLOSED;
        // Trigger onclose synchronously for test determinism
        if (this.onclose) {
            const cb = this.onclose;
            this.onclose = null;
            cb({ code: 1000, reason: 'Test closure' } as CloseEvent);
        }
    });

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
    }

    // Helper to simulate server events
    simulateOpen() {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
    }

    simulateMessage(data: unknown) {
        // cast to MessageEvent for test simplicity
        this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
    }

    simulateClose(code = 1000, reason = '') {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({ code, reason } as CloseEvent);
    }

    simulateError(error: unknown) {
        this.onerror?.(error as Event);
    }
}

describe('CloudAssemblyAI (Native WebSocket)', () => {
    let mode: CloudAssemblyAI;
    const onTranscriptUpdate = vi.fn();
    const onReady = vi.fn();
    const onError = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetAllMocks();

        // Setup WebSocket Mock using Vitest global stubbing
        vi.stubGlobal('WebSocket', MockWebSocket);
        MockWebSocket.instances = [];

        // Setup Supabase Mock
        mockGetSession.mockResolvedValue({
            data: { session: { access_token: 'fake-access-token' } }
        });

        // Mock fetch for the token endpoint
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ token: 'temp-assemblyai-token' })
        });

        mode = new CloudAssemblyAI({
            onTranscriptUpdate,
            onModelLoadProgress: vi.fn(),
            onReady,
            onError,
            session: { access_token: 'fake-access-token' } as Session
        });

        // Force auth path for connection test by disabling E2E bypass
        vi.spyOn(mode as unknown as { isE2EEnvironment: () => boolean }, 'isE2EEnvironment').mockReturnValue(false);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    const LAST_SOCKET = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

    describe('Connection & Generation ID', () => {
        it('should fetch token and connect to WebSocket with correct URL', async () => {
            await mode.init();
            await mode.start();

            // 1. Check fetch call
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('assemblyai-token'),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer fake-access-token'
                    })
                })
            );

            // 2. verify WebSocket creation
            const socket = LAST_SOCKET();
            expect(socket).toBeDefined();
            expect(socket.url).toContain('token=temp-assemblyai-token');
            expect(socket.url).toContain('sample_rate=16000');

            // 3. Open connection
            socket.simulateOpen();

            expect(onReady).toHaveBeenCalled();
        });

        it('should ignore events from zombie connections (Generation ID guard)', async () => {
            // Start connection 1
            await mode.init();
            await mode.start();
            const socket1 = LAST_SOCKET();

            // Stop and restart quickly
            await mode.stop();
            await mode.init();
            await mode.start();

            const socket2 = LAST_SOCKET();
            expect(socket2).not.toBe(socket1);

            // Now "socket1" finally opens. It should be ignored.
            socket1.simulateOpen();
            expect(onReady).not.toHaveBeenCalled(); // Should not match current ID

            // socket1 receiving a message should be ignored
            socket1.simulateMessage({ message_type: 'FinalTranscript', text: 'Ghost' });
            expect(onTranscriptUpdate).not.toHaveBeenCalled();

            // socket2 opens -> valid
            socket2.simulateOpen();
            expect(onReady).toHaveBeenCalled();

            // socket2 receives message -> valid
            socket2.simulateMessage({ message_type: 'FinalTranscript', text: 'Real' });
            expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { final: 'Real' } });
        });
    });

    describe('Transcript Handling', () => {
        it('should handle Partial and Final transcripts correctly', async () => {
            await mode.init();
            await mode.start();
            const socket = LAST_SOCKET();
            socket.simulateOpen();

            // Partial
            socket.simulateMessage({
                message_type: 'PartialTranscript',
                text: 'Hello'
            });
            expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { partial: 'Hello' } });

            // Final
            socket.simulateMessage({
                message_type: 'FinalTranscript',
                text: 'Hello world.'
            });
            expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { final: 'Hello world.' } });
        });
    });

    describe('Resilience & Backoff', () => {
        it('should reconnect with exponential backoff on error', async () => {
            await mode.init();
            await mode.start();
            const socket = LAST_SOCKET();
            socket.simulateOpen();

            // Simulate connection loss (onerror + onclose)
            socket.simulateClose(1006, 'Abnormal Closure');

            // Should NOT reconnect immediately
            await vi.advanceTimersByTimeAsync(500);
            expect(MockWebSocket.instances.length).toBe(1); // No new instance yet

            // Wait for backoff (base 1000ms + jitter)
            await vi.advanceTimersByTimeAsync(1500);
            // Wait for connection to be re-established
            await vi.waitUntil(() => MockWebSocket.instances.length === 2);

            expect(MockWebSocket.instances.length).toBe(2);

            // 2nd failure
            const socket2 = LAST_SOCKET();
            socket2.simulateClose(1006, 'Abnormal');

            // Backoff increase (approx 2000ms)
            await vi.advanceTimersByTimeAsync(1500);
            expect(MockWebSocket.instances.length).toBe(2); // Still waiting

            await vi.advanceTimersByTimeAsync(2000);
            await vi.waitUntil(() => MockWebSocket.instances.length === 3);
            expect(MockWebSocket.instances.length).toBe(3);
        });

        it('should give up after max retries', async () => {
            await mode.init();
            await mode.start();
            LAST_SOCKET().simulateOpen();

            // Fail 6 times (max is 5)
            for (let i = 0; i <= 5; i++) {
                LAST_SOCKET().simulateClose(1006, 'Fail');
                // Advance enough to cover backoff (max is 16s * 1000)
                await vi.advanceTimersByTimeAsync(35000);
                await Promise.resolve();
            }

            expect(onError).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('Connection lost')
            }));
        });
    });

    describe('Audio Processing', () => {
        it('should queue audio when connecting and flush on open (Behavioral)', async () => {
            await mode.init();
            await mode.start();

            // Allow microtasks to complete (fetchToken, etc.)
            await Promise.resolve();

            const audioData = new Float32Array([0.5, -0.5]);
            mode.processAudio(audioData);

            // ✅ Behavioral check: Queue should have 1 item while connecting
            expect(mode['audioQueue'].length).toBe(1);

            const socket = LAST_SOCKET();
            if (!socket) throw new Error('No socket found');

            socket.simulateOpen();

            // ✅ Use behavioral waiting: Wait for the socket to actually send the data
            // This handles the async nature of _doFlush and floatToInt16Async
            await vi.waitUntil(() => socket.send.mock.calls.length > 0);

            expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('audio_data'));

            // ✅ Behavioral check: Queue should also be empty now
            expect(mode['audioQueue'].length).toBe(0);
        });
    });

});
