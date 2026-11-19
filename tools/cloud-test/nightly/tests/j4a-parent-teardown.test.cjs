'use strict';
// #1884 (Sam, 17 Nov): parent-owned J4.a teardown and owner binding with BOUNDED fakes. Sam's three first controls lead:
//   1. an omitted trial-email query is HOLD even when every other read is zero (a generic account zero never satisfies it);
//   2. the bind-time lookup through the REAL bounded admin transport: paginated (counted per actual send), stalled (aborted at the
//      enforced deadline), over its own allowance (refused unsent), caller cancellation preserved; none of it touches the cleanup reserve;
//   3. an unsettled save makes the delete refuse: named HOLD, never bypassed, no verification.
// Plus settlement before deletion, the remaining-reserve/time proof before the first delete, and one scoped zero per store.
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTakes, confirmJ4aOwner, j4aParentTeardown } = require('../j4a-parent-teardown.cjs');
const { boundedAdminTransport } = require('../admin-transport.cjs');
const { j4aRequiredStores } = require('../residue-inventory.cjs');
const { unprovenCleanup } = require('../cleanup-evidence.cjs');

const { offlineWriterProof } = require('./fixtures/j4a-writer-proof.cjs');
const BINDING = 'd'.repeat(64);
const RUN = '41325698722';
const REF = `rwt-journey-j4-${RUN}-1`;
const EMAIL = `${REF}@example.com`;
const OWNER = '11111111-1111-4111-8111-111111111111';
const STORES = j4aRequiredStores();
const OWNER_TABLES = STORES.filter((s) => s.key === 'owner' && s.table).map((s) => s.table);

