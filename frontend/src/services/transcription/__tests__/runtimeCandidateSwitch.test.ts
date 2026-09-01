/**
 * #1263 — the in-page model switch: what it must do, and what it must REFUSE.
 *
 * The human comparison reads one script under three candidates in one authenticated session. These
 * prove the switch actually changes what runs, cannot be reached from a production build, and cannot
 * corrupt a session that is mid-flight.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CANDIDATES } from '../candidateRegistry';
import { effectiveCandidate } from '../candidateSelection';
import {
    switchCandidate, registerSwitchExecutor, runtimeCandidateOverride,
    clearRuntimeCandidateOverride, onRuntimeCandidateChange, SWITCH_BLOCKING_STATES,
} from '../runtimeCandidateSwitch';

const INTERNAL = { VITE_INTERNAL_BUILD: 'true' };
const PRODUCTION = { VITE_INTERNAL_BUILD: undefined };

function executor(state = 'READY') {
    const calls: string[] = [];
    return {
        calls,
        currentState: () => state,
        teardown: vi.fn(async () => { calls.push('teardown'); }),
        initialize: vi.fn(async () => { calls.push('initialize'); }),
    };
}

describe('the in-page model switch', () => {
    beforeEach(() => { clearRuntimeCandidateOverride(); registerSwitchExecutor(null); });
    afterEach(() => { clearRuntimeCandidateOverride(); registerSwitchExecutor(null); });

    it('CASUALTY: the full comparison runs in one page — v2 → distil → moonshine → v2', async () => {
        const e = executor(); registerSwitchExecutor(e);
        // Collected then asserted once: the recorded sequence names the hop that regressed without a
        // per-assertion message.
        const hops: Array<{ id: string; outcome: unknown; running: string }> = [];
        for (const id of ['v4:distil:q4', 'moonshine:streaming-medium', 'v2:base.en'] as const) {
            const outcome = await switchCandidate(id, INTERNAL);
            hops.push({ id, outcome, running: effectiveCandidate(undefined, INTERNAL, false).candidate.id });
        }
        expect(hops).toEqual([
            { id: 'v4:distil:q4', outcome: { ok: true, candidate: 'v4:distil:q4' }, running: 'v4:distil:q4' },
            { id: 'moonshine:streaming-medium', outcome: { ok: true, candidate: 'moonshine:streaming-medium' }, running: 'moonshine:streaming-medium' },
            { id: 'v2:base.en', outcome: { ok: true, candidate: 'v2:base.en' }, running: 'v2:base.en' },
        ]);
        // Every hop tore the engine down and brought it back up — never a hand-off.
        expect(e.calls).toEqual([
            'teardown', 'initialize', 'teardown', 'initialize', 'teardown', 'initialize',
        ]);
    });

    it('CASUALTY: a PRODUCTION build has no runtime selector at all', async () => {
        registerSwitchExecutor(executor());
        const out = await switchCandidate('v4:distil:q4', PRODUCTION);
        expect(out).toMatchObject({ ok: false, code: 'not_internal_build' });
        expect(runtimeCandidateOverride()).toBeNull();
    });

    it('CASUALTY: it is REFUSED in every state a swap would corrupt', async () => {
        const refused: string[] = [];
        const touchedEngine: string[] = [];
        const leakedOverride: string[] = [];
        for (const state of SWITCH_BLOCKING_STATES) {
            const e = executor(state); registerSwitchExecutor(e);
            const out = await switchCandidate('v4:distil:q4', INTERNAL);
            if (!out.ok && out.code === 'busy') refused.push(state);
            if ((e.teardown as unknown as { mock: { calls: unknown[] } }).mock.calls.length > 0) touchedEngine.push(state);
            if (runtimeCandidateOverride() !== null) leakedOverride.push(state);
        }
        expect(refused).toEqual([...SWITCH_BLOCKING_STATES]);
        // A refusal must not have touched the engine or moved the selection.
        expect(touchedEngine).toEqual([]);
        expect(leakedOverride).toEqual([]);
    });

    it('POSITIVE CONTROL: it is ALLOWED from a settled state', async () => {
        registerSwitchExecutor(executor('READY'));
        expect((await switchCandidate('v4:distil:q4', INTERNAL)).ok).toBe(true);
    });

    it('CASUALTY: the safety kill still outranks the switch', async () => {
        registerSwitchExecutor(executor());
        await switchCandidate('v4:distil:q4', INTERNAL);
        const sel = effectiveCandidate(undefined, INTERNAL, /* killEngaged */ true);
        expect(sel.candidate.id).toBe('v2:base.en');
        expect(sel.fallbackCause).toBe('remote_safety_kill');
    });

    it('CASUALTY: an unknown id changes nothing', async () => {
        const e = executor(); registerSwitchExecutor(e);
        const out = await switchCandidate('v9:imaginary', INTERNAL);
        expect(out).toMatchObject({ ok: false, code: 'unknown_candidate' });
        expect(e.teardown).not.toHaveBeenCalled();
        expect(runtimeCandidateOverride()).toBeNull();
    });

    it('a failed TEARDOWN restores the previous selection — the old engine is still up', async () => {
        const e = executor();
        e.teardown = vi.fn(async () => { throw new Error('worker would not die'); });
        registerSwitchExecutor(e);
        const out = await switchCandidate('v4:distil:q4', INTERNAL);
        expect(out).toMatchObject({ ok: false, code: 'teardown_failed' });
        expect(runtimeCandidateOverride()).toBeNull();
    });

    it('a failed INIT keeps the NEW selection — the old engine is already gone', async () => {
        const e = executor();
        e.initialize = vi.fn(async () => { throw new Error('model would not load'); });
        registerSwitchExecutor(e);
        const out = await switchCandidate('v4:distil:q4', INTERNAL);
        expect(out).toMatchObject({ ok: false, code: 'init_failed' });
        // Reporting the OLD candidate here would name a model that is not running.
        expect(runtimeCandidateOverride()).toBe('v4:distil:q4');
    });

    it('with no engine registered it refuses instead of pretending', async () => {
        expect(await switchCandidate('v4:distil:q4', INTERNAL)).toMatchObject({ ok: false, code: 'no_executor' });
    });

    it('subscribers are told what is now running', async () => {
        registerSwitchExecutor(executor());
        const seen: (string | null)[] = [];
        const off = onRuntimeCandidateChange((id) => seen.push(id));
        await switchCandidate('v4:distil:q4', INTERNAL);
        clearRuntimeCandidateOverride();
        off();
        expect(seen).toEqual(['v4:distil:q4', null]);
    });

    it('clearing the override hands the decision back to config', async () => {
        registerSwitchExecutor(executor());
        await switchCandidate('v4:distil:q4', INTERNAL);
        clearRuntimeCandidateOverride();
        expect(effectiveCandidate(undefined, INTERNAL, false).candidate.id).toBe(CANDIDATES['v2:base.en'].id);
    });
});
