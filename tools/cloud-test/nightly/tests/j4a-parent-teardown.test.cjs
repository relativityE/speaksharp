'use strict';
// #1884 (Sam, 17 Nov): parent-owned J4.a teardown with BOUNDED fakes. The fake admin keeps an in-memory user list and tables and
// counts every call; the fake `nightly.cleanup` has a capped reserve and counts reservations, so each admin call is shown to run
// inside its own reservation. Foreign-account refusal and partial/interrupted cleanup never delete the wrong thing and never PASS.
const test = require('node:test');
const assert = require('node:assert/strict');
const { j4aParentTeardown } = require('../j4a-parent-teardown.cjs');

const RUN = '41325698722';
const REF = `rwt-journey-j4-${RUN}-1`;
const EMAIL = `${REF}@example.com`;
const OWNER = 'owner-uid-1';

function fakeAdmin({ users, rows, failDelete = false, failProof = false, cascade = true, failList = false } = {}) {
    const state = { users: users ?? [{ id: OWNER, email: EMAIL }, { id: 'other-uid', email: 'someone@example.com' }],
        tables: rows ?? { sessions: [{ user_id: OWNER }, { user_id: 'other-uid' }], active_recording_lease: [{ user_id: OWNER }], trial_entitlements: [{ user_id: OWNER }] },
        calls: [], inReservation: 0, outsideReservation: 0, deleted: [] };
    const mark = (name) => { state.calls.push(name); if (state.inReservation > 0) return; state.outsideReservation += 1; };
    const admin = {
        auth: { admin: {
            listUsers: async ({ page, perPage }) => { mark('listUsers'); if (failList) return { data: null, error: { message: 'x' } }; return { data: { users: state.users.slice((page - 1) * perPage, page * perPage) }, error: null }; },
            getUserById: async (id) => {
                mark('getUserById');
                if (failProof && state.deleted.includes(id)) return { data: null, error: { status: 500, message: 'unavailable' } };
                const u = state.users.find((x) => x.id === id);
                return u ? { data: { user: { email: u.email } }, error: null } : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } };
            },
            deleteUser: async (id) => {
                mark('deleteUser');
                if (failDelete) return { error: { message: 'x' } };
                state.users = state.users.filter((u) => u.id !== id); state.deleted.push(id);
                if (cascade) for (const t of ['sessions', 'active_recording_lease']) state.tables[t] = state.tables[t].filter((r) => r.user_id !== id);
                return { error: null };
            },
        } },
        from: (table) => ({
            delete: () => ({ eq: async (col, v) => { mark(`delete:${table}`); state.tables[table] = state.tables[table].filter((r) => r[col] !== v); return { error: null }; } }),
            select: () => ({ eq: async (col, v) => { mark(`count:${table}`); return { count: state.tables[table].filter((r) => r[col] === v).length, error: null }; } }),
        }),
    };
    return { admin, state };
}

function fakeNightly(state, reserve = 50) {
    const n = { reservations: 0 };
    n.cleanup = async (_leg, fn) => {
        if (n.reservations >= reserve) return { sent: false, reason: 'the journey cleanup reserve is exhausted' };
        n.reservations += 1; state.inReservation += 1;
        try { return { sent: true, value: await fn() }; } finally { state.inReservation -= 1; }
    };
    return n;
}

const record = (over = {}) => ({ sent: { attemptId: 'J4.a-1', leg: 'J4.a', lookupRef: REF, emailDomain: 'example.com', ...over.sent }, answered: { result: { outcome: 'created' }, ...over.answered } });
const base = (admin, nightly, over = {}) => ({ nightly, admin, createRecord: record(), runId: RUN, configuredDomain: 'example.com', confirmedAccount: REF, childClosed: { exited: true, ownedPagesClosed: true }, ...over });

test('owned account: deleted inside reservations, deletion proven, zero residue for the same owner; other accounts untouched', async () => {
    const { admin, state } = fakeAdmin();
    const nightly = fakeNightly(state);
    const r = await j4aParentTeardown(base(admin, nightly));
    assert.equal(r.hold, null);
    assert.deepEqual(r.nightlyCleanup.steps.map((s) => [s.action, s.outcome]), [['pre-delete-trial-entitlements', 'done'], ['delete', 'done'], ['prove-deleted', 'done']]);
    assert.deepEqual(r.nightlyCleanup.verification, { kind: 'zero-residue', queries: [{ kind: 'account', scope: REF, count: 0 }, { kind: 'session', scope: REF, count: 0 }, { kind: 'lease', scope: REF, count: 0 }] });
    assert.equal(state.outsideReservation, 0, 'every admin call ran inside its own cleanup reservation');
    assert.equal(nightly.reservations, state.calls.length);
    assert.deepEqual(state.users.map((u) => u.id), ['other-uid']);
    assert.deepEqual(state.tables.sessions, [{ user_id: 'other-uid' }]);
});