/** An in-memory admin client; every call is counted, and (when given a transport) every call is one send through it. */
function fakeAdmin({ users, rows = {}, transport = null, obligationsOpen = false, casReply = null } = {}) {
    const st = { users: users ?? [{ id: OWNER, email: EMAIL }, { id: 'other-uid', email: 'someone@example.com' }], tables: {}, calls: [] };
    for (const t of [...OWNER_TABLES, 'trial_entitlements', 'account_save_obligations']) st.tables[t] = [];
    st.tables.trial_entitlements.push({ user_id: OWNER, email: EMAIL });
    st.tables.user_profiles.push({ id: OWNER });
    st.tables.sessions.push({ id: 'take-1', user_id: OWNER, status: 'completed', lease_id: 'lease-1', recording_fenced_at: null }, { id: 'take-x', user_id: 'other-uid', status: 'completed', lease_id: 'lease-x', recording_fenced_at: null });
    st.tables.account_save_obligations.push({ user_id: OWNER, phase: obligationsOpen ? 'admitted' : 'completed' });
    for (const [t, r] of Object.entries(rows)) st.tables[t] = r;
    const send = async (name) => { st.calls.push(name); if (transport) await transport.fetch(`admin://${name}`); };
    const notFound = { status: 404, code: 'user_not_found', message: 'User not found' };
    const filtered = (table, col, v) => (st.tables[table] ?? []).filter((r) => r[col] === v);
    const admin = {
        auth: { admin: {
            listUsers: async ({ page, perPage }) => { await send('listUsers'); return { data: { users: st.users.slice((page - 1) * perPage, page * perPage) }, error: null }; },
            getUserById: async (id) => { await send('getUserById'); const u = st.users.find((x) => x.id === id); return u ? { data: { user: { email: u.email } }, error: null } : { data: { user: null }, error: notFound }; },
            deleteUser: async (id) => {
                await send('deleteUser');
                if (st.tables.account_save_obligations.some((o) => o.user_id === id && o.phase !== 'completed')) return { error: { code: '55000', message: 'account admitted save unsettled' } };
                st.users = st.users.filter((u) => u.id !== id);
                for (const t of OWNER_TABLES.filter((x) => x !== 'account_save_obligations')) { const col = STORES.find((s) => s.table === t).column; st.tables[t] = st.tables[t].filter((r) => r[col] !== id); }
                // As on the real chain: no Auth FK, so completed journal rows SURVIVE the Auth delete.
                return { error: null };
            },
        } },
        from: (table) => ({
            select: (cols, opts) => ({ eq: async (col, v) => { await send(`select:${table}`);
                if (table === 'account_save_obligations') return { data: null, count: null, error: { code: '42501', message: 'permission denied for table account_save_obligations' } };
                const r = filtered(table, col, v); return opts?.head ? { count: r.length, error: null } : { data: r.map((x) => ({ ...x })), error: null }; } }),
            delete: () => ({ eq: async (col, v) => { await send(`delete:${table}`); st.tables[table] = st.tables[table].filter((r) => r[col] !== v); return { error: null }; } }),
            update: (patch) => { const eqs = []; const chain = { eq: (c, v) => { eqs.push([c, v]); return chain; }, select: async () => { await send(`update:${table}`); if (casReply) return casReply(); const hit = st.tables[table].filter((r) => eqs.every(([c, v]) => r[c] === v)); for (const r of hit) Object.assign(r, patch); return { data: hit.map((r) => ({ id: r.id })), error: null }; } }; return chain; },
        }),
    };
    /**
     * TEST-ONLY save-journal stand-in (logic coverage, NOT cleanup proof): what a reviewed, run-bound journal path would do, over this
     * fake's rows. `mode`: 'ok'; 'settle-noop' (claims done, leaves an admitted row); 'settle-fails'; 'remove-fails'; 'readback-fails'.
     */
    const journal = ({ mode = 'ok', runId = RUN, owner = OWNER } = {}) => Object.freeze({
        bound: { runId, owner },
        settle: async (uid) => { await send('journal:settle'); if (mode === 'settle-fails') return { error: { message: 'x' } };
            if (mode !== 'settle-noop') for (const r of st.tables.account_save_obligations) if (r.user_id === uid) r.phase = 'completed'; return { error: null }; },
        remove: async (uid) => { await send('journal:remove'); if (mode === 'remove-fails') return { error: { message: 'x' } };
            st.tables.account_save_obligations = st.tables.account_save_obligations.filter((r) => !(r.user_id === uid && r.phase === 'completed')); return { error: null }; },
        readBack: async (uid) => { await send('journal:readBack'); if (mode === 'readback-fails') return { error: { message: 'x' } };
            return { count: st.tables.account_save_obligations.filter((r) => r.user_id === uid).length, error: null }; },
    });
    return { admin, st, journal };
}
function fakeNightly(reserve = 70) {
    const n = { used: 0 };
    n.cleanup = async (_leg, fn) => { if (n.used >= reserve) return { sent: false }; n.used += 1; return { sent: true, value: await fn() }; };
    n.cleanupRemaining = () => reserve - n.used;
    return n;
}
const record = () => ({ sent: { attemptId: 'J4.a-1', leg: 'J4.a', lookupRef: REF, emailDomain: 'example.com' }, answered: { result: { outcome: 'created' } } });
/** A real bounded transport with the J4 teardown allowance; fakes that are not wired to it leave its count at zero. */
const bindTransport = () => boundedAdminTransport({ fetchImpl: async () => ({}), deadlineMs: 10_000, allowances: { bind: 51, teardown: 0 } });
const okTransport = () => boundedAdminTransport({ fetchImpl: async () => ({}), deadlineMs: 10_000, allowances: { bind: 0, teardown: 70 } });
const teardownArgs = (a, over = {}) => ({ nightly: fakeNightly(), admin: a.admin, transport: okTransport(), timeLeftMs: () => 700_000, saveJournal: a.journal(),
    createRecord: record(), runId: RUN, configuredDomain: 'example.com', confirmedAccount: REF,
    childClosed: { exited: true, ownedPagesClosed: true }, preservedOwner: OWNER, binding: BINDING,
    stopped: offlineWriterProof({ binding: BINDING, runId: RUN, owner: OWNER }), ...over });

