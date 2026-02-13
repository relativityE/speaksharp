
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PrivateWhisper from '../PrivateWhisper';
import { MicStream } from '../../utils/types';
import { testRegistry } from '../../TestRegistry';
import { IPrivateSTT } from '../../engines/IPrivateSTT';

// Mock audio utils
vi.mock('../../utils/audioUtils', () => ({
    createMicStream: vi.fn(),
}));

// Mock STT engine
const mockSTTEngine: IPrivateSTT = {
    init: vi.fn(),
    transcribe: vi.fn(),
    destroy: vi.fn(),
    getEngineType: () => 'mock',
};

// Create a real MicStream implementation for testing listeners
class RealHasListenersMicStream implements MicStream {
    state = 'ready' as const;
    sampleRate = 16000;
    _mediaStream = new MediaStream();
    public listeners = new Set<(frame: Float32Array) => void>();

    onFrame(callback: (frame: Float32Array) => void) {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }

    offFrame(callback: (frame: Float32Array) => void) {
        this.listeners.delete(callback);
    }

    stop() { }
    close() { }
}

describe('PrivateWhisper Memory Leaks', () => {
    let whisper: PrivateWhisper;
    let mic: RealHasListenersMicStream;

    const mockOptions = {
        onTranscriptUpdate: vi.fn(),
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn(),
        onStatusChange: vi.fn(),
        session: null,
        navigate: vi.fn(),
        getAssemblyAIToken: vi.fn(),
    };

    beforeEach(() => {
        mic = new RealHasListenersMicStream();
        // Inject mock engine via registry
        testRegistry.register('privateSTT', () => mockSTTEngine);
        whisper = new PrivateWhisper(mockOptions, mockSTTEngine);
    });

    afterEach(async () => {
        await whisper.terminate();
        testRegistry.clear();
    });

    it('should not accumulate listeners on multiple start/stop cycles', async () => {
        // Simulate 100 start/stop cycles (Expert Feedback: Increased from 50)
        for (let i = 0; i < 100; i++) {
            await whisper.startTranscription(mic);
            await whisper.stopTranscription();
        }

        // Verify no listeners remain
        expect(mic.listeners.size).toBe(0);
    });

    it('should cleanup listeners on terminate', async () => {
        await whisper.startTranscription(mic);
        expect(mic.listeners.size).toBe(1);

        await whisper.terminate();
        expect(mic.listeners.size).toBe(0);
    });
});
