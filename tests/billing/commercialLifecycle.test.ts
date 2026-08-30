import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    assertDbTrialWithoutStripe, assertTrialExpired, assertCheckoutHasNoStripeTrial,
    assertFirstPaidInvoice, assertTestObjectsCleaned, assertAllCommercialPhasesProven, COMMERCIAL_PHASES,
  isProofOfAbsence,
} from '../../scripts/billing-qualification/commercialLifecycle';

/** Every assertion must ABORT on its own named cause — a generic throw proves nothing about which. */
const trial = (over: Record<string, unknown> = {}) => ({
    trialStartedAt: '2026-08-01T00:00:00Z', trialEndsAt: '2026-08-31T00:00:00Z',
    stripeCustomerId: null, stripeSubscriptionId: null, entitlement: 'trial', ...over,
} as Parameters<typeof assertDbTrialWithoutStripe>[0]);

const sub = (over: Record<string, unknown> = {}) => ({
    livemode: false, status: 'active', trial_end: null, trial_start: null,
    items: { data: [{ price: { unit_amount: 1000, currency: 'usd', recurring: { interval: 'month' } } }] },
    ...over,
});

const invoice = (over: Record<string, unknown> = {}) => ({
    livemode: false, amount_paid: 1000, currency: 'usd', status: 'paid', billing_reason: 'subscription_create', ...over,
});

describe('#1302 — the DB trial has no Stripe in it', () => {
    it('POSITIVE CONTROL: a card-free 30-day DB trial passes', () => {
        expect(() => assertDbTrialWithoutStripe(trial())).not.toThrow();
    });

    it.each([
        ['a Stripe CUSTOMER exists', { stripeCustomerId: 'cus_test_1' }, /Stripe CUSTOMER exists/],
        ['a Stripe SUBSCRIPTION exists', { stripeSubscriptionId: 'sub_test_1' }, /Stripe SUBSCRIPTION exists/],
        ['no trial window at all', { trialEndsAt: null }, /no DB-backed trial window/],
        ['the window is not 30 days', { trialEndsAt: '2026-08-08T00:00:00Z' }, /not 30/],
        ['entitlement is already pro', { entitlement: 'pro' }, /not 'trial'/],
    ])('ABORTS when %s', (_l, over, pattern) => {
        expect(() => assertDbTrialWithoutStripe(trial(over))).toThrow(pattern);
    });
});

describe('#1302 — the trial actually ends', () => {
    it('POSITIVE CONTROL: expired window with dropped entitlement passes', () => {
        expect(() => assertTrialExpired({
            trialEndsAt: '2026-08-31T00:00:00Z', now: '2026-09-01T00:00:00Z', entitlement: 'free',
        })).not.toThrow();
    });

    it('ABORTS when entitlement is still pro after expiry', () => {
        expect(() => assertTrialExpired({
            trialEndsAt: '2026-08-31T00:00:00Z', now: '2026-09-01T00:00:00Z', entitlement: 'pro',
        })).toThrow(/still pro/);
    });

    it('ABORTS when entitlement is still trial after expiry — a trial that never ends is not a trial', () => {
        expect(() => assertTrialExpired({
            trialEndsAt: '2026-08-31T00:00:00Z', now: '2026-09-01T00:00:00Z', entitlement: 'trial',
        })).toThrow(/still trial/);
    });

    it('ABORTS when expiry is claimed BEFORE the window elapsed', () => {
        expect(() => assertTrialExpired({
            trialEndsAt: '2026-08-31T00:00:00Z', now: '2026-08-15T00:00:00Z', entitlement: 'free',
        })).toThrow(/before the trial window had elapsed/);
    });
});