// ---- Control 1: per-store identity; an omitted trial-email query is HOLD ----
test('positive: one scoped zero per required store, each carrying its own store identity; the bridge rule accepts it', async () => {
    const a = fakeAdmin();
    const r = await j4aParentTeardown(teardownArgs(a));
    assert.equal(r.hold, null);
    assert.deepEqual(r.nightlyCleanup.verification.queries.map((q) => q.store), STORES.map((s) => s.id));
    assert.ok(r.nightlyCleanup.verification.queries.every((q) => q.count === 0 && q.scope === REF));
    assert.deepEqual(unprovenCleanup({ ...r.nightlyCleanup, created: [{ kind: 'account', ref: REF }] },
        { requiredStores: STORES.map((s) => s.id), confirmedScope: REF }), []);
    assert.deepEqual(a.st.users.map((u) => u.id), ['other-uid']);
    assert.equal(a.st.tables.trial_entitlements.length, 0);
});

test('CONTROL: omitting ONLY the trial-email query while every other read is zero is HOLD; a generic account zero never satisfies it', async () => {
    const a = fakeAdmin();
    const r = await j4aParentTeardown(teardownArgs(a));
    const without = { ...r.nightlyCleanup, created: [{ kind: 'account', ref: REF }],
        verification: { kind: 'zero-residue', queries: r.nightlyCleanup.verification.queries.filter((q) => q.store !== 'trial_entitlements:email') } };
    assert.ok(without.verification.queries.some((q) => q.kind === 'account' && q.count === 0), 'other account-kind zeros are present');
    const reasons = unprovenCleanup(without, { requiredStores: STORES.map((s) => s.id), confirmedScope: REF });
    assert.deepEqual(reasons, ['no residue query for store trial_entitlements:email with observed zero on the confirmed account scope']);
});

test('CONTROL: a store\'s zero read on ANOTHER account scope does not satisfy that store', async () => {
    const a = fakeAdmin();
    const r = await j4aParentTeardown(teardownArgs(a));
    const queries = r.nightlyCleanup.verification.queries.map((q) => (q.store === 'user_profiles:id' ? { ...q, scope: 'rwt-journey-j4-99-1' } : q));
    const reasons = unprovenCleanup({ ...r.nightlyCleanup, created: [{ kind: 'account', ref: REF }], verification: { kind: 'zero-residue', queries } },
        { requiredStores: STORES.map((s) => s.id), confirmedScope: REF });
    assert.deepEqual(reasons, ['no residue query for store user_profiles:id with observed zero on the confirmed account scope']);
});

test('a trial entitlement left under the reserved email is observed (count 1), never zero', async () => {
    const a = fakeAdmin({ rows: { trial_entitlements: [{ user_id: OWNER, email: EMAIL }, { user_id: null, email: EMAIL }] } });
    const r = await j4aParentTeardown(teardownArgs(a));
    assert.equal(r.nightlyCleanup.verification.queries.find((q) => q.store === 'trial_entitlements:email').count, 1);
    assert.ok(unprovenCleanup({ ...r.nightlyCleanup, created: [] }, { requiredStores: STORES.map((s) => s.id), confirmedScope: REF }).length > 0);
});

