import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrivateSTT } from '@/services/transcription/engines/PrivateSTT';
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

describe('PrivateSTT Integration (Facade Logic)', () => {
    let privateSTT: PrivateSTT;
    const mockCallbacks = {
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn(),
        onTranscriptUpdate: vi.fn(),
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        
        // Define __SS_E2E__ on window for SSOT manifest (matching TestFlags.ts type)
        window.__SS_E2E__ = {
            isActive: true,
            engineType: 'system',
            registry: {},
            flags: {
                bypassMutex: true,
                fastTimers: true
            },
            debug: false
        };

        // Standardize WebGPU mock
        Object.defineProperty(navigator, 'gpu', {
            value: {},
            configurable: true,
            writable: true
        });

        privateSTT = new PrivateSTT();
    });

    afterEach(async () => {
        if (privateSTT) {
            await privateSTT.destroy();
        }
        delete (window as { __SS_E2E__?: unknown }).__SS_E2E__;
    });

    it('should use MockEngine when manifest indicates mocking', async () => {
        const manifest = window.__SS_E2E__!;
        manifest.engineType = 'mock';

        const mockInit = vi.fn().mockResolvedValue({ isOk: true, data: undefined });
        const mockInstance = new StubMock();
        (mockInstance as unknown as { onInit: unknown }).onInit = mockInit;
        
        // Register the mock engine in the registry (POJO style)
        (manifest.registry as Record<string, unknown>)['mock-engine'] = () => mockInstance;

        const result = await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.data : null).toBe('mock');
        expect(mockInit).toHaveBeenCalled();
    });

    it('should select WhisperTurbo when WebGPU is available', async () => {
        // Mock WebGPU presence
        Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });

        // To test selection logic, we must use 'real' engineType to bypass DISABLE_WASM flag in config/TestFlags.ts
        window.__SS_E2E__!.engineType = 'real';
        
        const mockInstance = new StubWhisperTurbo();
        (window.__SS_E2E__!.registry as Record<string, unknown>)['whisper-turbo'] = () => mockInstance;
        
        // Add Safe Engine to registry to prevent total failure if fallback happens
        (window.__SS_E2E__!.registry as Record<string, unknown>)['transformers-js'] = () => new StubTransformersJS();

        const result = await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.data : null).toBe('whisper-turbo');
    });

    it('should fallback to TransformersJS if WhisperTurbo fails', async () => {
        // Mock WebGPU presence
        Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });

        const manifest = window.__SS_E2E__!;

        window.__SS_E2E__!.engineType = 'real';

        // Fast engine fails
        const mockFastInstance = new StubWhisperTurbo();
        (mockFastInstance as unknown as { onInit: unknown }).onInit = vi.fn().mockResolvedValue({ isOk: false, error: new Error('WebGPU Init Failed') });
        (manifest.registry as Record<string, unknown>)['whisper-turbo'] = () => mockFastInstance;

        // Safe engine succeeds
        const mockSafeInstance = new StubTransformersJS();
        (manifest.registry as Record<string, unknown>)['transformers-js'] = () => mockSafeInstance;

        const result = await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.data : null).toBe('transformers-js');
    });

    it('should use TransformersJS immediately if WebGPU is unavailable', async () => {
        // Mock WebGPU absence
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
        window.__SS_E2E__!.engineType = 'real';

        const mockSafeInstance = new StubTransformersJS();
        (window.__SS_E2E__!.registry as Record<string, unknown>)['transformers-js'] = () => mockSafeInstance;

        const result = await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);

        expect(result.isOk).toBe(true);
        expect(result.isOk ? result.data : null).toBe('transformers-js');
    });

    it('should delegate transcription to the active engine', async () => {
        const manifest = window.__SS_E2E__!;
        manifest.engineType = 'mock';

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
        const manifest = window.__SS_E2E__!;
        manifest.debug = true;
        const spy = vi.spyOn(logger, 'info').mockImplementation(() => { });

        await privateSTT.init(mockCallbacks as PrivateSTTInitOptions);

        expect(spy).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('[PrivateSTT] Checking flags'));

        spy.mockRestore();
    });

    it('should handle WhisperTurbo initialization failure', async () => {
        // Mock WebGPU presence
        Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });

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
        expect(result.isOk ? result.data : 'none').toBe('transformers-js');
    });
});