describe('#1302 — Checkout grants no SECOND free period', () => {
    it('POSITIVE CONTROL: an immediately active $10/month subscription passes', () => {
        expect(() => assertCheckoutHasNoStripeTrial(sub())).not.toThrow();
    });

    it.each([
        ['a trial_end is present', { trial_end: 1_800_000_000 }, /trial_end/],
        ['a trial_start is present', { trial_start: 1_800_000_000 }, /trial_start/],
        ['the status is trialing', { status: 'trialing' }, /not immediately active/],
        ['it is a LIVE object', { livemode: true }, /LIVE object/],
        ['the amount is not $10', { items: { data: [{ price: { unit_amount: 500, currency: 'usd', recurring: { interval: 'month' } } }] } }, /not 1000/],
        ['the currency is not usd', { items: { data: [{ price: { unit_amount: 1000, currency: 'eur', recurring: { interval: 'month' } } }] } }, /not usd/],
        ['it is not monthly', { items: { data: [{ price: { unit_amount: 1000, currency: 'usd', recurring: { interval: 'year' } } }] } }, /not billed monthly/],
    ])('ABORTS when %s', (_l, over, pattern) => {
        expect(() => assertCheckoutHasNoStripeTrial(sub(over))).toThrow(pattern);
    });
});

describe('#1302 — the first invoice is a real initial charge', () => {
    it('POSITIVE CONTROL', () => { expect(() => assertFirstPaidInvoice(invoice())).not.toThrow(); });

    it.each([
        ['unpaid', { status: 'open' }, /not paid/],
        ['wrong amount', { amount_paid: 0 }, /not 1000/],
        ['wrong currency', { currency: 'gbp' }, /not usd/],
        ['a LIVE object', { livemode: true }, /LIVE object/],
        ['actually a renewal', { billing_reason: 'subscription_cycle' }, /RENEWAL, not the initial charge/],
    ])('ABORTS when the first invoice is %s', (_l, over, pattern) => {
        expect(() => assertFirstPaidInvoice(invoice(over))).toThrow(pattern);
    });
});

describe('#1302 — cleanup is unambiguous', () => {
    it('POSITIVE CONTROL: every created object confirmed deleted', () => {
        expect(() => assertTestObjectsCleaned({
            created: ['cus_1', 'sub_1'], confirmedDeleted: ['cus_1', 'sub_1'],
        })).not.toThrow();
    });

    it('ABORTS on a leftover — "no error" is not proof of deletion', () => {
        expect(() => assertTestObjectsCleaned({
            created: ['cus_1', 'sub_1'], confirmedDeleted: ['cus_1'],
        })).toThrow(/not confirmed deleted: sub_1/);
    });

    it('ABORTS when cleanup deleted something this run did not create', () => {
        // Deleting an object of unknown provenance in a shared test account is its own incident.
        expect(() => assertTestObjectsCleaned({
            created: ['cus_1'], confirmedDeleted: ['cus_1', 'cus_someone_else'],
        })).toThrow(/did not create: cus_someone_else/);
    });

    it('ABORTS when cleanup is claimed but nothing was ever created', () => {
        expect(() => assertTestObjectsCleaned({ created: [], confirmedDeleted: [] })).toThrow(/recorded creating nothing/);
    });
});

describe('#1302 — no phase may be skipped', () => {
    it('POSITIVE CONTROL: all phases proven passes', () => {
        const all = Object.fromEntries(COMMERCIAL_PHASES.map((p) => [p, true]));
        expect(() => assertAllCommercialPhasesProven(all)).not.toThrow();
    });

    it.each(COMMERCIAL_PHASES)('ABORTS when %s is unproven', (phase) => {
        const all = Object.fromEntries(COMMERCIAL_PHASES.map((p) => [p, true]));
        delete (all as Record<string, boolean>)[phase];
        expect(() => assertAllCommercialPhasesProven(all)).toThrow(new RegExp(phase));
    });
});