// ---- Control 2: the bind-time lookup through the real bounded transport ----
function lookupThrough({ pages, stall = false, bindAllowance = 51, deadlineMs = 10_000 }) {
    const sends = [];
    const fetchImpl = (url, init) => new Promise((resolve, reject) => {
        sends.push(url);
        if (!stall) { resolve({ ok: true }); return; }
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    const transport = boundedAdminTransport({ fetchImpl, deadlineMs, allowances: { bind: bindAllowance, teardown: 70 } });
    const users = Array.from({ length: (pages - 1) * 200 + 3 }, (_, i) => ({ id: `u-${i}`, email: `user${i}@example.com` }));
    users[users.length - 1] = { id: OWNER, email: EMAIL }; // the target sits on the last page
    return { a: fakeAdmin({ users, transport }), transport, sends };
}
const confirm = (a, transport) => confirmJ4aOwner({ admin: a.admin, transport, createRecord: record(), runId: RUN, configuredDomain: 'example.com', confirmedAccount: REF });

test('CONTROL paginated: the target on page 3 of 3 is found; every page and the re-read are counted as actual bind sends; teardown allowance untouched', async () => {
    const { a, transport, sends } = lookupThrough({ pages: 3 });
    const r = await confirm(a, transport);
    assert.equal(r.owner, OWNER);
    assert.deepEqual(transport.sent(), { bind: 4, teardown: 0 }); // 3 list pages + 1 re-read
    assert.equal(sends.length, 4);
});

test('CONTROL stalled: a list page that never answers is aborted at the ENFORCED per-request deadline: lookup unreadable, HOLD, nothing bound', async () => {
    const { a, transport } = lookupThrough({ pages: 1, stall: true, deadlineMs: 40 });
    const t0 = Date.now();
    const r = await confirm(a, transport);
    assert.match(r.hold, /lookup is unreadable/);
    assert.ok(Date.now() - t0 < 2_000, 'bounded by the transport deadline, not a hang');
    assert.equal(transport.sent().bind, 1);
});

test('CONTROL over-allowance: past the bind allowance the next page is refused UNSENT; lookup unreadable, HOLD', async () => {
    const { a, transport, sends } = lookupThrough({ pages: 3, bindAllowance: 2 });
    const r = await confirm(a, transport);
    assert.match(r.hold, /lookup is unreadable/);
    assert.deepEqual([transport.sent().bind, sends.length], [2, 2]);
});

test('the transport preserves caller cancellation and sends nothing without a phase', async () => {
    let seen = null;
    const transport = boundedAdminTransport({ fetchImpl: (_u, init) => new Promise((_res, rej) => { seen = init.signal; init.signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true }); }),
        deadlineMs: 60_000, allowances: { bind: 5, teardown: 5 } });
    await assert.rejects(transport.fetch('admin://x'), { code: 'ADMIN_PHASE' });
    transport.setPhase('bind');
    const caller = new AbortController();
    const p = transport.fetch('admin://x', { signal: caller.signal });
    const why = new Error('caller cancelled');
    const t0 = Date.now();
    caller.abort(why);
    await assert.rejects(p, /aborted/);
    assert.ok(Date.now() - t0 < 1_000, 'the caller\'s abort reached the request at once, not at the 60 s deadline');
    assert.equal(seen.aborted, true);
    assert.equal(seen.reason, why, 'the request saw the caller\'s own reason, not the deadline');
});

// ---- Control 3: an unsettled save refuses deletion; settlement before deletion ----
test('CONTROL: an unsettled admitted save makes the delete refuse: named HOLD, not bypassed, no proof and no verification', async () => {
    // A journal that claims it settled but did not: the delete guard is still the backstop, and its refusal is a named HOLD.
    const a = fakeAdmin({ obligationsOpen: true });
    const r = await j4aParentTeardown(teardownArgs(a, { saveJournal: a.journal({ mode: 'settle-noop' }) }));
    assert.match(r.hold, /deletion refused: an admitted save is unsettled/);
    assert.equal(r.nightlyCleanup.verification, undefined);
    assert.deepEqual(r.nightlyCleanup.left, [{ kind: 'account', ref: REF }]);
    assert.equal(a.st.calls.filter((c) => c === 'deleteUser').length, 1, 'refused once, never retried');
    assert.ok(a.st.users.some((u) => u.id === OWNER), 'the account remains (and is reported left)');
});

