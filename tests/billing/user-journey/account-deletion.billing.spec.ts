/**
 * J1.f and J7.d on the DISPOSABLE billing local stack (protected billing-local-stack-journey, journey `account_deletion`): a real
 * person's deletion, end to end, from each entry point, on its own fresh account.
 *   J1.f: an account whose trial already ended meets the payment wall and opens "Delete account" there.
 *   J7.d: an account on an open trial opens "Delete account" from the Account page.
 * Each: request the emailed verification link → open it from the stack's own Mailpit → confirm → (readiness, then completion when
 * the request is pending) → the page's terminal message. Then, READ-ONLY and before anything else: the closure attempt's phase,
 * whether the Auth user still exists, and the shipped residue check (verify_account_closure_residue). Only after those reads may
 * the fallback cleanup run, and a leg that needed it is recorded as such: it never earns a deletion pass (deletionReceipt.mjs).
 * Deletion is enabled only on this stack, by the run's own disposable grant (accountDeletionLocalStack.mjs); never production.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cleanupRunOwnedAccount } from '../../live/helpers/runOwnedCleanup';
import { loopbackTargets, receiptLeaks, smokeIdentity, type MailSummary } from '../../smoke/j1dSmokeChecks';
import { openFromHomepage, sessionUid, signInThroughForm } from '../../smoke/smokePage';
import { waitForAppVisibleReady } from '../../e2e/helpers';
import { ENTRY_ROUTE, combinedDeletionReceipt, deletionLink, deletionLoopStep, legReceipt, scorerAccount, terminalMessage, type DeletionLeg, type DeletionLegFacts } from './accountDeletionJourney';
import { coverageSql, localDbUrl } from './accountDeletionLocalStack.mjs';

const APP = process.env.BILLING_SANDBOX_APP_URL ?? '';
const API = process.env.BILLING_SANDBOX_SUPABASE_URL ?? '';
const MAIL = process.env.BILLING_SANDBOX_MAIL_URL ?? 'http://127.0.0.1:54324';
const ANON = process.env.BILLING_SANDBOX_ANON_KEY ?? '';
const SERVICE = process.env.BILLING_SANDBOX_SERVICE_ROLE_KEY ?? '';
const RELEASE = process.env.BILLING_SANDBOX_RELEASE_SHA ?? 'unknown';
const STACK_RUN = process.env.LOCAL_STACK_PROJECT ?? 'local';
const OUT = process.env.ACCOUNT_DELETION_RECEIPT_DIR ?? 'test-results/account-deletion';
const RUN = /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') ? process.env.GITHUB_RUN_ID! : 'local';
const WALL = 'trial-payment-wall';
const sha = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 16);
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
/** Both legs' scorer records, combined into the one receipt deletionReceipt.mjs scores (written after both, before teardown). */
const scored: Array<ReturnType<typeof scorerAccount>> = [];

