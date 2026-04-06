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
import { Result } from '@/services/transcription/modes/types';
import { createPrivateSTT, PrivateSTT } from '../PrivateSTT';
import { ENV } from '@/config/TestFlags';
import { STTEngine } from '@/contracts/STTEngine';

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
const mockEInit = vi.fn().mockResolvedValue({ isOk: true, data: undefined });

class StubWTE extends STTEngine {
    type = 'whisper-turbo' as const;
    onInit = mockWTEInit;
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn();
}

class StubTJ extends STTEngine {
    type = 'transformers-js' as const;
    onInit = mockTJInit;
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn();
}

class StubE extends STTEngine {
    type = 'mock' as const;
    onInit = mockEInit;
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn();
}

vi.mock('../WhisperTurboEngine', () => ({
    WhisperTurboEngine: vi.fn().mockImplementation(() => new StubWTE())
}));

vi.mock('../TransformersJSEngine', () => ({
    TransformersJSEngine: vi.fn().mockImplementation(() => new StubTJ())
}));

vi.mock('../MockEngine', () => ({
    MockEngine: vi.fn().mockImplementation(() => new StubE())
}));

describe('PrivateSTT (Routing Logic)', () => {
    beforeEach(async () => {
        globalThis.__TEST__ = true;
        vi.clearAllMocks();
        
        // Final Architectural Directive: Test Harness owns mutation at T=0
        await setupStrictZero();
        const win = window as unknown as { __SS_E2E__: { isActive: boolean, engineType: string, registry: Record<string, unknown> } };
        win.__SS_E2E__.isActive = false; // Default to production routing for unit tests
        win.__SS_E2E__.engineType = 'mock';
        win.__SS_E2E__.registry = {
            ...win.__SS_E2E__.registry,
            'mock': () => new StubE(),
            'whisper-turbo': () => new StubWTE(),
            'transformers-js': () => new StubTJ()
        };

        // Reset navigator metadata
        vi.stubGlobal('navigator', { ...navigator, gpu: undefined } as unknown as Navigator);
    });

    let pstt: PrivateSTT | null = null;

    afterEach(async () => {
        if (pstt) {
            await pstt.terminate();
            pstt = null;
        }
        if (typeof window !== 'undefined') {
            const win = window as unknown as Record<string, unknown>;
            delete win.__SS_E2E__;
        }
    });

    it('selects MockEngine when manifest engineType is mock', async () => {
        if (window.__SS_E2E__) window.__SS_E2E__.isActive = true;
        
        // Validation: Verify T=0 injection worked
        expect(ENV.isTest).toBe(true);
        expect(ENV.engineType).toBe('mock');

        pstt = createPrivateSTT();
        await pstt.init({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        
        // Note: Real MockEngine import is now bypassed by registry injection in PrivateSTT.ts
        expect(pstt.getEngineType()).toBe('mock');
    });

    it('selects WhisperTurboEngine (Fast Path) when WebGPU is available', async () => {
        if (window.__SS_E2E__) {
            window.__SS_E2E__.isActive = true;
            window.__SS_E2E__.engineType = 'real';
        }
        // @ts-expect-error - mock navigator.gpu
        navigator.gpu = {};

        pstt = createPrivateSTT();
        await pstt.init({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        
        expect(pstt.getEngineType()).toBe('whisper-turbo');
    });

    it('selects TransformersJSEngine (Safe Path) when WebGPU is missing', async () => {
        if (window.__SS_E2E__) {
            window.__SS_E2E__.isActive = true;
            window.__SS_E2E__.engineType = 'real';
        }
        // delete navigator.gpu handled in beforeEach

        pstt = createPrivateSTT();
        await pstt.init({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        
        expect(pstt.getEngineType()).toBe('transformers-js');
    });

    it('selects WhisperTurboEngine (Fast Path) when WebGPU is available (Re-verification)', async () => {
        // @ts-expect-error - mock navigator.gpu
        navigator.gpu = {};
        pstt = createPrivateSTT();
        await pstt.init({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });

        expect(pstt.getEngineType()).toBe('whisper-turbo');
    });

    it('waits for slow engine initialization (No-Timeout validation)', async () => {
        vi.useFakeTimers();

        // Target the stub's initialization
        mockTJInit.mockImplementationOnce(() => new Promise((resolve) => {
            setTimeout(() => resolve(Result.ok(undefined)), 2000);
        }));

        pstt = createPrivateSTT();
        // WebGPU is missing by default in beforeEach, so it will select TransformersJS
        const initPromise = pstt.init({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });

        await vi.advanceTimersByTimeAsync(3000);

        const result = await initPromise;
        expect(result.isOk).toBe(true);
        expect(pstt.getEngineType()).toBe('transformers-js');

        vi.useRealTimers();
    });
});