test('foreign account: a confirmed reference that is not the durable one, an ambiguous email, or an id that reads back another email deletes nothing', async () => {
    for (const [name, opts, over] of [
        ['child-confirmed ref differs', {}, { confirmedAccount: 'rwt-journey-j4-99-1' }],
        ['durable record for another leg', {}, { createRecord: record({ sent: { leg: 'J4.b' } }) }],
        ['domain not the configured one', {}, { configuredDomain: 'other.com' }],
        ['two accounts carry the email', { users: [{ id: OWNER, email: EMAIL }, { id: 'dup', email: EMAIL }] }, {}],
    ]) {
        const { admin, state } = fakeAdmin(opts);
        const r = await j4aParentTeardown(base(admin, fakeNightly(state), over));
        assert.ok(r.hold, name);
        assert.equal(state.calls.filter((c) => /^delete/.test(c)).length, 0, name);
        assert.equal(r.nightlyCleanup.verification, undefined, name);
    }
    // the only exact match's id re-reads to a different email (a swapped id): refused before any delete
    const { admin, state } = fakeAdmin();
    const real = admin.auth.admin.getUserById;
    admin.auth.admin.getUserById = async (id) => { const x = await real(id); return x.data?.user ? { data: { user: { email: 'foreign@example.com' } }, error: null } : x; };
    const r = await j4aParentTeardown(base(admin, fakeNightly(state)));
    assert.match(r.hold, /re-read by id/);
    assert.equal(state.calls.filter((c) => /^delete/.test(c)).length, 0);
});

test('no teardown before the child is closed, without a created answer, or when the lookup fails: HOLD, no admin call or no delete', async () => {
    for (const over of [{ childClosed: { exited: true, ownedPagesClosed: false } }, { childClosed: { exited: false, ownedPagesClosed: true } },
        { createRecord: record({ answered: { result: { outcome: 'refused' } } }) }, { createRecord: { sent: record().sent, answered: null } }, { createRecord: null }]) {
        const { admin, state } = fakeAdmin();
        const r = await j4aParentTeardown(base(admin, fakeNightly(state), over));
        assert.ok(r.hold);
        assert.equal(state.calls.length, 0);
    }
    const { admin, state } = fakeAdmin({ failList: true });
    const r = await j4aParentTeardown(base(admin, fakeNightly(state)));
    assert.match(r.hold, /lookup is unreadable/);
    assert.equal(state.calls.filter((c) => /^delete/.test(c)).length, 0);
});

test('partial cleanup: a failed delete, an unproven deletion or an exhausted reserve leaves the account listed and no verification', async () => {
    for (const [name, opts, reserve, why] of [
        ['delete fails', { failDelete: true }, 50, /delete failed/],
        ['proof re-read is not a not-found', { failProof: true }, 50, /not proven/],
        ['reserve exhausted mid-teardown', {}, 3, /pre-delete failed|delete failed|not proven/],
    ]) {
        const { admin, state } = fakeAdmin(opts);
        const r = await j4aParentTeardown(base(admin, fakeNightly(state, reserve)));
        assert.match(r.hold, why, name);
        assert.deepEqual(r.nightlyCleanup.left, [{ kind: 'account', ref: REF }], name);
        assert.equal(r.nightlyCleanup.verification, undefined, name);
        assert.ok(r.nightlyCleanup.steps.some((s) => s.outcome === 'failed'), name);
        assert.equal(state.outsideReservation, 0, name);
    }
});

test('residue left behind is reported as observed, never as zero; an unreadable count is not observed', async () => {
    const { admin, state } = fakeAdmin({ cascade: false });
    const r = await j4aParentTeardown(base(admin, fakeNightly(state)));
    assert.equal(r.hold, null);
    assert.deepEqual(r.nightlyCleanup.verification.queries.map((q) => [q.kind, q.count]), [['account', 0], ['session', 1], ['lease', 1]]);
    const b = fakeAdmin();
    const n = fakeNightly(b.state, 7); // enough to delete and prove, not to read every residue kind
    const r2 = await j4aParentTeardown(base(b.admin, n));
    assert.ok(r2.nightlyCleanup.verification.queries.some((q) => q.count === null));
});
