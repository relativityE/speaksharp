// @vitest-environment node
/**
 * J8 parent operations (Sam, 23 Nov): the only way the J8 browser spec reaches production data, held by the parent with the key.
 * Four named operations, each bound to the one admitted account and this run. Every control below is a refusal or a binding check.
 */
import { describe, expect, it, vi } from 'vitest';
import { createJ8ParentOps, FENCE_FUNCTIONS } from '../../scripts/rwt-j8-parent-ops.mts';

const TOKEN = 'a'.repeat(64);
const AUTH = `Bearer ${TOKEN}`;
const EMAIL = 'rwt-journey-j8-fixture@example.test';
const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BINDING = { repository: 'org/repo', workflow: 'org/repo/.github/workflows/rc-gates.yml@refs/heads/main', runId: '123', runAttempt: '1' };
const RUN_KEY = '123-1-AHT-07+AHT-08';

function fixture({ emailFor = (uid: string) => (uid === UID ? EMAIL : 'someone-else@example.test'), failures = [] as string[] } = {}) {
    const queries: Array<{ table: string; columns: string; filters: Array<[string, string, unknown]> }> = [];
    const builder = (table: string) => {
        const q = { table, columns: '', filters: [] as Array<[string, string, unknown]> };
        queries.push(q);
        type Chain = { select(c: string): Chain; eq(c: string, v: unknown): Chain; in(c: string, v: unknown): Chain; then(resolve: (v: unknown) => unknown): Promise<unknown> };
        const chain: Chain = {
            select(c: string) { q.columns = c; return chain; },
            eq(c: string, v: unknown) { q.filters.push(['eq', c, v]); return chain; },
            in(c: string, v: unknown) { q.filters.push(['in', c, v]); return chain; },
            then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: [{ id: 'row' }], error: null }).then(resolve); },
        };
        return chain;
    };
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const admin = {
        auth: { admin: { getUserById: vi.fn(async (uid: string) => ({ data: { user: { email: emailFor(uid) } }, error: null })) } },
        from: vi.fn(builder),
        rpc,
    };
    const helpers = {
        runOwnedIdentityFailures: vi.fn(async () => failures),
        markRunOwnedAccountCanary: vi.fn(async () => true),
    };
    const handle = createJ8ParentOps({ admin: admin as never, email: EMAIL, binding: BINDING, token: TOKEN, helpers: helpers as never });
    const bind = () => handle(AUTH, { op: 'identity_and_claim', args: { uid: UID } });
    return { handle, admin, helpers, queries, rpc, bind };
}

describe('J8 parent operations: token, operation allowlist and binding', () => {
    it('refuses a missing or wrong token before doing anything', async () => {
        const f = fixture();
        for (const auth of [undefined, '', `Bearer ${'b'.repeat(64)}`, TOKEN]) {
            expect((await f.handle(auth, { op: 'identity_and_claim', args: { uid: UID } })).body).toEqual({ refused: 'unauthorized' });
        }
        expect(f.admin.auth.admin.getUserById).not.toHaveBeenCalled();
    });
    it('refuses any operation outside the four named ones (no generic proxy)', async () => {
        const f = fixture();
        for (const op of ['from', 'rpc', 'delete_account', 'sql', '']) {
            expect((await f.handle(AUTH, { op, args: {} })).body).toEqual({ refused: 'unknown_operation' });
        }
    });
    it('nothing reads or writes data before the admitted account is bound', async () => {
        const f = fixture();
        expect((await f.handle(AUTH, { op: 'fence', args: { fn: FENCE_FUNCTIONS[0], args: {} } })).body).toEqual({ refused: 'no_bound_account' });
        expect((await f.handle(AUTH, { op: 'issue_reports', args: { by: 'key', value: 'k1' } })).body).toEqual({ refused: 'no_bound_account' });
        expect((await f.handle(AUTH, { op: 'take_digests', args: { ids: [UID] } })).body).toEqual({ refused: 'no_bound_account' });
        expect(f.rpc).not.toHaveBeenCalled();
        expect(f.queries).toHaveLength(0);
    });
});

