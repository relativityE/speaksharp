import { describe, it, expect, vi, beforeEach } from 'vitest';
import CloudAssemblyAI from '../modes/CloudAssemblyAI';
import { MicStream } from '../utils/types';

const mockSocket = {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
};

vi.mock('../utils/ManagedWebSocket', () => ({
    ManagedWebSocket: vi.fn(() => mockSocket),
}));

describe('CloudAssemblyAI', () => {
    let cloudAI: CloudAssemblyAI;
    const onTranscriptUpdate = vi.fn();
    const getAssemblyAIToken = vi.fn().mockResolvedValue('fake-token');

    beforeEach(() => {
        vi.clearAllMocks();
        cloudAI = new CloudAssemblyAI({
            onTranscriptUpdate,
            getAssemblyAIToken,
            onReady: vi.fn(),
            session: null,
            navigate: vi.fn(),
            onModelLoadProgress: vi.fn(),
        });
    });

    it('should initialize and get a token', async () => {
        await cloudAI.init();
        expect(getAssemblyAIToken).toHaveBeenCalled();
    });

    it('should open a websocket connection on startTranscription', async () => {
        await cloudAI.init();
        await cloudAI.startTranscription({ sampleRate: 16000 } as MicStream);
        expect(mockSocket.on).toHaveBeenCalledWith('open', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should send audio data when the websocket is open', async () => {
        await cloudAI.init();
        await cloudAI.startTranscription({
            sampleRate: 16000,
            onFrame: (handler) => handler(new Float32Array([1, 2, 3])),
        } as MicStream);

        // Manually trigger the 'open' event
        const openCallback = mockSocket.on.mock.calls.find(call => call[0] === 'open')?.[1];
        if (openCallback) {
            openCallback();
        }

        expect(mockSocket.send).toHaveBeenCalledWith(JSON.stringify({ audio_data: 'AQI=' }));
    });

    it('should handle incoming messages', async () => {
        await cloudAI.init();
        await cloudAI.startTranscription({ sampleRate: 16000 } as MicStream);

        // Manually trigger a 'message' event
        const messageCallback = mockSocket.on.mock.calls.find(call => call[0] === 'message')?.[1];
        if (messageCallback) {
            messageCallback(JSON.stringify({ message_type: 'SessionBegins', 'session_id': '123' }));
        }

        expect(onTranscriptUpdate).toHaveBeenCalledWith({
            transcript: { partial: 'Session started...' },
        });
    });

    it('should close the websocket on stopTranscription', async () => {
        await cloudAI.init();
        await cloudAI.startTranscription({ sampleRate: 16000 } as MicStream);
        await cloudAI.stopTranscription();
        expect(mockSocket.close).toHaveBeenCalled();
    });
});