/**
 * #1263 — the in-page model switch: what it must do, and what it must REFUSE.
 *
 * The human comparison reads one script under three candidates in one authenticated session. These
 * prove the switch actually changes what runs, accepts only the closed comparison slate, and cannot
 * corrupt a session that is mid-flight.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CANDIDATES } from '../candidateRegistry';
import { effectiveCandidate } from '../candidateSelection';
import {
    switchCandidate, registerSwitchExecutor, runtimeCandidateOverride,
    clearRuntimeCandidateOverride, onRuntimeCandidateChange, SWITCH_BLOCKING_STATES,
    engineIntegrationRefusal,
} from '../runtimeCandidateSwitch';
import { authorizeProduction, resetAuthorization } from './modelComparisonAuthorization.helper';

// Selection configuration remains injectable; switch AUTHORITY does not.
const INTERNAL_SELECTION = { VITE_INTERNAL_BUILD: 'true' };

function executor(state = 'READY') {
    const calls: string[] = [];
    // `observed` defaults to agreeing with the selection so the happy path behaves like a working
    // engine; a test sets it to disagree to prove the postcondition actually compares something. The
    // REAL executor reads what the engine published (`resolvedEngine()`), which is what makes the
    // comparison meaningful in production — see the four-hop real-facade proof.
    const e = {
        calls,
        observed: null as string | null,
        useSelectionAsObserved: true,
        currentState: () => state,
        teardown: vi.fn(async () => { calls.push('teardown'); }),
        initialize: vi.fn(async () => { calls.push('initialize'); }),
        observedCandidate: () => (e.useSelectionAsObserved ? runtimeCandidateOverride() : e.observed),
    };
    return e;
}

describe('the in-page model switch', () => {
    beforeEach(() => {
        resetAuthorization();
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        clearRuntimeCandidateOverride();
        registerSwitchExecutor(null);
    });
    afterEach(() => {
        resetAuthorization();
        vi.unstubAllEnvs();
        clearRuntimeCandidateOverride();
        registerSwitchExecutor(null);
    });

    it('CASUALTY: the FULL comparison runs in one page — v2 → distil → moonshine → v2', async () => {
        // The sequence the human test actually performs. Moonshine was refused here until it was
        // registered on the real provider path; the refusal is now lifted, so the whole slate is
        // reachable without a reload.
        const e = executor(); registerSwitchExecutor(e);
        const hops: Array<{ id: string; outcome: unknown; running: string }> = [];
        for (const id of ['v4:distil:q4', 'moonshine:streaming-medium', 'v2:base.en'] as const) {
            const outcome = await switchCandidate(id);
            hops.push({ id, outcome, running: effectiveCandidate(undefined, INTERNAL_SELECTION, false).candidate.id });
        }
        expect(hops).toEqual([
            { id: 'v4:distil:q4', outcome: { ok: true, candidate: 'v4:distil:q4' }, running: 'v4:distil:q4' },
            { id: 'moonshine:streaming-medium', outcome: { ok: true, candidate: 'moonshine:streaming-medium' }, running: 'moonshine:streaming-medium' },
            { id: 'v2:base.en', outcome: { ok: true, candidate: 'v2:base.en' }, running: 'v2:base.en' },
        ]);
        // Every hop tore the engine down and brought it back up — never a hand-off.
        expect(e.calls).toEqual(['teardown', 'initialize', 'teardown', 'initialize', 'teardown', 'initialize']);
    });

    it('CASUALTY: an engine the facade cannot construct is still refused', async () => {
        // Moonshine is integrated now, so the guard is proven against a synthetic candidate instead —
        // otherwise the check would have been deleted along with its only example, and the next engine
        // added without a provider path would fall through and run the CONFIGURED model under its id.
        const unbuildable = { ...CANDIDATES['v2:base.en'], id: 'v9:unbuildable', engine: 'not-an-engine' };
        const out = engineIntegrationRefusal(unbuildable as never);
        expect(out).toMatchObject({ ok: false, code: 'engine_not_integrated' });
        expect(runtimeCandidateOverride()).toBeNull();
    });

    it('POSITIVE CONTROL: moonshine is now switchable', async () => {
        registerSwitchExecutor(executor());
        expect((await switchCandidate('moonshine:streaming-medium')).ok).toBe(true);
    });

    it('CASUALTY: a SECOND switch is refused while one is still running', async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => { release = r; });
        const e = executor();
        e.teardown = vi.fn(async () => { await gate; });
        registerSwitchExecutor(e);

        const first = switchCandidate('v4:distil:q4');
        const second = await switchCandidate('v2:base.en');
        expect(second).toMatchObject({ ok: false, code: 'switch_in_progress' });
        release();
        expect((await first).ok).toBe(true);
        // and once it settles, switching works again
        expect((await switchCandidate('v2:base.en')).ok).toBe(true);
    });

    it('CASUALTY: canonical Production can run the three-model CDP comparison', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', '');
        expect((await authorizeProduction()).accepted).toBe(true);
        registerSwitchExecutor(executor());
        const out = await switchCandidate('v4:distil:q4', CANDIDATES, 'open_mic');
        expect(out).toEqual({ ok: true, candidate: 'v4:distil:q4' });
        expect(runtimeCandidateOverride()).toBe('v4:distil:q4');
    });

    it('CASUALTY: canonical Production can run Moonshine after its real-runtime E/F preflight', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', '');
        expect((await authorizeProduction({
            candidateId: 'moonshine:streaming-medium',
            nonce: 'moonshine-preflight-123456',
        })).accepted).toBe(true);
        registerSwitchExecutor(executor());
        const out = await switchCandidate('moonshine:streaming-medium', CANDIDATES, 'open_mic');
        expect(out).toEqual({ ok: true, candidate: 'moonshine:streaming-medium' });
        expect(runtimeCandidateOverride()).toBe('moonshine:streaming-medium');
    });

    it('CASUALTY: canonical Production refuses a comparison arm whose preflight is incomplete', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', '');
        expect((await authorizeProduction({
            candidateId: 'moonshine:streaming-medium',
            nonce: 'moonshine-preflight-refusal-123456',
        })).accepted).toBe(true);
        const incomplete = {
            ...CANDIDATES,
            'moonshine:streaming-medium': {
                ...CANDIDATES['moonshine:streaming-medium'],
                comparisonReady: false,
                comparisonNotReadyReason: 'synthetic missing preflight',
            },
        } as typeof CANDIDATES;
        const e = executor(); registerSwitchExecutor(e);
        const out = await switchCandidate('moonshine:streaming-medium', incomplete, 'open_mic');
        expect(out).toMatchObject({ ok: false, code: 'candidate_not_comparison_ready' });
        expect(e.teardown).not.toHaveBeenCalled();
        expect(runtimeCandidateOverride()).toBeNull();
    });

    it('CASUALTY: canonical Production spends one authorization on one row', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', '');
        expect((await authorizeProduction()).accepted).toBe(true);
        registerSwitchExecutor(executor());
        expect((await switchCandidate('v4:distil:q4', CANDIDATES, 'open_mic')).ok).toBe(true);
        expect(await switchCandidate('v2:base.en', CANDIDATES, 'open_mic'))
            .toMatchObject({ ok: false, code: 'not_armed' });
    });

    it('CASUALTY: registry membership does not widen the three-model comparison', async () => {
        const e = executor(); registerSwitchExecutor(e);
        const out = await switchCandidate('v4:base:q4');
        expect(out).toMatchObject({ ok: false, code: 'not_comparison_candidate' });
        expect(e.teardown).not.toHaveBeenCalled();
        expect(runtimeCandidateOverride()).toBeNull();
    });

    it('CASUALTY: an ordinary Production page cannot call the switch without the CDP arm', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', '');
        const e = executor(); registerSwitchExecutor(e);
        expect(await switchCandidate('v2:base.en')).toMatchObject({ ok: false, code: 'not_armed' });
        expect(e.teardown).not.toHaveBeenCalled();
    });

    it('CASUALTY: it is REFUSED in every state a swap would corrupt', async () => {
        const refused: string[] = [];
        const touchedEngine: string[] = [];
        const leakedOverride: string[] = [];
        for (const state of SWITCH_BLOCKING_STATES) {
            const e = executor(state); registerSwitchExecutor(e);
            const out = await switchCandidate('v4:distil:q4');
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
        expect((await switchCandidate('v4:distil:q4')).ok).toBe(true);
    });

    it('CASUALTY: the safety kill still outranks the switch', async () => {
        registerSwitchExecutor(executor());
        await switchCandidate('v4:distil:q4');
        const sel = effectiveCandidate(undefined, INTERNAL_SELECTION, /* killEngaged */ true);
        expect(sel.candidate.id).toBe('v2:base.en');
        expect(sel.fallbackCause).toBe('remote_safety_kill');
    });

    it('CASUALTY: an unknown id changes nothing', async () => {
        const e = executor(); registerSwitchExecutor(e);
        const out = await switchCandidate('v9:imaginary');
        expect(out).toMatchObject({ ok: false, code: 'unknown_candidate' });
        expect(e.teardown).not.toHaveBeenCalled();
        expect(runtimeCandidateOverride()).toBeNull();
    });

    it('a failed TEARDOWN restores the previous selection — the old engine is still up', async () => {
        const e = executor();
        e.teardown = vi.fn(async () => { throw new Error('worker would not die'); });
        registerSwitchExecutor(e);
        const out = await switchCandidate('v4:distil:q4');
        expect(out).toMatchObject({ ok: false, code: 'teardown_failed' });
        expect(runtimeCandidateOverride()).toBeNull();
    });

    it('a failed INIT keeps the NEW selection — the old engine is already gone', async () => {
        const e = executor();
        e.initialize = vi.fn(async () => { throw new Error('model would not load'); });
        registerSwitchExecutor(e);
        const out = await switchCandidate('v4:distil:q4');
        expect(out).toMatchObject({ ok: false, code: 'init_failed' });
        // Reporting the OLD candidate here would name a model that is not running.
        expect(runtimeCandidateOverride()).toBe('v4:distil:q4');
    });

    it('with no engine registered it refuses instead of pretending', async () => {
        expect(await switchCandidate('v4:distil:q4')).toMatchObject({ ok: false, code: 'no_executor' });
    });

    it('subscribers are told what is now running', async () => {
        registerSwitchExecutor(executor());
        const seen: (string | null)[] = [];
        const off = onRuntimeCandidateChange((id) => seen.push(id));
        await switchCandidate('v4:distil:q4');
        clearRuntimeCandidateOverride();
        off();
        expect(seen).toEqual(['v4:distil:q4', null]);
    });

    it('clearing the override hands the decision back to config', async () => {
        registerSwitchExecutor(executor());
        await switchCandidate('v4:distil:q4');
        clearRuntimeCandidateOverride();
        expect(effectiveCandidate(undefined, INTERNAL_SELECTION, false).candidate.id).toBe(CANDIDATES['v2:base.en'].id);
    });
});

