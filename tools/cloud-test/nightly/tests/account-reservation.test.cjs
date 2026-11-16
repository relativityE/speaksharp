"use strict";
// Nightly AHT suite: a lost create reply never leads to a second account (Sam, 16 Nov). One email and ONE create per
// journey reservation; an unanswered create is resolved only by finding the account, never by its absence or a timer.
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const { AccountReservations, reservationEmail, resolveUnansweredCreate } = require('../account-reservation.cjs');

const PREFIX = 'rwt-journey-';
const EMAIL = reservationEmail({ prefix: PREFIX, journey: 'J8', runId: '4321', runAttempt: '1', domain: 'example.com' });

/** An auth server with one account per email AND deletion: a create that arrives after a delete makes a new account. */
function fakeAuth() {
    const accounts = new Map();
    return {
        create(email) {
            const key = email.toLowerCase();
            if (accounts.has(key)) return 'exists';
            accounts.set(key, true);
            return 'created';
        },
        delete(email) { accounts.delete(email.toLowerCase()); },
        lookup(email) { return accounts.has(email.toLowerCase()) ? 'one' : 'zero'; },
        count(email) { return accounts.has(email.toLowerCase()) ? 1 : 0; },
    };
}

describe('the reservation email', () => {
    it('is one stable, lower-case run-owned address per journey, run and attempt', () => {
        expect(EMAIL).toBe('rwt-journey-j8-4321-1@example.com');
        expect(reservationEmail({ prefix: PREFIX, journey: 'J1', runId: '4321', runAttempt: '1', domain: 'Example.COM' })).toBe('rwt-journey-j1-4321-1@example.com');
    });
    it('refuses a missing part, a non-numeric run, or an address that is not plain', () => {
        for (const bad of [{ runId: '' }, { runId: 'x1' }, { runAttempt: '1a' }, { domain: 'nodot' }, { journey: 'J8 ' }, { prefix: 'Bad Prefix ' }])
            expect(() => reservationEmail({ prefix: PREFIX, journey: 'J8', runId: '4321', runAttempt: '1', domain: 'example.com', ...bad })).toThrow();
    });
});

describe('one email and one create per journey reservation', () => {
    it('admits the first create and fixes its email', () => {
        const r = new AccountReservations();
        expect(r.admitCreate('J8', EMAIL.toUpperCase())).toMatchObject({ admitted: true, email: EMAIL });
        expect(r.emailOf('J8')).toBe(EMAIL);
        expect(r.createsSent('J8')).toBe(1);
    });
    it('CONTROL: refuses a create under a second email, so a lost reply is never "solved" by a fresh address', () => {
        const r = new AccountReservations();
        r.admitCreate('J8', EMAIL);
        const second = r.admitCreate('J8', 'rwt-journey-j8-4321-1-retry@example.com');
        expect(second.admitted).toBe(false);
        expect(second.reason).toContain('second account');
        expect(r.admitCreate('J8', '').admitted).toBe(false);
    });
    it('CONTROL: refuses a retry under the SAME email, which could land after the first account is deleted', () => {
        const r = new AccountReservations();
        r.admitCreate('J8', EMAIL);
        const retry = r.admitCreate('J8', EMAIL);
        expect(retry.admitted).toBe(false);
        expect(retry.reason).toContain('after that account is deleted');
        expect(r.createsSent('J8')).toBe(1);
    });
    it('keeps journeys apart: J1 and J8 each reserve their own email and one create', () => {
        const r = new AccountReservations();
        expect(r.admitCreate('J8', EMAIL).admitted).toBe(true);
        expect(r.admitCreate('J1', 'rwt-journey-j1-4321-1@example.com').admitted).toBe(true);
    });
});

describe('a create whose reply never arrives', () => {
    it('the one create landed: found, it is the reservation\'s account; after its deletion nothing else can land', () => {
        const auth = fakeAuth();
        const r = new AccountReservations();
        r.admitCreate('J8', EMAIL);
        auth.create(EMAIL); // landed, but its reply was lost
        expect(resolveUnansweredCreate({ lookup: auth.lookup(EMAIL), createsSent: r.createsSent('J8') })).toMatchObject({ state: 'resolved', how: 'landed' });
        auth.delete(EMAIL);
        // No other create was ever admitted, so no late create exists to land.
        expect(r.admitCreate('J8', EMAIL).admitted).toBe(false);
        expect(auth.count(EMAIL)).toBe(0);
    });
    it('CONTROL: nothing found yet is HOLD, never resolved: the create may still land', () => {
        const auth = fakeAuth();
        const step = resolveUnansweredCreate({ lookup: auth.lookup(EMAIL), createsSent: 1 });
        expect(step.state).toBe('unresolved');
        expect(step.reason).toContain('absence proves nothing');
        // When it does land, the next lookup resolves it.
        auth.create(EMAIL);
        expect(resolveUnansweredCreate({ lookup: auth.lookup(EMAIL), createsSent: 1 }).state).toBe('resolved');
    });
    it('CONTROL (late-after-delete): with a second create in flight, a found-and-deleted account is followed by a NEW one', () => {
        // Why one create per reservation: the one-account-per-email rule does not cover a create that lands after a delete.
        const auth = fakeAuth();
        auth.create(EMAIL); // the first create landed
        auth.delete(EMAIL); // found and deleted
        expect(auth.create(EMAIL)).toBe('created'); // a retry, still in flight, lands late
        expect(auth.count(EMAIL)).toBe(1); // an account exists after "cleanup"
        // The resolver refuses to call a two-create reservation resolved, whatever the lookup finds.
        for (const lookup of ['one', 'zero'])
            expect(resolveUnansweredCreate({ lookup, createsSent: 2 }).state).toBe('unresolved');
    });
    it('never resolves on an unreadable, ambiguous or foreign lookup, an unknown outcome, or an unknown create count', () => {
        for (const lookup of ['unreadable', 'ambiguous', 'not_run_owned', 'maybe', undefined])
            expect(resolveUnansweredCreate({ lookup, createsSent: 1 }).state).toBe('unresolved');
        for (const createsSent of [0, 2, undefined, Number.NaN, 1.5])
            expect(resolveUnansweredCreate({ lookup: 'one', createsSent }).state).toBe('unresolved');
    });
});
