// @vitest-environment node
/**
 * J8 parent operations (Sam, 23 Nov): the only way the J8 browser spec reaches production data, held by the parent with the key.
 * Four named operations, each bound to the one admitted account and this run. Every control below is a refusal or a binding check.
 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { createJ8ParentOps, FENCE_FUNCTIONS, serveJ8ParentOps } from '../../scripts/rwt-j8-parent-ops.mts';
import { j8ParentOpsFromEnv, parentFenceClient, parentIdentityAndClaim, parentReportReader, parentReportsByKeys, parentTakeRows } from '../live/helpers/j8ParentOpsClient';

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

describe('served in the parent through the entry\'s settlement gate (real loopback server)', () => {
    /** The entry's gate shape (j8-nightly-entry.cjs parentOperations): run while open, reject once closed, track what is in flight. */
    function gate() {
        let open = true; let runs = 0; const inFlight = new Set<Promise<unknown>>();
        return {
            runs: () => runs, inFlight: () => inFlight.size, close() { open = false; },
            run<T>(fn: () => Promise<T>): Promise<T> {
                if (!open) return Promise.reject(new Error('closed'));
                runs += 1;
                const call = Promise.resolve().then(fn);
                const ended = call.then(() => undefined, () => undefined);
                inFlight.add(ended); void ended.then(() => inFlight.delete(ended));
                return call;
            },
        };
    }
    const post = (url: string, body: unknown, auth = AUTH) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(body) })
        .then(async (r) => ({ status: r.status, body: await r.json() }));
    async function served(g = gate()) {
        const f = fixture();
        const s = await serveJ8ParentOps({ admin: f.admin as never, email: EMAIL, binding: BINDING, token: TOKEN, gate: g, helpers: f.helpers as never });
        return { f, s, g };
    }

    it('listens on loopback /op only and runs every operation through the gate', async () => {
        const { f, s, g } = await served();
        try {
            expect(new URL(s.url)).toMatchObject({ protocol: 'http:', hostname: '127.0.0.1', pathname: '/op' });
            expect(await post(s.url, { op: 'identity_and_claim', args: { uid: UID } })).toEqual({ status: 200, body: { failures: 0, claimed: true } });
            expect((await post(s.url, { op: 'take_digests', args: { ids: [UID] } })).status).toBe(200);
            expect(g.runs()).toBe(2);
            expect(f.queries.at(-1)!.filters).toContainEqual(['eq', 'user_id', UID]);
            expect((await fetch(s.url.replace('/op', '/other'), { method: 'POST', body: '{}' })).status).toBe(404);
        } finally { s.close(); }
    });
    it('once the gate closes (the spec ended), a request is answered closed and nothing is read or written', async () => {
        const { f, s, g } = await served();
        try {
            await post(s.url, { op: 'identity_and_claim', args: { uid: UID } });
            g.close();
            expect(await post(s.url, { op: 'fence', args: { fn: 'verify_rwt_feedback_fence_v1', args: { p_run_key: RUN_KEY } } })).toEqual({ status: 409, body: { refused: 'closed' } });
            expect(f.rpc).not.toHaveBeenCalled();
        } finally { s.close(); }
    });
    it('an operation in flight when the gate closes is tracked by the gate until it settles, and still completes', async () => {
        const { f, s, g } = await served();
        try {
            await post(s.url, { op: 'identity_and_claim', args: { uid: UID } });
            let finish!: () => void;
            f.rpc.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ data: { closed: true }, error: null }); }) as never);
            const pending = post(s.url, { op: 'fence', args: { fn: 'close_rwt_feedback_fence_v1', args: { p_run_key: RUN_KEY } } });
            await vi.waitFor(() => expect(g.inFlight()).toBe(1));
            g.close();
            finish();
            expect(await pending).toEqual({ status: 200, body: { data: { closed: true }, error: null } });
            await vi.waitFor(() => expect(g.inFlight()).toBe(0));
        } finally { s.close(); }
    });
    it('a wrong token is refused inside the gate before any data access; close() stops listening', async () => {
        const { f, s } = await served();
        expect(await post(s.url, { op: 'identity_and_claim', args: { uid: UID } }, `Bearer ${'b'.repeat(64)}`)).toEqual({ status: 401, body: { refused: 'unauthorized' } });
        expect(f.admin.auth.admin.getUserById).not.toHaveBeenCalled();
        s.close();
        await expect(post(s.url, { op: 'take_digests', args: { ids: [UID] } })).rejects.toThrow();
    });
    it('refuses to serve without a gate', async () => {
        const f = fixture();
        await expect(serveJ8ParentOps({ admin: f.admin as never, email: EMAIL, binding: BINDING, token: TOKEN, gate: undefined as never })).rejects.toThrow('j8_parent_ops_setup');
    });
});

