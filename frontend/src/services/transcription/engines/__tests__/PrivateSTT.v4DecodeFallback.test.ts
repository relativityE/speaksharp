// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupStrictZero } from '../../../../../../tests/setupStrictZero';
import type { PrivateSTT as PrivateSTTType } from '../PrivateSTT';
import { STTEngine } from '../../../../contracts/STTEngine';

vi.mock('@xenova/transformers', () => ({}));

// engineType 'real' => ENV.disableWasm is false, so the AUTO resolver actually runs.
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
            get disableWasm(): boolean { return this.isTest && this.engineType !== 'real'; },
        },
    };
});

// Force the v4 flag ON so the AUTO path selects v4 (WebGPU is made usable below).
vi.mock('../../privateV4Flags', () => ({
    getV4FlagState: () => ({ v4Enabled: true, distilEnabled: false }),
}));

const v4Transcribe = vi.fn();
const tjTranscribe = vi.fn();
const mockV4Init = vi.fn().mockResolvedValue({ isOk: true, data: undefined });
const mockTJInit = vi.fn().mockResolvedValue({ isOk: true, data: undefined });

class StubV4 extends STTEngine {
    type = 'transformers-js-v4' as const;
    checkAvailability = vi.fn().mockResolvedValue({ available: true });
    protected onInit = mockV4Init;
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onPause = vi.fn().mockResolvedValue(undefined);
    onResume = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = v4Transcribe;
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
    transcribe = tjTranscribe;
}

function setGpuUsable(): void {
    Object.defineProperty(globalThis.navigator, 'gpu', {
        value: { requestAdapter: vi.fn().mockResolvedValue({ name: 'adapter' }) },
        configurable: true,
        writable: true,
    });
}

describe('PrivateSTT v4 decode-time fallback (auto/flag path)', () => {
    let pstt: PrivateSTTType | null = null;

    beforeEach(async () => {
        globalThis.__TEST__ = true;
        vi.clearAllMocks();
        mockV4Init.mockResolvedValue({ isOk: true, data: undefined });
        mockTJInit.mockResolvedValue({ isOk: true, data: undefined });
        await setupStrictZero();
        const { sttRegistry } = await import('../../STTRegistry');
        sttRegistry.register('transformers-js', (o) => new StubTJ(o));
        sttRegistry.register('transformers-js-v4', (o) => new StubV4(o));
        const win = window as unknown as { __SS_E2E__: { isActive: boolean; engineType: string } };
        win.__SS_E2E__.isActive = true;
        win.__SS_E2E__.engineType = 'real';
        window.localStorage.clear();
        setGpuUsable();
    });

    afterEach(async () => {
        if (pstt) { await pstt.terminate(); pstt = null; }
        if (typeof window !== 'undefined') {
            delete (window as unknown as Record<string, unknown>).__SS_E2E__;
            window.localStorage.clear();
        }
    });

    it('v4 decode FAILURE -> falls back to v2-base and re-transcribes the SAME audio (no data loss)', async () => {
        const audio = new Float32Array([0.1, 0.2, 0.3]);
        v4Transcribe.mockResolvedValue({ isOk: false, error: new Error('invalid data location: undefined for input "a"') });
        tjTranscribe.mockResolvedValue({ isOk: true, data: 'v2 base transcript' });

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();
        expect(pstt.getEngineType(), 'auto path should select v4 with flag on + WebGPU').toBe('transformers-js-v4');

        const result = await pstt.transcribe(audio);

        expect(result, 'user must NOT be stranded with an empty session').toEqual({ isOk: true, data: 'v2 base transcript' });
        expect(v4Transcribe).toHaveBeenCalledWith(audio);
        expect(tjTranscribe).toHaveBeenCalledWith(audio); // SAME audio re-transcribed -> no data loss
        expect(pstt.getEngineType()).toBe('transformers-js'); // swapped to v2-base
    });

    it('v4 decode SUCCESS -> no fallback (v2-base never invoked)', async () => {
        v4Transcribe.mockResolvedValue({ isOk: true, data: 'v4 transcript' });

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        const result = await pstt.transcribe(new Float32Array([0.1]));
        expect(result).toEqual({ isOk: true, data: 'v4 transcript' });
        expect(tjTranscribe).not.toHaveBeenCalled();
        expect(pstt.getEngineType()).toBe('transformers-js-v4');
    });

    it('v4 EMPTY transcript (silent WASM failure, isOk:true data:"") -> falls back to v2-base', async () => {
        const audio = new Float32Array([0.1, 0.2, 0.3]);
        // base_q4 on WASM can return an empty SUCCESS instead of throwing — must still fall back.
        v4Transcribe.mockResolvedValue({ isOk: true, data: '   ' });
        tjTranscribe.mockResolvedValue({ isOk: true, data: 'v2 recovered transcript' });

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        const result = await pstt.transcribe(audio);
        expect(result, 'empty v4 must not strand the user').toEqual({ isOk: true, data: 'v2 recovered transcript' });
        expect(tjTranscribe).toHaveBeenCalledWith(audio); // same audio re-transcribed
        expect(pstt.getEngineType()).toBe('transformers-js'); // swapped to v2-base
    });

    it('only falls back ONCE (no loop) if v2 also fails', async () => {
        v4Transcribe.mockResolvedValue({ isOk: false, error: new Error('invalid data location') });
        tjTranscribe.mockResolvedValue({ isOk: false, error: new Error('v2 decode also failed') });

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        const result = await pstt.transcribe(new Float32Array([0.1]));
        expect(result.isOk).toBe(false);
        expect(tjTranscribe).toHaveBeenCalledTimes(1); // fell back once, did not loop
    });

    it('STRICT override v4 decode failure does NOT fall back (exposes the bug for dev/test)', async () => {
        v4Transcribe.mockResolvedValue({ isOk: false, error: new Error('invalid data location: undefined for input "a"') });
        tjTranscribe.mockResolvedValue({ isOk: true, data: 'v2 must NOT be used on the strict override path' });

        const { PrivateSTT } = await import('../PrivateSTT');
        // forceEngine = the explicit/strict override path: it must surface the v4 error,
        // never silently fall back, so dev/test can see the real bug.
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'transformers-js-v4' } as never);
        await pstt.init();
        expect(pstt.getEngineType()).toBe('transformers-js-v4');

        const result = await pstt.transcribe(new Float32Array([0.1]));
        expect(result.isOk).toBe(false);              // strict: surfaces the v4 decode error
        expect(tjTranscribe).not.toHaveBeenCalled();  // v2-base NOT invoked
        expect(pstt.getEngineType()).toBe('transformers-js-v4'); // stayed on v4, no swap
    });
});