describe('identity_and_claim: binds only the admitted account', () => {
    it('a uid whose Auth email is not the admitted email is refused and never bound', async () => {
        const f = fixture();
        expect((await f.handle(AUTH, { op: 'identity_and_claim', args: { uid: OTHER } })).body).toEqual({ refused: 'not_the_admitted_account' });
        expect(f.helpers.runOwnedIdentityFailures).not.toHaveBeenCalled();
        expect(f.helpers.markRunOwnedAccountCanary).not.toHaveBeenCalled();
        expect((await f.handle(AUTH, { op: 'issue_reports', args: { by: 'key', value: 'k1' } })).body).toEqual({ refused: 'no_bound_account' });
    });
    it('the admitted account is checked, claimed with the ADMITTED email (never a caller value), and bound', async () => {
        const f = fixture();
        expect((await f.bind()).body).toEqual({ failures: 0, claimed: true });
        expect(f.helpers.runOwnedIdentityFailures).toHaveBeenCalledWith(f.admin, UID, EMAIL);
        expect(f.helpers.markRunOwnedAccountCanary).toHaveBeenCalledWith(f.admin, UID, EMAIL);
    });
    it('a failed identity check binds nothing and claims nothing', async () => {
        const f = fixture({ failures: ['profile missing'] });
        expect((await f.bind()).body).toEqual({ failures: 1, claimed: false });
        expect(f.helpers.markRunOwnedAccountCanary).not.toHaveBeenCalled();
        expect((await f.handle(AUTH, { op: 'take_digests', args: { ids: [UID] } })).body).toEqual({ refused: 'no_bound_account' });
    });
    it('once bound, another account cannot be bound in the same run', async () => {
        const f = fixture({ emailFor: () => EMAIL });
        await f.bind();
        expect((await f.handle(AUTH, { op: 'identity_and_claim', args: { uid: OTHER } })).body).toEqual({ refused: 'another_account' });
    });
    it('extra arguments are refused', async () => {
        const f = fixture();
        expect((await f.handle(AUTH, { op: 'identity_and_claim', args: { uid: UID, email: 'x@example.test' } })).body).toEqual({ refused: 'bad_arguments' });
    });
});

describe('fence: only the four fence RPCs, only for this account and this run', () => {
    const open = (over: Record<string, unknown> = {}) => ({ op: 'fence', args: { fn: 'open_rwt_feedback_fence_v1',
        args: { p_owner: UID, p_binding: { ...BINDING, role: 'rwt-journey' }, p_case: 'AHT-07+AHT-08', p_key_cap: 4, ...over } } });
    it('a valid open and the run-keyed close/clean/verify reach the RPC unchanged', async () => {
        const f = fixture(); await f.bind();
        expect((await f.handle(AUTH, open())).status).toBe(200);
        for (const fn of FENCE_FUNCTIONS.slice(1)) {
            expect((await f.handle(AUTH, { op: 'fence', args: { fn, args: { p_run_key: RUN_KEY } } })).status).toBe(200);
        }
        expect(f.rpc).toHaveBeenCalledTimes(4);
    });
    it('refuses any other RPC name', async () => {
        const f = fixture(); await f.bind();
        expect((await f.handle(AUTH, { op: 'fence', args: { fn: 'delete_user', args: { p_run_key: RUN_KEY } } })).body).toEqual({ refused: 'not_a_fence_call' });
        expect(f.rpc).not.toHaveBeenCalled();
    });
    it('refuses an open for another owner, another run, another case or with extra arguments', async () => {
        const f = fixture(); await f.bind();
        expect((await f.handle(AUTH, open({ p_owner: OTHER }))).body).toEqual({ refused: 'another_account' });
        expect((await f.handle(AUTH, open({ p_binding: { ...BINDING, runId: '999', role: 'rwt-journey' } }))).body).toEqual({ refused: 'another_run' });
        expect((await f.handle(AUTH, open({ p_case: 'AHT-07' }))).body).toEqual({ refused: 'another_run' });
        expect((await f.handle(AUTH, open({ p_extra: 1 }))).body).toEqual({ refused: 'bad_arguments' });
        expect(f.rpc).not.toHaveBeenCalled();
    });
    it('refuses close/clean/verify for another run key', async () => {
        const f = fixture(); await f.bind();
        expect((await f.handle(AUTH, { op: 'fence', args: { fn: 'close_rwt_feedback_fence_v1', args: { p_run_key: '999-1-AHT-07+AHT-08' } } })).body).toEqual({ refused: 'another_run' });
        expect(f.rpc).not.toHaveBeenCalled();
    });
});

