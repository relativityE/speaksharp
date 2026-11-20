// @vitest-environment node
/** #1826 controls: the canary run-owned lane orchestration (setup / cleanup / sweep) with injected admin, GitHub and cleanup. */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { __resetCreateGuardForTests, currentCanaryBinding } from '../../scripts/lib/canaryRunOwnedAccount.mjs';
import { MAX_PAGES, PER_PAGE, bindFailureAdmin, cleanupLane, describeSweep, domainFrom, listRunOwnedAccounts, makeGetRun, setupLane, sweepLane } from '../../scripts/lib/canaryRunOwnedLane.mjs';

const WF = 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/main';
const ENV = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_RUN_ID: '43000000002', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: WF, CANARY_TRIAL_EMAIL: 'trial-identity@Example.Test' };
const NOW = Date.parse('2026-11-12T12:00:00Z');
const H = 3600_000;
import { readSaveJournalInventory } from '../../tests/live/helpers/runOwnedCleanup';

/** #1906: the restart-after-deletion finish (its own tests are in the save-journal suites); none left over here. */
const FINISH = async () => 0;
/** #1906: the shared inventory reader (it parses what the admin double's rpc answers). */
const READ = (a, s) => readSaveJournalInventory(a, s);
const SAVE_JOURNAL_RUNS_FN = 'list_unfinished_account_save_journal_cleanup_runs_v1';
const EMPTY_INVENTORY = { data: { claims: 0, live: 0, unbound: 0, runs: [] }, error: null };
/** An inventory of claims on deleted accounts, one entry per binding (recent claims as given). */
const inventory = (entries, extra = {}) => {
    const runs = entries.map(([binding, claims = 1, recent = 0]) => ({ binding, claims, recent }));
    const live = extra.live ?? 0; const unbound = extra.unbound ?? 0;
    return { data: { claims: live + unbound + runs.reduce((n, r) => n + r.claims, 0), live, unbound, runs }, error: null };
};
const bind = (runId, runAttempt = '1', over = {}) => ({ canary_run: { repository: 'relativityE/speaksharp', workflow: WF, runId, runAttempt, role: 'canary-active-trial', ...over } });
const user = (id, email, meta, ageH = 5) => ({ id, email, app_metadata: meta, created_at: new Date(NOW - ageH * H).toISOString() });
const MINE = user('m1', 'ctrial-run-43000000002-1-aaaa1111@example.test', bind('43000000002'));

/** Admin double over a fixed user list; createUser appends. */
const admin = (users, o = {}) => ({
    users,
    auth: { admin: {
        listUsers: vi.fn(async ({ page, perPage }) => (o.listError ? { data: null, error: { message: 'x' } } : { data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null })),
        getUserById: vi.fn(async (id) => {
            const u = users.find((x) => x.id === id);
            return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'x' } };
        }),
        createUser: vi.fn(async ({ email, app_metadata }) => { users.push(user('new', email, app_metadata, 0)); return { data: { user: { id: 'new' } }, error: null }; }),
        deleteUser: vi.fn(async () => ({ error: null })),
    } },
    // #1906: the listing of runs with an unfinished save-journal claim (none unless the test says so).
    rpc: vi.fn(async (fn) => (fn === SAVE_JOURNAL_RUNS_FN ? (o.journal ?? EMPTY_INVENTORY) : { data: null, error: { code: '42883', message: 'x' } })),
});
beforeEach(() => __resetCreateGuardForTests());

describe('listRunOwnedAccounts — complete listing or nothing', () => {
    it('pages through every user and keeps only the run-owned prefix', async () => {
        const many = Array.from({ length: PER_PAGE + 3 }, (_, i) => user(`x${i}`, i === PER_PAGE + 1 ? MINE.email : `someone${i}@example.test`, {}));
        expect((await listRunOwnedAccounts(admin(many))).map((u) => u.email)).toEqual([MINE.email]);
    });
    it('throws on a page error and on more pages than the bound (never a partial "zero")', async () => {
        await expect(listRunOwnedAccounts(admin([MINE], { listError: true }))).rejects.toThrow('list-failed');
        const endless = { auth: { admin: { listUsers: async () => ({ data: { users: Array(PER_PAGE).fill(MINE) }, error: null }) } } };
        await expect(listRunOwnedAccounts(endless)).rejects.toThrow('list-unbounded');
        expect(MAX_PAGES).toBeGreaterThan(0);
    });
});

