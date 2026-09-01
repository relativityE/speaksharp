// @vitest-environment jsdom
//
// #1381 closure point 5 — THE FOUR HOPS, THROUGH THE REAL FACADE.
//
// The existing four-hop test registers a fake executor whose `teardown` and `initialize` push strings
// into an array. That proves the switch's BOOKKEEPING — that selection moves, that every hop tears down
// before it initialises — and nothing else. It would pass identically if the facade could not construct
// Moonshine at all, because no engine is ever built: the thing the hop exists to exercise is the part
// the fake replaces.
//
// So this drives the REAL installed executor and the REAL PrivateSTT facade. What remains stubbed is the
// engine factory behind each provider, because a unit test cannot download 305 MB of weights — but the
// identity each hop publishes is produced by the real resolution path, not asserted by the harness. That
// is the distinction that matters here: requested === observed is DERIVED, not arranged.
//
// Real weights on real hardware are #1390's job; this proves the wiring that #1390 depends on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installRuntimeCandidateSwitch } from '../installRuntimeSwitch';
import { clearRuntimeCandidateOverride, registerSwitchExecutor } from '../runtimeCandidateSwitch';
import { clearResolvedEngine } from '@/services/telemetry/runtimeAttribution';
import { sttRegistry } from '../STTRegistry';
import { speechRuntimeController } from '@/services/SpeechRuntimeController';
import type { IPrivateSTTEngine } from '../../../contracts/IPrivateSTTEngine';

vi.mock('../../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// AN ENVIRONMENT FACT, NOT THE LOGIC UNDER TEST. distil requires real WebGPU, which jsdom does not
// have; refusing it there is correct product behaviour, not a bug to route around. The operator runs
// these hops on real hardware, so the accelerator is stubbed present to reach the identity question.
// That distil is refused when WebGPU is genuinely absent is proven separately and deliberately not
// re-proven by weakening it here.
//
// BOTH probes are stubbed, and that is worth stating. The refusal gate calls `isWebGPUSupported()`
// while the runtime-path resolver independently calls `detectWebGPUSupport()`. Stubbing only the first
// produced a state where the gate said "accelerator present, distil may proceed" and the resolver said
// "no accelerator, fall to the v2 floor" — so a distil request resolved to v2 and the switch still
// returned ok. That divergence was manufactured here, and in production both calls reach the same
// module, so this is a latent fragility rather than a live defect. It is recorded because the failure
// mode it produces is a silent model substitution reported as success, which is the one outcome this
// workstream cannot tolerate — and nothing currently couples the two probes.
vi.mock('../utils/webgpuSupport', () => ({
    isWebGPUSupported: async () => true,
    detectWebGPUSupport: async () => ({ supported: true, adapter: 'stub', reason: null }),
}));

const INTERNAL = { VITE_INTERNAL_BUILD: 'true' };
const SEQUENCE = ['v4:distil:q4', 'moonshine:streaming-medium', 'v2:base.en'] as const;

const stubEngine = (): IPrivateSTTEngine => ({
    init: vi.fn(async () => ({ isOk: true, data: undefined })),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    terminate: vi.fn(async () => {}),
    getTranscript: vi.fn(async () => ''),
    getInterimTranscript: vi.fn(() => ''),
} as unknown as IPrivateSTTEngine);

const active = () => (window as unknown as {
    __SS_SWITCH_CANDIDATE__: (id: string) => Promise<{ ok: boolean; code?: string }>;
    __SS_ACTIVE_CANDIDATE__: () => { requested: string; observed: string | null; matches: boolean };
});

describe('v2 → distil → Moonshine → v2 on the real facade', () => {
    beforeEach(() => {
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor(null);
        for (const provider of ['transformers-js', 'transformers-js-v4', 'moonshine-streaming']) {
            sttRegistry.register(provider, () => stubEngine() as never);
        }
        document.documentElement.setAttribute('data-runtime-state', 'READY');
        // The real executor's `initialize` asks the controller to bring an engine up. Here that builds a
        // REAL PrivateSTT against the registered factories, so the identity published at the end of the
        // hop is the one the facade resolved rather than one the test supplied.
        vi.spyOn(speechRuntimeController, 'initiateModelDownload').mockImplementation(async () => {
            const { PrivateSTT } = await import('../engines/PrivateSTT');
            const engine = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
            await engine.init();
        });
        installRuntimeCandidateSwitch(INTERNAL);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sttRegistry.clear();
        registerSwitchExecutor(null);
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        speechRuntimeController.service = null;
        document.documentElement.removeAttribute('data-runtime-state');
    });

    it('CASUALTY: every hop reaches READY with requested === observed', async () => {
        const seen: Array<{ requested: string; observed: string | null; matches: boolean }> = [];
        for (const id of SEQUENCE) {
            const outcome = await active().__SS_SWITCH_CANDIDATE__(id);
            expect(outcome.ok, `hop to ${id} failed: ${outcome.code}`).toBe(true);
            seen.push(active().__SS_ACTIVE_CANDIDATE__());
        }

        expect(seen.map((s) => s.requested)).toEqual([...SEQUENCE]);
        // The load-bearing assertion. `observed` comes from what the engine published on resolution, so
        // a hop that silently ran a different model — the exact failure this whole workstream exists to
        // prevent — shows up here as a mismatch rather than as a clean-looking pass.
        expect(seen.map((s) => s.observed)).toEqual([...SEQUENCE]);
        expect(seen.every((s) => s.matches)).toBe(true);
    });

    it('CASUALTY: a hop whose engine fails to initialise publishes NO identity', async () => {
        // The dangerous residue: `resolvedEngine()` used to survive a failed switch, so the app kept
        // reporting the PREVIOUS model as the running one. An observed identity that outlives its engine
        // reads as evidence, which is worse than reporting nothing.
        await active().__SS_SWITCH_CANDIDATE__('v4:distil:q4');
        expect(active().__SS_ACTIVE_CANDIDATE__().observed).toBe('v4:distil:q4');

        (speechRuntimeController.initiateModelDownload as unknown as { mockImplementation: (f: () => Promise<void>) => void })
            .mockImplementation(async () => { throw new Error('engine failed to start'); });

        const outcome = await active().__SS_SWITCH_CANDIDATE__('moonshine:streaming-medium');
        expect(outcome.ok).toBe(false);
        const state = active().__SS_ACTIVE_CANDIDATE__();
        expect(state.observed, 'the outgoing model must not be reported as running').toBeNull();
        expect(state.matches).toBe(false);
    });
});