describe('issue_reports and take_digests: the bound account only, fixed columns', () => {
    it('every report read is filtered to the bound uid with fixed columns; the caller names no user', async () => {
        const f = fixture(); await f.bind();
        await f.handle(AUTH, { op: 'issue_reports', args: { by: 'keys', value: ['k1', 'k2'] } });
        await f.handle(AUTH, { op: 'issue_reports', args: { by: 'id', value: OTHER } });
        for (const q of f.queries) {
            expect(q.table).toBe('user_issue_reports');
            expect(q.columns).toBe('id,session_id,metadata');
            expect(q.filters).toContainEqual(['eq', 'user_id', UID]);
        }
    });
    it('refuses malformed report reads', async () => {
        const f = fixture(); await f.bind();
        for (const args of [{ by: 'user_id', value: UID }, { by: 'keys', value: [] }, { by: 'id', value: 'not-a-uuid' }, { by: 'key', value: "x' OR 1=1" }]) {
            expect((await f.handle(AUTH, { op: 'issue_reports', args })).body).toEqual({ refused: 'bad_arguments' });
        }
    });
    it('take digests read only the bound uid\'s sessions, at most four ids', async () => {
        const f = fixture(); await f.bind();
        expect((await f.handle(AUTH, { op: 'take_digests', args: { ids: [UID, OTHER] } })).status).toBe(200);
        expect(f.queries.at(-1)).toMatchObject({ table: 'sessions' });
        expect(f.queries.at(-1)!.filters).toContainEqual(['eq', 'user_id', UID]);
        expect((await f.handle(AUTH, { op: 'take_digests', args: { ids: [UID, UID, UID, UID, UID] } })).body).toEqual({ refused: 'bad_arguments' });
    });
});

describe('lifecycle: admission closes when the spec exits; cleanup waits for in-flight operations', () => {
    it('after close, new operations are refused; close resolves only once the in-flight operation settles', async () => {
        const f = fixture(); await f.bind();
        let finish!: () => void;
        f.rpc.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ data: { ok: true }, error: null }); }) as never);
        const pending = f.handle(AUTH, { op: 'fence', args: { fn: 'verify_rwt_feedback_fence_v1', args: { p_run_key: RUN_KEY } } });
        await Promise.resolve();
        expect(f.handle.inFlight()).toBe(1);
        let settled = false;
        const closed = f.handle.close().then(() => { settled = true; });
        expect((await f.handle(AUTH, { op: 'take_digests', args: { ids: [UID] } })).body).toEqual({ refused: 'closed' });
        await new Promise((r) => setTimeout(r, 20));
        expect(settled).toBe(false);
        finish();
        await pending; await closed;
        expect(settled).toBe(true);
        expect(f.handle.inFlight()).toBe(0);
    });
    it('close with nothing in flight resolves at once', async () => {
        const f = fixture();
        await f.handle.close();
        expect((await f.bind()).body).toEqual({ refused: 'closed' });
    });
});
