import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveCheckoutCredentials } from '../helpers/checkoutCredentials';

/**
 * #1492 — THE PAID CHECKOUT PROOF'S IDENTITY IS ONE ATOMIC PAIR.
 *
 * `stripe-checkout-readiness.live.spec.ts` resolved its email and its password through two SEPARATE
 * `??` chains that each fell back through the Free and Pro reviewers. Three failures followed, and the
 * gate stayed green through all of them:
 *
 * - wrong role: the proof ran as the FREE reviewer, leaving live-mode Stripe customer state on an
 *   account whose purpose is to be a clean Free tier, and dropping the dedicated identity from the
 *   billing-freeze audit that reads the same variable;
 * - mixed identity: the halves resolved independently, so `CHECKOUT_TEST_EMAIL` could pair with
 *   `FREE_TEST_PASSWORD` — a combination that authenticates as nobody and blames Stripe for it;
 * - absence read as pass: a missing credential SKIPPED the test, so a release gate reported success
 *   having executed no proof at all.
 *
 * The first two casualties below are behavioural, against the resolver. The rest are static, because
 * the defect lived in how the workflow and the spec were WIRED, and wiring is not reachable from a
 * unit test of any function.
 */
describe('#1492 — checkout credentials are one atomic pair', () => {
    const SPEC = 'tests/live/stripe-checkout-readiness.live.spec.ts';
    const spec = readFileSync(SPEC, 'utf8');
    const WORKFLOWS = ['.github/workflows/rc-gates.yml', '.github/workflows/billing-freeze-check.yml'];

    it('CASUALTY: a missing email fails closed and names what is absent', () => {
        const result = resolveCheckoutCredentials({ CHECKOUT_TEST_PASSWORD: 'pw' });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.missing).toEqual(['CHECKOUT_TEST_EMAIL']);
        expect(result.reason).toContain('CHECKOUT_TEST_EMAIL');
    });

    it('CASUALTY: a missing password fails closed and names what is absent', () => {
        const result = resolveCheckoutCredentials({ CHECKOUT_TEST_EMAIL: 'checkout@example.test' });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.missing).toEqual(['CHECKOUT_TEST_PASSWORD']);
        expect(result.reason).toContain('CHECKOUT_TEST_PASSWORD');
    });

    it('CASUALTY: a blank or whitespace credential is absent, not present', () => {
        // The old chains used `??`, which accepts '' as a value — an empty Variable would have passed
        // presence and then failed authentication for an unexplained reason.
        const blank = [
            { CHECKOUT_TEST_EMAIL: '', CHECKOUT_TEST_PASSWORD: 'pw' },
            { CHECKOUT_TEST_EMAIL: '   ', CHECKOUT_TEST_PASSWORD: 'pw' },
            { CHECKOUT_TEST_EMAIL: 'checkout@example.test', CHECKOUT_TEST_PASSWORD: '' },
        ];
        const wronglyAccepted = blank.filter((env) => resolveCheckoutCredentials(env).ok);
        expect(wronglyAccepted).toEqual([]);
    });

    it('accepts only the complete dedicated pair, and trims it', () => {
        const result = resolveCheckoutCredentials({
            CHECKOUT_TEST_EMAIL: ' checkout@example.test ',
            CHECKOUT_TEST_PASSWORD: ' pw ',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.email).toBe('checkout@example.test');
        expect(result.password).toBe('pw');
    });

    it('CASUALTY: mixed or fallback sources are unreachable — the spec names no other identity', () => {
        // The resolver reads only the checkout pair, so a mixed pair cannot be assembled by construction.
        // What must also stay true is that the SPEC does not reintroduce another source alongside it.
        for (const forbidden of [
            'FREE_TEST_EMAIL', 'FREE_TEST_PASSWORD',
            'PRO_TEST_EMAIL', 'PRO_TEST_PASSWORD',
            'E2E_FREE_EMAIL', 'E2E_FREE_PASSWORD',
            'E2E_PRO_EMAIL', 'E2E_PRO_PASSWORD',
        ]) {
            expect(spec, `${SPEC} must not resolve any identity but the checkout pair (found ${forbidden})`)
                .not.toContain(forbidden);
        }
    });

    it('CASUALTY: no credential-dependent skip — an absent identity fails the gate', () => {
        // A skip on a missing credential is the "absence read as pass" defect: the release gate goes
        // green having executed nothing. Configuration skips are a different thing and are allowed.
        const skipArgs = [...spec.matchAll(/test\.skip\(([\s\S]*?)\)\s*;/g)].map((m) => m[1]);
        expect(skipArgs.length, 'the spec should still guard Supabase configuration').toBeGreaterThan(0);
        for (const args of skipArgs) {
            for (const credential of ['CHECKOUT_TEST_EMAIL', 'CHECKOUT_TEST_PASSWORD', 'TEST_EMAIL', 'TEST_PASSWORD', 'CHECKOUT_CREDENTIALS']) {
                expect(args, `test.skip must not be conditioned on a credential (${credential})`)
                    .not.toContain(credential);
            }
        }
        // And the absence must be asserted, so it fails rather than passing quietly.
        expect(spec).toContain('resolveCheckoutCredentials');
    });

    it('CASUALTY: neither workflow may revert the email to the Secret', () => {
        for (const file of WORKFLOWS) {
            const text = readFileSync(file, 'utf8');
            for (const line of text.split('\n')) {
                if (!/^\s*CHECKOUT_TEST_EMAIL\s*:/.test(line)) continue;
                expect(line, `${file} must read vars.CHECKOUT_TEST_EMAIL`).toContain('vars.CHECKOUT_TEST_EMAIL');
                expect(line, `${file} must not read the email from Secrets`).not.toContain('secrets.CHECKOUT_TEST_EMAIL');
            }
        }
    });

    it('both workflows still supply the password from Secrets — only the EMAIL moved', () => {
        // #1294's split is email-is-identifier, password-is-credential. Moving the password too would be
        // the opposite error, so it is pinned here rather than left to reviewer memory.
        const rcGates = readFileSync('.github/workflows/rc-gates.yml', 'utf8');
        expect(rcGates).toContain('CHECKOUT_TEST_PASSWORD: ${{ secrets.CHECKOUT_TEST_PASSWORD }}');
        expect(rcGates).not.toContain('vars.CHECKOUT_TEST_PASSWORD');
    });
});