describe('makeGetRun — one attempt, fail closed', () => {
    it('reads the exact attempt endpoint and returns only status, attempt and update time', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'completed', run_attempt: 2, updated_at: 'T', extra: 'dropped' }) }));
        const got = await makeGetRun({ fetchImpl, token: 't', repository: 'relativityE/speaksharp' })('43000000002', '2');
        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.github.com/repos/relativityE/speaksharp/actions/runs/43000000002/attempts/2');
        expect(got).toEqual({ status: 'completed', run_attempt: 2, updated_at: 'T' });
    });
    it('returns {error:true} for malformed ids (without calling GitHub), HTTP errors, odd bodies and network failures', async () => {
        const ok = vi.fn();
        expect(await makeGetRun({ fetchImpl: ok, token: 't', repository: 'r/r' })('0', '1')).toEqual({ error: true });
        expect(await makeGetRun({ fetchImpl: ok, token: 't', repository: 'r/r' })('1', 'x')).toEqual({ error: true });
        expect(ok).not.toHaveBeenCalled();
        expect(await makeGetRun({ fetchImpl: async () => ({ ok: false }), token: 't', repository: 'r/r' })('1', '1')).toEqual({ error: true });
        expect(await makeGetRun({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }), token: 't', repository: 'r/r' })('1', '1')).toEqual({ error: true });
        expect(await makeGetRun({ fetchImpl: async () => { throw new Error('net'); }, token: 't', repository: 'r/r' })('1', '1')).toEqual({ error: true });
    });
});

describe('setupLane — one account, masked before export', () => {
    it('uses only the configured identity\'s domain', () => {
        expect(domainFrom(ENV)).toBe('example.test');
        expect(domainFrom({})).toBe('');
    });
    it('creates and binds one account, masks email and password BEFORE exporting them', async () => {
        const order = [];
        const r = await setupLane({ admin: admin([]), env: ENV, mask: (v) => order.push(['mask', v]), exportEnv: (n, v) => order.push(['export', n, v]), cleanup: vi.fn() });
        expect(r).toEqual({ ok: true, code: 'created-bound' });
        expect(order.map((e) => e[0])).toEqual(['mask', 'mask', 'export', 'export']);
        expect(order.slice(2).map((e) => e[1])).toEqual(['CANARY_EMAIL', 'CANARY_LANE_PASSWORD']);
        expect(order[2][2]).toBe(order[0][1]);
        expect(order[3][2]).toBe(order[1][1]);
        expect(order[2][2]).toMatch(/^ctrial-run-43000000002-1-[0-9a-f]{8}@example\.test$/);
    });
    it('without a cleanup function (missing or not callable) nothing is created or exported (review return on 5223bed2)', async () => {
        for (const cleanup of [undefined, null, 'cleanup', {}]) {
            __resetCreateGuardForTests();
            const a = admin([]);
            const exportEnv = vi.fn();
            const mask = vi.fn();
            expect(await setupLane({ admin: a, env: ENV, mask, exportEnv, cleanup })).toEqual({ ok: false, code: 'no-cleanup' });
            expect(a.auth.admin.createUser).not.toHaveBeenCalled();
            expect(exportEnv).not.toHaveBeenCalled();
            expect(mask).not.toHaveBeenCalled();
        }
    });
    it('outside a run, or with a prohibited/missing domain, creates and exports nothing', async () => {
        for (const env of [{ ...ENV, GITHUB_ACTIONS: 'false' }, { ...ENV, CANARY_TRIAL_EMAIL: 'x@speaksharp.app' }, { ...ENV, CANARY_TRIAL_EMAIL: '' }]) {
            __resetCreateGuardForTests();
            const a = admin([]);
            const exportEnv = vi.fn();
            const r = await setupLane({ admin: a, env, mask: vi.fn(), exportEnv, cleanup: vi.fn() });
            expect(r.ok).toBe(false);
            expect(a.auth.admin.createUser).not.toHaveBeenCalled();
            expect(exportEnv).not.toHaveBeenCalled();
        }
    });
});

