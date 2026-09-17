import { readdirSync, readFileSync } from 'node:fs';
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

    it('accepts only the complete dedicated pair, and trims the email only', () => {
        const result = resolveCheckoutCredentials({
            CHECKOUT_TEST_EMAIL: ' checkout@example.test ',
            CHECKOUT_TEST_PASSWORD: 'pw',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // The email is an identifier; surrounding whitespace is configuration noise.
        expect(result.email).toBe('checkout@example.test');
        expect(result.password).toBe('pw');
    });

    /**
     * #1492 PO cherry-pick — THE PASSWORD IS RETURNED EXACTLY AS CONFIGURED.
     *
     * The previous head trimmed the password on the way out, and the test above used to ASSERT that
     * trimming (`' pw '` became `'pw'`), so the suite pinned the defect instead of catching it. A password
     * may legitimately begin or end with whitespace; trimming it authenticates with a different string than
     * the account holds. Trimming is still how absence is detected — it just never reaches the credential.
     */
    it('CASUALTY: leading whitespace in the password is preserved', () => {
        const result = resolveCheckoutCredentials({ CHECKOUT_TEST_EMAIL: 'c@example.test', CHECKOUT_TEST_PASSWORD: '  lead' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.password).toBe('  lead');
    });

    it('CASUALTY: trailing whitespace in the password is preserved', () => {
        const result = resolveCheckoutCredentials({ CHECKOUT_TEST_EMAIL: 'c@example.test', CHECKOUT_TEST_PASSWORD: 'trail\t ' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.password).toBe('trail\t ');
    });

    it('CASUALTY: an all-whitespace password is rejected as absent', () => {
        for (const blank of [' ', '   ', '\t', ' \n\t ']) {
            const result = resolveCheckoutCredentials({ CHECKOUT_TEST_EMAIL: 'c@example.test', CHECKOUT_TEST_PASSWORD: blank });
            expect(result.ok).toBe(false);
            if (result.ok) continue;
            expect(result.missing).toEqual(['CHECKOUT_TEST_PASSWORD']);
        }
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

    /**
     * #1492 Codex P1 on `70b3a32d` — EVERY STEP THAT CAN LAUNCH THE SPEC MUST SUPPLY THE PAIR.
     *
     * Making the spec atomic was necessary and not sufficient. `live-release-matrix.yml` still passed only
     * the PRO reviewer to its dedicated checkout job, and the `rc-gates.yml` diagnostic single-spec step
     * passed no checkout pair at all. The spec now ignores those names, so both entry points would fail
     * closed before authenticating — the proof could not run from either.
     *
     * The step list is DISCOVERED, not hand-maintained: a step launches the spec when its (comment-stripped)
     * text names the spec file, the paid Gate 3 scripts that run it, or the diagnostic spec variable. A
     * future launcher is therefore held to the same rule without anyone remembering to add it here.
     */
    const LAUNCHES_CHECKOUT = /stripe-checkout-readiness\.live\.spec\.ts|rc:gate:3:dast:paid|rc:dast:live:paid|\$DIAGNOSTIC_DAST_SPEC/;
    const EXACT_EMAIL = /^\s*CHECKOUT_TEST_EMAIL:\s*\$\{\{\s*vars\.CHECKOUT_TEST_EMAIL\s*\}\}\s*$/m;
    const EXACT_PASSWORD = /^\s*CHECKOUT_TEST_PASSWORD:\s*\$\{\{\s*secrets\.CHECKOUT_TEST_PASSWORD\s*\}\}\s*$/m;
    const launchers = (() => {
        const found: { file: string; name: string; text: string }[] = [];
        for (const f of readdirSync('.github/workflows').filter((n) => /\.ya?ml$/.test(n))) {
            const raw = readFileSync(`.github/workflows/${f}`, 'utf8');
            // Each chunk after the first begins at a `- name:` step boundary.
            for (const chunk of raw.split(/\n(?=\s*- name:)/).slice(1)) {
                const text = chunk.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
                if (!LAUNCHES_CHECKOUT.test(text)) continue;
                const name = /- name:\s*(.+)/.exec(text)?.[1]?.trim() ?? '<unnamed>';
                found.push({ file: f, name, text });
            }
        }
        return found;
    })();

    it('the discovery is not vacuous — every known checkout entry point is found', () => {
        const ids = launchers.map((l) => `${l.file} :: ${l.name}`);
        for (const expected of [
            'live-release-matrix.yml :: Run Stripe Checkout Readiness Proof',
            'rc-gates.yml :: Run DAST Live Gate — PAID Stripe readiness (paid-launch scope only)',
            'rc-gates.yml :: Run DAST Live Gate (DIAGNOSTIC single spec — NOT a Gate 3 pass)',
        ]) {
            expect(ids).toContain(expected);
        }
    });

    it('CASUALTY: every step that can launch the checkout spec supplies the exact dedicated pair', () => {
        const missing = launchers
            .filter((l) => !EXACT_EMAIL.test(l.text) || !EXACT_PASSWORD.test(l.text))
            .map((l) => `${l.file} :: ${l.name}`);
        expect(missing).toEqual([]);
    });

    it('CASUALTY: no launching step sources the pair from the wrong store', () => {
        const wrong = launchers
            .filter((l) => /secrets\.CHECKOUT_TEST_EMAIL|vars\.CHECKOUT_TEST_PASSWORD/.test(l.text))
            .map((l) => `${l.file} :: ${l.name}`);
        expect(wrong).toEqual([]);
    });

    it('CASUALTY: the dedicated checkout job offers no Free, Pro or legacy identity to substitute', () => {
        // The diagnostic step legitimately carries FREE/PRO for the OTHER specs it can select; the
        // spec refuses them itself. The matrix job exists only for checkout, so it carries nothing else.
        const job = launchers.find((l) => l.file === 'live-release-matrix.yml');
        expect(job?.text ?? '').not.toMatch(/(FREE|PRO)_TEST_(EMAIL|PASSWORD)|E2E_(FREE|PRO)_(EMAIL|PASSWORD)/);
    });

    it('both workflows still supply the password from Secrets — only the EMAIL moved', () => {
        // #1294's split is email-is-identifier, password-is-credential. Moving the password too would be
        // the opposite error, so it is pinned here rather than left to reviewer memory.
        const rcGates = readFileSync('.github/workflows/rc-gates.yml', 'utf8');
        expect(rcGates).toContain('CHECKOUT_TEST_PASSWORD: ${{ secrets.CHECKOUT_TEST_PASSWORD }}');
        expect(rcGates).not.toContain('vars.CHECKOUT_TEST_PASSWORD');
    });
});
