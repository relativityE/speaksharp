// @vitest-environment happy-dom
//
// HEADLESS OPERATIONAL PostHog proof (NON-GPU claims). The GPU-dependent claim — "flag ON + real
// WebGPU adapter -> v4 selected, WER/RTF" — is NOT here (no GPU in CI; see V4_WEBGPU_VALUE_PROOF
// runbook). Everything below runs deterministically in headless CI against the REAL resolver +
// the REAL posthog.capture surface.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupStrictZero } from '../../../../../../tests/setupStrictZero';
import type { PrivateSTT as PrivateSTTType } from '../PrivateSTT';
import { STTEngine } from '../../../../contracts/STTEngine';

// Spy the ACTUAL posthog.capture payloads PrivateSTT emits (not just the sanitizer in isolation).
const posthogCapture = vi.fn();
vi.mock('posthog-js', () => ({
    default: { capture: (...a: unknown[]) => posthogCapture(...a), isFeatureEnabled: () => false },
}));

vi.mock('@xenova/transformers', () => ({}));

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

// PostHog flag state — togglable per test (this IS the control plane under test).
const flagState = { v4Enabled: false, distilEnabled: false };
vi.mock('../../privateV4Flags', () => ({ getV4FlagState: () => ({ ...flagState }) }));

const v4Construct = vi.fn();
const v4Init = vi.fn();
class StubV4 extends STTEngine {
    type = 'transformers-js-v4' as const;
    constructor(o?: ConstructorParameters<typeof STTEngine>[0]) { super(o); v4Construct(o); }
    checkAvailability = vi.fn().mockResolvedValue({ available: true });
    protected onInit = v4Init;
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onPause = vi.fn().mockResolvedValue(undefined);
    onResume = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn().mockResolvedValue({ isOk: true, data: 'v4' });
}
class StubTJ extends STTEngine {
    type = 'transformers-js' as const;
    checkAvailability = vi.fn().mockResolvedValue({ available: true });
    protected onInit = vi.fn().mockResolvedValue({ isOk: true, data: undefined });
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onPause = vi.fn().mockResolvedValue(undefined);
    onResume = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn().mockResolvedValue({ isOk: true, data: 'v2' });
}
function setGpu(usable: boolean): void {
    Object.defineProperty(globalThis.navigator, 'gpu', {
        value: usable ? { requestAdapter: vi.fn().mockResolvedValue({ name: 'adapter' }) } : undefined,
        configurable: true, writable: true,
    });
}

/**
 * SELECTION CANNOT BE BYPASSED — headless operational proof (non-GPU).
 *
 * The positive question ("what does this build run?") is answered by config and proven in
 * candidateSelection.test.ts. This file answers the NEGATIVE question, which is the one an attacker or
 * a stale bookmark asks: can anything OTHER than the config change which model a visitor gets?
 *
 * Deliberately UNMOCKED selection. Stubbing `effectiveCandidate` here would make every assertion below
 * pass for the wrong reason — a fixed mock is trivially immune to a URL parameter — so these drive the
 * real selection path and attempt the bypasses against it.
 *
 * The flag/forceAuto SELECTION cases that used to live here were removed with the mechanism they
 * described: flags and the forceAuto shim can no longer choose a model, so a test asserting which model
 * they choose would assert a behaviour that no longer exists.
 */
