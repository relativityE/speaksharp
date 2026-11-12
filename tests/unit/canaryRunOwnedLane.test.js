// @vitest-environment node
/** #1826 controls: the canary run-owned lane orchestration (setup / cleanup / sweep) with injected admin, GitHub and cleanup. */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { __resetCreateGuardForTests, currentCanaryBinding } from '../../scripts/lib/canaryRunOwnedAccount.mjs';
import { MAX_PAGES, PER_PAGE, cleanupLane, describeSweep, domainFrom, listRunOwnedAccounts, makeGetRun, setupLane, sweepLane } from '../../scripts/lib/canaryRunOwnedLane.mjs';

const WF = 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/main';
const ENV = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_RUN_ID: '43000000002', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: WF, CANARY_TRIAL_EMAIL: 'trial-identity@Example.Test' };
const NOW = Date.parse('2026-11-12T12:00:00Z');
const H = 3600_000;
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
        const r = await setupLane({ admin: admin([]), env: ENV, mask: (v) => order.push(['mask', v]), exportEnv: (n, v) => order.push(['export', n, v]) });
        expect(r).toEqual({ ok: true, code: 'created-bound' });
        expect(order.map((e) => e[0])).toEqual(['mask', 'mask', 'export', 'export']);
        expect(order.slice(2).map((e) => e[1])).toEqual(['CANARY_EMAIL', 'CANARY_LANE_PASSWORD']);
        expect(order[2][2]).toBe(order[0][1]);
        expect(order[3][2]).toBe(order[1][1]);
        expect(order[2][2]).toMatch(/^ctrial-run-43000000002-1-[0-9a-f]{8}@example\.test$/);
    });
    it('outside a run, or with a prohibited/missing domain, creates and exports nothing', async () => {
        for (const env of [{ ...ENV, GITHUB_ACTIONS: 'false' }, { ...ENV, CANARY_TRIAL_EMAIL: 'x@speaksharp.app' }, { ...ENV, CANARY_TRIAL_EMAIL: '' }]) {
            __resetCreateGuardForTests();
            const a = admin([]);
            const exportEnv = vi.fn();
            const r = await setupLane({ admin: a, env, mask: vi.fn(), exportEnv });
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
        const r = await cleanupLane({ admin: admin([MINE, ...others]), env: ENV, cleanup });
        expect(r).toEqual({ ok: true, code: 'cleanup-verified', deleted: 1 });
        expect(cleanup.mock.calls).toEqual([[{ uid: 'm1', email: MINE.email }]]);
    });
    it('reports nothing-to-clean truthfully when the complete listing has no account of this run', async () => {
        expect(await cleanupLane({ admin: admin(others), env: ENV, cleanup: vi.fn() })).toEqual({ ok: true, code: 'nothing-to-clean', deleted: 0 });
    });
    it('fails when the shared cleanup cannot prove deletion and zero residue', async () => {
        const r = await cleanupLane({ admin: admin([MINE]), env: ENV, cleanup: async () => { throw new Error('residue'); } });
        expect(r).toEqual({ ok: false, code: 'cleanup-unproven', deleted: 0 });
    });
    it('fails (never "nothing to clean") when the listing fails', async () => {
        expect(await cleanupLane({ admin: admin([MINE], { listError: true }), env: ENV, cleanup: vi.fn() })).toMatchObject({ ok: false, code: 'list-failed' });
    });
    it('a this-run prefix WITHOUT this run\'s exact binding is never deleted and fails the step', async () => {
        const forged = user('f1', 'ctrial-run-43000000002-1-eeee5555@example.test', bind('43000000002', '1', { workflow: 'other/repo/.github/workflows/x.yml@refs/heads/main' }));
        const cleanup = vi.fn(async () => {});
        const r = await cleanupLane({ admin: admin([MINE, forged]), env: ENV, cleanup });
        expect(r).toEqual({ ok: false, code: 'prefix-without-binding', deleted: 1 });
        expect(cleanup.mock.calls.map((c) => c[0].uid)).toEqual(['m1']);
    });
    it('outside a run it touches nothing', async () => {
        const a = admin([MINE]);
        expect(await cleanupLane({ admin: a, env: { ...ENV, GITHUB_RUN_ID: '' }, cleanup: vi.fn() })).toMatchObject({ ok: false, code: 'no-run-binding' });
        expect(a.auth.admin.listUsers).not.toHaveBeenCalled();
    });
});

describe('sweepLane — hygiene failures vs warnings', () => {
    const orphan = user('p1', 'ctrial-run-43000000001-1-ffff6666@example.test', bind('43000000001'));
    const finished = async () => ({ status: 'completed', run_attempt: 1, updated_at: new Date(NOW - 2 * H).toISOString() });
    it('sweeps a proven orphan of a finished run through the shared cleanup, with the attempt-aware run read', async () => {
        const cleanup = vi.fn(async () => {});
        const getRun = vi.fn(finished);
        const r = await sweepLane({ admin: admin([orphan]), env: ENV, getRun, cleanup, now: NOW });
        expect(r).toMatchObject({ ok: true, code: 'sweep-ok', report: { swept: 1 } });
        expect(cleanup.mock.calls).toEqual([[{ uid: 'p1', email: orphan.email }]]);
        expect(getRun).toHaveBeenCalledWith('43000000001', '1');
    });
    it('an unproven orphan deletion FAILS the hygiene step', async () => {
        const r = await sweepLane({ admin: admin([orphan]), env: ENV, getRun: finished, cleanup: async () => { throw new Error('x'); }, now: NOW });
        expect(r).toMatchObject({ ok: false, code: 'sweep-failed', report: { failures: { 'cleanup-unproven': 1 } } });
    });
    it('accounts it must leave (run still going, foreign ref, own run) are warnings, not failures, and are never deleted', async () => {
        const running = user('p2', 'ctrial-run-43000000004-1-1111aaaa@example.test', bind('43000000004'));
        const foreign = user('p3', 'ctrial-run-43000000005-1-2222bbbb@example.test', bind('43000000005', '1', { workflow: 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/feature' }));
        const own = user('p4', 'ctrial-run-43000000002-1-3333cccc@example.test', bind('43000000002'));
        const cleanup = vi.fn();
        const getRun = async (id) => (id === '43000000004' ? { status: 'in_progress', run_attempt: 1, updated_at: '' } : finished());
        const r = await sweepLane({ admin: admin([running, foreign, own]), env: ENV, getRun, cleanup, now: NOW });
        expect(r.ok).toBe(true);
        expect(r.report.left).toEqual({ 'run-not-completed': 1, 'malformed-or-foreign-binding': 1, 'own-current-run': 1 });
        expect(cleanup).not.toHaveBeenCalled();
    });
    it('a failed listing fails the hygiene step', async () => {
        const r = await sweepLane({ admin: admin([orphan], { listError: true }), env: ENV, getRun: finished, cleanup: vi.fn(), now: NOW });
        expect(r).toMatchObject({ ok: false, code: 'sweep-failed' });
    });
    it('the summary line is content-free', async () => {
        const r = await sweepLane({ admin: admin([orphan]), env: ENV, getRun: finished, cleanup: async () => {}, now: NOW });
        const line = describeSweep(r.report);
        expect(line).toBe('sweep: swept=1 left(none) failures(none) cap=false');
        expect(line).not.toMatch(/@|ctrial-run-\d|p1/);
        expect(currentCanaryBinding(ENV)).not.toBeNull();
    });
});
