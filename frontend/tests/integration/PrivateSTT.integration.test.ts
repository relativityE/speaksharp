import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrivateSTT as PrivateSTTType } from '../../src/services/transcription/engines/PrivateSTT';
import { setupStrictZero } from '../../../tests/setupStrictZero';
import { Result } from '../../src/services/transcription/modes/types';
import logger from '@/lib/logger';

import { STTEngine } from '../../src/contracts/STTEngine';
import { EngineCallbacks } from '../../src/contracts/IPrivateSTTEngine';
import { PrivateSTTInitOptions } from '../../src/contracts/IPrivateSTT';

// Stub Engines for contract checking
class StubWhisperTurbo extends STTEngine {
    public readonly type = 'whisper-turbo';
    protected async onInit(_t?: number): Promise<Result<void, Error>> { return { isOk: true, data: undefined }; }
    protected async onStart(): Promise<void> { }
    protected async onStop(): Promise<void> { }
    protected async onPause(): Promise<void> { }
    protected async onResume(): Promise<void> { }
    public async transcribe(_a: Float32Array): Promise<Result<string, Error>> { return { isOk: true, data: 'text' }; }
    protected async onDestroy(): Promise<void> { }
}

class StubTransformersJS extends STTEngine {
    public readonly type = 'transformers-js';
    protected async onInit(_t?: number): Promise<Result<void, Error>> { return { isOk: true, data: undefined }; }
    protected async onStart(): Promise<void> { }
    protected async onStop(): Promise<void> { }
    protected async onPause(): Promise<void> { }
    protected async onResume(): Promise<void> { }
    public async transcribe(_a: Float32Array): Promise<Result<string, Error>> { return { isOk: true, data: 'text' }; }
    protected async onDestroy(): Promise<void> { }
}

class StubMock extends STTEngine {
    public readonly type = 'mock';
    protected async onInit(_t?: number): Promise<Result<void, Error>> { return { isOk: true, data: undefined }; }
    protected async onStart(): Promise<void> { }
    protected async onStop(): Promise<void> { }
    protected async onPause(): Promise<void> { }
    protected async onResume(): Promise<void> { }
    public async transcribe(_a: Float32Array): Promise<Result<string, Error>> { return { isOk: true, data: 'text' }; }
    protected async onDestroy(): Promise<void> { }
}

import { SSE2EManifest } from '@/config/TestFlags';

