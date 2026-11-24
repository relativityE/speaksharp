// @vitest-environment node
/** J1.f / J7.d deletion journeys on the disposable billing stack: the link, the terminal message and the leg receipt. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENTRY_ROUTE, STATUS_RECHECK_MS, combineLegScorerFiles, combinedDeletionReceipt, deletionLink, deletionLoopStep, legReceipt, legScorerFile, scorerAccount, terminalMessage, type DeletionLegFacts } from '../billing/user-journey/accountDeletionJourney';
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

describe('deletionLoopStep: after confirming, act as the user would until the page\'s final message', () => {
    const at = (over: Partial<Parameters<typeof deletionLoopStep>[0]> = {}) =>
        deletionLoopStep({ terminal: 'pending', completeVisible: false, statusButtonVisible: true, msSinceStatusCheck: Infinity, ...over });
    it('a pending confirmation is checked at once (the page starts completion only on "Check deletion status"), then at most every 10 s', () => {
        // Codex on 43efed9a: without this the Complete button never appears and J1.f times out (then J7.d is skipped).
        expect(at()).toBe('check_status');
        expect(at({ msSinceStatusCheck: STATUS_RECHECK_MS - 1 })).toBe('wait');
        expect(at({ msSinceStatusCheck: STATUS_RECHECK_MS })).toBe('check_status');
        expect(at({ statusButtonVisible: false })).toBe('wait');
    });
    it('completes when the page offers it, before any further status check', () => {
        expect(at({ completeVisible: true })).toBe('complete');
    });
    it('stops on every final message, and only on those', () => {
        for (const t of ['deleted', 'deleted_cleanup_unverified', 'refused', 'unverified'] as const) expect(at({ terminal: t, completeVisible: true })).toBe('stop');
        for (const t of ['pending', 'none'] as const) expect(at({ terminal: t })).not.toBe('stop');
    });
    it('the journey spec drives its loop through this step and clicks the status control', () => {
        const spec = readFileSync('tests/billing/user-journey/account-deletion.billing.spec.ts', 'utf8');
        const loop = spec.slice(spec.indexOf('async function confirmAndComplete'), spec.indexOf('async function runLeg'));
        expect(loop).toContain('deletionLoopStep({');
        expect(loop).toContain("page.getByRole('button', { name: 'Check deletion status' })");
        expect(loop).toMatch(/step === 'check_status'\) \{[^}]*await check\.click\(\);/);
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
            { journeys: 'success', stackStopped: 'success', stackDestroyed: 'success', stripeClean: 'success' }, { release: run.release, stackRun: run.stackRun });
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
    it('the browser facts reach the scorer: a failed entry, an unseen link or a non-deleted page fails that leg', () => {
        expect(score(leg('J1.f', { entryReached: false }), leg('J7.d')).defects['J1.f']).toContain('entry_not_reached');
        expect(score(leg('J1.f'), leg('J7.d', { verificationLinkFound: false })).defects['J7.d']).toContain('verification_not_observed');
        expect(score(leg('J1.f', { terminal: 'deleted_cleanup_unverified' }), leg('J7.d')).defects['J1.f']).toContain('terminal_ui_not_deleted');
    });
});

describe('each route runs on its own (run 45407419238): per-leg scorer files, rebuilt into one receipt', () => {
    const run = { release: 'f'.repeat(40), stackRun: 'billing-local-stack-45407419238-1' };
    const facts = (leg: 'J1.f' | 'J7.d'): DeletionLegFacts => ({ leg, route: ENTRY_ROUTE[leg], accountSha: 'a'.repeat(16), entryReached: true,
        verificationRequested: true, verificationLinkFound: true, terminal: 'deleted', closurePhase: 'completed', authUser: 'absent',
        residueClear: true, fallbackCleanup: 'not_run' });
    const file = (leg: 'J1.f' | 'J7.d', r = run) => legScorerFile(scorerAccount(facts(leg), (leg === 'J1.f' ? '1' : '2').repeat(64)), r);
    it('combines this run\'s files in leg order, whichever finished first', () => {
        expect(combineLegScorerFiles([file('J7.d'), file('J1.f')], run).map((a) => a.leg)).toEqual(['J1.f', 'J7.d']);
    });
    it('a leg whose file is missing is simply absent (the scorer then fails the account count), never invented', () => {
        expect(combineLegScorerFiles([file('J7.d')], run).map((a) => a.leg)).toEqual(['J7.d']);
    });
    it('another run\'s or another release\'s file, a malformed file, or another kind is ignored; a duplicate leg is kept', () => {
        const other = file('J1.f', { ...run, stackRun: 'billing-local-stack-1-1' });
        const oldRelease = file('J1.f', { ...run, release: 'e'.repeat(40) });
        expect(combineLegScorerFiles([other, oldRelease, null, 'x', { ...file('J1.f'), kind: 'other' }, file('J7.d')], run).map((a) => a.leg)).toEqual(['J7.d']);
        expect(combineLegScorerFiles([file('J1.f'), file('J1.f')], run)).toHaveLength(2);
    });
    it('the spec has no serial mode, writes each leg\'s scorer file, and rebuilds the combined receipt from those files', () => {
        const spec = readFileSync('tests/billing/user-journey/account-deletion.billing.spec.ts', 'utf8');
        expect(spec).not.toMatch(/mode:\s*'serial'/);
        expect(spec).toContain('-deletion-scorer.json`), scorerText');
        expect(spec).toContain('const accounts = combineLegScorerFiles(files, { release: RELEASE, stackRun: STACK_RUN });');
        expect(spec).not.toMatch(/\bscored\b/);
    });
});
