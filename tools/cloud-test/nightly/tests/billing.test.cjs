"use strict";
// Nightly AHT suite, J9.a: bounded portal check, the portal address never leaves the check, test mode only,
// billing rows reconciled rather than promised away.
const { describe, expect, fn, it } = require('./expect-lite.cjs');
const { portalOpensVerdict, reconcileBillingRows, redactPortalUrls } = require('../oracles/billing-portal.cjs');
const { FixtureNotBuilt, LiveModeRefused, assertTestModeFixture, loadPaidAccountFixture } = require('../oracles/paid-account-fixture.cjs');
const TEST_URL = 'https://billing.stripe.com/p/session/test_YWNjdF8xUXlTZWNyZXQ';
const LIVE_URL = 'https://billing.stripe.com/p/session/live_YWNjdF8xUXlTZWNyZXQ';
function ports(o = {}) {
    const lines = [];
    const opened = [];
    const p = {
        createSession: o.create ?? (async () => ({ url: o.url ?? TEST_URL })),
        openAndConfirm: o.open ?? (async (u) => { opened.push(u); return { portalShown: o.shown ?? true }; }),
        log: (l) => lines.push(l),
    };
    return { p, lines, opened };
}
const leaks = (lines, v) => [...lines, JSON.stringify(v)].some((l) => l.includes('billing.stripe.com/p/session/'));
describe('billing portal check', () => {
    it('passes when the test-mode portal opens, and the address appears in no log line or verdict', async () => {
        const { p, lines, opened } = ports();
        const v = await portalOpensVerdict(p);
        expect(v.outcome).toBe('PASS');
        expect(opened).toEqual([TEST_URL]);
        expect(leaks(lines, v)).toBe(false);
    });
    it('refuses to open a portal address that is not a test-mode session', async () => {
        const { p, opened, lines } = ports({ url: LIVE_URL });
        const v = await portalOpensVerdict(p);
        expect(v.outcome).toBe('FAIL');
        expect(opened).toEqual([]);
        expect(leaks(lines, v)).toBe(false);
    });
    it('keeps the address out of the log when an error message carries it', async () => {
        const { p, lines } = ports({ open: async (u) => { throw new Error(`navigation to ${u} failed`); } });
        const v = await portalOpensVerdict(p);
        expect(v.outcome).toBe('FAIL');
        expect(leaks(lines, v)).toBe(false);
    });
    it('is bounded: one attempt, failed on timeout', async () => {
        const create = fn(() => new Promise(() => undefined));
        const { p } = ports({ create });
        // Real timers with a short bound: the leg gives up after the bound, with one attempt and no retry.
        await expect(portalOpensVerdict(p, 20)).resolves.toMatchObject({ outcome: 'FAIL' });
        expect(create).toHaveBeenCalledTimes(1);
    });
    it('fails when the portal page is not shown', async () => {
        expect((await portalOpensVerdict(ports({ shown: false }).p)).outcome).toBe('FAIL');
    });
    it('redacts every portal address in a text', () => {
        expect(redactPortalUrls(`a ${TEST_URL}?x=1 b ${LIVE_URL}`)).toBe('a [billing-portal-url] b [billing-portal-url]');
    });
});
describe('billing cleanup reconciliation (no promise of zero rows)', () => {
    it('reports rows retained by design as PASS', () => {
        const r = reconcileBillingRows([{ table: 'stripe_customers', count: 1, otherAccountRows: 0 }, { table: 'checkout_operations', count: 0, otherAccountRows: 0 }], ['stripe_customers']);
        expect(r).toMatchObject({ outcome: 'PASS', retained: ['stripe_customers=1'] });
    });
    it('fails when another account\'s rows were touched, and holds rows in an unreviewed table', () => {
        expect(reconcileBillingRows([{ table: 'stripe_customers', count: 1, otherAccountRows: 1 }], ['stripe_customers']).outcome).toBe('FAIL');
        expect(reconcileBillingRows([{ table: 'new_table', count: 2, otherAccountRows: 0 }], ['stripe_customers']).outcome).toBe('HOLD');
    });
});
describe('J9.a paid account fixture: Stripe test mode only', () => {
    const f = { accountEmail: 'rwt-journey-paid@example.test', stripeMode: 'test', customerId: 'cus_1', subscriptionId: 'sub_1', recordedOnRelease: 'a'.repeat(40) };
    const cus = { id: 'cus_1', livemode: false };
    const sub = { id: 'sub_1', livemode: false };
    it('accepts a test-mode key, customer and subscription', () => {
        expect(() => assertTestModeFixture(f, 'sk_test_x', cus, sub)).not.toThrow();
        expect(() => assertTestModeFixture(f, 'rk_test_x', cus, sub)).not.toThrow();
    });
    it('refuses a live key, a live object, a missing key, other objects or no named release', () => {
        expect(() => assertTestModeFixture(f, 'sk_live_x', cus, sub)).toThrow(LiveModeRefused);
        expect(() => assertTestModeFixture(f, undefined, cus, sub)).toThrow(LiveModeRefused);
        expect(() => assertTestModeFixture(f, 'sk_test_x', { ...cus, livemode: true }, sub)).toThrow(LiveModeRefused);
        expect(() => assertTestModeFixture(f, 'sk_test_x', cus, { ...sub, livemode: true })).toThrow(LiveModeRefused);
        expect(() => assertTestModeFixture(f, 'sk_test_x', { id: 'cus_2', livemode: false }, sub)).toThrow(LiveModeRefused);
        expect(() => assertTestModeFixture({ ...f, recordedOnRelease: 'main' }, 'sk_test_x', cus, sub)).toThrow(LiveModeRefused);
    });
    it('is not built yet, and says so instead of returning an account', () => {
        expect(() => loadPaidAccountFixture()).toThrow(FixtureNotBuilt);
    });
});
