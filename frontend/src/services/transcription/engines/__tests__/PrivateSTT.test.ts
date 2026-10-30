/**
 * @file PrivateSTT.spec.ts
 * @description Unit Test for the "Routing Logic" (Facade).
 * @verification_scope
 * - Verifies WebGPU presence NEVER promotes off the CPU floor (whisper-turbo /
 *   WebGPU acceleration was retired pre-beta).
 * - Verifies correct engine selection:
 *   - default / WebGPU present -> TransformersJSEngine (CPU floor)
 *   - explicit forceEngine='transformers-js-v4' -> V4 (experimental, opt-in)
 *   - `window.__SS_E2E__` -> MockEngine (Reliable Path)
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupStrictZero } from '../../../../../../tests/setupStrictZero';
import { Result } from '../../modes/types';
import type { PrivateSTT as PrivateSTTType } from '../PrivateSTT';
import { ENV } from '../../../../config/TestFlags';
import { STTEngine } from '../../../../contracts/STTEngine';
import { PRIV_STT_V4_VARIANTS } from '../../sttConstants';

// Mock underlying libraries to avoid resolution errors
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
// Construction spy: proves the v4 engine object is never even instantiated on the flag-off path.
const mockV4Construct = vi.fn();
const mockEInit = vi.fn().mockResolvedValue({ isOk: true, data: undefined });

// A stub registered under a NON-CONFIGURED provider key, to prove PrivateSTT never
// auto-selects a stray registry entry (the key 'whisper-turbo' was retired).
class StubWTE extends STTEngine {
    type = 'transformers-js-v4' as const;
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
    constructor(options?: ConstructorParameters<typeof STTEngine>[0]) {
        super(options);
        mockV4Construct();
    }
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
        sttRegistry.register('unconfigured-provider', (options) => new StubWTE(options));
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
        vi.unstubAllEnvs();
        if (pstt) {
            await pstt.terminate();
            pstt = null;
        }
        if (typeof window !== 'undefined') {
            const win = window as unknown as Record<string, unknown>;
            delete win.__SS_E2E__;
            window.localStorage.clear();
            try { window.history.replaceState({}, '', '/'); } catch { /* happy-dom location reset */ }
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

    it('stays on TransformersJSEngine when navigator.gpu lacks a usable adapter', async () => {
        // navigator.gpu present but WITHOUT requestAdapter is NOT real WebGPU
        // support; detectWebGPUSupport must treat it as unsupported and keep CPU.
        if (window.__SS_E2E__) {
            window.__SS_E2E__.isActive = true;
            window.__SS_E2E__.engineType = 'real';
        }
        Object.defineProperty(navigator, 'gpu', { value: {}, writable: true, configurable: true });

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(pstt.getEngineType()).toBe('transformers-js');
        expect(mockWTEInit).not.toHaveBeenCalled();
    });

    it('stays on CPU (transformers-js) even when WebGPU is usable — turbo/WebGPU promotion retired', async () => {
        if (window.__SS_E2E__) {
            window.__SS_E2E__.isActive = true;
            window.__SS_E2E__.engineType = 'real';
        }
        Object.defineProperty(navigator, 'gpu', {
            value: { requestAdapter: vi.fn().mockResolvedValue({ name: 'mock-adapter' }) },
            writable: true,
            configurable: true,
        });
        const { ModelManager } = await import('../../ModelManager');
        vi.spyOn(ModelManager, 'isModelDownloaded').mockResolvedValue(false);

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(pstt.getEngineType()).toBe('transformers-js');
        expect(mockWTEInit).not.toHaveBeenCalled();
    });

    it('flag-off (default): auto path stays v2-base and NEVER constructs or initializes the v4 engine — even with WebGPU usable', async () => {
        // PostHog is uninitialized in unit tests, so getV4FlagState() reads every v4 flag as OFF —
        // exactly the production default. This nails the explicit pre-merge item:
        // "flag off -> no v4 constructor / load / model request".
        if (window.__SS_E2E__) {
            window.__SS_E2E__.isActive = true;
            window.__SS_E2E__.engineType = 'real';
        }
        // WebGPU IS usable — proves it is the FLAG (off), not WebGPU-absence, keeping us on v2-base.
        Object.defineProperty(navigator, 'gpu', {
            value: { requestAdapter: vi.fn().mockResolvedValue({ name: 'mock-adapter' }) },
            writable: true,
            configurable: true,
        });
        const { ModelManager } = await import('../../ModelManager');
        vi.spyOn(ModelManager, 'isModelDownloaded').mockResolvedValue(false);

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(pstt.getEngineType()).toBe('transformers-js'); // v2-base default
        expect(mockV4Construct).not.toHaveBeenCalled();        // v4 engine never constructed
        expect(mockV4Init).not.toHaveBeenCalled();             // no v4 init / load / model request
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

    it('P0.1: publishes structured runtime telemetry on window.__PRIVATE_STT_RUNTIME_DEBUG__ after the auto path runs', async () => {
        if (window.__SS_E2E__) {
            window.__SS_E2E__.isActive = true;
            window.__SS_E2E__.engineType = 'real';
        }
        delete (window as unknown as Record<string, unknown>).__PRIVATE_STT_RUNTIME_DEBUG__;

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        const debugObj = (window as unknown as { __PRIVATE_STT_RUNTIME_DEBUG__?: Record<string, unknown> }).__PRIVATE_STT_RUNTIME_DEBUG__;
        expect(debugObj).toBeDefined();
        // Every release-proof field must be populated (non-null), not inferred.
        expect(debugObj?.runtime).toBeDefined();
        expect(debugObj?.provider).toBe('transformers-js');
        expect(debugObj?.acceleration).toBe('cpu');
        expect(typeof debugObj?.crossOriginIsolated).toBe('boolean');
        expect(typeof debugObj?.wasmThreadCount).toBe('number');
        expect(debugObj?.cloudFallbackAttempted).toBe(false);
        expect(debugObj?.selectedAt).toBeDefined();
        // getRuntimePath() exposes the same decision for in-app/harness reads.
        expect(pstt.getRuntimePath()?.provider).toBe('transformers-js');
    });

    it('P0.1: publishes structured runtime telemetry for explicit transformers-js override', async () => {
        if (window.__SS_E2E__) {
            window.__SS_E2E__.isActive = true;
            window.__SS_E2E__.engineType = 'real';
        }
        delete (window as unknown as Record<string, unknown>).__PRIVATE_STT_RUNTIME_DEBUG__;

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'transformers-js' } as never);
        await pstt.init();

        const debugObj = (window as unknown as { __PRIVATE_STT_RUNTIME_DEBUG__?: Record<string, unknown> }).__PRIVATE_STT_RUNTIME_DEBUG__;
        expect(debugObj).toBeDefined();
        expect(debugObj?.runtime).toBeDefined();
        expect(debugObj?.provider).toBe('transformers-js');
        expect(debugObj?.acceleration).toBe('cpu');
        expect(typeof debugObj?.crossOriginIsolated).toBe('boolean');
        expect(typeof debugObj?.wasmThreadCount).toBe('number');
        expect(debugObj?.cloudFallbackAttempted).toBe(false);
        expect(debugObj?.selectedAt).toBeDefined();
        expect(pstt.getRuntimePath()?.provider).toBe('transformers-js');
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

    // ---- MERGE-SAFETY: the public ?privateEngine / localStorage override is dev/test-only ----
    // A normal production build must NOT let a public URL or localStorage value bypass the
    // PostHog v4 flag. Production is simulated by DEV=false + not-E2E + not-unit (__TEST__=false).
    it('merge-safety: PRODUCTION ignores ?privateEngine=transformers-js-v4 override -> v2-base (no flag bypass)', async () => {
        vi.stubEnv('DEV', false);
        globalThis.__TEST__ = false;
        if (window.__SS_E2E__) window.__SS_E2E__.isActive = false;
        window.history.replaceState({}, '', '?privateEngine=transformers-js-v4');

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(pstt.getEngineType()).toBe('transformers-js'); // override ignored in production
        expect(mockV4Construct).not.toHaveBeenCalled();        // v4 never constructed
        expect(mockV4Init).not.toHaveBeenCalled();             // v4 never initialized
    });

    it('merge-safety: PRODUCTION ignores localStorage private-engine override -> v2-base (no flag bypass)', async () => {
        vi.stubEnv('DEV', false);
        globalThis.__TEST__ = false;
        if (window.__SS_E2E__) window.__SS_E2E__.isActive = false;
        window.localStorage.setItem('speaksharp.private.engine', 'transformers-js-v4');

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(pstt.getEngineType()).toBe('transformers-js');
        expect(mockV4Construct).not.toHaveBeenCalled();
        expect(mockV4Init).not.toHaveBeenCalled();
    });

    it('CASUALTY: ?privateEngine / localStorage can no longer force v4, even in dev/test', async () => {
        // This used to assert the override was HONORED here, gated to dev/test. The gate was real, but
        // the sibling `?privateModel=` channel had no gate at all and worked on the production site,
        // and these parameter names disclose internal engine builds to anyone reading a URL. The whole
        // channel is retired, so the assertion inverts: the URL and storage are now inert everywhere.
        if (window.__SS_E2E__) { window.__SS_E2E__.isActive = true; window.__SS_E2E__.engineType = 'real'; }
        window.localStorage.setItem('speaksharp.private.engine', 'transformers-js-v4');
        window.history.replaceState({}, '', '?privateEngine=transformers-js-v4');

        const { PrivateSTT } = await import('../PrivateSTT');
        pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        expect(pstt.getEngineType()).toBe('transformers-js');
        expect(mockV4Init).not.toHaveBeenCalled();
        window.history.replaceState({}, '', '/');
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

    it('contract: v4 availability reports cache miss and the SELECTED variant size', async () => {
        globalThis.__TEST__ = false;
        // Availability follows the CONFIG SELECTION, not the provider default: a build configured for
        // a v4 variant must probe that variant and quote ITS download size. Reporting base_q4's number
        // for a different variant is a consent prompt about the wrong model.
        vi.resetModules();
        vi.doMock('../../candidateSelection', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../../candidateSelection')>();
            const { CANDIDATES } = await import('../../candidateRegistry');
            return {
                ...actual,
                effectiveCandidate: () => ({ candidate: CANDIDATES['v4:base:q4'], fallbackCause: null }),
            };
        });
        try {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
            const availability = await pstt.checkAvailability();

            expect(availability.isAvailable).toBe(false);
            expect(availability.reason).toBe('CACHE_MISS');
            expect(availability.sizeMB).toBe(PRIV_STT_V4_VARIANTS.base_q4.EXPECTED_SPLIT_DOWNLOAD_MB);
        } finally {
            // UNCONDITIONAL. A throwing assertion previously left this module mocked, and the NEXT
            // test then resolved v4 and failed for a reason that had nothing to do with it.
            vi.doUnmock('../../candidateSelection');
            vi.resetModules();
        }
    });

    it('contract: does not fall back to a non-configured registry provider when configured provider is absent', async () => {
        await setupStrictZero();
        const { sttRegistry } = await import('../../STTRegistry');
        sttRegistry.clear();
        sttRegistry.register('unconfigured-provider', (options) => new StubWTE(options));

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

    describe('#1635 cancellation/recovery of an in-flight acquisition', () => {
        type Gate = (result: Result<void, Error>) => void;
        let created: StubTJ[];
        let gates: Gate[];
        beforeEach(async () => {
            created = [];
            gates = [];
            mockTJInit.mockImplementation(() => new Promise((resolve) => { gates.push(resolve); }));
            const { sttRegistry } = await import('../../STTRegistry');
            sttRegistry.register('transformers-js', (options) => {
                const engine = new StubTJ(options);
                created.push(engine);
                return engine;
            });
        });
        afterEach(() => { mockTJInit.mockReset(); mockTJInit.mockResolvedValue({ isOk: true, data: undefined }); });

        it.each(['destroy', 'terminate'] as const)('a %s during the model load releases the acquired engine exactly once and never adopts it', async (teardown) => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
            const pending = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            await pstt[teardown]();
            gates[0](Result.ok(undefined));
            const result = await pending;

            expect(result.isOk).toBe(false);
            expect(created).toHaveLength(1);
            expect(created[0].onDestroy).toHaveBeenCalledTimes(1);
            await expect(pstt.start()).rejects.toThrow(/not initialized/);
        });

        it('destroy then re-init: the old load settling last is released and cannot replace the new engine', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
            const old = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            await pstt.destroy();
            const fresh = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(2));
            gates[1](Result.ok(undefined));
            expect((await fresh).isOk).toBe(true);
            gates[0](Result.ok(undefined));
            expect((await old).isOk).toBe(false);

            expect(created).toHaveLength(2);
            expect(created[0].onDestroy).toHaveBeenCalledTimes(1); // the cancelled acquisition, released once
            expect(created[1].onDestroy).not.toHaveBeenCalled(); // the newer engine is never destroyed here
            await pstt.terminate();
            expect(created[1].onDestroy).toHaveBeenCalledTimes(1); // and it is the one the facade owned
            pstt = null;
        });

        it('overlapping init() calls acquire ONE engine', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
            const first = pstt.init();
            const second = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            gates[0](Result.ok(undefined));
            expect((await first).isOk).toBe(true);
            expect((await second).isOk).toBe(true);
            expect(created).toHaveLength(1);
            expect(mockTJInit).toHaveBeenCalledTimes(1);
        });

        it('an injected engine destroyed during its own init is torn down once, with no read of the nulled engine', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            const injected = new StubTJ({});
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() }, injected as never);
            const pending = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            await pstt.destroy();
            gates[0](Result.ok(undefined));
            const result = await pending; // must settle, not throw a TypeError on `this.engine.type`
            expect(result.isOk).toBe(false);
            expect(injected.onDestroy).toHaveBeenCalledTimes(1);
        });

        it.each(['terminate', 'destroy'] as const)('Sam counterexample: a slow %s of engine A cannot destroy engine B adopted by a fresh init', async (teardown) => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
            const first = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            gates[0](Result.ok(undefined));
            expect((await first).isOk).toBe(true);

            // Engine A's own teardown is slow: its child terminate/destroy waits on a gate.
            let releaseA!: () => void;
            created[0].onDestroy.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseA = resolve; }));
            const tearingDown = pstt[teardown]();
            const fresh = pstt.init(); // init B, requested while A's teardown is still in progress
            await vi.waitFor(() => expect(created[0].onDestroy).toHaveBeenCalledTimes(1));
            expect(created).toHaveLength(1); // B is not even constructed until A's teardown settles
            releaseA();
            await tearingDown;
            await vi.waitFor(() => expect(gates).toHaveLength(2));
            gates[1](Result.ok(undefined));
            expect((await fresh).isOk).toBe(true);

            expect(created).toHaveLength(2);
            expect(created[1].onDestroy).not.toHaveBeenCalled(); // A's teardown never acted on B
            await pstt.start(); // the facade is initialised with a live engine, not left with engine null
            await pstt.terminate();
            expect(created[1].onDestroy).toHaveBeenCalledTimes(1);
            pstt = null;
        });

        /**
         * Moonshine's real engine implements terminate() (it closes the transcriber) and NO destroy(); validateEngine
         * then injects a no-op destroy. A release through destroy() would report success with the transcriber open.
         */
        const moonshineShaped = () => {
            const state = { transcriberOpen: false, terminations: 0, settleInit: (() => undefined) as (result: Result<void, Error>) => void };
            const engine = {
                init: vi.fn(() => {
                    // Own the partial resource while acquisition is pending. Settling a cancelled
                    // load must not manufacture a new resource after its teardown already completed.
                    state.transcriberOpen = true;
                    return new Promise<Result<void, Error>>((resolve) => { state.settleInit = resolve; });
                }),
                transcribe: vi.fn(async () => ({ isOk: true, data: '' })),
                start: vi.fn(async () => {}), stop: vi.fn(async () => {}),
                pause: vi.fn(async () => {}), resume: vi.fn(async () => {}),
                terminate: vi.fn(async () => { state.terminations += 1; state.transcriberOpen = false; }),
                getTranscript: vi.fn(async () => ''), getInterimTranscript: vi.fn(() => ''),
            };
            return { engine, state };
        };

        it.each(['destroy', 'terminate'] as const)('a cancelled Moonshine-shaped acquisition is released through terminate() exactly once, closing its transcriber (%s)', async (teardown) => {
            const selection = await import('../../candidateSelection');
            const { CANDIDATES } = await import('../../candidateRegistry');
            vi.spyOn(selection, 'effectiveCandidate').mockReturnValue({ candidate: CANDIDATES['moonshine:streaming-medium'], fallbackCause: null } as never);
            const moonshine = moonshineShaped();
            const { sttRegistry } = await import('../../STTRegistry');
            sttRegistry.register('moonshine-streaming', () => moonshine.engine as never);

            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'moonshine-streaming' } as never);
            const pending = pstt.init();
            await vi.waitFor(() => expect(moonshine.engine.init).toHaveBeenCalledTimes(1));
            expect(moonshine.state.transcriberOpen).toBe(true);
            await pstt[teardown]();
            expect(moonshine.state.transcriberOpen).toBe(false);
            moonshine.state.settleInit(Result.ok(undefined));
            const result = await pending;

            expect(result.isOk).toBe(false);
            expect(moonshine.engine.terminate).toHaveBeenCalledTimes(1);
            expect(moonshine.state.transcriberOpen, 'a no-op destroy() would leave the transcriber open').toBe(false);
        });

        it('a cancelled acquisition whose release FAILS reports an uncertain release, never a clean cancel', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
            const pending = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            created[0].onDestroy.mockRejectedValueOnce(new Error('dispose exploded'));
            await expect(pstt.destroy()).rejects.toThrow(/release uncertain\): dispose exploded/);
            gates[0](Result.ok(undefined));
            const result = await pending;
            expect(result.isOk).toBe(false);
            expect(result.isOk ? '' : result.error.message).toMatch(/release uncertain/);
            expect(result.isOk ? '' : result.error.message).toMatch(/dispose exploded/);
            pstt = null; // its release is uncertain by design; afterEach must not replay it
        });

        it('a replaced engine whose release FAILS refuses the replacement, releases the new engine, and says so', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            // The explicit-provider path acquires a NEW engine on every init; the default path re-inits the adopted one.
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'transformers-js' } as never);
            const first = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            gates[0](Result.ok(undefined));
            expect((await first).isOk).toBe(true);

            created[0].onDestroy.mockRejectedValueOnce(new Error('old engine stuck'));
            const replacing = pstt.init(); // a completed init re-run while engine A is still adopted: acquires engine B
            await vi.waitFor(() => expect(gates).toHaveLength(2));
            gates[1](Result.ok(undefined));
            const result = await replacing;

            expect(result.isOk).toBe(false);
            expect(result.isOk ? '' : result.error.message).toMatch(/replaced engine FAILED \(release uncertain\): old engine stuck; the new engine was released/);
            expect(created[1].onDestroy).toHaveBeenCalledTimes(1); // the refused replacement is released, not adopted
            await expect(pstt.start()).rejects.toThrow(/not initialized/);
            pstt = null; // its release is uncertain by design; afterEach must not replay it
        });

        it('a failed engine release rejects public destroy() as uncertain, and a repeat replays it', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
            const first = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            gates[0](Result.ok(undefined));
            expect((await first).isOk).toBe(true);
            created[0].onDestroy.mockRejectedValueOnce(new Error('engine dispose failed'));
            await expect(pstt.destroy()).rejects.toThrow(/release uncertain\): engine dispose failed/);
            await expect(pstt.destroy()).rejects.toThrow(/release uncertain\): engine dispose failed/);
            expect(created[0].onDestroy).toHaveBeenCalledTimes(1);
            // The facade whose release is uncertain refuses to initialise again; no new engine is acquired.
            const reinit = await pstt.init();
            expect(reinit.isOk).toBe(false);
            expect(reinit.isOk ? '' : reinit.error.message).toMatch(/previous teardown failed \(release uncertain\)/);
            expect(created).toHaveLength(1);
            pstt = null; // its teardown failed by design; afterEach must not replay it
        });

        it('concurrent terminate/destroy waiters all see the SAME failed release, never a success', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
            const first = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            gates[0](Result.ok(undefined));
            expect((await first).isOk).toBe(true);
            created[0].onDestroy.mockRejectedValueOnce(new Error('engine stuck'));
            const outcomes = await Promise.allSettled([pstt.terminate(), pstt.destroy(), pstt.terminate()]);
            expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected', 'rejected']);
            const [reason, ...others] = outcomes.map((outcome) => (outcome as PromiseRejectedResult).reason as Error);
            expect(reason.message).toBe('[PrivateSTT] engine release FAILED during teardown (release uncertain): engine stuck');
            for (const other of others) expect(other).toBe(reason);
            expect(created[0].onDestroy).toHaveBeenCalledTimes(1);
            pstt = null;
        });

        it('Sam counterexample: a stale failed retirement cannot clear the readiness of a newer, successful init', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            // The explicit-provider path acquires a new engine per init, so init B must retire engine A.
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'transformers-js' } as never);
            const initA = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            gates[0](Result.ok(undefined));
            expect((await initA).isOk).toBe(true);

            let rejectA!: (error: Error) => void;
            created[0].onDestroy.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectA = reject; }));
            const initB = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(2));
            gates[1](Result.ok(undefined));
            await vi.waitFor(() => expect(created[0].onDestroy).toHaveBeenCalledTimes(1)); // A's retirement is pending

            await pstt.destroy();
            const initC = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(3));
            gates[2](Result.ok(undefined));
            expect((await initC).isOk).toBe(true);

            rejectA(new Error('A stuck'));
            const resultB = await initB;
            expect(resultB.isOk).toBe(false);

            await pstt.start(); // C is still initialised: B's stale failure did not clear its readiness
            expect(pstt.getEngineType()).toBe('transformers-js');
            expect(created[2].onDestroy).not.toHaveBeenCalled();
            // C is released, but A's failed release is retained, so the teardown is still reported uncertain.
            await expect(pstt.terminate()).rejects.toThrow(/A stuck/);
            expect(created[2].onDestroy).toHaveBeenCalledTimes(1); // and C is the engine the facade owned
            pstt = null;
        });

        it('Sam r6 #1: a failed replacement release is sticky: a later init refuses and acquires nothing', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'transformers-js' } as never);
            const initA = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            gates[0](Result.ok(undefined));
            expect((await initA).isOk).toBe(true);

            created[0].onDestroy.mockRejectedValueOnce(new Error('old engine stuck'));
            const initB = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(2));
            gates[1](Result.ok(undefined));
            expect((await initB).isOk).toBe(false);

            const retry = pstt.init();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(created, 'a retry after an uncertain release must not acquire engine C').toHaveLength(2);
            gates[2]?.(Result.ok(undefined)); // only reached if a retry wrongly acquired
            const retried = await retry;
            expect(retried.isOk).toBe(false);
            expect(retried.isOk ? '' : retried.error.message).toMatch(/release uncertain\).*old engine stuck/);
            expect(mockTJInit).toHaveBeenCalledTimes(2);
            pstt = null; // its release is uncertain by design; afterEach must not replay it
        });

        it('Sam r7 #1 residual: after a failed replacement release, concurrent and repeated destroy/terminate all reject with the retained failure', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'transformers-js' } as never);
            const initA = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            gates[0](Result.ok(undefined));
            expect((await initA).isOk).toBe(true);

            const retained = new Error('old engine stuck');
            created[0].onDestroy.mockRejectedValueOnce(retained);
            const initB = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(2));
            gates[1](Result.ok(undefined));
            expect((await initB).isOk).toBe(false); // A's release rejected; B's cleanup completed
            expect(created[0].onDestroy).toHaveBeenCalledTimes(1);
            expect(created[1].onDestroy).toHaveBeenCalledTimes(1);

            const concurrent = await Promise.allSettled([pstt.destroy(), pstt.terminate(), pstt.destroy()]);
            const repeated = await Promise.allSettled([pstt.terminate(), pstt.destroy()]);
            for (const outcome of [...concurrent, ...repeated]) {
                expect(outcome.status).toBe('rejected');
                expect((outcome as PromiseRejectedResult).reason).toBe(retained); // the ORIGINAL failure, never a new one
            }
            expect(created[0].onDestroy).toHaveBeenCalledTimes(1); // A is never closed a second time
            expect(created[1].onDestroy).toHaveBeenCalledTimes(1);
            pstt = null; // its release is uncertain by design; afterEach must not replay it
        });

        it('Sam r6 #2: Start while the replaced engine is still being retired rejects instead of starting nothing', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'transformers-js' } as never);
            const initA = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            gates[0](Result.ok(undefined));
            expect((await initA).isOk).toBe(true);

            let releaseA!: () => void;
            created[0].onDestroy.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseA = resolve; }));
            const initB = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(2));
            gates[1](Result.ok(undefined));
            await vi.waitFor(() => expect(created[0].onDestroy).toHaveBeenCalledTimes(1)); // A's retirement is held

            await expect(pstt.start()).rejects.toThrow(/not initialized/);
            expect(created[1].onStart).not.toHaveBeenCalled();
            releaseA();
            expect((await initB).isOk).toBe(true);
            await pstt.start(); // the owned replacement, once adopted, is the engine that starts
            expect(created[1].onStart).toHaveBeenCalledTimes(1);
        });

        it('Sam r6 #3: a teardown in the post-adoption window cancels the init instead of reading the detached engine', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            const facade = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), forceEngine: 'transformers-js' } as never);
            pstt = facade;
            const internals = facade as unknown as { adoptEngine: (...args: unknown[]) => Promise<Result<void, Error>> };
            const adopt = internals.adoptEngine.bind(facade);
            vi.spyOn(internals, 'adoptEngine').mockImplementationOnce(async (...args: unknown[]) => {
                const adopted = await adopt(...args);
                await facade.destroy(); // detaches and releases the engine before the init resumes
                return adopted;
            });
            const pending = facade.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            gates[0](Result.ok(undefined));
            const result = await pending; // must settle as a cancellation, not reject with a null dereference

            expect(result.isOk).toBe(false);
            expect(result.isOk ? '' : result.error.message).toMatch(/init cancelled/);
            expect(created[0].onDestroy).toHaveBeenCalledTimes(1);
            await expect(facade.start()).rejects.toThrow(/not initialized/);
        });

        it.each([
            { releaseOutcome: 'completes', releaseError: null, teardownStatus: 'fulfilled', teardownMessage: /^$/ },
            { releaseOutcome: 'fails', releaseError: new Error('injected stuck'), teardownStatus: 'rejected', teardownMessage: /release uncertain\): injected stuck/ },
        ] as const)('Sam r6 #4: an injected init cancelled while its release is held (and $releaseOutcome) never claims the engine was released', async ({ releaseError, teardownStatus, teardownMessage }) => {
            const { PrivateSTT } = await import('../PrivateSTT');
            const injected = new StubTJ({});
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() }, injected as never);
            const pending = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            let completeRelease!: () => void;
            let failRelease!: (error: Error) => void;
            injected.onDestroy.mockImplementationOnce(() => new Promise<void>((resolve, reject) => { completeRelease = resolve; failRelease = reject; }));
            const tearingDown = pstt.destroy();
            gates[0](Result.ok(undefined));
            const result = await pending; // settles while the release is still held

            expect(result.isOk).toBe(false);
            const message = result.isOk ? '' : result.error.message;
            expect(message).toMatch(/init cancelled/);
            expect(message).not.toMatch(/was released/);
            if (releaseError) failRelease(releaseError);
            else completeRelease();
            const [teardown] = await Promise.allSettled([tearingDown]);
            expect(teardown.status).toBe(teardownStatus);
            expect(teardown.status === 'rejected' ? String((teardown.reason as Error).message) : '').toMatch(teardownMessage);
            expect(injected.onDestroy).toHaveBeenCalledTimes(1);
            if (teardown.status === 'rejected') pstt = null; // its teardown failed by design; afterEach must not replay it
        });

        it('Sam r7 adjacent #1: init B waits for pending A retirement and acquires nothing if that release fails', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
            const initA = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1)); // pending A
            const staleFailure = new Error('stale A cleanup failed');
            let failRelease!: (error: Error) => void;
            created[0].onDestroy.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failRelease = reject; }));
            const retirement = pstt.destroy().then(() => null, (error: unknown) => error);
            const initB = pstt.init(); // B must wait for A's pending release, before construction.
            await vi.waitFor(() => expect(created[0].onDestroy).toHaveBeenCalledTimes(1));
            expect(created).toHaveLength(1);
            failRelease(staleFailure);
            expect(await retirement).toEqual(expect.objectContaining({ message: expect.stringMatching(/release uncertain\): stale A cleanup failed/) }));
            gates[0](Result.ok(undefined));
            const resultA = await initA;
            expect(resultA.isOk).toBe(false);
            expect(resultA.isOk ? '' : resultA.error.message).toMatch(/release uncertain\): stale A cleanup failed/);
            const resultB = await initB;

            expect(resultB.isOk).toBe(false);
            expect(resultB.isOk ? '' : resultB.error.message).toBe('[STTEngine] transformers-js cannot initialise: its previous teardown failed (release uncertain); create a new engine. stale A cleanup failed');
            expect(created).toHaveLength(1); // B never acquires a worker after an uncertain release.
            expect(created[0].onDestroy).toHaveBeenCalledTimes(1); // A is not closed a second time
            await expect(pstt.start()).rejects.toThrow(/not initialized/);
            pstt = null; // its release is uncertain by design; afterEach must not replay it
        });

        it('Sam r7 adjacent #2: an injected engine whose init fails and whose release rejects is recorded and never re-invoked', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            // A contract-valid injected double that is NOT an STTEngine: no sticky protection of its own.
            const injected = {
                init: vi.fn(async () => Result.err(new Error('injected init failed'))),
                start: vi.fn(async () => {}), stop: vi.fn(async () => {}),
                terminate: vi.fn(async () => { throw new Error('injected release stuck'); }),
                transcribe: vi.fn(async () => Result.ok('')),
                getTranscript: vi.fn(async () => ''), getInterimTranscript: vi.fn(() => ''),
            };
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() }, injected as never);
            const first = await pstt.init(); // must settle as a Result, not reject

            expect(first.isOk).toBe(false);
            expect(first.isOk ? '' : first.error.message).toMatch(/injected init failed; releasing the injected engine FAILED \(release uncertain\): injected release stuck/);
            const again = await pstt.init();
            expect(again.isOk).toBe(false);
            expect(again.isOk ? '' : again.error.message).toMatch(/release uncertain\).*injected release stuck/);
            expect(injected.init).toHaveBeenCalledTimes(1); // the uncertain engine is never re-invoked
            expect(injected.terminate).toHaveBeenCalledTimes(1);
            pstt = null; // its release is uncertain by design; afterEach must not replay it
        });

        it('preservation: a completed destroy -> init reuses the facade with a fresh engine', async () => {
            const { PrivateSTT } = await import('../PrivateSTT');
            pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
            const first = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(1));
            gates[0](Result.ok(undefined));
            expect((await first).isOk).toBe(true);
            await pstt.destroy();
            expect(created[0].onDestroy).toHaveBeenCalledTimes(1);
            const again = pstt.init();
            await vi.waitFor(() => expect(gates).toHaveLength(2));
            gates[1](Result.ok(undefined));
            expect((await again).isOk).toBe(true);
            expect(pstt.getEngineType()).toBe('transformers-js');
            expect(created).toHaveLength(2);
            expect(created[1].onDestroy).not.toHaveBeenCalled();
        });
    });
});
