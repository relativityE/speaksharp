import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrivateSTT as PrivateSTTType } from '@/services/transcription/engines/PrivateSTT';
import { setupStrictZero } from '../../../tests/setupStrictZero';
import { Result } from '@/services/transcription/modes/types';
import logger from '@/lib/logger';

import { STTEngine } from '@/contracts/STTEngine';
import { EngineCallbacks } from '@/contracts/IPrivateSTTEngine';
import { PrivateSTTInitOptions } from '@/contracts/IPrivateSTT';

// Stub Engines for contract checking
class StubWhisperTurbo extends STTEngine {
    public readonly type = 'whisper-turbo';
    protected async onInit(_c: EngineCallbacks, _t?: number): Promise<Result<void, Error>> { return { isOk: true, data: undefined }; }
    protected async onStart(): Promise<void> { }
    protected async onStop(): Promise<void> { }
    public async transcribe(_a: Float32Array): Promise<Result<string, Error>> { return { isOk: true, data: 'text' }; }
    protected async onDestroy(): Promise<void> { }
}

class StubTransformersJS extends STTEngine {
    public readonly type = 'transformers-js';
    protected async onInit(_c: EngineCallbacks, _t?: number): Promise<Result<void, Error>> { return { isOk: true, data: undefined }; }
    protected async onStart(): Promise<void> { }
    protected async onStop(): Promise<void> { }
    public async transcribe(_a: Float32Array): Promise<Result<string, Error>> { return { isOk: true, data: 'text' }; }
    protected async onDestroy(): Promise<void> { }
}

class StubMock extends STTEngine {
    public readonly type = 'mock';
    protected async onInit(_c: EngineCallbacks, _t?: number): Promise<Result<void, Error>> { return { isOk: true, data: undefined }; }
    protected async onStart(): Promise<void> { }
    protected async onStop(): Promise<void> { }
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

    async function setupTest(manifestOverrides: Partial<SSE2EManifest> = {}) {
        vi.clearAllMocks();
        await setupStrictZero();

        window.__SS_E2E__ = {
            isActive: true,
            engineType: 'system',
            registry: {},
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
        return {
            PrivateSTT: mod.PrivateSTT,
            privateSTT: new mod.PrivateSTT()
        };
    }

    afterEach(async () => {
        delete (window as { __SS_E2E__?: unknown }).__SS_E2E__;
    });

    it('should use MockEngine when manifest indicates mocking', async () => {
        const { privateSTT } = await setupTest({ engineType: 'mock' });
        const manifest = window.__SS_E2E__!;

        const mockInit = vi.fn().mockResolvedValue({ isOk: true, data: undefined });
        const mockInstance = new StubMock();
        (mockInstance as unknown as { onInit: unknown }).onInit = mockInit;
        
        // Register the mock engine in the registry (POJO style)
        (manifest.registry as Record<string, unknown>)['mock-engine'] = () => mockInstance;

        const result = await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);

        expect(result.isOk).toBe(true);
        expect(privateSTT.getEngineType()).toBe('mock');
        expect(mockInit).toHaveBeenCalled();
    });

    it('should select WhisperTurbo when WebGPU is available', async () => {
        const { privateSTT } = await setupTest({ engineType: 'real' });
        const manifest = window.__SS_E2E__!;
        
        const mockInstance = new StubWhisperTurbo();
        (manifest.registry as Record<string, unknown>)['whisper-turbo'] = () => mockInstance;
        
        // Add Safe Engine to registry to prevent total failure if fallback happens
        (manifest.registry as Record<string, unknown>)['transformers-js'] = () => new StubTransformersJS();

        const result = await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);

        expect(result.isOk).toBe(true);
        expect(privateSTT.getEngineType()).toBe('whisper-turbo');
    });

    it('should fallback to TransformersJS if WhisperTurbo fails', async () => {
        const { privateSTT } = await setupTest({ engineType: 'real' });
        const manifest = window.__SS_E2E__!;

        // Fast engine fails
        const mockFastInstance = new StubWhisperTurbo();
        (mockFastInstance as unknown as { onInit: unknown }).onInit = vi.fn().mockResolvedValue({ isOk: false, error: new Error('WebGPU Init Failed') });
        (manifest.registry as Record<string, unknown>)['whisper-turbo'] = () => mockFastInstance;

        // Safe engine succeeds
        const mockSafeInstance = new StubTransformersJS();
        (manifest.registry as Record<string, unknown>)['transformers-js'] = () => mockSafeInstance;

        const result = await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);

        expect(result.isOk).toBe(true);
        expect(privateSTT.getEngineType()).toBe('transformers-js');
    });

    it('should use TransformersJS immediately if WebGPU is unavailable', async () => {
        const { privateSTT } = await setupTest({ engineType: 'real' });
        const manifest = window.__SS_E2E__!;
        
        // Mock WebGPU absence after setupTest (which sets it to {})
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });

        const mockSafeInstance = new StubTransformersJS();
        (manifest.registry as Record<string, unknown>)['transformers-js'] = () => mockSafeInstance;

        const result = await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);

        expect(result.isOk).toBe(true);
        expect(privateSTT.getEngineType()).toBe('transformers-js');
    });

    it('should delegate transcription to the active engine', async () => {
        const { privateSTT } = await setupTest({ engineType: 'mock' });
        const manifest = window.__SS_E2E__!;

        const mockTranscribe = vi.fn().mockResolvedValue({ isOk: true, data: 'transcribed text' });
        const mockInstance = new StubMock();
        (mockInstance as unknown as { transcribe: unknown }).transcribe = mockTranscribe;
        (manifest.registry as Record<string, unknown>)['mock-engine'] = () => mockInstance;

        await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);
        const result = await privateSTT.transcribe(new Float32Array(10));

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.data : null).toBe('transcribed text');
        expect(mockTranscribe).toHaveBeenCalled();
    });

    it('should exercise debug logging in init', async () => {
        const { privateSTT } = await setupTest({ debug: true });

        const spy = vi.spyOn(logger, 'info').mockImplementation(() => { });

        await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);

        expect(spy).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('[PrivateSTT] Checking flags'));

        spy.mockRestore();
    });

    it('should handle WhisperTurbo initialization failure', async () => {
        const { privateSTT } = await setupTest({ engineType: 'real' });
        const manifest = window.__SS_E2E__!;

        // WhisperTurbo fails
        const mockFastInstance = new StubWhisperTurbo();
        (mockFastInstance as unknown as { onInit: unknown }).onInit = vi.fn().mockResolvedValue({ isOk: false, error: new Error('Low-level WASM crash') });
        (manifest.registry as Record<string, unknown>)['whisper-turbo'] = () => mockFastInstance;

        // TransformersJS succeeds
        const mockSafeInstance = new StubTransformersJS();
        (manifest.registry as Record<string, unknown>)['transformers-js'] = () => mockSafeInstance;

        const result = await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);

        expect(result.isOk).toBe(true);
        expect(result.isOk).toBe(true);
        expect(privateSTT.getEngineType()).toBe('transformers-js');
    });
});