describe('Private STT selection cannot be bypassed (non-GPU)', () => {
    let pstt: PrivateSTTType | null = null;
    beforeEach(async () => {
        (globalThis as { __TEST__?: boolean }).__TEST__ = true;
        vi.clearAllMocks();
        flagState.v4Enabled = false; flagState.distilEnabled = false;
        v4Init.mockResolvedValue({ isOk: true, data: undefined });
        await setupStrictZero();
        const { sttRegistry } = await import('../../STTRegistry');
        sttRegistry.register('transformers-js', (o) => new StubTJ(o));
        sttRegistry.register('transformers-js-v4', (o) => new StubV4(o));
        const win = window as unknown as { __SS_E2E__: { isActive: boolean; engineType: string } };
        win.__SS_E2E__.isActive = true; win.__SS_E2E__.engineType = 'real';
        window.localStorage.clear();
        window.history.replaceState({}, '', '/');
        setGpu(false);
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        if (pstt) { await pstt.terminate(); pstt = null; }
        if (typeof window !== 'undefined') { delete (window as unknown as Record<string, unknown>).__SS_E2E__; window.localStorage.clear(); }
    });

    // Case A — flag OFF (default) -> v2-base, no v4 construct/init (also in PrivateSTT.test.ts).
    it('A: flag OFF -> v2-base, v4 NEVER constructed/initialized (even with WebGPU usable)', async () => {
        flagState.v4Enabled = false; setGpu(true);
        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();
        expect(pstt.getEngineType()).toBe('transformers-js');
        expect(v4Construct).not.toHaveBeenCalled();
        expect(v4Init).not.toHaveBeenCalled();
    });

    // Case E — flag ON but NO WebGPU -> conservative v2-base (resolver never forces broken v4).
    it('E: flag ON + NO WebGPU -> v2-base (no v4 construct); resolver does not force unsupported v4', async () => {
        flagState.v4Enabled = true; setGpu(false);
        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();
        expect(pstt.getEngineType()).toBe('transformers-js');
        expect(v4Construct).not.toHaveBeenCalled();
    });

    // Case B — PRODUCTION cannot be bypassed by ?v4ForceAuto / ?privateEngine / ?engine.
    it('NON-VACUITY: the engine that ran is the one CONFIG names, not a constant', async () => {
        // Without this the bypass cases below could pass for the wrong reason: if v4 were unreachable
        // by ANY route they would still see 'transformers-js'. This ties the expected outcome to the
        // checked-in selection, so changing the config changes what this suite demands.
        const { effectiveCandidate } = await import('../../candidateSelection');
        const { candidate, fallbackCause } = effectiveCandidate();
        expect(fallbackCause, 'no safety kill in this harness').toBeNull();

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        const expected = candidate.engine === 'transformers-js-v4' ? 'transformers-js-v4' : 'transformers-js';
        expect(pstt.getEngineType(), `config names ${candidate.id}`).toBe(expected);
    });

    it('B: PRODUCTION ignores ?v4ForceAuto=1 (+ ?engine=v4 / ?privateEngine) -> v2-base, no v4 construct', async () => {
        vi.stubEnv('DEV', false);
        (globalThis as { __TEST__?: boolean }).__TEST__ = false;
        if (window.__SS_E2E__) (window.__SS_E2E__ as { isActive: boolean }).isActive = false;
        flagState.v4Enabled = false; setGpu(true);
        window.history.replaceState({}, '', '?v4ForceAuto=1&engine=v4&privateEngine=transformers-js-v4&v4Variant=distil_q4');
        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();
        expect(pstt.getEngineType()).toBe('transformers-js'); // no URL bypass in production
        expect(v4Construct).not.toHaveBeenCalled();
    });

    // Case C — PRODUCTION cannot be bypassed by localStorage experiment keys.
    it('C: PRODUCTION ignores localStorage v4 bypass attempts -> v2-base, no v4 construct', async () => {
        vi.stubEnv('DEV', false);
        (globalThis as { __TEST__?: boolean }).__TEST__ = false;
        if (window.__SS_E2E__) (window.__SS_E2E__ as { isActive: boolean }).isActive = false;
        flagState.v4Enabled = false; setGpu(true);
        window.localStorage.setItem('privateEngine', 'transformers-js-v4');
        window.localStorage.setItem('speaksharp.private.engine', 'transformers-js-v4');
        window.localStorage.setItem('stt_engine', 'v4');
        window.localStorage.setItem('speaksharp.v4.forceAuto', '1'); // the REAL forceAuto key (not a phantom)
        window.localStorage.setItem('privateModel', 'v4');
        window.localStorage.setItem('speaksharp.v4.variant', 'distil_q4');

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(pstt.getEngineType()).toBe('transformers-js');
        expect(v4Construct).not.toHaveBeenCalled();
    });

    // Case F2 — PRODUCTION/BETA: the SAME real forceAuto key is INERT. Even with WebGPU usable, a
    // production build ignores `speaksharp.v4.forceAuto` (override gated `import.meta.env.DEV || isTest`)
    // -> v2-base, no v4 construct, selectionSource='default' (never dev_harness). Proves the localStorage
    // forceAuto shim can never become a production engine-selection bypass.
    it('F2: PRODUCTION ignores the real localStorage forceAuto key -> v2-base, selectionSource=default (NOT dev_harness)', async () => {
        vi.stubEnv('DEV', false);
        (globalThis as { __TEST__?: boolean }).__TEST__ = false;
        if (window.__SS_E2E__) (window.__SS_E2E__ as { isActive: boolean }).isActive = false;
        flagState.v4Enabled = false; setGpu(true);
        window.localStorage.setItem('speaksharp.v4.forceAuto', '1'); // real key — must be inert in production
        window.localStorage.setItem('speaksharp.v4.variant', 'distil_q4'); // real variant key — also inert in production
        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();
        expect(pstt.getEngineType()).toBe('transformers-js'); // forceAuto ignored in production
        expect(v4Construct).not.toHaveBeenCalled();
        const dbg = (window as unknown as { __PRIVATE_STT_RUNTIME_DEBUG__?: { selectionSource?: string } }).__PRIVATE_STT_RUNTIME_DEBUG__;
        expect(dbg?.selectionSource, 'production v2 path is selectionSource=default, never dev_harness').toBe('default');
    });
});