describe('PrivateSTT Integration (Facade Logic)', () => {
    const mockCallbacks = {
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn(),
        onTranscriptUpdate: vi.fn(),
    };

    async function setupTest(manifestOverrides: Partial<SSE2EManifest> = {}, options: PrivateSTTInitOptions = {} as PrivateSTTInitOptions) {
        vi.clearAllMocks();
        await setupStrictZero();

        window.__SS_E2E__ = {
            isActive: true,
            engineType: 'system',
            flags: {
                bypassMutex: true,
                fastTimers: true
            },
            debug: false,
            ...manifestOverrides
        };

        // Standardize WebGPU mock
        Object.defineProperty(navigator, 'gpu', {
            value: {},
            configurable: true,
            writable: true
        });

        const mod = await import('@/services/transcription/engines/PrivateSTT');
        const { sttRegistry } = await import('@/services/transcription/STTRegistry');

        return {
            PrivateSTT: mod.PrivateSTT,
            privateSTT: new mod.PrivateSTT(options),
            sttRegistry
        };
    }

    afterEach(async () => {
        const { sttRegistry } = await import('@/services/transcription/STTRegistry');
        sttRegistry.clear();
        delete (window as { __SS_E2E__?: unknown }).__SS_E2E__;
    });

    it('should use MockEngine when manifest indicates mocking', async () => {
        const mockInit = vi.fn().mockResolvedValue({ isOk: true, data: undefined });
        const mockInstance = new StubMock();
        (mockInstance as unknown as { onInit: unknown }).onInit = mockInit;

        const { privateSTT, sttRegistry } = await setupTest(
            { engineType: 'mock' },
            { ...mockCallbacks, forceEngine: 'mock' } as PrivateSTTInitOptions
        );
        
        // Register the mock engine in the singleton registry
        sttRegistry.registerStatic('mock', mockInstance);

        const result = await privateSTT.init();

        expect(result.isOk).toBe(true);
        expect(privateSTT.getEngineType()).toBe('mock');
        expect(mockInit).toHaveBeenCalled();
    });

    it('should select WhisperTurbo when WebGPU is available', async () => {
        const mockInstance = new StubWhisperTurbo();
        const { privateSTT, sttRegistry } = await setupTest(
            { engineType: 'real' },
            mockCallbacks as PrivateSTTInitOptions
        );
        
        sttRegistry.registerStatic('whisper-turbo', mockInstance);
        
        // Add Safe Engine to registry to prevent total failure if fallback happens
        sttRegistry.registerStatic('transformers-js', new StubTransformersJS());

        const result = await privateSTT.init();

        expect(result.isOk).toBe(true);
        expect(privateSTT.getEngineType()).toBe('whisper-turbo');
    });

    it('should fallback to TransformersJS if WhisperTurbo fails', async () => {
        const mockFastInstance = new StubWhisperTurbo();
        (mockFastInstance as unknown as { onInit: unknown }).onInit = vi.fn().mockResolvedValue({ isOk: false, error: new Error('WebGPU Init Failed') });

        const mockSafeInstance = new StubTransformersJS();
        
        const { privateSTT, sttRegistry } = await setupTest(
            { engineType: 'real' },
            mockCallbacks as PrivateSTTInitOptions
        );

        sttRegistry.registerStatic('whisper-turbo', mockFastInstance);
        sttRegistry.registerStatic('transformers-js', mockSafeInstance);

        const result = await privateSTT.init();

        expect(result.isOk).toBe(true);
        expect(privateSTT.getEngineType()).toBe('transformers-js');
    });

    it('should use TransformersJS immediately if WebGPU is unavailable', async () => {
        const mockSafeInstance = new StubTransformersJS();
        const { privateSTT, sttRegistry } = await setupTest(
            { engineType: 'mock' },
            mockCallbacks as PrivateSTTInitOptions
        );
        
        sttRegistry.registerStatic('transformers-js', mockSafeInstance);

        const result = await privateSTT.init();

        expect(result.isOk).toBe(true);
        expect(privateSTT.getEngineType()).toBe('transformers-js');
    });

    it('should delegate transcription to the active engine', async () => {
        const mockTranscribe = vi.fn().mockResolvedValue({ isOk: true, data: 'transcribed text' });
        const mockInstance = new StubMock();
        (mockInstance as unknown as { transcribe: unknown }).transcribe = mockTranscribe;

        const { privateSTT, sttRegistry } = await setupTest(
            { engineType: 'mock' },
            { ...mockCallbacks, forceEngine: 'mock' } as PrivateSTTInitOptions
        );
        
        sttRegistry.registerStatic('mock', mockInstance);

        await privateSTT.init();
        const result = await privateSTT.transcribe(new Float32Array(10));

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.data : null).toBe('transcribed text');
        expect(mockTranscribe).toHaveBeenCalled();
    });

    it('should exercise debug logging in init', async () => {
        const { privateSTT } = await setupTest(
            { debug: true },
            mockCallbacks as PrivateSTTInitOptions
        );

        const spy = vi.spyOn(logger, 'info').mockImplementation(() => { });

        await privateSTT.init();

        expect(spy).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('[PrivateSTT] 🚀 Privacy-first engine selection started...'));

        spy.mockRestore();
    });

    it('should handle WhisperTurbo initialization failure', async () => {
        // WhisperTurbo fails
        const mockFastInstance = new StubWhisperTurbo();
        (mockFastInstance as unknown as { onInit: unknown }).onInit = vi.fn().mockResolvedValue({ isOk: false, error: new Error('Low-level WASM crash') });

        // TransformersJS succeeds
        const mockSafeInstance = new StubTransformersJS();

        const { privateSTT, sttRegistry } = await setupTest(
            { engineType: 'real' },
            mockCallbacks as PrivateSTTInitOptions
        );

        sttRegistry.registerStatic('whisper-turbo', mockFastInstance);
        sttRegistry.registerStatic('transformers-js', mockSafeInstance);

        const result = await privateSTT.init();

        expect(result.isOk).toBe(true);
        expect(privateSTT.getEngineType()).toBe('transformers-js');
    });
});