test('CONTROL: zero closable takes does not authorize teardown without a verified run-bound writer capability', async () => {
    for (const stopped of [null, { writersClosedAt: 1, unsettledSaveIds: [] }, offlineWriterProof({ binding: 'f'.repeat(64), runId: RUN, owner: OWNER }),
        offlineWriterProof({ binding: BINDING, runId: 'foreign-run', owner: OWNER }), offlineWriterProof({ binding: BINDING, runId: RUN, owner: 'foreign-owner' })]) {
        const a = fakeAdmin(); // Completed takes only; old code would have entered destructive teardown.
        const args = teardownArgs(a, { stopped });
        const r = await j4aParentTeardown(args);
        assert.deepEqual([a.st.calls, args.nightly.used], [[], 0]);
        assert.match(r.hold, /no verified stopped-writer evidence/);
        assert.ok(a.st.users.some((u) => u.id === OWNER));
        assert.equal(r.nightlyCleanup.verification, undefined);
    }
});

test('settlement: an open take with no stopped-writer proof stops BEFORE any delete; with the proof it is closed first, then deleted', async () => {
    const open = [{ id: 'take-1', user_id: OWNER, status: 'active', lease_id: 'lease-1', recording_fenced_at: null }];
    const a = fakeAdmin({ rows: { sessions: open.map((x) => ({ ...x })) } });
    const r = await j4aParentTeardown(teardownArgs(a, { stopped: null }));
    assert.match(r.hold, /no verified stopped-writer evidence/);
    assert.equal(a.st.calls.filter((c) => /^delete|deleteUser/.test(c)).length, 0);
    const b = fakeAdmin({ rows: { sessions: open.map((x) => ({ ...x })) } });
    const ok = await j4aParentTeardown(teardownArgs(b));
    assert.equal(ok.hold, null);
    assert.ok(b.st.calls.indexOf('update:sessions') < b.st.calls.indexOf('deleteUser'));
    const c = fakeAdmin({ rows: { sessions: open.map((x) => ({ ...x })) } });
    const inflight = await j4aParentTeardown(teardownArgs(c, { stopped: { writersClosedAt: 1, unsettledSaveIds: ['TAKE-1'] } }));
    assert.match(inflight.hold, /no verified stopped-writer evidence/);
    assert.deepEqual(c.st.calls, []);
});

test('settlement CAS requires one exact returned id before journal or delete calls', async () => {
    const take = { id: 'take-1', user_id: OWNER, status: 'active', lease_id: 'lease-1', recording_fenced_at: null };
    for (const data of [[], [{ id: 'take-x' }], [{ id: 'take-1' }, { id: 'take-1' }], null, [{}]]) {
        const a = fakeAdmin({ rows: { sessions: [take] }, casReply: () => ({ data, error: null }) });
        const r = await j4aParentTeardown(teardownArgs(a));
        assert.match(r.hold, /open take could not be settled/);
        assert.equal(a.st.calls.at(-1), 'update:sessions');
        assert.equal(r.nightlyCleanup.steps.at(-1).outcome, 'failed');
        assert.equal(a.st.users.find(x => x.id === OWNER)?.email, EMAIL);
    }
});

test('settlement: an unsettleable take or a lease with no take stops before any delete', async () => {
    for (const rows of [{ sessions: [{ id: 't', user_id: OWNER, status: 'active', lease_id: null, recording_fenced_at: null }] },
        { active_recording_lease: [{ user_id: OWNER, lease_id: 'orphan-lease' }] }]) {
        const a = fakeAdmin({ rows });
        const r = await j4aParentTeardown(teardownArgs(a));
        assert.ok(r.hold);
        assert.equal(a.st.calls.filter((c) => /deleteUser|^delete:/.test(c)).length, 0);
    }
});

