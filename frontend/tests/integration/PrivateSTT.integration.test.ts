import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrivateSTT } from '@/services/transcription/engines/PrivateSTT';
import { Result } from 'true-myth';
import logger from '@/lib/logger';

// Mock the engines
vi.mock('@/services/transcription/engines/WhisperTurboEngine', () => ({
    WhisperTurboEngine: vi.fn().mockImplementation(() => ({
        type: 'whisper-turbo',
        init: vi.fn(),
        transcribe: vi.fn(),
        destroy: vi.fn(),
    }))
}));

vi.mock('@/services/transcription/engines/TransformersJSEngine', () => ({
    TransformersJSEngine: vi.fn().mockImplementation(() => ({
        type: 'transformers-js',
        init: vi.fn(),
        transcribe: vi.fn(),
        destroy: vi.fn(),
    }))
}));

vi.mock('@/services/transcription/engines/MockEngine', () => ({
    MockEngine: vi.fn().mockImplementation(() => ({
        type: 'mock',
        init: vi.fn(),
        transcribe: vi.fn(),
        destroy: vi.fn(),
    }))
}));

// Mock the flagging system
vi.mock('@/config/TestFlags', () => ({
    TestFlags: {
        IS_TEST_MODE: false,
        USE_REAL_DATABASE: false,
        USE_REAL_TRANSCRIPTION: false,
        FORCE_CPU_TRANSCRIPTION: false,
        DEBUG_ENABLED: false,
        IS_SESSION_MOCKED: false,
    },
    shouldUseMockTranscription: vi.fn(() => false),
    shouldEnableMocks: vi.fn(() => false),
}));

describe('PrivateSTT Integration (Facade Logic)', () => {
    let privateSTT: PrivateSTT;
    const mockCallbacks = {
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn(),
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        privateSTT = new PrivateSTT();

        // Standardize WebGPU mock
        Object.defineProperty(navigator, 'gpu', {
            value: {},
            configurable: true,
            writable: true
        });
    });

    afterEach(async () => {
        if (privateSTT) {
            await privateSTT.destroy();
        }
    });

    it('should use MockEngine when TestFlags indicates mocking', async () => {
        const { shouldUseMockTranscription } = await import('@/config/TestFlags');
        (shouldUseMockTranscription as any).mockReturnValue(true);

        const { MockEngine } = await import('@/services/transcription/engines/MockEngine');
        const mockInit = vi.fn().mockResolvedValue(Result.ok(undefined));
        (MockEngine as any).mockImplementationOnce(() => ({
            type: 'mock',
            init: mockInit,
            destroy: vi.fn(),
        }));

        const result = await privateSTT.init(mockCallbacks);

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.value : null).toBe('mock');
        expect(mockInit).toHaveBeenCalled();

        // Reset
        (shouldUseMockTranscription as any).mockReturnValue(false);
    });

    it('should select WhisperTurbo when WebGPU is available', async () => {
        // Mock WebGPU presence
        Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });

        const { WhisperTurboEngine } = await import('@/services/transcription/engines/WhisperTurboEngine');
        const mockInit = vi.fn().mockResolvedValue(Result.ok(undefined));
        (WhisperTurboEngine as any).mockImplementationOnce(() => ({
            type: 'whisper-turbo',
            init: mockInit,
            destroy: vi.fn(),
        }));

        const result = await privateSTT.init(mockCallbacks);

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.value : null).toBe('whisper-turbo');
        expect(mockInit).toHaveBeenCalled();
    });

    it('should fallback to TransformersJS if WhisperTurbo fails', async () => {
        // Mock WebGPU presence
        Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });

        const { WhisperTurboEngine } = await import('@/services/transcription/engines/WhisperTurboEngine');
        const { TransformersJSEngine } = await import('@/services/transcription/engines/TransformersJSEngine');

        // Fast engine fails
        (WhisperTurboEngine as any).mockImplementationOnce(() => ({
            type: 'whisper-turbo',
            init: vi.fn().mockResolvedValue(Result.err(new Error('WebGPU Init Failed'))),
            destroy: vi.fn(),
        }));

        // Safe engine succeeds
        const mockSafeInit = vi.fn().mockResolvedValue(Result.ok(undefined));
        (TransformersJSEngine as any).mockImplementationOnce(() => ({
            type: 'transformers-js',
            init: mockSafeInit,
            destroy: vi.fn(),
        }));

        const result = await privateSTT.init(mockCallbacks);

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.value : null).toBe('transformers-js');
        expect(mockSafeInit).toHaveBeenCalled();
    });

    it('should use TransformersJS immediately if WebGPU is unavailable', async () => {
        // Mock WebGPU absence
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });

        const { TransformersJSEngine } = await import('@/services/transcription/engines/TransformersJSEngine');
        const mockSafeInit = vi.fn().mockResolvedValue(Result.ok(undefined));
        (TransformersJSEngine as any).mockImplementationOnce(() => ({
            type: 'transformers-js',
            init: mockSafeInit,
            destroy: vi.fn(),
        }));

        const result = await privateSTT.init(mockCallbacks);

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.value : null).toBe('transformers-js');
        expect(mockSafeInit).toHaveBeenCalled();
    });

    it('should delegate transcription to the active engine', async () => {
        // Initialize with Mock
        const { shouldUseMockTranscription } = await import('@/config/TestFlags');
        (shouldUseMockTranscription as any).mockReturnValue(true);

        const { MockEngine } = await import('@/services/transcription/engines/MockEngine');
        const mockTranscribe = vi.fn().mockResolvedValue(Result.ok('transcribed text'));
        (MockEngine as any).mockImplementationOnce(() => ({
            type: 'mock',
            init: vi.fn().mockResolvedValue(Result.ok(undefined)),
            transcribe: mockTranscribe,
            destroy: vi.fn(),
        }));

        await privateSTT.init(mockCallbacks);
        const result = await privateSTT.transcribe(new Float32Array(10));

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.value : null).toBe('transcribed text');
        expect(mockTranscribe).toHaveBeenCalled();

        // Reset
        (shouldUseMockTranscription as any).mockReturnValue(false);
    });

    it('should exercise debug logging in init', async () => {
        const { TestFlags } = await import('@/config/TestFlags');
        // @ts-expect-error
        TestFlags.DEBUG_ENABLED = true;
        const spy = vi.spyOn(logger, 'info').mockImplementation(() => { });

        await privateSTT.init(mockCallbacks);

        expect(spy).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('[PrivateSTT] Checking flags'));

        // @ts-expect-error
        TestFlags.DEBUG_ENABLED = false;
        spy.mockRestore();
    });

    it('should handle WhisperTurbo initialization failure (Line 156 coverage)', async () => {
        // Mock WebGPU presence
        Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });

        const { WhisperTurboEngine } = await import('@/services/transcription/engines/WhisperTurboEngine');
        const { TransformersJSEngine } = await import('@/services/transcription/engines/TransformersJSEngine');

        // WhisperTurbo fails with Result.err
        const mockError = new Error('Low-level WASM crash');
        (WhisperTurboEngine as any).mockImplementationOnce(() => ({
            type: 'whisper-turbo',
            init: vi.fn().mockResolvedValue(Result.err(mockError)),
            destroy: vi.fn(),
        }));

        // TransformersJS succeeds
        (TransformersJSEngine as any).mockImplementationOnce(() => ({
            type: 'transformers-js',
            init: vi.fn().mockResolvedValue(Result.ok(undefined)),
            destroy: vi.fn(),
        }));

        const result = await privateSTT.init(mockCallbacks);

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.value : 'none').toBe('transformers-js');
    });
});