describe('the switch refuses to report success for a model that is not running', () => {
    beforeEach(() => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        clearRuntimeCandidateOverride();
        registerSwitchExecutor(null);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        clearRuntimeCandidateOverride();
        registerSwitchExecutor(null);
    });

    it('CASUALTY: a mismatch between requested and observed FAILS the switch', async () => {
        // Initialising without throwing is not evidence the requested model is the one running. A
        // resolver that quietly fell back completes just as cleanly, and reporting ok there hands the
        // operator a take labelled with a model that never ran.
        const e = executor(); registerSwitchExecutor(e);
        e.useSelectionAsObserved = false;
        e.observed = 'v2:base.en';

        const out = await switchCandidate('moonshine:streaming-medium');
        expect(out).toMatchObject({ ok: false, code: 'identity_mismatch' });
        expect(out.ok === false && out.reason).toMatch(/is running "v2:base.en"/);
        // The engine is torn down rather than left running under a label we have refused.
        expect(e.calls.filter((c) => c === 'teardown')).toHaveLength(2);
    });

    it('CASUALTY: an engine that published NOTHING is not a successful switch', async () => {
        const e = executor(); registerSwitchExecutor(e);
        e.useSelectionAsObserved = false;
        e.observed = null;

        const out = await switchCandidate('v4:distil:q4');
        expect(out).toMatchObject({ ok: false, code: 'identity_mismatch' });
        expect(out.ok === false && out.reason).toMatch(/published no identity/);
    });

    it('POSITIVE CONTROL: agreement still reports success', async () => {
        const e = executor(); registerSwitchExecutor(e);
        const out = await switchCandidate('v4:distil:q4');
        expect(out).toEqual({ ok: true, candidate: 'v4:distil:q4' });
    });
});