// ---- before the first delete: reserve, allowance and time cover every remaining request ----
test('a reserve, allowance or time that cannot cover settlement + deletion + every store read stops BEFORE the first delete', async () => {
    const need = 5 + STORES.length; // journal settle, pre-delete, delete, proof, journal remove, one read per store
    // 3 requests are sent before the check (re-read, takes, leases); each case leaves exactly one request too few.
    const viaTransport = boundedAdminTransport({ fetchImpl: async () => ({}), allowances: { bind: 0, teardown: need - 1 + 3 }, deadlineMs: 10_000 });
    for (const [over, admin] of [[{ nightly: fakeNightly(3 + need - 1) }, fakeAdmin()],
        [{ transport: viaTransport }, fakeAdmin({ transport: viaTransport })],
        [{ timeLeftMs: () => need * 10_000 - 1, deadlineMs: 10_000 }, fakeAdmin()]]) {
        const a = admin;
        const r = await j4aParentTeardown(teardownArgs(a, over));
        assert.match(r.hold, /cannot cover/);
        assert.equal(a.st.calls.filter((c) => /deleteUser|^delete:/.test(c)).length, 0);
    }
});

// ---- ownership ----
test('teardown never enumerates: the preserved owner is re-read by id and must carry the reserved email; no preserved owner is HOLD', async () => {
    const a = fakeAdmin();
    await j4aParentTeardown(teardownArgs(a));
    assert.equal(a.st.calls.filter((c) => c === 'listUsers').length, 0);
    const b = fakeAdmin({ users: [{ id: OWNER, email: 'foreign@example.com' }] });
    assert.match((await j4aParentTeardown(teardownArgs(b))).hold, /does not carry the reserved email/);
    assert.equal(b.st.calls.filter((c) => /deleteUser/.test(c)).length, 0);
    assert.match((await j4aParentTeardown(teardownArgs(fakeAdmin(), { preservedOwner: null }))).hold, /no owner was preserved/);
});

test('bind refuses a mismatched durable record, another leg, another domain, or two accounts on the email, before any lookup or delete', async () => {
    for (const over of [{ confirmedAccount: 'rwt-journey-j4-99-1' }, { createRecord: { ...record(), sent: { ...record().sent, leg: 'J4.b' } } }, { configuredDomain: 'other.com' }]) {
        const a = fakeAdmin();
        const r = await confirmJ4aOwner({ admin: a.admin, transport: bindTransport(), createRecord: record(), runId: RUN, configuredDomain: 'example.com', confirmedAccount: REF, ...over });
        assert.ok(r.hold && !/transport/.test(r.hold), r.hold);
        assert.equal(a.st.calls.length, 0);
    }
    const dup = fakeAdmin({ users: [{ id: OWNER, email: EMAIL }, { id: 'dup', email: EMAIL }] });
    assert.match((await confirm(dup, bindTransport())).hold, /ambiguous/);
});

test('classifyTakes matches the established rule (settled, closable, unsettleable)', () => {
    assert.deepEqual(classifyTakes([
        { status: 'completed', lease_id: null, recording_fenced_at: null }, { status: 'failed', lease_id: 'l', recording_fenced_at: null },
        { status: 'active', lease_id: 'l', recording_fenced_at: null }, { status: 'active', lease_id: null, recording_fenced_at: null },
    ]).closable.length, 1);
});

// ---- Sam: both bounds are REQUIRED; a missing transport or an unknown time is HOLD with nothing sent ----
test('teardown without a bounded transport, or without a known time left, is HOLD before any request', async () => {
    for (const [over, why] of [[{ transport: undefined }, /no bounded admin transport/], [{ timeLeftMs: undefined }, /time left for teardown is unknown/],
        [{ timeLeftMs: () => NaN }, /time left cannot cover/], [{ timeLeftMs: () => null }, /time left cannot cover/]]) {
        const a = fakeAdmin();
        const r = await j4aParentTeardown(teardownArgs(a, over));
        assert.match(r.hold, why);
        if (!over.timeLeftMs) assert.deepEqual(a.st.calls, [], 'nothing sent');
        assert.equal(a.st.calls.filter((c) => /deleteUser|^delete:/.test(c)).length, 0, 'nothing deleted');
    }
});

