// @vitest-environment node
/** J1.f / J7.d deletion journeys on the disposable billing stack: the link, the terminal message and the leg receipt. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENTRY_ROUTE, combinedDeletionReceipt, deletionLink, legReceipt, scorerAccount, terminalMessage, type DeletionLegFacts } from '../billing/user-journey/accountDeletionJourney';
import { finaliseDeletionReceipt } from '../billing/user-journey/deletionReceipt.mjs';

const API = 'http://127.0.0.1:54321';
const APP = 'http://localhost:5173';
const redirect = (over = '') => encodeURIComponent(`${APP}/account/delete?account_deletion_token=tok123${over}`);
const verify = (o: { origin?: string; type?: string; token?: string; to?: string } = {}) =>
    `${o.origin ?? API}/auth/v1/verify?token=${o.token ?? 'otp1'}&type=${o.type ?? 'magiclink'}&redirect_to=${o.to ?? redirect()}`;

describe('deletionLink: the one magic link back to this app\'s /account/delete with its token', () => {
    it('finds it in text or HTML (with &amp;)', () => {
        expect(deletionLink(`Open ${verify()} now`, API, APP)).toBe(new URL(verify()).toString());
        expect(deletionLink(`<a href="${verify().replace(/&/g, '&amp;')}">x</a>`, API, APP)).toBe(new URL(verify()).toString());
    });
    it('refuses no link, two links, another host, a signup link, no token, or a redirect anywhere else', () => {
        expect(deletionLink('nothing here', API, APP)).toBe(null);
        expect(deletionLink(`${verify()} ${verify({ token: 'otp2' })}`, API, APP)).toBe(null);
        expect(deletionLink(verify({ origin: 'http://evil.example.test' }), API, APP)).toBe(null);
        expect(deletionLink(verify({ type: 'signup' }), API, APP)).toBe(null);
        expect(deletionLink(verify({ token: '' }), API, APP)).toBe(null);
        expect(deletionLink(verify({ to: encodeURIComponent('http://evil.example.test/account/delete?account_deletion_token=x') }), API, APP)).toBe(null);
        expect(deletionLink(verify({ to: encodeURIComponent(`${APP}/account?account_deletion_token=x`) }), API, APP)).toBe(null);
        expect(deletionLink(verify({ to: encodeURIComponent(`${APP}/account/delete`) }), API, APP)).toBe(null);
    });
});

describe('terminalMessage: only the page\'s plain "deleted" counts', () => {
    it('classifies each of the page\'s own final messages', () => {
        const page = readFileSync('frontend/src/pages/AccountDeletionPage.tsx', 'utf8');
        const cases: Array<[string, ReturnType<typeof terminalMessage>]> = [
            ['Your account has been deleted.', 'deleted'],
            ['Your account has been deleted. Your trial email is retained to prevent repeat trials. Historical billing and support records may remain.', 'deleted'],
            ['Your account was deleted, but complete cleanup could not be verified. Please contact support.', 'deleted_cleanup_unverified'],
            ['Verification was refused or expired. Request a new emailed link while signed in to the correct account.', 'refused'],
            ['We could not verify the deletion result. Do not assume your account or billing was changed. Please contact support before retrying.', 'unverified'],
            ['Your deletion request is pending. Your account has not been deleted. Previously accepted work must settle before deletion can proceed.', 'pending'],
            ['Billing is closed, but your account has not been deleted. Request a new verification link after one minute or contact support.', 'refused'],
            ['Checking your account deletion status…', 'none'],
        ];
        for (const [text, want] of cases) {
            expect(page.includes(text.slice(0, 40)), `the page still says: ${text.slice(0, 40)}`).toBe(true);
            expect(terminalMessage([text])).toBe(want);
        }
    });
    it('the cleanup-unverified message is never read as a clean deletion, even beside other status text', () => {
        expect(terminalMessage(['Your account has been deleted.', 'Your account was deleted, but complete cleanup could not be verified.'])).toBe('deleted_cleanup_unverified');
    });
});

describe('leg receipt', () => {
    const facts: DeletionLegFacts = { leg: 'J7.d', route: ENTRY_ROUTE['J7.d'], accountSha: 'a'.repeat(16), entryReached: true, verificationRequested: true,
        verificationLinkFound: true, terminal: 'deleted', closurePhase: 'completed', authUser: 'absent', residueClear: true, fallbackCleanup: 'not_run' };
    it('each leg is its own route and carries only fixed words and a hash', () => {
        expect(ENTRY_ROUTE).toEqual({ 'J1.f': 'trial_wall', 'J7.d': 'account_page' });
        const r = legReceipt(facts, { release: 'f'.repeat(40), stackRun: 'billing-local-stack-1-1', startedAt: 1, finishedAt: 11 });
        expect(r).toMatchObject({ kind: 'account-deletion-local-stack-leg', disposable: true, productionAcceptance: false, leg: 'J7.d', route: 'account_page', durationMs: 10 });
        expect(JSON.stringify(r)).not.toMatch(/@|eyJ|access_token|\/auth\/v1\/verify/);
    });
});

describe('the journeys\' combined receipt is exactly what the scorer (deletionReceipt.mjs) reads', () => {
    const leg = (l: 'J1.f' | 'J7.d', over: Partial<DeletionLegFacts> = {}): DeletionLegFacts => ({ leg: l, route: ENTRY_ROUTE[l], accountSha: 'a'.repeat(16),
        entryReached: true, verificationRequested: true, verificationLinkFound: true, terminal: 'deleted', closurePhase: 'completed', authUser: 'absent',
        residueClear: true, fallbackCleanup: 'not_run', ...over });
    const run = { release: 'f'.repeat(40), stackRun: 'billing-local-stack-45355779902-1' };
    const score = (a: DeletionLegFacts, b: DeletionLegFacts) =>
        finaliseDeletionReceipt(combinedDeletionReceipt([scorerAccount(a, '1'.repeat(64)), scorerAccount(b, '2'.repeat(64))], run),
            { stackStopped: 'success', stackDestroyed: 'success', stripeClean: 'success' }, { release: run.release, stackRun: run.stackRun });
    it('two clean legs carry no receipt or leg defect (only the destruction proof, which this unit test does not supply)', () => {
        const r = score(leg('J1.f'), leg('J7.d'));
        expect(r.defects['J1.f']).toEqual([]);
        expect(r.defects['J7.d']).toEqual([]);
        expect(r.defects.run.filter((d: string) => !/destruction|identity|stack_/.test(d))).toEqual([]);
    });
    it('a leg that needed the fallback cleanup, or whose deletion did not finish, carries its defect', () => {
        expect(score(leg('J1.f', { fallbackCleanup: 'ran_deleted' }), leg('J7.d')).defects['J1.f']).toContain('fallback_cleanup_ran');
        expect(score(leg('J1.f'), leg('J7.d', { closurePhase: 'processing', authUser: 'present', residueClear: false })).defects['J7.d'])
            .toEqual(['deletion_not_terminal', 'auth_user_present', 'residue_not_zero']);
    });
});
