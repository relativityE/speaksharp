"use strict";
// Nightly AHT suite: the exact-email lookup is complete before it may say `zero` (Sam, 16 Nov). Offline, injected listings.
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const { enumerateUsers, exactEmailLookup } = require('../account-lookup.cjs');

const PREFIX = 'rwt-journey-';
const EMAIL = 'rwt-journey-j8-7001-1@example.com';
const user = (i, over = {}) => ({ id: `id-${i}`, email: `someone-${i}@example.com`, ...over });
/** A listing of `n` users in pages of `perPage`; `total` is reported only when `withTotal`, like auth-js with a Link header. */
function listing(all, { perPage = 3, withTotal = true, failOn = null, totalOverride = null } = {}) {
    const calls = [];
    const listUsers = async ({ page, perPage: pp }) => {
        calls.push(page);
        if (page === failOn) return { data: { users: [] }, error: { message: 'boom' } };
        const users = all.slice((page - 1) * pp, page * pp);
        return { data: { users, ...(withTotal ? { total: totalOverride ?? all.length } : {}) }, error: null };
    };
    return { listUsers, calls, perPage };
}
const lookup = async (all, opts = {}) => {
    const l = listing(all, opts);
    return exactEmailLookup(await enumerateUsers(l.listUsers, { perPage: l.perPage, maxPages: opts.maxPages ?? 50 }), { email: EMAIL, runOwnedPrefix: PREFIX });
};

describe('a complete listing', () => {
    it('finds the one run-owned account, case-insensitively, across pages', async () => {
        const all = [user(1), user(2), user(3), user(4), user(5, { email: EMAIL.toUpperCase(), id: 'acct-1' })];
        expect(await lookup(all)).toMatchObject({ lookup: 'one', uid: 'acct-1' });
    });
    it('says zero only when the listing ended on a short page and the total agrees', async () => {
        expect((await lookup([user(1), user(2), user(3), user(4)])).lookup).toBe('zero');
        expect((await lookup([user(1), user(2)], { withTotal: false })).lookup).toBe('zero');
    });
    it('ambiguous and non-run-owned matches are never "one"', async () => {
        expect((await lookup([user(1, { email: EMAIL }), user(2, { email: EMAIL })])).lookup).toBe('ambiguous');
        expect((await exactEmailLookup({ complete: true, users: [user(1, { email: 'other-j8@example.com' })] }, { email: 'other-j8@example.com', runOwnedPrefix: PREFIX })).lookup).toBe('not_run_owned');
    });
});

describe('CONTROLS: an incomplete listing is unreadable, never zero', () => {
    it('truncated enumeration: the page cap is reached on a full page, even with the account just past the cap', async () => {
        const all = [...Array.from({ length: 6 }, (_, i) => user(i)), user(99, { email: EMAIL, id: 'acct-late' })];
        const out = await lookup(all, { maxPages: 2 });
        expect(out.lookup).toBe('unreadable');
        expect(out.reason).toContain('truncated');
    });
    it('a reported total that disagrees with what was read', async () => {
        const out = await lookup([user(1), user(2)], { totalOverride: 9 });
        expect(out.lookup).toBe('unreadable');
        expect(out.reason).toContain('disagrees');
    });
    it('a listing error, a throw or a malformed page', async () => {
        expect((await lookup([user(1), user(2), user(3), user(4)], { failOn: 2 })).lookup).toBe('unreadable');
        const thrower = async () => { throw new Error('network'); };
        expect(exactEmailLookup(await enumerateUsers(thrower), { email: EMAIL, runOwnedPrefix: PREFIX }).lookup).toBe('unreadable');
        const malformed = async () => ({ data: { users: 'nope' }, error: null });
        expect(exactEmailLookup(await enumerateUsers(malformed), { email: EMAIL, runOwnedPrefix: PREFIX }).lookup).toBe('unreadable');
    });
    it('a matching row without an id is unreadable, not zero', async () => {
        for (const id of [undefined, null, '']) {
            const out = await lookup([user(1), user(2, { email: EMAIL, id })]);
            expect(out.lookup).toBe('unreadable');
            expect(out.reason).toContain('no id');
        }
    });
    it('a missing or malformed email or prefix is unreadable', () => {
        for (const args of [{ email: 'not-an-email', runOwnedPrefix: PREFIX }, { email: EMAIL, runOwnedPrefix: '' }])
            expect(exactEmailLookup({ complete: true, users: [] }, args).lookup).toBe('unreadable');
    });
});

describe('zero after a lost reply', () => {
    it('a complete zero is still only "zero": it names absence, it does not clear an unanswered create (that stays HOLD)', async () => {
        const out = await lookup([user(1), user(2)]);
        expect(out.lookup).toBe('zero');
        expect(out.uid).toBe(undefined);
        // The runner's reservation resolver (#1875 account-reservation.cjs) keeps `zero` unresolved: absence proves nothing,
        // the one create may still land. This module never returns anything that could be read as "cleared".
        expect(['one', 'zero', 'ambiguous', 'not_run_owned', 'unreadable']).toContain(out.lookup);
    });
});