describe('#1302 — additive: the existing weekly lane is untouched', () => {
    it('does NOT extend the runner REQUIRED_PHASES', () => {
        // Extending them would make assertAllPhasesProven demand phases the existing runner never proves,
        // and the weekly billing-qualification lane would start failing on unauthorized work.
        //
        // Read as SOURCE rather than imported: the runner pulls a Deno-style `npm:` specifier through its
        // PGlite helper, which this project's resolver cannot load. Importing it to prove a property about
        // a literal would couple this guard to an unrelated runtime concern.
        const src = readFileSync(resolve(__dirname, '../../scripts/billing-qualification/runner.ts'), 'utf8');
        const required = src.slice(src.indexOf('REQUIRED_PHASES'), src.indexOf(']', src.indexOf('REQUIRED_PHASES')));
        expect(required).toContain('checkout');
        for (const p of COMMERCIAL_PHASES) expect(required).not.toContain(p);
    });
});

describe('#1302 — cleanup may only accept a DEFINITE absence as proof of deletion', () => {
    // `catch { gone = true }` treated EVERY retrieval failure as proof of deletion. An expired key, a 429
    // or a DNS blip says nothing about whether the object still exists — the run would have reported
    // clean cleanup while leaking a Test Clock, its customer and its subscription into a shared account.
    it.each([
        ['a 404 status', { statusCode: 404 }],
        ['code resource_missing', { code: 'resource_missing' }],
        ['a Stripe "No such test clock" invalid-request error', {
            type: 'StripeInvalidRequestError', message: 'No such test clock: tc_123',
        }],
    ])('ACCEPTS %s as proof the object is gone', (_l, err) => {
        expect(isProofOfAbsence(err)).toBe(true);
    });

    it.each([
        ['an authentication failure', { statusCode: 401, type: 'StripeAuthenticationError', message: 'Invalid API Key' }],
        ['a rate limit', { statusCode: 429, type: 'StripeRateLimitError', message: 'Too many requests' }],
        ['a generic network failure', { type: 'StripeConnectionError', message: 'ECONNRESET' }],
        ['a server error', { statusCode: 500, message: 'internal error' }],
        ['a bare Error', new Error('something went wrong')],
        ['a non-object', 'boom'],
        ['nothing at all', undefined],
    ])('REJECTS %s — an inability to look is not proof of absence', (_l, err) => {
        expect(isProofOfAbsence(err)).toBe(false);
    });

    it('the runner uses the predicate rather than a bare catch', () => {
        const src = readFileSync(resolve(__dirname, '../../scripts/billing-qualification/commercialRunner.ts'), 'utf8');
        expect(src).toContain('isProofOfAbsence(e)');
        expect(src).toContain('deletion could not be PROVEN');
        // The original bug, in one line. It must not come back.
        expect(src).not.toContain('catch { gone = true; }');
    });
});

describe('#1302 — an expected-success webhook must REQUIRE HTTP success', () => {
    // Every one of these events leaves the stored tier equal to what we expect, so a handler answering
    // HTTP 500 would have passed every tier assertion while processing nothing.
    const src = readFileSync(resolve(__dirname, '../../scripts/billing-qualification/commercialRunner.ts'), 'utf8');

    it('send() throws on any non-2xx, not merely records it', () => {
        const block = src.slice(src.indexOf('const send = async ('), src.indexOf('return { status, tier };'));
        expect(block).toContain('status < 200 || status >= 300');
        expect(block).toContain('an unchanged tier does not make that a success');
    });

    it('every expected-success phase goes through send(), so each inherits the status requirement', () => {
        for (const note of [
            'first paid binding', 'DUPLICATE of the binding event', 'renewal',
            'OUT-OF-ORDER (older than the last applied)', 'payment failure', 'recovery',
            'cancel_at_period_end', 'terminal revocation',
        ]) {
            const call = src.includes(`"${note}"`);
            expect(call, `${note} is not delivered through send()`).toBe(true);
        }
    });

    it('the FORGED-signature casualty deliberately does NOT go through send()', () => {
        // It must be rejected, so requiring HTTP success there would be backwards.
        expect(src).toContain('{ forgeSignature: true }');
        expect(src).toContain('a FORGED webhook signature was accepted');
    });
});
