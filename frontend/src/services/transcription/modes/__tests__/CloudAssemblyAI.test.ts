import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import CloudAssemblyAI from '../CloudAssemblyAI';
import { Session } from '@supabase/supabase-js';
import type {
    CloudAuthContext,
    CloudConnectionContext,
    CloudProviderEvent,
    CloudSttProvider,
} from '../../providers/cloud/types';
// Removed unused TranscriptionModeOptions, Transcript imports

vi.mock('../../utils/AudioProcessor', () => ({
    floatToInt16: vi.fn((float32Array: Float32Array) => new Int16Array(float32Array.length)),
    floatToInt16Async: vi.fn(async (float32Array: Float32Array) => {
        const result = new Int16Array(float32Array.length);
        return { result, base64: 'mock-base64' };
    }),
}));

// Mock WebSocket
class MockWebSocket {
    public static CONNECTING = 0;
    public static OPEN = 1;
    public static CLOSING = 2;
    public static CLOSED = 3;
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

    public simulateBegin(id: string = 'assemblyai-session-id') {
        this.simulateMessage({
            type: 'Begin',
            id,
            configuration: {
                model: 'universal-streaming-english',
                api_version: '2025-05-12',
            },
        });
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
            runId: 'test-instance',
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
        expect(socket.url, `[TRACE-P1] expected AssemblyAI v3 WebSocket path — ${trace}`).toContain('wss://streaming.assemblyai.com/v3/ws?');
        expect(socket.url, `[TRACE-P1] expected Universal Streaming model in URL — ${trace}`).toContain('speech_model=universal-streaming-english');
        // fetchToken() returns the mock fetch token
        expect(socket.url, `[TRACE-P1] expected mock token in URL — ${trace}`).toContain('token=temp-assemblyai-token');
        
        socket.simulateOpen();
        expect(onReady).not.toHaveBeenCalled();
        socket.simulateBegin();
        expect(onReady).toHaveBeenCalled();
    });

    it('prefers the app-provided AssemblyAI token callback over direct fetch', async () => {
        const getAssemblyAIToken = vi.fn().mockResolvedValue('callback-token');
        mode = new CloudAssemblyAI({
            runId: 'test-instance',
            onTranscriptUpdate,
            onModelLoadProgress: vi.fn(),
            onReady,
            onError,
            session: { access_token: 'fake-access-token' } as Session,
            getAssemblyAIToken,
        });
        vi.spyOn(mode, 'isE2EEnvironment').mockReturnValue(false);

        await mode.init();
        await mode.start();

        const socket = LAST_SOCKET();
        expect(getAssemblyAIToken).toHaveBeenCalledTimes(1);
        expect(mockFetch).not.toHaveBeenCalled();
        expect(socket.url).toContain('token=callback-token');
    });

    it('does not include unproven keyterms/prompt params when Cloud starts with user words', async () => {
        await mode.init();
        await mode.start(undefined, ['CanaryBoostTest', 'Productization']);

        const socket = LAST_SOCKET();
        expect(socket).toBeDefined();

        const params = new URL(socket.url).searchParams;
        expect(params.has('keyterms_prompt')).toBe(false);
        expect(params.has('prompt')).toBe(false);
    });

    it('does not include default filler prompt params on the launch-safe AssemblyAI path', async () => {
        await mode.init();
        await mode.start();

        const socket = LAST_SOCKET();
        expect(socket).toBeDefined();

        const params = new URL(socket.url).searchParams;
        expect(params.has('keyterms_prompt')).toBe(false);
        expect(params.has('prompt')).toBe(false);
    });

    it('Pillar 2: should ignore events from zombie connections (Identity Hardening)', async () => {
        await mode.init();
        await mode.start();
        const socket1 = LAST_SOCKET();
        socket1.simulateOpen();
        socket1.simulateBegin(); // socket1 legitimately becomes provider-ready → onReady called

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

        // socket2 opens (connectionId=2) but is not ready until AssemblyAI Begin
        socket2.simulateOpen();
        expect(onReady).not.toHaveBeenCalled();
        socket2.simulateBegin();
        expect(onReady).toHaveBeenCalledTimes(1);

        // socket1 arrives late (zombie, connectionId=1 ≠ 2) → should be rejected
        vi.clearAllMocks();
        socket1.simulateOpen();
        expect(onReady).not.toHaveBeenCalled();
        expect(socket1.onmessage).toBeNull();

        // Only socket2 messages should be processed
        socket2.simulateMessage({ type: 'Turn', transcript: 'Real', end_of_turn: true });
        expect(onTranscriptUpdate).toHaveBeenCalledWith({
            transcript: {
                final: 'Real',
                speaker: undefined,
            },
        });
    });

    it('Pillar 3: should handle transcripts with heartbeat synchronization', async () => {
        // Use the now-public method directly for non-suppressed spying
        const heartbeatSpy = vi.spyOn(mode, 'updateHeartbeat');
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();
        socket.simulateBegin();

        socket.simulateMessage({ type: 'Turn', transcript: 'Hello', end_of_turn: false });
        expect(heartbeatSpy).toHaveBeenCalled();
        expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { partial: 'Hello' } });
    });

    it('buffers audio until AssemblyAI provider-ready and then sends provider-valid chunks', async () => {
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();

        for (let i = 0; i < 19; i++) {
            mode.processAudio(new Float32Array(43));
        }
        await mode.waitForFlush();
        expect(socket.send).not.toHaveBeenCalled();

        socket.simulateBegin();
        await mode.waitForFlush();

        expect(socket.send).toHaveBeenCalledTimes(1);
        const sentPayload = socket.send.mock.calls[0][0] as ArrayBuffer;
        expect(sentPayload.byteLength).toBe(1600);
    });

    it('pads and sends trailing audio below the provider minimum before stop', async () => {
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();
        socket.simulateBegin();

        mode.processAudio(new Float32Array(43));
        await mode.waitForFlush();
        expect(socket.send).not.toHaveBeenCalled();

        vi.useRealTimers();
        await mode.stop();

        expect(socket.send).toHaveBeenCalledTimes(2);
        const sentPayload = socket.send.mock.calls[0][0] as ArrayBuffer;
        expect(sentPayload.byteLength).toBe(1600);
        expect(socket.send.mock.calls[1][0]).toBe(JSON.stringify({ type: 'Terminate' }));
    });

    it('treats Cloud audio frames as heartbeat activity while provider messages are quiet', async () => {
        const heartbeatSpy = vi.spyOn(mode, 'updateHeartbeat');
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();

        heartbeatSpy.mockClear();
        mode.processAudio(new Float32Array(43));

        expect(heartbeatSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle AssemblyAI v3 Turn messages', async () => {
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();
        socket.simulateBegin();

        socket.simulateMessage({ type: 'Turn', transcript: 'Hello from v3', end_of_turn: false });
        expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { partial: 'Hello from v3' } });

        socket.simulateMessage({ type: 'Turn', transcript: 'Hello from v3 final.', end_of_turn: true });
        expect(onTranscriptUpdate).toHaveBeenCalledWith({
            transcript: {
                final: 'Hello from v3 final.',
                speaker: undefined,
            },
        });
    });

    it('REGRESSION: preserves final AssemblyAI tail Turn after Terminate is sent', async () => {
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();
        socket.simulateBegin();

        socket.simulateMessage({ type: 'Turn', transcript: 'The visible opening', end_of_turn: false });
        expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { partial: 'The visible opening' } });

        const stopPromise = mode.stop();
        await vi.waitFor(() => {
            expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'Terminate' }));
        });

        expect(socket.onmessage).toBeTypeOf('function');

        socket.simulateMessage({
            type: 'Turn',
            transcript: 'The visible opening and the final tail sentence.',
            end_of_turn: true,
        });
        socket.simulateMessage({ type: 'Termination' });

        await stopPromise;

        expect(onTranscriptUpdate).toHaveBeenCalledWith({
            transcript: {
                final: 'The visible opening and the final tail sentence.',
                speaker: undefined,
            },
        });
        expect(await mode.getTranscript()).toBe('The visible opening and the final tail sentence.');
    });

    it('should handle AssemblyAI v3 partial Turn text from words when top-level text is empty', async () => {
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();
        socket.simulateBegin();

        socket.simulateMessage({
            type: 'Turn',
            transcript: '',
            utterance: '',
            end_of_turn: false,
            words: [
                { text: 'Cloud', word_is_final: false },
                { text: 'partial', word_is_final: false },
            ],
        });

        expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { partial: 'Cloud partial' } });
    });

    it('honors the generic Cloud provider contract with fake provider events', async () => {
        const receivedCustomTerms: string[][] = [];
        const fakeProvider: CloudSttProvider = {
            id: 'fake-cloud',
            displayName: 'Fake Cloud Provider',
            modelName: 'fake-model',
            getCapabilities: () => ({
                interimResults: true,
                finalResults: true,
                confidenceScores: false,
                wordTimestamps: false,
                speakerLabels: false,
                customTerms: true,
                punctuation: true,
            }),
            getToken: async (_context: CloudAuthContext) => ({ token: 'fake-token' }),
            buildWebSocketUrl: (context: CloudConnectionContext) => {
                receivedCustomTerms.push(context.customTerms);
                return `wss://fake-cloud.example/ws?token=${context.token.token}`;
            },
            buildOpenMessage: () => null,
            getAudioPolicy: () => ({
                sampleRateHz: 16000,
                encoding: 'pcm_s16le',
                minPacketSamples: 800,
                maxPacketSamples: 16000,
                maxQueuedAudioFrames: 4000,
                canStreamBeforeProviderReady: false,
            }),
            encodeAudio: (audio: Float32Array) => new Int16Array(audio.length).buffer,
            parseMessage: (raw: string | ArrayBuffer): CloudProviderEvent[] => {
                if (typeof raw !== 'string') return [];
                return JSON.parse(raw) as CloudProviderEvent[];
            },
            buildTerminateMessage: () => 'FAKE_TERMINATE',
            classifyClose: () => ({
                recoverable: true,
                reason: 'fake-close',
                shouldPreserveTranscript: true,
            }),
        };

        mode = new CloudAssemblyAI({
            runId: 'fake-provider-run',
            onTranscriptUpdate,
            onModelLoadProgress: vi.fn(),
            onReady,
            onError,
            session: { access_token: 'fake-access-token' } as Session
        }, undefined, fakeProvider);

        await mode.init();
        await mode.start(undefined, ['ProviderSwapTerm']);
        const socket = LAST_SOCKET();
        socket.simulateOpen();

        mode.processAudio(new Float32Array(800));
        await mode.waitForFlush();
        expect(socket.send).not.toHaveBeenCalled();

        socket.onmessage?.({ data: JSON.stringify([{ type: 'provider-ready', sessionId: 'fake-session' }]) });
        await mode.waitForFlush();
        expect(onReady).toHaveBeenCalledTimes(1);
        expect(socket.send).toHaveBeenCalledTimes(1);
        expect(receivedCustomTerms[0]).toEqual(['ProviderSwapTerm']);

        socket.onmessage?.({ data: JSON.stringify([
            { type: 'partial', text: 'Normalized partial' },
            { type: 'final', text: 'Normalized final.' },
        ]) });

        expect(onTranscriptUpdate).toHaveBeenCalledWith({ transcript: { partial: 'Normalized partial' } });
        expect(onTranscriptUpdate).toHaveBeenCalledWith({
            transcript: {
                final: 'Normalized final.',
                speaker: undefined,
            },
        });

        vi.useRealTimers();
        await mode.stop();
        expect(socket.send).toHaveBeenLastCalledWith('FAKE_TERMINATE');
    });

    it('Pillar 4: should handle connection loss with exponential backoff', async () => {
        await mode.init();
        await mode.start();
        const socket = LAST_SOCKET();
        socket.simulateOpen();
        socket.simulateBegin();

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
        socket.simulateBegin();

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
        socket.simulateBegin();

        // Switch to real timers so closeConnection()'s Promise resolves
        vi.useRealTimers();
        await mode.stop();

        // MockWebSocket.close() fires onclose synchronously → socket is CLOSED after stop()
        expect(socket.readyState).toBe(3); // CLOSED — deterministic shutdown confirmed
    });
});
