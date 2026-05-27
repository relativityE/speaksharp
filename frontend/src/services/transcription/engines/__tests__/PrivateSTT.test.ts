/**
 * @file PrivateSTT.spec.ts
 * @description Unit Test for the "Routing Logic" (Facade).
 * @verification_scope
 * - Verifies `WebGPU` capability detection via `navigator.gpu`.
 * - Verifies correct engine selection:
 *   - WebGPU available -> WhisperTurboEngine (Fast Path)
 *   - WebGPU missing -> TransformersJSEngine (Safe Path)
 *   - `window.__SS_E2E__` -> MockEngine (Reliable Path)
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupStrictZero } from '../../../../../../tests/setupStrictZero';
import { Result } from '../../modes/types';
import type { PrivateSTT as PrivateSTTType } from '../PrivateSTT';
import { ENV } from '../../../../config/TestFlags';
import { STTEngine } from '../../../../contracts/STTEngine';
import { PRIV_STT_V4 } from '../../sttConstants';

// Mock underlying libraries to avoid resolution errors
vi.mock('whisper-turbo', () => ({}));
vi.mock('@xenova/transformers', () => ({}));

// Inject dynamic ENV mock to bypass static IIFE in TestFlags.ts
vi.mock('@/config/TestFlags', async (importOriginal) => {
    interface SSWindow { __SS_E2E__?: { isActive?: boolean; engineType?: string } }
    interface TestGlobal { __TEST__?: boolean }
    const actual = await importOriginal<typeof import('@/config/TestFlags')>();
    return {
        ...actual,
        ENV: {
            ...actual.ENV,
            get isE2E(): boolean { return !!(window as unknown as SSWindow).__SS_E2E__?.isActive; },
            get isTest(): boolean { return this.isE2E || !!(globalThis as unknown as TestGlobal).__TEST__; },
            get engineType(): string { return ((window as unknown as SSWindow).__SS_E2E__?.isActive && (window as unknown as SSWindow).__SS_E2E__?.engineType) || 'system'; },
            get disableWasm(): boolean { return this.isTest && this.engineType !== 'real'; }
        }
    };
});

// Top-level mocks for control in tests
const mockWTEInit = vi.fn().mockResolvedValue({ isOk: true, data: undefined });
const mockTJInit = vi.fn().mockResolvedValue({ isOk: true, data: undefined });
const mockV4Init = vi.fn().mockResolvedValue({ isOk: true, data: undefined });
const mockEInit = vi.fn().mockResolvedValue({ isOk: true, data: undefined });

class StubWTE extends STTEngine {
    type = 'whisper-turbo' as const;
    checkAvailability = vi.fn().mockResolvedValue({ available: true });
    protected onInit = mockWTEInit;
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onPause = vi.fn().mockResolvedValue(undefined);
    onResume = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn();
}

class StubTJ extends STTEngine {
    type = 'transformers-js' as const;
    checkAvailability = vi.fn().mockResolvedValue({ available: true });
    protected onInit = mockTJInit;
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onPause = vi.fn().mockResolvedValue(undefined);
    onResume = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn();
}

class StubV4 extends STTEngine {
    type = 'transformers-js-v4' as const;
    checkAvailability = vi.fn().mockResolvedValue({ available: true });
    protected onInit = mockV4Init;
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onPause = vi.fn().mockResolvedValue(undefined);
    onResume = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn();
}

class StubE extends STTEngine {
    type = 'mock' as const;
    checkAvailability = vi.fn().mockResolvedValue({ available: true });
    protected onInit = mockEInit;
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onPause = vi.fn().mockResolvedValue(undefined);
    onResume = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn();
}



describe('PrivateSTT (Routing Logic)', () => {
    beforeEach(async () => {
        globalThis.__TEST__ = true;
        vi.clearAllMocks();

        // 1. Initialize Registry at T=0
        await setupStrictZero();

        // 2. Inject Test Stubs into SSOT Registry
        const { sttRegistry } = await import('../../STTRegistry');
        sttRegistry.register('whisper-turbo', (options) => new StubWTE(options));
        sttRegistry.register('transformers-js', (options) => new StubTJ(options));
        sttRegistry.register('transformers-js-v4', (options) => new StubV4(options));
        sttRegistry.register('mock', (options) => new StubE(options));

        // 3. Configure Local Test State
        const win = window as unknown as { __SS_E2E__: { isActive: boolean, engineType: string } };
        win.__SS_E2E__.isActive = false; 
        win.__SS_E2E__.engineType = 'mock';
        window.localStorage.clear();

        // Reset navigator metadata
        vi.stubGlobal('navigator', { ...navigator, gpu: undefined } as unknown as Navigator);
    });

    let pstt: PrivateSTTType | null = null;

    afterEach(async () => {
        if (pstt) {
            await pstt.terminate();
            pstt = null;
        }
        if (typeof window !== 'undefined') {
            const win = window as unknown as Record<string, unknown>;
            delete win.__SS_E2E__;
            window.localStorage.clear();
        }
    });

    it('selects MockEngine when manifest engineType is mock', async () => {
        if (window.__SS_E2E__) window.__SS_E2E__.isActive = true;

        const traceEnv = `isE2E=${ENV.isE2E}, engineType=${ENV.engineType}, ssE2E=${JSON.stringify(window.__SS_E2E__)}`;
        expect(ENV.isTest, `[TRACE-PSTT] ENV.isTest should be true — ${traceEnv}`).toBe(true);
        expect(ENV.engineType, `[TRACE-PSTT] engineType should be mock — ${traceEnv}`).toBe('mock');

        const { PrivateSTT } = await import('../PrivateSTT');
        // Use forceEngine='mock' — the explicit mock path in onInit() (line 99-112)
        // The fallback registry path only hits 'mock' when preferred engine has no factory
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'mock' } as never);
        await pstt.init();

        const gotType = pstt.getEngineType();
        expect(gotType, `[TRACE-PSTT] wrong engine type — ${traceEnv}, gotType=${gotType}`).toBe('mock');
    });

    it('selects TransformersJSEngine by default even when WebGPU is available', async () => {
        if (window.__SS_E2E__) {
            window.__SS_E2E__.isActive = true;
            window.__SS_E2E__.engineType = 'real';
        }
        Object.defineProperty(navigator, 'gpu', { value: {}, writable: true, configurable: true });

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(pstt.getEngineType()).toBe('transformers-js');
    });

    it('selects TransformersJSEngine (Safe Path) when WebGPU is missing', async () => {
        if (window.__SS_E2E__) {
            window.__SS_E2E__.isActive = true;
            window.__SS_E2E__.engineType = 'real';
        }
        // navigator.gpu is undefined by default (set in beforeEach)

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(pstt.getEngineType()).toBe('transformers-js');
    });

    it('selects WhisperTurboEngine only with explicit forceEngine override', async () => {
        // Must set engineType='real' so ENV.disableWasm=false, enabling the GPU path
        if (window.__SS_E2E__) {
            window.__SS_E2E__.isActive = true;
            window.__SS_E2E__.engineType = 'real';
        }
        Object.defineProperty(navigator, 'gpu', { value: {}, writable: true, configurable: true });

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'whisper-turbo' } as never);
        await pstt.init();

        expect(pstt.getEngineType()).toBe('whisper-turbo');
    });

    it('contract: selects experimental v4 only with explicit forceEngine override', async () => {
        if (window.__SS_E2E__) {
            window.__SS_E2E__.isActive = true;
            window.__SS_E2E__.engineType = 'real';
        }

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'transformers-js-v4' } as never);
        const result = await pstt.init();

        expect(result.isOk).toBe(true);
        expect(mockV4Init).toHaveBeenCalledOnce();
        expect(mockTJInit).not.toHaveBeenCalled();
        expect(pstt.getEngineType()).toBe('transformers-js-v4');
    });

    it('contract: failed explicit v4 init does not silently fall back to default v2', async () => {
        const v4Error = new Error('missing q4 dtype artifact');
        mockV4Init.mockResolvedValueOnce({ isOk: false, error: v4Error });

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'transformers-js-v4' } as never);
        const result = await pstt.init();

        expect(result.isOk).toBe(false);
        if (result.isOk) {
            throw new Error('Expected explicit v4 initialization to fail');
        }
        expect(result.error).toBe(v4Error);
        expect(mockV4Init).toHaveBeenCalledOnce();
        expect(mockTJInit).not.toHaveBeenCalled();
    });

    it('contract: availability is a pure cache probe and does not instantiate registry engines', async () => {
        const factory = vi.fn((options) => new StubTJ(options));
        const { sttRegistry } = await import('../../STTRegistry');
        sttRegistry.clear();
        sttRegistry.register('transformers-js', factory);

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        const availability = await pstt.checkAvailability();

        expect(availability.isAvailable).toBe(false);
        expect(availability.reason).toBe('CACHE_MISS');
        expect(factory).not.toHaveBeenCalled();
    });

    it('contract: v4 availability reports cache miss and q4 split size before explicit setup', async () => {
        globalThis.__TEST__ = false;
        window.localStorage.setItem('speaksharp.private.engine', 'transformers-js-v4');

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        const availability = await pstt.checkAvailability();

        expect(availability.isAvailable).toBe(false);
        expect(availability.reason).toBe('CACHE_MISS');
        expect(availability.sizeMB).toBe(PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB);
    });

    it('contract: does not fall back to a non-configured registry provider when configured provider is absent', async () => {
        await setupStrictZero();
        const { sttRegistry } = await import('../../STTRegistry');
        sttRegistry.clear();
        sttRegistry.register('whisper-turbo', (options) => new StubWTE(options));

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        const result = await pstt.init();

        expect(result.isOk).toBe(false);
        expect(pstt.getEngineType()).toBe('transformers-js');
        expect(mockWTEInit).not.toHaveBeenCalled();
    });

    it('waits for slow engine initialization (No-Timeout validation)', async () => {
        vi.useFakeTimers();

        // Target the stub's initialization
        mockTJInit.mockImplementationOnce(() => new Promise((resolve) => {
            setTimeout(() => resolve(Result.ok(undefined)), 2000);
        }));

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        // WebGPU is missing by default in beforeEach, so it will select TransformersJS
        const initPromise = pstt.init();

        await vi.advanceTimersByTimeAsync(3000);

        const result = await initPromise;
        expect(result.isOk).toBe(true);
        expect(pstt.getEngineType()).toBe('transformers-js');

        vi.useRealTimers();
    });
});
