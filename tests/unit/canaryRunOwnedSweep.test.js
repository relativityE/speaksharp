// @vitest-environment node
/** Controls for the canary run-owned trial-account sweeper (#1826). */
import { describe, it, expect, vi } from 'vitest';
import { decide, parseBinding, sweep, MAX_DELETES_PER_SWEEP, ROLE } from '../../scripts/lib/canaryRunOwnedSweep.mjs';

const EXPECTED = { repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/main' };
const NOW = Date.parse('2026-11-12T12:00:00Z');
const H = 3600_000;
const binding = (over = {}) => ({ ct_run: { repository: EXPECTED.repository, workflow: EXPECTED.workflow, runId: '43000000001', runAttempt: '1', role: ROLE, ...over } });
const acct = (over = {}) => ({ id: 'u1', email: 'ctrial-run-43000000001-1-abcd1234@example.test', created_at: new Date(NOW - 5 * H).toISOString(), app_metadata: binding(), ...over });
const run = (over = {}) => ({ status: 'completed', run_attempt: 1, updated_at: new Date(NOW - 2 * H).toISOString(), ...over });
const d = (a, r, self) => decide({ account: a, run: r, now: NOW, expected: EXPECTED, self });

describe('decide — delete only with positive proof', () => {
    it('a bound account of a completed, old-enough run of this repo/workflow is deletable', () => {
        expect(d(acct(), run())).toMatchObject({ action: 'delete', binding: { runId: '43000000001', runAttempt: '1' } });
    });
    it.each([
        ['not-run-owned-prefix', acct({ email: 'canary-trial@example.test' })],
        ['unbound', acct({ app_metadata: {} })],
        ['malformed-or-foreign-binding', acct({ app_metadata: binding({ repository: 'someone/else' }) })],
        ['malformed-or-foreign-binding', acct({ app_metadata: binding({ workflow: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main' }) })],
        ['malformed-or-foreign-binding', acct({ app_metadata: binding({ role: 'rwt-journey' }) })],
        ['malformed-or-foreign-binding', acct({ app_metadata: binding({ runId: '0' }) })],
        ['malformed-or-foreign-binding', acct({ app_metadata: { ct_run: { ...binding().ct_run, extra: 1 } } })],
        ['malformed-or-foreign-binding', acct({ app_metadata: { ct_run: { runId: '43000000001' } } })],
        ['too-young', acct({ created_at: new Date(NOW - 1 * H).toISOString() })],
        ['too-young', acct({ created_at: 'garbage' })],
    ])('leaves %s', (reason, a) => { expect(d(a, run())).toEqual({ action: 'leave', reason }); });
    it('leaves on run lookup failure, attempt mismatch (rerun), in-progress, unknown state, or a just-completed run', () => {
        expect(d(acct(), { error: true }).reason).toBe('run-lookup-failed');
        expect(d(acct(), run({ run_attempt: 2 })).reason).toBe('attempt-mismatch');
        expect(d(acct(), run({ status: 'in_progress' })).reason).toBe('run-not-completed');
        expect(d(acct(), run({ status: undefined })).reason).toBe('run-state-unknown');
        expect(d(acct(), run({ updated_at: new Date(NOW - 5 * 60_000).toISOString() })).reason).toBe('run-completed-too-recently');
    });
    it('never touches its own current run', () => {
        expect(d(acct(), run(), { runId: '43000000001' }).reason).toBe('own-current-run');
    });
    it('parseBinding refuses forged shapes', () => {
        expect(parseBinding({ ct_run: 'x' }, EXPECTED)).toBeNull();
        expect(parseBinding(null, EXPECTED)).toBeNull();
    });
});

const deps = (accounts, o = {}) => {
    const runs = o.runs ?? (() => run());
    return {
        listRunOwnedAccounts: vi.fn(async () => { if (o.listThrows) throw new Error('x'); return accounts; }),
        getUser: vi.fn(async (id) => (o.getUser ? o.getUser(id) : accounts.find((a) => a.id === id) ?? null)),
        getRun: vi.fn(async (id) => runs(id)),
        deleteAndProve: vi.fn(async (id) => (o.deleteAndProve ? o.deleteAndProve(id) : { ok: true })),
    };
};
const S = (dep, self) => sweep(dep, { now: NOW, expected: EXPECTED, self });

describe('sweep — re-check, residue proof, caps, races', () => {
    it('reads the state of the bound ATTEMPT, not just the run, on both the first read and the re-check', async () => {
        const dep = deps([acct()]);
        await S(dep);
        expect(dep.getRun.mock.calls.length).toBe(2);
        for (const call of dep.getRun.mock.calls) expect(call).toEqual([expect.any(String), expect.stringMatching(/^[1-9]\d*$/)]);
    });
    it('sweeps an eligible orphan after re-checking it, with the residue proof', async () => {
        const dep = deps([acct()]);
        expect(await S(dep)).toMatchObject({ swept: 1, success: true });
        expect(dep.getUser).toHaveBeenCalledWith('u1');
        expect(dep.deleteAndProve).toHaveBeenCalledWith('u1');
    });
    it('CONTROL: the run changes state between lookup and deletion (a rerun starts) → left alone, non-success', async () => {
        let n = 0;
        const dep = deps([acct()], { runs: () => (n++ === 0 ? run() : run({ status: 'in_progress', run_attempt: 2 })) });
        const r = await S(dep);
        expect(dep.deleteAndProve).not.toHaveBeenCalled();
        expect(r).toMatchObject({ swept: 0, success: false, left: { 'state-changed': 1 } });
    });
    it('CONTROL: the binding changes between lookup and deletion → left alone', async () => {
        const dep = deps([acct()], { getUser: () => acct({ app_metadata: binding({ runId: '43000000002' }) }) });
        const r = await S(dep);
        expect(dep.deleteAndProve).not.toHaveBeenCalled();
        expect(r.success).toBe(false);
    });
    it('double sweep race: gone at re-check still requires the residue proof; absent ≠ swept; residue without account fails', async () => {
        const gone = deps([acct()], { getUser: () => null, deleteAndProve: () => ({ ok: 'absent' }) });
        expect(await S(gone)).toMatchObject({ swept: 0, alreadyGone: 1, success: true });
        expect(gone.deleteAndProve).toHaveBeenCalledTimes(1);
        const residue = deps([acct()], { getUser: () => null, deleteAndProve: () => ({ ok: false, step: 'residue-without-account' }) });
        expect(await S(residue)).toMatchObject({ swept: 0, alreadyGone: 0, success: false, failures: { 'residue-without-account': 1 } });
    });
    it.each(['get_user', 'pre_delete:trial_entitlements', 'delete_user', 'post_delete_verify', 'residue_query:sessions', 'residue_found:sessions', 'residue_unproven:sessions'])(
        'interrupted cleanup at %s is reported, never counted as swept or zero residue', async (step) => {
            const r = await S(deps([acct()], { deleteAndProve: () => ({ ok: false, step }) }));
            expect(r).toMatchObject({ swept: 0, success: false, failures: { [step]: 1 } });
        });
    it('a thrown deletion is an unknown failure, not success', async () => {
        const r = await S(deps([acct()], { deleteAndProve: () => { throw new Error('x'); } }));
        expect(r).toMatchObject({ swept: 0, success: false, failures: { unknown: 1 } });
    });
    it('hard cap: at most MAX deletes per sweep; the rest are reported, non-success', async () => {
        const many = Array.from({ length: MAX_DELETES_PER_SWEEP + 2 }, (_, i) => acct({ id: `u${i}` }));
        const r = await S(deps(many));
        expect(r.swept).toBe(MAX_DELETES_PER_SWEEP);
        expect(r).toMatchObject({ capReached: true, success: false });
    });
    it('a failed listing deletes nothing and is non-success; foreign and own-run accounts are reported, not deleted', async () => {
        expect(await S(deps([acct()], { listThrows: true }))).toMatchObject({ swept: 0, success: false, failures: { 'list-failed': 1 } });
        const dep = deps([acct({ id: 'f', app_metadata: binding({ repository: 'x/y' }) }), acct({ id: 'o' })]);
        const r = await S(dep, { runId: '43000000001' });
        expect(dep.deleteAndProve).not.toHaveBeenCalled();
        expect(r.left).toEqual({ 'malformed-or-foreign-binding': 1, 'own-current-run': 1 });
    });
});
