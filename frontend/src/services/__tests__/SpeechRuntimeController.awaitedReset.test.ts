// @vitest-environment jsdom
//
// #1263 — the model switch needs to know WHEN the previous engine is gone.
//
// `reset()` clears state synchronously and then leaves `service.destroy()` and both lifecycle
// transitions running unawaited — its own comment called this "fire-and-forget destruction". A caller
// therefore cannot tell whether the old engine is still alive when it returns.
//
// Polling the published runtime state is not a substitute, and that is the trap this suite pins: at the
// moment a switch begins the state is already READY — that is why the switch was permitted — so a
// settled-state check passes on its FIRST read, before the reset has changed anything. The check looks
// like a wait and is not one.
//
// These drive the REAL controller. Only the service is a stub, because the thing under test is the
// controller's teardown ordering, not a transcription engine.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
    updateSession: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u' } } } }) },
        functions: { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) },
    })),
}));

/** A service whose destruction we can hold open, so ordering is observable rather than inferred. */
function deferredService() {
    let release!: () => void;
    const destroyed = { value: false };
    const gate = new Promise<void>((r) => { release = r; });
    const destroy = vi.fn(async () => { await gate; destroyed.value = true; });
    return { svc: { destroy } as unknown as never, destroy, destroyed, release };
}

describe('SpeechRuntimeController — awaited vs fire-and-forget hard reset', () => {
    let controller: SpeechRuntimeController;
    beforeEach(() => {
        // The real singleton, as the other controller suites use it — the constructor is private.
        controller = SpeechRuntimeController.getInstance();
        (controller as unknown as { state: string }).state = 'READY';
        (controller as unknown as { initialized: boolean }).initialized = true;
        controller.service = null;
    });

    it('CASUALTY: hardResetAwaited does NOT resolve until the service is destroyed', async () => {
        const { svc, destroyed, release } = deferredService();
        controller.service = svc;

        let resolved = false;
        const pending = controller.hardResetAwaited('candidate-switch').then(() => { resolved = true; });

        // Destruction is still held open, so the caller must still be waiting.
        await Promise.resolve();
        expect(destroyed.value).toBe(false);
        expect(resolved).toBe(false);

        release();
        await pending;
        expect(destroyed.value).toBe(true);
        expect(resolved).toBe(true);
    });

    it('POSITIVE CONTROL: reset() returns while destruction is still in flight', async () => {
        // This is the behaviour the switch could not build on — asserted so the difference between the
        // two entry points is proven, not assumed.
        const { svc, destroyed, release } = deferredService();
        controller.service = svc;

        controller.reset('candidate-switch');
        await Promise.resolve();
        expect(destroyed.value).toBe(false); // returned already, destruction unfinished

        release();
    });

    it('CASUALTY: the published state reads SETTLED while destruction is still open', async () => {
        // Why a settled-state poll can never serve as the wait, from both ends:
        //   before the reset, the state is READY — that is the precondition for a switch;
        //   the instant the reset begins, it is set to IDLE *synchronously*.
        // Both are settled values, so a poll passes immediately in either case while the old engine is
        // still being destroyed. The check looks like a wait and is not one.
        document.documentElement.setAttribute('data-runtime-state', 'READY');
        const { svc, destroyed, release } = deferredService();
        controller.service = svc;

        const pending = controller.hardResetAwaited('candidate-switch');

        const stateDuringTeardown = document.documentElement.getAttribute('data-runtime-state');
        expect(['READY', 'IDLE', 'TERMINATED']).toContain(stateDuringTeardown);
        expect(destroyed.value, 'destruction is still open at that moment').toBe(false);

        release();
        await pending;
        expect(destroyed.value).toBe(true);
    });

    it('CASUALTY: a destroy that REJECTS propagates — the caller must not proceed', async () => {
        // Treating a failed destruction as success is the dangerous reading: detaching our reference
        // says nothing about whether the worker and microphone were released. The caller has to be able
        // to refuse the next engine.
        const destroy = vi.fn(async () => { throw new Error('worker would not die'); });
        controller.service = { destroy } as unknown as never;
        await expect(controller.hardResetAwaited('candidate-switch')).rejects.toThrow(/worker would not die/);
        expect(destroy).toHaveBeenCalled();
        // State is still cleared and the lifecycle still lands, so a failed teardown is recoverable.
        expect(controller.service).toBeNull();
    });

    it('with no service attached it is a no-op that still resolves', async () => {
        controller.service = null;
        await expect(controller.hardResetAwaited('candidate-switch')).resolves.toBeUndefined();
    });

    it('the SOFT reset path is untouched — it preserves the engine', async () => {
        const { svc, destroy } = deferredService();
        controller.service = svc;
        await controller.hardResetAwaited('subscriber_unmount');
        expect(destroy).not.toHaveBeenCalled();
        expect(controller.service).not.toBeNull();
    });
});
