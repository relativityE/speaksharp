/**
 * #1263 — the REAL switch executor's lifecycle, not an injected fake.
 *
 * `runtimeCandidateSwitch.test.ts` proves the switch's DECISIONS against a stub executor. It cannot see
 * the two defects that live in the executor itself:
 *
 *   - `reset()` fires `svc.destroy().catch(...)` without awaiting it and transitions with `void`, so it
 *     returns while destruction is still in flight. Depending on it alone let `initialize()` start
 *     against a service that was still tearing down.
 *   - `resolvedEngine()` holds what the OUTGOING engine published and was never cleared in production,
 *     so a switch that failed to initialise kept reporting the previous model as the running one.
 *
 * These drive the executor `installRuntimeCandidateSwitch` actually registers, with the controller and
 * service mocked, and assert ORDER and ATTRIBUTION rather than merely that the calls happened.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const order: string[] = [];
const destroy = vi.fn(async () => { order.push('destroy'); });
const reset = vi.fn(() => { order.push('reset'); });
const initiateModelDownload = vi.fn(async () => { order.push('initiateModelDownload'); });

vi.mock('@/services/SpeechRuntimeController', () => ({
    speechRuntimeController: { reset, initiateModelDownload },
}));
vi.mock('../TranscriptionService', () => ({
    getTranscriptionService: () => ({ destroy }),
}));

import { installRuntimeCandidateSwitch, waitForSettled } from '../installRuntimeSwitch';
import { switchCandidate, clearRuntimeCandidateOverride, registerSwitchExecutor } from '../runtimeCandidateSwitch';
import { recordResolvedEngine, resolvedEngine, clearResolvedEngine } from '@/services/telemetry/runtimeAttribution';

const INTERNAL = { VITE_INTERNAL_BUILD: 'true' };
const setState = (s: string) => document.documentElement.setAttribute('data-runtime-state', s);

describe('the real switch executor', () => {
    beforeEach(() => {
        order.length = 0;
        vi.clearAllMocks();
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor(null);
        setState('READY');
        installRuntimeCandidateSwitch(INTERNAL);
    });
    afterEach(() => {
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor(null);
        document.documentElement.removeAttribute('data-runtime-state');
    });

    it('CASUALTY: destruction is AWAITED before the new engine initialises', async () => {
        const out = await switchCandidate('v4:distil:q4', INTERNAL);
        expect(out.ok).toBe(true);
        // The old service is destroyed, state is cleared, and only then does the new engine come up.
        expect(order).toEqual(['destroy', 'reset', 'initiateModelDownload']);
    });

    it('CASUALTY: a SLOW destroy still completes before initialise starts', async () => {
        destroy.mockImplementationOnce(async () => {
            await new Promise((r) => setTimeout(r, 30));
            order.push('destroy');
        });
        await switchCandidate('v4:distil:q4', INTERNAL);
        expect(order.indexOf('destroy')).toBeLessThan(order.indexOf('initiateModelDownload'));
    });

    it('CASUALTY: the OUTGOING engine identity is cleared, not carried into the new session', async () => {
        recordResolvedEngine({ candidateId: 'v2:base.en', modelIdentity: { engine: 'transformers-js' } });
        expect(resolvedEngine()?.candidateId).toBe('v2:base.en');
        await switchCandidate('v4:distil:q4', INTERNAL);
        // Nothing has resolved on the NEW engine yet, so the honest answer is "unknown", never the
        // model that is no longer running.
        expect(resolvedEngine()).toBeNull();
    });

    it('CASUALTY: a FAILED switch does not keep reporting the previous model', async () => {
        recordResolvedEngine({ candidateId: 'v2:base.en', modelIdentity: { engine: 'transformers-js' } });
        initiateModelDownload.mockImplementationOnce(async () => { throw new Error('model would not load'); });
        const out = await switchCandidate('v4:distil:q4', INTERNAL);
        expect(out).toMatchObject({ ok: false, code: 'init_failed' });
        expect(resolvedEngine()).toBeNull();
    });

    it('a teardown that never settles FAILS rather than hanging', async () => {
        // Driven directly with a millisecond budget: going through switchCandidate would wait out the
        // real 15s teardown allowance on every CI run to prove a branch that needs no wall-clock.
        await expect(waitForSettled(() => 'STOPPING', 60, 10)).rejects.toThrow(/did not settle/);
    });

    it('POSITIVE CONTROL: a settled state returns immediately', async () => {
        await expect(waitForSettled(() => 'READY', 60, 10)).resolves.toBeUndefined();
    });
});