describe('the spec-side client (tests/live/helpers/j8ParentOpsClient.ts) against the real served operations', () => {
    const openGate = { run: <T,>(fn: () => Promise<T>) => fn() };
    async function live() {
        const f = fixture();
        const s = await serveJ8ParentOps({ admin: f.admin as never, email: EMAIL, binding: BINDING, token: TOKEN, gate: openGate, helpers: f.helpers as never });
        const ops = j8ParentOpsFromEnv({ RWT_J8_OPS_URL: s.url, RWT_J8_OPS_TOKEN: TOKEN })!;
        return { f, s, ops };
    }
    it('only a loopback /op address with a 64-hex run token is accepted; outside the J8 runner there is no client', () => {
        expect(j8ParentOpsFromEnv({})).toBe(null);
        for (const [url, token] of [['https://127.0.0.1:1/op', TOKEN], ['http://localhost:1/op', TOKEN], ['http://127.0.0.1:1/other', TOKEN], ['http://127.0.0.1:1/op', 'short']]) {
            expect(() => j8ParentOpsFromEnv({ RWT_J8_OPS_URL: url, RWT_J8_OPS_TOKEN: token })).toThrow(/only the loopback/);
        }
    });
    it('identity and claim, the fence client, report reads by key(s) and id, and take rows all round-trip for the bound account', async () => {
        const { f, s, ops } = await live();
        try {
            expect(await parentIdentityAndClaim(ops, UID)).toEqual({ failures: [], claimed: true });
            const fence = parentFenceClient(ops);
            expect(await fence.rpc('verify_rwt_feedback_fence_v1', { p_run_key: RUN_KEY })).toEqual({ data: { ok: true }, error: null });
            expect(await parentReportsByKeys(ops, ['k1'])).toEqual({ data: [{ id: 'row' }], error: null });
            expect(await parentReportsByKeys(ops, ['k1', 'k2'])).toEqual({ data: [{ id: 'row' }], error: null });
            const byId = await parentReportReader(ops).from('user_issue_reports').select('id,metadata').eq('id', UID).eq('user_id', OTHER);
            expect(byId).toEqual({ data: [{ id: 'row' }], error: null });
            expect(await parentTakeRows(ops, [UID])).toEqual({ data: [{ id: 'row' }], error: null });
            // The caller's user id and columns are never forwarded: every read is the bound uid with fixed columns.
            for (const q of f.queries) expect(q.filters).toContainEqual(['eq', 'user_id', UID]);
        } finally { s.close(); }
    });
    it('a parent refusal becomes a fail-closed error for the caller; a refused identity is a failure, never a claim', async () => {
        const { s, ops } = await live();
        try {
            expect(await parentIdentityAndClaim(ops, OTHER)).toEqual({ failures: ['parent refused the account (not_the_admitted_account)'], claimed: false });
            expect(await parentFenceClient(ops).rpc('verify_rwt_feedback_fence_v1', { p_run_key: RUN_KEY })).toEqual({ data: null, error: { code: 'parent_refused', message: 'no_bound_account' } });
            expect(await parentReportReader(ops).from('sessions').select('id').eq('id', UID).eq('user_id', UID)).toEqual({ data: null, error: { code: 'parent_refused' } });
            const wrongToken = j8ParentOpsFromEnv({ RWT_J8_OPS_URL: s.url, RWT_J8_OPS_TOKEN: 'c'.repeat(64) })!;
            expect((await parentTakeRows(wrongToken, [UID])).error).toEqual({ code: 'parent_refused', message: 'unauthorized' });
        } finally { s.close(); }
    });
});

