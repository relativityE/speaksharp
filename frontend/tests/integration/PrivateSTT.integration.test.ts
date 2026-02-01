import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrivateSTT } from '@/services/transcription/engines/PrivateSTT';
import { Result } from 'true-myth';

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

// Mock the environment config to control IS_TEST_ENVIRONMENT
vi.mock('@/config/env', () => ({
    IS_TEST_ENVIRONMENT: false,
    E2E_CONTEXT_FLAG: '__E2E_CONTEXT__',
    // Mock other exports if needed, or use vi.importActual if possible
    getEnvVar: vi.fn(),
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

    it('should use MockEngine when IS_TEST_ENVIRONMENT is active', async () => {
        // Dynamically update the mock to return true
        const env = await import('@/config/env');
        // @ts-expect-error - overriding readonly export for test
        env.IS_TEST_ENVIRONMENT = true;

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

        // Reset for other tests
        // @ts-expect-error
        env.IS_TEST_ENVIRONMENT = false;
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
        const env = await import('@/config/env');
        // @ts-expect-error
        env.IS_TEST_ENVIRONMENT = true;

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
        // @ts-expect-error
        env.IS_TEST_ENVIRONMENT = false;
    });
});
