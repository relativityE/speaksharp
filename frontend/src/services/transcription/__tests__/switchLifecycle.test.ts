// @vitest-environment jsdom
//
// #1263 — ONE COMBINED ORDERING PROOF, against the REAL controller.
//
// The critical condition is that the new engine does not begin initialising while the old engine's
// destruction is still unresolved. Proving that in two halves — "hardResetAwaited() waits" in a
// controller test, "the installer calls hardResetAwaited()" in a mocked test — leaves the join
// untested: an installer wired to `reset()` instead would satisfy both halves and still start two
// engines over one worker. So this drives the real singleton through the real switch, and holds
// destruction open across the boundary.
//
// Only the SERVICE is a stub, because the subject is teardown ordering rather than a transcription
// engine, and `initiateModelDownload` is spied so the test does not download a model.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import type { TranscriptionMode } from '../TranscriptionPolicy';
import { speechRuntimeController } from '@/services/SpeechRuntimeController';
import { installRuntimeCandidateSwitch } from '../installRuntimeSwitch';
import { switchCandidate, clearRuntimeCandidateOverride, registerSwitchExecutor } from '../runtimeCandidateSwitch';
import { recordResolvedEngine, resolvedEngine, clearResolvedEngine } from '@/services/telemetry/runtimeAttribution';

vi.mock('../../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const INTERNAL = { VITE_INTERNAL_BUILD: 'true' };

/** A service whose destruction we hold open, so ordering is observable rather than inferred. */
function deferredService() {
    let release!: () => void;
    const destroyed = { value: false };
    const gate = new Promise<void>((r) => { release = r; });
    const destroy = vi.fn(async () => { await gate; destroyed.value = true; });
    return { svc: { destroy } as unknown as never, destroy, destroyed, release };
}

describe('model switch — combined real-controller ordering', () => {
    let initSpy: MockInstance<(mode?: TranscriptionMode) => Promise<void>>;
    const order: string[] = [];

    beforeEach(() => {
        order.length = 0;
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor(null);
        (speechRuntimeController as unknown as { state: string }).state = 'READY';
        document.documentElement.setAttribute('data-runtime-state', 'READY');
        initSpy = vi.spyOn(speechRuntimeController, 'initiateModelDownload')
            .mockImplementation(async () => { order.push('initiateModelDownload'); });
        installRuntimeCandidateSwitch(INTERNAL);
    });
    afterEach(() => {
        initSpy.mockRestore();
        registerSwitchExecutor(null);
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        speechRuntimeController.service = null;
        document.documentElement.removeAttribute('data-runtime-state');
    });

    it('CASUALTY: initialisation does NOT begin while the old engine is still being destroyed', async () => {
        const { svc, destroyed, release } = deferredService();
        speechRuntimeController.service = svc;

        const pending = switchCandidate('v4:distil:q4', INTERNAL);

        // Give the switch every chance to run ahead: several microtask turns and a macrotask.
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 20));

        expect(destroyed.value, 'destruction is still open').toBe(false);
        expect(initSpy, 'the new engine must not have started').not.toHaveBeenCalled();

        release();
        const out = await pending;

        expect(out.ok).toBe(true);
        expect(destroyed.value).toBe(true);
        expect(initSpy).toHaveBeenCalledTimes(1);
    });

    it('CASUALTY: the OUTGOING identity is cleared before the new engine comes up', async () => {
        recordResolvedEngine({ candidateId: 'v2:base.en', modelIdentity: { engine: 'transformers-js' } });
        const { svc, release } = deferredService();
        speechRuntimeController.service = svc;

        const pending = switchCandidate('v4:distil:q4', INTERNAL);
        await Promise.resolve();
        // Already unknown while the old engine is still dying — never the model that is going away.
        expect(resolvedEngine()).toBeNull();
        release();
        await pending;
        expect(resolvedEngine()).toBeNull();
    });

    it('CASUALTY: a failed initialisation does not resurrect the previous model identity', async () => {
        recordResolvedEngine({ candidateId: 'v2:base.en', modelIdentity: { engine: 'transformers-js' } });
        initSpy.mockImplementationOnce(async () => { throw new Error('model would not load'); });
        speechRuntimeController.service = null;

        const out = await switchCandidate('v4:distil:q4', INTERNAL);
        expect(out).toMatchObject({ ok: false, code: 'init_failed' });
        expect(resolvedEngine()).toBeNull();
    });

    it('CASUALTY: switching to MOONSHINE tears down the old engine before starting it', async () => {
        // Moonshine is registered on the provider path now, so it is switched TO rather than refused —
        // and it must obey the same ordering as every other candidate.
        const { svc, destroyed, release } = deferredService();
        speechRuntimeController.service = svc;

        const pending = switchCandidate('moonshine:streaming-medium', INTERNAL);
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 20));
        expect(destroyed.value).toBe(false);
        expect(initSpy, 'moonshine must not start over a live engine').not.toHaveBeenCalled();

        release();
        expect((await pending).ok).toBe(true);
        expect(destroyed.value).toBe(true);
        expect(initSpy).toHaveBeenCalledTimes(1);
    });

    it('POSITIVE CONTROL: with no service attached the switch still completes', async () => {
        speechRuntimeController.service = null;
        const out = await switchCandidate('v4:distil:q4', INTERNAL);
        expect(out.ok).toBe(true);
        expect(initSpy).toHaveBeenCalledTimes(1);
    });
});