describe('cleanupLane — only this run+attempt, only with proof', () => {
    const others = [
        user('o1', 'ctrial-run-43000000002-2-bbbb2222@example.test', bind('43000000002', '2')),        // same run, other attempt
        user('o2', 'ctrial-run-43000000003-1-cccc3333@example.test', bind('43000000003')),             // other run
        user('o3', 'ctrial-run-43000000099-1-dddd4444@example.test', bind('43000000002')),             // binding/prefix disagree
        user('o4', 'canary-trial@example.test', {}),                                                   // existing canary identity
    ];
    it('deletes exactly this run+attempt\'s bound account through the shared cleanup', async () => {
        const cleanup = vi.fn(async () => {});
        const r = await cleanupLane({ finishSaveJournal: FINISH, admin: admin([MINE, ...others]), env: ENV, cleanup });
        expect(r).toEqual({ ok: true, code: 'cleanup-verified', deleted: 1, orphans: 0 });
        expect(cleanup.mock.calls).toEqual([[expect.objectContaining({ uid: 'm1', email: MINE.email })]]);
    });
    it('reports nothing-to-clean truthfully when the complete listing has no account of this run', async () => {
        expect(await cleanupLane({ finishSaveJournal: FINISH, admin: admin(others), env: ENV, cleanup: vi.fn() })).toEqual({ ok: true, code: 'nothing-to-clean', deleted: 0, orphans: 0 });
    });
    it('fails when the shared cleanup cannot prove deletion and zero residue', async () => {
        const r = await cleanupLane({ finishSaveJournal: FINISH, admin: admin([MINE]), env: ENV, cleanup: async () => { throw new Error('residue'); } });
        expect(r).toEqual({ ok: false, code: 'cleanup-unproven', deleted: 0 });
    });
    it('fails (never "nothing to clean") when the listing fails', async () => {
        expect(await cleanupLane({ finishSaveJournal: FINISH, admin: admin([MINE], { listError: true }), env: ENV, cleanup: vi.fn() })).toMatchObject({ ok: false, code: 'list-failed' });
    });
    it('a this-run prefix WITHOUT this run\'s exact binding is never deleted and fails the step', async () => {
        const forged = user('f1', 'ctrial-run-43000000002-1-eeee5555@example.test', bind('43000000002', '1', { workflow: 'other/repo/.github/workflows/x.yml@refs/heads/main' }));
        const cleanup = vi.fn(async () => {});
        const r = await cleanupLane({ finishSaveJournal: FINISH, admin: admin([MINE, forged]), env: ENV, cleanup });
        expect(r).toEqual({ ok: false, code: 'prefix-without-binding', deleted: 1, orphans: 0 });
        expect(cleanup.mock.calls.map((c) => c[0].uid)).toEqual(['m1']);
    });
    it('outside a run it touches nothing', async () => {
        const a = admin([MINE]);
        expect(await cleanupLane({ finishSaveJournal: FINISH, admin: a, env: { ...ENV, GITHUB_RUN_ID: '' }, cleanup: vi.fn() })).toMatchObject({ ok: false, code: 'no-run-binding' });
        expect(a.auth.admin.listUsers).not.toHaveBeenCalled();
    });
});

