import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhisperEngineRegistry } from '../WhisperEngineRegistry';

// Mock Dependencies
vi.mock('../../../../lib/logger', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }
}));

// Mock whisper-turbo
const mockSession = {
    transcribe: vi.fn().mockResolvedValue({ text: "test" }),
    destroy: vi.fn(),
    ping: vi.fn().mockResolvedValue(true)
};

vi.mock('whisper-turbo', () => ({
    SessionManager: vi.fn().mockImplementation(() => ({
        loadModel: vi.fn().mockResolvedValue({
            isErr: false,
            value: mockSession
        }),
        terminate: vi.fn(),
    })),
    AvailableModels: { WHISPER_BASE: 'base' }
}));

describe('WhisperEngineRegistry', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        // Reset registry state
        await WhisperEngineRegistry.purge();

        // Robust Mock for navigator.locks
        const mockLocks = {
            request: vi.fn(async (name, options, callback) => {
                const lock = { name };
                return await callback(lock);
            })
        };

        if (!(global as unknown as { navigator?: unknown }).navigator) {
            (global as unknown as { navigator: Record<string, unknown> }).navigator = {};
        }
        Object.defineProperty((global as unknown as { navigator: Record<string, unknown> }).navigator, 'locks', {
            value: mockLocks,
            configurable: true,
            writable: true
        });

        // Mock global location and fetch
        Object.defineProperty(global, 'window', {
            value: { location: { origin: 'http://localhost' } },
            configurable: true,
            writable: true
        });

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
        }));

        // Mock performance.now
        global.performance.now = vi.fn().mockReturnValue(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should acquire engine using Web Locks API with ifAvailable: true', async () => {
        const session = await WhisperEngineRegistry.acquire();
        expect(navigator.locks.request).toHaveBeenCalledWith(
            'whisper-webgpu-singleton',
            { mode: 'exclusive', ifAvailable: true },
            expect.any(Function)
        );
        expect(session).toBeDefined();
    });

    it('should use BroadcastChannel fallback if Web Locks API is missing', async () => {
        // 1. Remove navigator.locks
        Object.defineProperty(global.navigator, 'locks', { value: undefined, configurable: true });

        // 2. Mock BroadcastChannel to simulate coordination
        // Success path: Don't respond to ping -> we are the first tab
        const mockChannel = {
            postMessage: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            close: vi.fn(),
        };
        vi.stubGlobal('BroadcastChannel', vi.fn().mockImplementation(() => mockChannel));

        // 3. Trigger acquisition
        WhisperEngineRegistry.WARMUP_TIMEOUT = 100;
        const acquirePromise = WhisperEngineRegistry.acquire();

        // 4. Advance timers for the 100ms coordination polyfill check
        // WhisperRegistry uses 100ms for pings
        await vi.advanceTimersByTimeAsync(110);

        // Advance timers for the warmupWithTimeout (100ms)
        await vi.advanceTimersByTimeAsync(100);

        const session = await acquirePromise;

        // 5. Verify behavioral contract
        expect(session).toBeDefined();
        expect(mockChannel.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'acquire-ping' }));
        expect(mockChannel.close).toHaveBeenCalled();
    });

    it('should acquire engine using Web Locks API', async () => {
        const session = await WhisperEngineRegistry.acquire();
        expect(navigator.locks.request).toHaveBeenCalledWith(
            'whisper-webgpu-singleton',
            { mode: 'exclusive', ifAvailable: true },
            expect.any(Function)
        );
        expect(session).toBeDefined();
    });

    it('should deduplicate concurrent acquire calls (Inversion Safety)', async () => {
        // Start two acquisitions simultaneously
        const p1 = WhisperEngineRegistry.acquire();
        const p2 = WhisperEngineRegistry.acquire();

        // Both should resolve to the same session instance (deduplication)
        const [s1, s2] = await Promise.all([p1, p2]);

        expect(s1).toBeDefined();
        expect(s1).toBe(s2);
        // singleton pattern: session is only created once
    });

    it('should trigger purge if heartbeat probe fails', async () => {
        // Prevent recursive timer issues by mocking setInterval
        const setIntervalSpy = vi.spyOn(global, 'setInterval');
        let heartbeatCallback: (() => Promise<void>) | null = null;
        setIntervalSpy.mockImplementation(((cb: () => Promise<void>) => {
            heartbeatCallback = cb;
            return 999;
        }) as unknown as typeof setInterval);

        const session = await WhisperEngineRegistry.acquire();
        const purgeSpy = vi.spyOn(WhisperEngineRegistry, 'purge');

        // Mock failure on the specific session instance's transcribe method
        (session as { transcribe: import('vitest').Mock }).transcribe.mockRejectedValue(new Error('GPU HANG'));

        // Manually trigger the heartbeat callback
        await heartbeatCallback!();

        expect(purgeSpy).toHaveBeenCalled();
        setIntervalSpy.mockRestore();
    });

    it('should release engine correctly and allow subsequent acquisition after purge', async () => {
        await WhisperEngineRegistry.acquire();
        WhisperEngineRegistry.release();

        // Release reduces refCount but doesn't purge immediately (usually 10s grace, but release is separate)
        // Actually release() in our impl just handles refCounts.

        await WhisperEngineRegistry.purge();

        // Should be able to acquire again
        const session2 = await WhisperEngineRegistry.acquire();
        expect(session2).toBeDefined();
    });
});