function guards(): SupabaseClient {
    expect(process.env.BILLING_SANDBOX_TARGET, 'the disposable local stack only').toBe('local-disposable-stack');
    expect(process.env.BILLING_JOURNEY_APPROVAL, 'the dispatch\'s own isolated test-mode acknowledgement').toBe('ISOLATED-TEST-MODE-ONLY');
    expect(loopbackTargets({ app: APP, api: API, mail: MAIL }), 'every target must be loopback before anything is created').toEqual({ status: 'PASS', reason: 'loopback_only' });
    expect(ANON.length > 20 && SERVICE.length > 20, 'the stack\'s own keys').toBe(true);
    return createClient(API, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function freshAccount(admin: SupabaseClient, label: string) {
    const email = smokeIdentity(Date.now(), RUN, label);
    const password = randomBytes(18).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error('disposable account not created');
    return { email, password, uid: data.user.id };
}

/** The stack's mailbox, for exactly this address: the one deletion link, or null. Never logged. */
async function linkFromMailbox(address: string): Promise<string | null> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`).catch(() => null);
        const found = res?.ok ? await res.json().catch(() => null) as { messages?: MailSummary[] } | null : null;
        const mine = (found?.messages ?? []).filter((m) => Array.isArray(m.To) && m.To.length === 1
            && String(m.To[0].Address ?? '').toLowerCase() === address.toLowerCase() && typeof m.ID === 'string');
        if (mine.length === 1) {
            const msg = await fetch(`${MAIL}/api/v1/message/${encodeURIComponent(String(mine[0].ID))}`).catch(() => null);
            const body = msg?.ok ? await msg.json().catch(() => null) as { Text?: string; HTML?: string } | null : null;
            return body ? deletionLink(`${body.Text ?? ''}\n${body.HTML ?? ''}`, API, APP) : null;
        }
        if (mine.length > 1) return null;
        await new Promise((r) => setTimeout(r, 1_000));
    }
    return null;
}

const statusTexts = (page: Page) => page.getByRole('status').allInnerTexts().catch(() => [] as string[]);

/**
 * SEEDED, this stack only: the request-scoped completion coverage for this run-owned user's pending request
 * (accountDeletionLocalStack.mjs coverageSql). In production that row is operator evidence; without it the status reader says
 * `coverage_unverified` and the page never offers completion. Exactly one row, or the leg fails.
 */
function seedCoverage(uid: string) {
    const out = execFileSync('psql', [localDbUrl(process.env.LOCAL_DB_URL ?? ''), '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', coverageSql(uid)],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    if (out.trim().split('\n').filter(Boolean).length !== 1) throw new Error('disposable completion coverage: expected exactly one pending request');
}

/** Confirm on the verified page, then (if pending) complete through readiness, and return the page's terminal message. */
async function confirmAndComplete(page: Page, uid: string) {
    await page.getByLabel('I understand this is permanent, ends my access now, and provides no refund.').check();
    await page.getByRole('button', { name: 'Permanently delete my account' }).click();
    const deadline = Date.now() + 180_000;
    let lastStatusCheck = -Infinity;
    let covered = false;
    while (Date.now() < deadline) {
        const terminal = terminalMessage(await statusTexts(page));
        // Once the confirmation is pending (the request now exists), and before the first status check asks for readiness.
        if (terminal === 'pending' && !covered) { seedCoverage(uid); covered = true; }
        const complete = page.getByRole('button', { name: 'Complete permanent account deletion' });
        const check = page.getByRole('button', { name: 'Check deletion status' });
        const step = deletionLoopStep({ terminal, completeVisible: await complete.isVisible().catch(() => false),
            statusButtonVisible: await check.isVisible().catch(() => false), msSinceStatusCheck: Date.now() - lastStatusCheck });
        if (step === 'stop') return terminal;
        if (step === 'complete') {
            await page.getByLabel('I confirm permanent account deletion now, with no refund.').check();
            await complete.click();
        } else if (step === 'check_status') {
            // A pending confirmation starts completion only when the user checks status (AccountDeletionPage).
            await check.click();
            lastStatusCheck = Date.now();
        }
        await new Promise((r) => setTimeout(r, 2_000));
    }
    return terminalMessage(await statusTexts(page));
}

async function runLeg(leg: DeletionLeg, browser: import('@playwright/test').Browser) {
    const started = Date.now();
    const admin = guards();
    const account = await freshAccount(admin, leg === 'J1.f' ? 'deletion-wall' : 'deletion-account');
    const facts: DeletionLegFacts = { leg, route: ENTRY_ROUTE[leg], accountSha: sha(account.email), entryReached: false,
        verificationRequested: false, verificationLinkFound: false, terminal: 'none', closurePhase: null, authUser: 'unread',
        residueClear: null, fallbackCleanup: 'not_run' };
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        if (leg === 'J1.f') {
            // SEEDED (this stack only): the account's real signup trial already ended.
            const { error } = await admin.from('user_profiles').update({ trial_expires_at: new Date(Date.now() - 86_400_000).toISOString() }).eq('id', account.uid);
            if (error) throw new Error('trial expiry seed refused');
        }
        await openFromHomepage(page, 'Sign In', '/auth/signin');
        await signInThroughForm(page, account.email, account.password);
        await expect.poll(() => sessionUid(page), { timeout: 30_000 }).toBe(account.uid);
        if (leg === 'J1.f') {
            await page.goto(`${APP}/practice`);
            await waitForAppVisibleReady(page);
            await page.getByTestId(WALL).waitFor({ state: 'visible', timeout: 30_000 });
            await page.getByTestId(WALL).getByRole('link', { name: 'Delete account', exact: true }).click();
        } else {
            await page.goto(`${APP}/account`);
            await waitForAppVisibleReady(page);
            await page.getByTestId('account-delete-link').click();
        }
        facts.entryReached = await page.waitForURL((u) => u.pathname === '/account/delete', { timeout: 30_000 }).then(() => true, () => false);
        if (!facts.entryReached) return facts;
        await page.getByRole('button', { name: 'Email me a verification link' }).click();
        facts.verificationRequested = await page.getByText('Check your account email.', { exact: false })
            .waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false);
        if (!facts.verificationRequested) return facts;
        const link = await linkFromMailbox(account.email);
        facts.verificationLinkFound = link !== null;
        if (!link) return facts;
        await page.goto(link);
        await page.waitForURL((u) => u.pathname === '/account/delete', { timeout: 30_000 });
        facts.terminal = await confirmAndComplete(page, account.uid);
    } finally {
        await context.close().catch(() => undefined);
        // READ-ONLY, before any cleanup: the attempt's phase, the Auth user, and the shipped residue check.
        const attempt = await admin.from('account_closure_attempts').select('phase').eq('user_id', account.uid).maybeSingle();
        facts.closurePhase = attempt.error ? 'unread' : (attempt.data?.phase ?? null);
        const user = await admin.auth.admin.getUserById(account.uid);
        facts.authUser = user.data?.user ? 'present' : (user.error && !/not.?found/i.test(user.error.message ?? '')) ? 'unread' : 'absent';
        const residue = await admin.rpc('verify_account_closure_residue', { p_user_id: account.uid, p_email: account.email });
        facts.residueClear = residue.error ? null : residue.data === true;
        // Only now: the fallback, recorded, never a pass.
        if (facts.authUser !== 'absent') {
            try {
                await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: account.uid, createdEmail: account.email, runOwnedPrefix: 'rwt-journey-' });
                facts.fallbackCleanup = (await admin.auth.admin.getUserById(account.uid)).data?.user ? 'ran_residue' : 'ran_deleted';
            } catch { facts.fallbackCleanup = 'ran_failed'; }
        }
        scored.push(scorerAccount(facts, sha256(account.uid)));
        const receipt = legReceipt(facts, { release: RELEASE, stackRun: STACK_RUN, startedAt: started, finishedAt: Date.now() });
        const text = JSON.stringify(receipt, null, 2);
        const leaks = receiptLeaks(text, [account.email, account.password, account.uid, SERVICE, ANON]);
        mkdirSync(OUT, { recursive: true });
        if (leaks.length === 0) writeFileSync(join(OUT, `${leg === 'J1.f' ? 'j1f' : 'j7d'}-deletion-receipt.json`), text, { mode: 0o600 });
        await test.info().attach('account-deletion-leg.json', { body: leaks.length === 0 ? text : '{"refused":"receipt_leak"}', contentType: 'application/json' });
        expect(leaks, 'the receipt carries no address, id, secret, token or link').toEqual([]);
    }
    return facts;
}

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
    const text = JSON.stringify(combinedDeletionReceipt(scored, { release: RELEASE, stackRun: STACK_RUN }), null, 2);
    // The combined receipt carries hashes and fixed words only; the per-leg leak check already ran on each leg's facts.
    if (!/@|eyJ|access_token|\/auth\/v1\/verify/.test(text)) {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, 'account-deletion-receipt.json'), text, { mode: 0o600 });
    }
});

for (const leg of ['J1.f', 'J7.d'] as const) {
    test(`billing account_deletion: ${leg} deletes its own account from ${ENTRY_ROUTE[leg] === 'trial_wall' ? 'the trial wall' : 'the Account page'}, leaving no residue`, async ({ browser }) => {
        test.setTimeout(420_000);
        const facts = await runLeg(leg, browser);
        // The spec's own floor; the authoritative scoring (with teardown and destruction proof) is deletionReceipt.mjs.
        expect({ entry: facts.entryReached, requested: facts.verificationRequested, link: facts.verificationLinkFound, terminal: facts.terminal,
            phase: facts.closurePhase, authUser: facts.authUser, residueClear: facts.residueClear, fallback: facts.fallbackCleanup })
            .toEqual({ entry: true, requested: true, link: true, terminal: 'deleted', phase: 'completed', authUser: 'absent', residueClear: true, fallback: 'not_run' });
    });
}
