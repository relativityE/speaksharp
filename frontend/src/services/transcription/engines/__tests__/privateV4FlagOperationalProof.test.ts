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
const PII_KEYS = ['email', 'transcript', 'audio', 'stack', 'errorstack', 'sk_live', 'pk_live', 'whsec', 'token', 'jwt', 'password', 'secret', 'apikey', 'referencetext', 'distinctid', 'userid', 'sessiontoken'];

describe('v4 PostHog flag — headless operational proof (non-GPU)', () => {
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

    // Case D — the ACTUAL posthog.capture payloads carry NO PII and record selectionSource.
    it('D: PostHog capture payloads contain NO PII/secrets and record selectionSource', async () => {
        flagState.v4Enabled = true; setGpu(true);
        v4Init.mockResolvedValue({ isOk: false, error: new Error('forced v4 init failure for telemetry') }); // -> fallback -> telemetry
        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(posthogCapture, 'PrivateSTT must emit a flagged v4 telemetry event').toHaveBeenCalled();
        let attemptPayload: Record<string, unknown> | undefined;
        // PII safety applies to EVERY captured event; selectionSource lives on the canonical attempt event.
        for (const [event, payload] of posthogCapture.mock.calls as Array<[string, Record<string, unknown>]>) {
            expect(String(event)).toMatch(/^private_stt_v4_/);
            const blob = JSON.stringify(payload ?? {}).toLowerCase();
            for (const bad of PII_KEYS) {
                expect(blob, `posthog "${event}" payload must not contain "${bad}"`).not.toContain(bad);
            }
            expect(blob, 'no @-style email values').not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
            if (event === 'private_stt_v4_attempt') attemptPayload = payload;
        }
        // flag-driven (not forceAuto) -> the canonical attempt event records the REAL flag source.
        expect(attemptPayload, 'canonical private_stt_v4_attempt event with real-flag selectionSource')
            .toMatchObject({ selectionSource: 'posthog_flag' });
    });

    // Case F1 — DEV/TEST harness: the real localStorage forceAuto key (`speaksharp.v4.forceAuto`) +
    // usable WebGPU selects v4, and the artifact labels it selectionSource:'dev_harness' — NOT
    // posthog_flag — even though `reason` reads `webgpu_available_v4_flag` on real WebGPU (identical
    // for flag AND forceAuto there). Locks the Gate A (dev_harness) vs Gate B (posthog_flag) distinction.
    it('F1: DEV/TEST forceAuto (real localStorage key) + WebGPU -> v4 selected, selectionSource=dev_harness (NOT posthog_flag)', async () => {
        flagState.v4Enabled = false; setGpu(true);
        window.localStorage.setItem('speaksharp.v4.forceAuto', '1'); // dev/test-gated forceAuto shim (Gate A)
        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();
        expect(pstt.getEngineType()).toBe('transformers-js-v4'); // forceAuto selects v4 in dev/test
        const dbg = (window as unknown as { __PRIVATE_STT_RUNTIME_DEBUG__?: { selectionSource?: string; reason?: string } }).__PRIVATE_STT_RUNTIME_DEBUG__;
        expect(dbg?.selectionSource, 'forceAuto value run must be labelled dev_harness, never posthog_flag').toBe('dev_harness');
        expect(dbg?.reason, 'reason is the conflated signal; proves selectionSource is the honest one').toBe('webgpu_available_v4_flag');
    });

    it('F1b: DEV/TEST forceAuto + v4Variant=distil_q4 selects the distil Gate A candidate', async () => {
        flagState.v4Enabled = false; setGpu(true);
        window.localStorage.setItem('speaksharp.v4.forceAuto', '1');
        window.localStorage.setItem('speaksharp.v4.variant', 'distil_q4');

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(pstt.getEngineType()).toBe('transformers-js-v4');
        expect(v4Construct).toHaveBeenCalledWith(expect.objectContaining({ v4Variant: 'distil_q4' }));
        const dbg = (window as unknown as { __PRIVATE_STT_RUNTIME_DEBUG__?: { selectionSource?: string; v4Variant?: string } }).__PRIVATE_STT_RUNTIME_DEBUG__;
        expect(dbg?.selectionSource).toBe('dev_harness');
        expect(dbg?.v4Variant).toBe('distil_q4');
    });

    it('F1c: DEV/TEST forceAuto + v4Variant=base_q4 selects the base Gate A candidate (dev_harness)', async () => {
        flagState.v4Enabled = false; setGpu(true);
        window.localStorage.setItem('speaksharp.v4.forceAuto', '1');
        window.localStorage.setItem('speaksharp.v4.variant', 'base_q4');
        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();
        expect(pstt.getEngineType()).toBe('transformers-js-v4');
        const dbg = (window as unknown as { __PRIVATE_STT_RUNTIME_DEBUG__?: { selectionSource?: string; v4Variant?: string } }).__PRIVATE_STT_RUNTIME_DEBUG__;
        expect(dbg?.selectionSource).toBe('dev_harness');
        expect(dbg?.v4Variant).toBe('base_q4');
    });

    // Allowlist FAIL-CLOSED: an unknown v4Variant must never load an arbitrary model — it falls back to
    // the base_q4 floor. Guards the security invariant that the bakeoff knob is a 2-value allowlist only.
    it('F1d: DEV/TEST forceAuto + UNKNOWN v4Variant fails closed to base_q4 (no arbitrary model)', async () => {
        flagState.v4Enabled = false; setGpu(true);
        window.localStorage.setItem('speaksharp.v4.forceAuto', '1');
        window.localStorage.setItem('speaksharp.v4.variant', 'evil-org/secret-model'); // not allowlisted
        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();
        expect(pstt.getEngineType()).toBe('transformers-js-v4'); // forceAuto still selects v4 (base floor)
        const dbg = (window as unknown as { __PRIVATE_STT_RUNTIME_DEBUG__?: { v4Variant?: string } }).__PRIVATE_STT_RUNTIME_DEBUG__;
        expect(dbg?.v4Variant, 'unknown variant must fall closed to base_q4, never a custom model').toBe('base_q4');
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