test('bind without a bounded transport is HOLD and sends nothing', async () => {
    const a = fakeAdmin();
    const r = await confirmJ4aOwner({ admin: a.admin, createRecord: record(), runId: RUN, configuredDomain: 'example.com', confirmedAccount: REF });
    assert.match(r.hold, /no bounded admin transport/);
    assert.deepEqual(a.st.calls, []);
});

// ---- Sam (17 Nov): the save journal. No reviewed, run-bound path means HOLD before ANY request; with one, its rows are settled before
// the delete, removed after it (completed rows survive the Auth delete), and read back by the journal path, never by service role. ----
test('CONTROL: with no save-journal path, or one bound to another run or owner, teardown is HOLD before any request; nothing is deleted', async () => {
    for (const pick of [() => null, (a) => a.journal({ runId: 'another-run' }), (a) => a.journal({ owner: '22222222-2222-4222-8222-222222222222' }),
        (a) => ({ ...a.journal(), readBack: undefined })]) {
        const a = fakeAdmin({ obligationsOpen: true });
        const r = await j4aParentTeardown(teardownArgs(a, { saveJournal: pick(a) }));
        assert.match(r.hold, /no reviewed, run-bound way to settle, remove and read back the save journal/);
        assert.deepEqual(a.st.calls, [], 'nothing sent, so nothing closed, pre-deleted or deleted');
        assert.ok(a.st.users.some((u) => u.id === OWNER));
        assert.deepEqual(r.nightlyCleanup.left, [{ kind: 'account', ref: REF }]);
    }
});

test('with the journal path: settled BEFORE the delete, the surviving completed row removed AFTER it, and read back as zero by the journal path', async () => {
    const a = fakeAdmin({ obligationsOpen: true });
    const r = await j4aParentTeardown(teardownArgs(a));
    assert.equal(r.hold, null);
    const order = a.st.calls.filter((c) => /^journal:|deleteUser/.test(c));
    assert.deepEqual(order.slice(0, 3), ['journal:settle', 'deleteUser', 'journal:remove']);
    assert.ok(!a.st.calls.includes('select:account_save_obligations'), 'never a service-role read of the journal');
    assert.equal(r.nightlyCleanup.verification.queries.find((q) => q.store === 'account_save_obligations:user_id').count, 0);
    assert.deepEqual(r.nightlyCleanup.steps.map((x) => x.action), ['settle-save-journal', 'pre-delete-trial-entitlements', 'delete', 'prove-deleted', 'remove-save-journal']);
});

test('journal failures: settle fails -> HOLD before any delete; remove fails -> HOLD (row reported left); read-back fails -> not an observed zero', async () => {
    const s1 = fakeAdmin({ obligationsOpen: true });
    assert.match((await j4aParentTeardown(teardownArgs(s1, { saveJournal: s1.journal({ mode: 'settle-fails' }) }))).hold, /could not be settled, so nothing is deleted/);
    assert.equal(s1.st.calls.filter((c) => c === 'deleteUser' || /^delete:/.test(c)).length, 0);
    const s2 = fakeAdmin();
    assert.match((await j4aParentTeardown(teardownArgs(s2, { saveJournal: s2.journal({ mode: 'remove-fails' }) }))).hold, /journal rows could not be removed/);
    assert.equal(s2.st.tables.account_save_obligations.length, 1, 'the completed row survived the Auth delete and is still there');
    const s3 = fakeAdmin();
    const r3 = await j4aParentTeardown(teardownArgs(s3, { saveJournal: s3.journal({ mode: 'readback-fails' }) }));
    assert.equal(r3.nightlyCleanup.verification.queries.find((q) => q.store === 'account_save_obligations:user_id').count, null);
    assert.ok(unprovenCleanup({ ...r3.nightlyCleanup, created: [{ kind: 'account', ref: REF }] }, { requiredStores: STORES.map((x) => x.id), confirmedScope: REF })
        .includes('no residue query for store account_save_obligations:user_id with observed zero on the confirmed account scope'));
});
