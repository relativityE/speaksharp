// #1263 — a v4 decode is BOUNDED, and never SUBSTITUTED.
//
// This suite previously proved that a failed, empty or hung v4 decode re-ran the same audio on
// v2-base. That behaviour is removed: selection is now an explicit, reviewed config decision, so
// quietly producing a v2 transcript under the selected candidate's id would make a comparison of two
// models a comparison of one against itself — and nothing in the saved row would show it.
//
// The BOUND is kept and widened. It and the substitution used to share one eligibility flag, and that
// flag is now always false, so removing the substitution alone would have silently switched off the
// hang protection too — an explicitly selected v4 could then wait forever.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupStrictZero } from '../../../../../../tests/setupStrictZero';
import type { PrivateSTT as PrivateSTTType } from '../PrivateSTT';
import { STTEngine } from '../../../../contracts/STTEngine';

vi.mock('@xenova/transformers', () => ({}));
vi.mock('posthog-js', () => ({ default: { capture: vi.fn(), isFeatureEnabled: () => false } }));

vi.mock('../../candidateSelection', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../candidateSelection')>();
    const { CANDIDATES } = await import('../../candidateRegistry');
    return {
        ...actual,
        effectiveCandidate: () => ({ candidate: CANDIDATES['v4:base:q4'], fallbackCause: null }),
    };
});

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

describe('v4 decode is bounded, never substituted', () => {
    let pstt: PrivateSTTType | null = null;

    beforeEach(async () => {
        (globalThis as { __TEST__?: boolean }).__TEST__ = true;
        vi.clearAllMocks();
        await setupStrictZero();
        const { sttRegistry } = await import('../../STTRegistry');
        sttRegistry.register('transformers-js', (o) => new StubTJ(o));
        sttRegistry.register('transformers-js-v4', (o) => new StubV4(o));
        const win = window as unknown as { __SS_E2E__: { isActive: boolean; engineType: string } };
        win.__SS_E2E__.isActive = true; win.__SS_E2E__.engineType = 'real';
    });
    afterEach(async () => {
        if (pstt) { await pstt.terminate(); pstt = null; }
        delete (window as unknown as Record<string, unknown>).__SS_E2E__;
    });

    async function start() {
        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();
        return pstt;
    }

    it('CASUALTY: a FAILED v4 decode surfaces — v2 is never asked to re-transcribe', async () => {
        v4Transcribe.mockResolvedValue({ isOk: false, error: new Error('decode blew up') });
        const p = await start();
        const out = await p.transcribe(new Float32Array(16000));
        expect(out.isOk).toBe(false);
        expect(tjTranscribe, 'v2 must never see this audio').not.toHaveBeenCalled();
    });

    it('CASUALTY: an EMPTY v4 transcript is returned as-is, not replaced by a v2 attempt', async () => {
        // Genuine silence is a real answer. Re-running it on another model and saving THAT is how a
        // v2 transcript ends up attributed to a different candidate.
        v4Transcribe.mockResolvedValue({ isOk: true, data: '' });
        const p = await start();
        const out = await p.transcribe(new Float32Array(16000));
        expect(out).toEqual({ isOk: true, data: '' });
        expect(tjTranscribe).not.toHaveBeenCalled();
    });

    it('CASUALTY: a HUNG v4 decode is still BOUNDED — it fails instead of waiting forever', async () => {
        // The protection that must survive the substitution's removal.
        v4Transcribe.mockImplementation(() => new Promise(() => { /* never resolves */ }));
        const p = await start();
        vi.useFakeTimers();
        const pending = p.transcribe(new Float32Array(16000));
        await vi.advanceTimersByTimeAsync(200_000);
        const out = await pending;
        vi.useRealTimers();
        expect(out.isOk).toBe(false);
        expect(tjTranscribe).not.toHaveBeenCalled();
    });

    it('POSITIVE CONTROL: a successful v4 decode is returned unchanged', async () => {
        v4Transcribe.mockResolvedValue({ isOk: true, data: 'v4 said this' });
        const p = await start();
        expect(await p.transcribe(new Float32Array(16000))).toEqual({ isOk: true, data: 'v4 said this' });
        expect(tjTranscribe).not.toHaveBeenCalled();
    });
});