describe('sweepLane — hygiene failures vs warnings', () => {
    const orphan = user('p1', 'ctrial-run-43000000001-1-ffff6666@example.test', bind('43000000001'));
    const finished = async () => ({ status: 'completed', run_attempt: 1, updated_at: new Date(NOW - 2 * H).toISOString() });
    it('sweeps a proven orphan of a finished run through the shared cleanup, with the attempt-aware run read', async () => {
        const cleanup = vi.fn(async () => {});
        const getRun = vi.fn(finished);
        const r = await sweepLane({ readSaveJournal: READ, finishSaveJournal: FINISH, admin: admin([orphan]), env: ENV, getRun, cleanup, now: NOW });
        expect(r).toMatchObject({ ok: true, code: 'sweep-ok', report: { swept: 1 } });
        expect(cleanup.mock.calls).toEqual([[expect.objectContaining({ uid: 'p1', email: orphan.email })]]);
        expect(getRun).toHaveBeenCalledWith('43000000001', '1');
    });
    it('an unproven orphan deletion FAILS the hygiene step', async () => {
        const r = await sweepLane({ readSaveJournal: READ, finishSaveJournal: FINISH, admin: admin([orphan]), env: ENV, getRun: finished, cleanup: async () => { throw new Error('x'); }, now: NOW });
        expect(r).toMatchObject({ ok: false, code: 'sweep-failed', report: { failures: { 'cleanup-unproven': 1 } } });
    });
    it('accounts it must leave (run still going, foreign ref, own run) are warnings, not failures, and are never deleted', async () => {
        const running = user('p2', 'ctrial-run-43000000004-1-1111aaaa@example.test', bind('43000000004'));
        const foreign = user('p3', 'ctrial-run-43000000005-1-2222bbbb@example.test', bind('43000000005', '1', { workflow: 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/feature' }));
        const own = user('p4', 'ctrial-run-43000000002-1-3333cccc@example.test', bind('43000000002'));
        const cleanup = vi.fn();
        const getRun = async (id) => (id === '43000000004' ? { status: 'in_progress', run_attempt: 1, updated_at: '' } : finished());
        const r = await sweepLane({ readSaveJournal: READ, finishSaveJournal: FINISH, admin: admin([running, foreign, own]), env: ENV, getRun, cleanup, now: NOW });
        expect(r.ok).toBe(true);
        expect(r.report.left).toEqual({ 'run-not-completed': 1, 'malformed-or-foreign-binding': 1, 'own-current-run': 1 });
        expect(cleanup).not.toHaveBeenCalled();
    });
    it('a failed listing fails the hygiene step', async () => {
        const r = await sweepLane({ readSaveJournal: READ, finishSaveJournal: FINISH, admin: admin([orphan], { listError: true }), env: ENV, getRun: finished, cleanup: vi.fn(), now: NOW });
        expect(r).toMatchObject({ ok: false, code: 'sweep-failed' });
    });
    it('the summary line is content-free', async () => {
        const r = await sweepLane({ readSaveJournal: READ, finishSaveJournal: FINISH, admin: admin([orphan]), env: ENV, getRun: finished, cleanup: async () => {}, now: NOW });
        const line = describeSweep(r.report);
        expect(line).toBe('sweep: swept=1 left(none) failures(none) cap=false save_journal(runs=0,finished=0,left=0,failed=0)');
        expect(line).not.toMatch(/@|ctrial-run-\d|p1/);
        expect(currentCanaryBinding(ENV)).not.toBeNull();
    });
});

describe('#1906 restart after deletion: canary save-journal claims (Codex on 62b50df)', () => {
    const claimOf = (runId, runAttempt = '1', over = {}) => ({ ...bind(runId, runAttempt, over).canary_run });
    const rwt = { repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main', runId: '44000000001', runAttempt: '1', role: 'rwt-journey' };
    const runs = { '43000000010': { status: 'completed', run_attempt: 1, updated_at: new Date(NOW - 2 * H).toISOString() },     // finished
        '43000000011': { status: 'in_progress', run_attempt: 1, updated_at: new Date(NOW - 2 * H).toISOString() },                // still going
        '43000000012': { status: 'completed', run_attempt: 2, updated_at: new Date(NOW - 2 * H).toISOString() },                  // attempt moved on
        '43000000013': { status: 'completed', run_attempt: 1, updated_at: new Date(NOW - 60_000).toISOString() },                // just finished
        '43000000002': { status: 'completed', run_attempt: 1, updated_at: new Date(NOW - 2 * H).toISOString() } };               // the CURRENT run (as GitHub might show it)
    const getRun = vi.fn(async (runId) => runs[runId] ?? { error: true });

    it('cleanupLane finishes THIS run+attempt\'s own leftovers by its exact canary binding, after its own account', async () => {
        const order = [];
        const cleanup = vi.fn(async () => { order.push('own'); });
        const finish = vi.fn(async () => { order.push('finish'); return 1; });
        expect(await cleanupLane({ finishSaveJournal: finish, admin: admin([MINE]), env: ENV, cleanup })).toEqual({ ok: true, code: 'cleanup-verified', deleted: 1, orphans: 1 });
        expect(order).toEqual(['own', 'finish']);
        expect(finish.mock.calls[0][1]).toEqual(claimOf('43000000002'));
        // Nothing of its own listed: still finished by binding (a stopped cleanup whose account is already gone), and REPORTED as a cleanup, never "nothing to clean" (Sam, #1906 review of 6b8943d).
        const finish2 = vi.fn(async () => 1);
        expect(await cleanupLane({ finishSaveJournal: finish2, admin: admin([]), env: ENV, cleanup: vi.fn() })).toEqual({ ok: true, code: 'cleanup-verified', deleted: 0, orphans: 1 });
        expect(finish2).toHaveBeenCalledTimes(1);
    });
    it('cleanupLane fails closed when the finish fails, and refuses to run without one', async () => {
        expect(await cleanupLane({ finishSaveJournal: async () => { throw new Error('x'); }, admin: admin([MINE]), env: ENV, cleanup: vi.fn(async () => {}) }))
            .toEqual({ ok: false, code: 'save-journal-unproven', deleted: 1 });
        for (const finishSaveJournal of [undefined, null, {}]) {
            const a = admin([MINE]);
            expect(await cleanupLane({ finishSaveJournal, admin: a, env: ENV, cleanup: vi.fn() })).toEqual({ ok: false, code: 'no-save-journal-finish', deleted: 0 });
            expect(a.auth.admin.listUsers).not.toHaveBeenCalled();
            expect(await sweepLane({ readSaveJournal: READ, finishSaveJournal, admin: a, env: ENV, getRun, cleanup: vi.fn(), now: NOW })).toMatchObject({ ok: false, code: 'no-save-journal-finish' });
        }
    });
    it('sweepLane finishes only canary runs of this repo/workflow whose exact attempt finished long enough ago; never the current run', async () => {
        const listed = inventory([[claimOf('43000000010')], [claimOf('43000000011')], [claimOf('43000000012')], [claimOf('43000000013')],
            [claimOf('43000000002')], [rwt], [claimOf('43000000010', '1', { workflow: 'other/repo/.github/workflows/canary.yml@refs/heads/main' })]], { live: 1, unbound: 1 });
        const finish = vi.fn(async () => 2);
        const r = await sweepLane({ readSaveJournal: READ, finishSaveJournal: finish, admin: admin([], { journal: listed }), env: ENV, getRun, cleanup: vi.fn(), now: NOW });
        expect(r.ok).toBe(true);
        expect(r.report.saveJournal).toEqual({ runs: 5, finished: 2, left: 4, failed: 0 });
        expect(finish.mock.calls.map((c) => c[1])).toEqual([claimOf('43000000010')]);
        expect(describeSweep(r.report)).toMatch(/ save_journal\(runs=5,finished=2,left=4,failed=0\)$/);
        const a = admin([], { journal: listed });
        await sweepLane({ readSaveJournal: READ, finishSaveJournal: finish, admin: a, env: ENV, getRun, cleanup: vi.fn(), now: NOW });
        expect(a.rpc.mock.calls.find(([fn]) => fn === SAVE_JOURNAL_RUNS_FN)?.[1]).toEqual({ p_min_age_seconds: 2 * 3600 });
    });
    it('sweepLane leaves a finished run that still has a RECENT claim (Sam, #1906 review: it may still be finishing it)', async () => {
        const finish = vi.fn(async () => 1);
        const r = await sweepLane({ readSaveJournal: READ, finishSaveJournal: finish, admin: admin([], { journal: inventory([[claimOf('43000000010'), 2, 1]]) }),
            env: ENV, getRun, cleanup: vi.fn(), now: NOW });
        expect(r).toMatchObject({ ok: true, report: { saveJournal: { runs: 1, finished: 0, left: 1, failed: 0 } } });
        expect(finish).not.toHaveBeenCalled();
    });
    it('a finish that reports no counted number, or fewer than the claims listed for that run, is never success (no missing-equals-zero)', async () => {
        for (const bad of [undefined, null, '2', -1, 1.5, Number.NaN, 1]) {     // 1 < the 2 claims listed
            const r = await sweepLane({ readSaveJournal: READ, finishSaveJournal: vi.fn(async () => bad), admin: admin([], { journal: inventory([[claimOf('43000000010'), 2]]) }),
                env: ENV, getRun, cleanup: vi.fn(), now: NOW });
            expect(r).toMatchObject({ ok: false, code: 'sweep-failed', report: { saveJournal: { finished: 0, failed: 1 } } });
        }
        for (const bad of [undefined, null, '0', -1, 0.5, Number.NaN]) {
            expect(await cleanupLane({ finishSaveJournal: vi.fn(async () => bad), admin: admin([MINE]), env: ENV, cleanup: vi.fn(async () => {}) }))
                .toEqual({ ok: false, code: 'save-journal-unproven', deleted: 1 });
        }
    });
    it('sweepLane fails on a failed finish, a listing error, a refused (too many) or unprovable inventory; a database without the function lists nothing', async () => {
        const one = inventory([[claimOf('43000000010')]]);
        const fails = await sweepLane({ readSaveJournal: READ, finishSaveJournal: async () => { throw new Error('x'); }, admin: admin([], { journal: one }), env: ENV, getRun, cleanup: vi.fn(), now: NOW });
        expect(fails).toMatchObject({ ok: false, code: 'sweep-failed', report: { saveJournal: { runs: 1, finished: 0, failed: 1 } } });
        const sum = one.data;
        for (const journal of [{ data: null, error: { code: '42501', message: 'x' } }, { data: null, error: { code: '54000', message: 'x' } }, { data: null, error: null },
            { data: 3, error: null }, { data: [claimOf('43000000010')], error: null },                       // the old row-set shape
            { data: { ...sum, claims: sum.claims + 1 }, error: null },                                          // a claim not accounted for
            { data: { ...sum, runs: [] }, error: null },                                                        // a clipped run list
            { data: { ...sum, runs: [{ ...sum.runs[0], binding: null }] }, error: null },                       // a malformed binding
            { data: { ...sum, runs: [{ ...sum.runs[0], recent: 2 }] }, error: null }]) {
            const finish = vi.fn();
            const r = await sweepLane({ readSaveJournal: READ, finishSaveJournal: finish, admin: admin([], { journal }), env: ENV, getRun, cleanup: vi.fn(), now: NOW });
            expect(r).toMatchObject({ ok: false, code: 'sweep-failed', report: { saveJournal: { failed: 1 } } });
            expect(finish).not.toHaveBeenCalled();
        }
        const throws = await sweepLane({ readSaveJournal: async () => { throw new Error('x'); }, finishSaveJournal: vi.fn(), admin: admin([]), env: ENV, getRun, cleanup: vi.fn(), now: NOW });
        expect(throws).toMatchObject({ ok: false, report: { saveJournal: { failed: 1 } } });
        const absent = await sweepLane({ readSaveJournal: READ, finishSaveJournal: vi.fn(), admin: admin([], { journal: { data: null, error: { code: 'PGRST202', message: 'x' } } }), env: ENV, getRun, cleanup: vi.fn(), now: NOW });
        expect(absent).toMatchObject({ ok: true, report: { saveJournal: { runs: 0, failed: 0 } } });
    });
    it('sweepLane refuses to run without the inventory reader', async () => {
        for (const readSaveJournal of [undefined, null, {}]) {
            const a = admin([MINE]);
            expect(await sweepLane({ readSaveJournal, finishSaveJournal: FINISH, admin: a, env: ENV, getRun, cleanup: vi.fn(), now: NOW }))
                .toMatchObject({ ok: false, code: 'no-save-journal-read', report: null });
            expect(a.auth.admin.listUsers).not.toHaveBeenCalled();
        }
    });
    it('bindFailureAdmin changes only this account\'s unbound claim: this run\'s binding when the account carries it, unbound otherwise', async () => {
        const binding = currentCanaryBinding(ENV);
        const bound = user('n1', 'ctrial-run-43000000002-1-ffff0000@example.test', bind('43000000002'));
        const foreign = user('n2', 'ctrial-run-43000000002-1-ffff0001@example.test', bind('43000000009'));
        const bare = user('n3', 'ctrial-run-43000000002-1-ffff0002@example.test', {});
        const base = admin([bound, foreign, bare]);
        base.rpc = vi.fn(async () => ({ data: null, error: null }));
        const claim = (uid) => ({ p_user_id: uid, p_run_binding: null, p_token: 'a'.repeat(64) });
        await bindFailureAdmin(base, { uid: 'n1', binding }).rpc('claim_account_save_journal_cleanup_v1', claim('n1'));
        expect(base.rpc.mock.calls.at(-1)[1].p_run_binding).toEqual(claimOf('43000000002'));
        for (const uid of ['n2', 'n3', 'gone']) {
            await bindFailureAdmin(base, { uid, binding }).rpc('claim_account_save_journal_cleanup_v1', claim(uid));
            expect(base.rpc.mock.calls.at(-1)[1].p_run_binding).toBeNull();
        }
        // Another account's claim, a claim that already names a binding, and every other call pass through unchanged.
        const w = bindFailureAdmin(base, { uid: 'n1', binding });
        for (const [fn, args] of [['claim_account_save_journal_cleanup_v1', claim('n2')], ['claim_account_save_journal_cleanup_v1', { ...claim('n1'), p_run_binding: { x: '1' } }], ['count_account_save_journal_v1', { p_user_id: 'n1' }]]) {
            await w.rpc(fn, args);
            expect(base.rpc.mock.calls.at(-1)).toEqual([fn, args]);
        }
        expect(w.auth).toBe(base.auth);
    });
});