describe('unknown write outcomes reach the entry\'s real settlement gate (Sam on 40e1a5a6)', () => {
    const entryGate = () => (createRequire(import.meta.url)('../../tools/cloud-test/nightly/j8-nightly-entry.cjs') as {
        parentOperations: () => { port: { run<T>(fn: () => Promise<T>): Promise<T> }; close(): void; settle(ms: number): Promise<boolean>; outcomeUnknown: boolean };
    }).parentOperations();
    async function served(setup: (f: ReturnType<typeof fixture>) => void) {
        const f = fixture(); setup(f);
        const ops = entryGate();
        const s = await serveJ8ParentOps({ admin: f.admin as never, email: EMAIL, binding: BINDING, token: TOKEN, gate: ops.port, helpers: f.helpers as never });
        return { f, s, ops };
    }
    const closeFence = { op: 'fence', args: { fn: 'close_rwt_feedback_fence_v1', args: { p_run_key: RUN_KEY } } };
    const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: AUTH }, body: JSON.stringify(body) })
        .then(async (r) => ({ status: r.status, body: await r.json() }));
    it('a fence write that throws, or fails with no error code, marks the outcome unknown; the spec still gets a fail-closed answer', async () => {
        const fails = {
            throws: () => Promise.reject(new Error('socket hang up')),
            noCode: async () => ({ data: null, error: { message: 'fetch failed', code: '' } }),
        };
        for (const [behaviour, rpcFail] of Object.entries(fails)) {
            const t = await served((f) => { f.rpc.mockImplementation(rpcFail as never); });
            try {
                await post(t.s.url, { op: 'identity_and_claim', args: { uid: UID } });
                expect(t.ops.outcomeUnknown).toBe(false);
                const r = await post(t.s.url, closeFence);
                expect({ behaviour, failClosed: r.status === 502 || r.body.error !== null }).toEqual({ behaviour, failClosed: true });
                t.ops.close();
                expect({ behaviour, settled: await t.ops.settle(500), unknown: t.ops.outcomeUnknown }).toEqual({ behaviour, settled: true, unknown: true });
            } finally { t.s.close(); }
        }
    });
    it('a definite database refusal of a write, a failed read and a clean run leave the outcome known', async () => {
        const refused = await served((f) => { f.rpc.mockImplementation((async (fn: string) => (fn === 'verify_rwt_feedback_fence_v1'
            ? Promise.reject(new Error('read failed')) : { data: null, error: { message: 'fence closed', code: 'P0001' } })) as never); });
        try {
            await post(refused.s.url, { op: 'identity_and_claim', args: { uid: UID } });
            expect((await post(refused.s.url, closeFence)).body).toEqual({ data: null, error: { code: 'P0001' } });
            expect((await post(refused.s.url, { op: 'fence', args: { fn: 'verify_rwt_feedback_fence_v1', args: { p_run_key: RUN_KEY } } })).body).toEqual({ refused: 'operation_failed' });
            refused.ops.close();
            expect({ settled: await refused.ops.settle(500), unknown: refused.ops.outcomeUnknown }).toEqual({ settled: true, unknown: false });
        } finally { refused.s.close(); }
    });
    it('an identity check that fails, or a canary claim that is not confirmed, marks the outcome unknown', async () => {
        for (const [failures, claim] of [[['profile missing'], true], [[], false]] as const) {
            const t = await served((f) => { f.helpers.runOwnedIdentityFailures.mockResolvedValue([...failures] as never); f.helpers.markRunOwnedAccountCanary.mockResolvedValue(claim as never); });
            try {
                const r = await post(t.s.url, { op: 'identity_and_claim', args: { uid: UID } });
                expect(r.body.claimed).toBe(false);
                t.ops.close();
                expect({ unknown: t.ops.outcomeUnknown, settled: await t.ops.settle(500) }).toEqual({ unknown: true, settled: true });
            } finally { t.s.close(); }
        }
    });
});
