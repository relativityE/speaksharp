/**
 * J1.e / J1.f against a DISPOSABLE local Supabase stack only (scripts/j1d-smoke/stack.sh, Edge functions served).
 *
 *   J1.e: a disposable account's real signup trial is SEEDED (scratch stack only) to end ~75 s ahead. Signed in from the homepage
 *         with the Open Mic session page open, the payment wall replaces that open page at the deadline with no navigation. A fresh
 *         sign-in after expiry meets the wall. The server refuses the same account: a guarded product read that worked before
 *         expiry fails with payment_required, and the usage check says trial_expired.
 *   J1.f: a disposable account SEEDED already expired signs in from the homepage, meets the wall and follows its Delete account
 *         link to the deletion page. account-closure deliberately refuses without a hosted project and a matching deployment binding,
 *         so on loopback deletion status fails closed: the page shows its blocked state, offers no request, sends no verification
 *         email and deletes nothing. Deletion completion is HOLD readiness_wiring_and_hosted_binding_required (never PASS): the
 *         routed page supplies no completion readiness, so it is not provable even on a bound hosted project.
 *
 * No production expiry edit, no daily canary, no live deletion. Disposable smoke evidence, not a production J1.e/J1.f pass.
 */
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cleanupRunOwnedAccount } from '../live/helpers/runOwnedCleanup';
import { loopbackTargets, receiptLeaks, smokeIdentity, type MailSummary, type SmokeVerdict } from './j1dSmokeChecks';
import {
    closureRefusedVerdict, freshSignInWallVerdict, openPageWallVerdict, provisionedTrialVerdict, serverRefusalVerdict, type ClosureAnswer, type RpcOutcome, type UsageAnswer,
} from './j1efTrialChecks';
import { openFromHomepage, sessionUid, signInThroughForm, visibleReady } from './smokePage';

const APP = process.env.J1D_SMOKE_APP_URL ?? '';
const API = process.env.J1D_SMOKE_API_URL ?? '';
const MAIL = process.env.J1D_SMOKE_MAIL_URL ?? '';
const ANON = process.env.J1D_SMOKE_ANON_KEY ?? '';
const SERVICE_ROLE = process.env.J1D_SMOKE_SERVICE_ROLE_KEY ?? '';
const RECEIPT = process.env.J1D_SMOKE_RECEIPT ?? '';
const RUN = /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') ? process.env.GITHUB_RUN_ID! : 'local';
const WALL = 'trial-payment-wall';
const SESSION = 'session-page';

type Row = { name: string } & SmokeVerdict & { ms: number };
type Account = { email: string; password: string; uid: string };
type Ctx = { context: BrowserContext; page: Page };
const sha = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 16);
const micCounter = () => {
    const w = window as unknown as { __j1dMic: number };
    w.__j1dMic = 0;
    const md = navigator.mediaDevices;
    if (md && typeof md.getUserMedia === 'function') {
        const original = md.getUserMedia.bind(md);
        md.getUserMedia = (c?: MediaStreamConstraints) => { w.__j1dMic += 1; return original(c); };
    }
};

/** One bounded journey: steps record verdicts, the main flow stops at its first non-PASS, and cleanup plus the receipt always run. */
function journey(name: string) {
    const rows: Row[] = [];
    let stopped = false;
    const step = async (label: string, run: () => Promise<SmokeVerdict>, boundMs = 60_000) => {
        if (stopped) { rows.push({ name: label, status: 'HOLD', reason: 'not_run_after_earlier_step', ms: 0 }); return; }
        const t = Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const bound = new Promise<SmokeVerdict>((resolve) => { timer = setTimeout(() => resolve({ status: 'HOLD', reason: 'step_timeout' }), boundMs); });
        const v = await Promise.race([run().catch((e: unknown): SmokeVerdict => ({ status: 'HOLD', reason: `error_${e instanceof Error ? e.name : 'unknown'}` })), bound]);
        clearTimeout(timer);
        rows.push({ name: label, ...v, ms: Date.now() - t });
        console.log(`J1EF_SMOKE_STEP ${name} ${v.status} ${label} (${v.reason}, ${Date.now() - t} ms)`);
        if (v.status !== 'PASS') stopped = true;
    };
    return { rows, step };
}

function guards(): SupabaseClient {
    expect(loopbackTargets({ app: APP, api: API, mail: MAIL }), 'every target must be loopback before anything is created').toEqual({ status: 'PASS', reason: 'loopback_only' });
    expect(SERVICE_ROLE.length > 20 && ANON.length > 20 && RECEIPT.length > 0, 'the disposable stack keys and receipt path come from scripts/j1d-smoke/stack.sh').toBe(true);
    return createClient(API, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
}
/** A disposable account through the real Auth signup path on the scratch stack; its trial comes from the signup trigger. */
async function disposableAccount(admin: SupabaseClient, label: string) {
    const email = smokeIdentity(Date.now(), RUN, label);
    const password = randomBytes(18).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error('disposable account not created');
    return { email, password, uid: data.user.id };
}
const readProfile = async (admin: SupabaseClient, uid: string) => {
    const { data, error } = await admin.from('user_profiles').select('commercial_trial_granted_at,trial_expires_at').eq('id', uid).maybeSingle();
    return error ? null : data;
};
/** SCRATCH STACK ONLY: move this disposable account's trial expiry (never production). */
async function seedTrialExpiry(admin: SupabaseClient, uid: string, at: Date): Promise<boolean> {
    const { error } = await admin.from('user_profiles').update({ trial_expires_at: at.toISOString() }).eq('id', uid);
    return !error;
}
async function userClient(email: string, password: string): Promise<SupabaseClient> {
    const client = createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error('user client sign-in refused');
    return client;
}
const guardedRead = async (client: SupabaseClient, uid: string): Promise<RpcOutcome> => {
    const { error } = await client.rpc('get_analytics_summary', { p_user_id: uid });
    return error ? { ok: false, message: `${error.code ?? ''} ${error.message ?? ''}` } : { ok: true };
};
const usageCheck = async (client: SupabaseClient): Promise<UsageAnswer | null> => {
    const { data, error } = await client.functions.invoke('check-usage-limit');
    return error ? null : (data as UsageAnswer);
};
async function freshPage(browser: Browser): Promise<Ctx> {
    const context = await browser.newContext();
    await context.addInitScript(micCounter);
    return { context, page: await context.newPage() };
}
async function signInFromHomepage(page: Page, email: string, password: string): Promise<void> {
    await openFromHomepage(page, 'Sign In', '/auth/signin');
    await signInThroughForm(page, email, password);
}
const visible = (page: Page, id: string) => page.getByTestId(id).first().isVisible().catch(() => false);
async function cleanUp(admin: SupabaseClient, uid: string, email: string): Promise<string> {
    if (!uid) return 'not_created';
    const before = await admin.auth.admin.getUserById(uid);
    if (!before.data?.user) return 'already_deleted';
    try {
        await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: uid, createdEmail: email, runOwnedPrefix: 'rwt-journey-' });
        const after = await admin.auth.admin.getUserById(uid);
        return after.data?.user ? 'residue' : 'deleted_and_read_back';
    } catch (e) { return `failed_${e instanceof Error ? e.name : 'unknown'}`; }
}
function writeReceipt(file: string, receipt: Record<string, unknown>, forbidden: string[]): void {
    const text = JSON.stringify(receipt, null, 2);
    const leaks = receiptLeaks(text, forbidden.filter(Boolean));
    if (leaks.length === 0) writeFileSync(file, text, { mode: 0o600 });
    expect(leaks, 'the receipt carries no secret, token, link or address').toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test('J1.e: the trial ends on an open session page, then on a fresh sign-in, and the server refuses', async ({ browser }) => {
    test.setTimeout(420_000);
    const started = Date.now();
    const admin = guards();
    const { rows, step } = journey('J1.e');
    let account = null as Account | null;
    let open = null as Ctx | null;
    let fresh = null as Ctx | null;
    let cleanup = 'not_created';
    try {
        await step('a disposable account gets its marked trial from the real signup trigger', async () => {
            account = await disposableAccount(admin, 'trial-ends');
            return provisionedTrialVerdict(await readProfile(admin, account.uid), Date.now());
        });
        const acct = () => account!;
        let expiresAt = 0;
        let api: SupabaseClient | null = null;
        let guardedBefore: RpcOutcome | null = null;
        let usageBefore: UsageAnswer | null = null;
        await step('SEEDED (scratch stack only): the trial now ends 75 s ahead, and the account is still open', async () => {
            expiresAt = Date.now() + 75_000;
            if (!(await seedTrialExpiry(admin, acct().uid, new Date(expiresAt)))) return { status: 'HOLD', reason: 'seed_refused' };
            api = await userClient(acct().email, acct().password);
            guardedBefore = await guardedRead(api, acct().uid);
            usageBefore = await usageCheck(api);
            return guardedBefore.ok && usageBefore?.can_start === true ? { status: 'PASS', reason: 'open_before_expiry' } : { status: 'HOLD', reason: 'not_open_before_expiry' };
        });
        let pathBefore = '';
        let navigations = 0;
        let productShownBefore = false;
        let wallBefore = true;
        await step('sign in from the homepage and open the Open Mic session page before the deadline', async () => {
            open = await freshPage(browser);
            await signInFromHomepage(open.page, acct().email, acct().password);
            await expect.poll(() => sessionUid(open!.page), { timeout: 30_000 }).toBe(acct().uid);
            await open.page.goto(`${APP}/session`);
            await visibleReady(open.page);
            productShownBefore = await open.page.getByTestId(SESSION).waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
            wallBefore = await visible(open.page, WALL);
            pathBefore = new URL(open.page.url()).pathname;
            open.page.on('framenavigated', (frame) => { if (frame === open!.page.mainFrame()) navigations += 1; });
            if (Date.now() >= expiresAt) return { status: 'HOLD', reason: 'deadline_passed_before_page_opened' };
            return productShownBefore && !wallBefore ? { status: 'PASS', reason: 'session_open_before_expiry' } : { status: 'HOLD', reason: 'session_not_open_before_expiry' };
        });
        await step('the payment wall replaces the OPEN page at the deadline, with no navigation', async () => {
            const wallAfter = await open!.page.getByTestId(WALL).waitFor({ state: 'visible', timeout: Math.max(0, expiresAt - Date.now()) + 90_000 }).then(() => true, () => false);
            return openPageWallVerdict({ productShownBefore, wallBefore, wallAfter, productShownAfter: await visible(open!.page, SESSION),
                pathBefore, pathAfter: new URL(open!.page.url()).pathname, navigations,
                micAcquisitions: await open!.page.evaluate(() => (window as unknown as { __j1dMic?: number }).__j1dMic ?? 0) });
        }, 200_000);
        await step('a fresh sign-in after expiry meets the wall on the product route', async () => {
            fresh = await freshPage(browser);
            await signInFromHomepage(fresh.page, acct().email, acct().password);
            const signedIn = await expect.poll(() => sessionUid(fresh!.page), { timeout: 30_000 }).toBe(acct().uid).then(() => true, () => false);
            await fresh.page.goto(`${APP}/practice`);
            await visibleReady(fresh.page);
            const wallShown = await fresh.page.getByTestId(WALL).waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
            return freshSignInWallVerdict({ signedIn, wallShown, productShown: await visible(fresh.page, 'practice-root') || await visible(fresh.page, SESSION) });
        });
        await step('the server refuses the expired account (guarded read payment_required; usage check trial_expired)', async () => serverRefusalVerdict({
            guardedBefore, usageBefore, guardedAfter: api ? await guardedRead(api, acct().uid) : null, usageAfter: api ? await usageCheck(api) : null }));
    } finally {
        const [o, f, a] = [open as Ctx | null, fresh as Ctx | null, account as Account | null];
        await o?.context.close().catch(() => undefined);
        await f?.context.close().catch(() => undefined);
        cleanup = await cleanUp(admin, a?.uid ?? '', a?.email ?? '');
        writeReceipt(join(dirname(RECEIPT), 'j1e-receipt.json'), { kind: 'j1e-trial-ends-smoke', disposable: true, productionAcceptance: false,
            seeded: 'trial expiry moved on the scratch stack only', commit: process.env.J1D_SMOKE_COMMIT ?? 'unknown', run: RUN,
            identity: { addressSha: sha(a?.email ?? '') }, assertions: rows, cleanup, durationMs: Date.now() - started },
        [a?.password ?? '', a?.email ?? '', SERVICE_ROLE, ANON]);
        expect(['deleted_and_read_back', 'not_created'], 'run-owned cleanup read back').toContain(cleanup);
    }
    expect(rows.map((r) => [r.name, r.status, r.reason])).toEqual(rows.map((r) => [r.name, 'PASS', r.reason]));
    expect(rows).toHaveLength(6);
});

test('J1.f: an already-expired account reaches deletion from the wall, and deletion status fails closed without hosted binding', async ({ browser }) => {
    test.setTimeout(240_000);
    const started = Date.now();
    const admin = guards();
    const { rows, step } = journey('J1.f');
    let account = null as Account | null;
    let s = null as Ctx | null;
    let cleanup = 'not_created';
    // Every account-closure answer the page receives (POST only), recorded as status and the refusal fields, never a body or token.
    const answers: ClosureAnswer[] = [];
    try {
        await step('SEEDED (scratch stack only): a disposable account whose real signup trial already ended', async () => {
            account = await disposableAccount(admin, 'trial-ended');
            const provisioned = provisionedTrialVerdict(await readProfile(admin, account.uid), Date.now());
            if (provisioned.status !== 'PASS') return provisioned;
            return (await seedTrialExpiry(admin, account.uid, new Date(Date.now() - 86_400_000))) ? { status: 'PASS', reason: 'expired_account_seeded' } : { status: 'HOLD', reason: 'seed_refused' };
        });
        const acct = () => account!;
        await step('signed in from the homepage, the expired account meets the wall', async () => {
            s = await freshPage(browser);
            await signInFromHomepage(s.page, acct().email, acct().password);
            await expect.poll(() => sessionUid(s!.page), { timeout: 30_000 }).toBe(acct().uid);
            await s.page.goto(`${APP}/practice`);
            await visibleReady(s.page);
            return (await s.page.getByTestId(WALL).waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false))
                ? { status: 'PASS', reason: 'wall_shown' } : { status: 'FAIL', reason: 'no_wall_for_expired_account' };
        });
        await step('the wall\'s Delete account link opens the deletion page', async () => {
            s!.page.on('response', (r) => {
                if (r.request().method() !== 'POST' || new URL(r.url()).pathname !== '/functions/v1/account-closure') return;
                void r.json().then((b: { error?: unknown; outcome?: unknown } | null) => answers.push({ status: r.status(), error: b?.error, outcome: b?.outcome }),
                    () => answers.push({ status: r.status() }));
            });
            await s!.page.getByTestId(WALL).getByRole('link', { name: 'Delete account', exact: true }).click();
            const opened = await s!.page.waitForURL((u) => u.pathname === '/account/delete', { timeout: 30_000 }).then(() => true, () => false);
            return opened ? { status: 'PASS', reason: 'deletion_page_opened' } : { status: 'FAIL', reason: 'deletion_page_not_opened' };
        });
        await step('deletion status fails closed without hosted binding: nothing offered, sent or deleted', async () => {
            const refusalShown = await s!.page.getByText('We could not verify your account deletion status. Confirmation is blocked.', { exact: false })
                .waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
            await expect.poll(() => answers.length, { timeout: 10_000 }).toBeGreaterThan(0).catch(() => undefined);
            const requestOffered = await s!.page.getByRole('button', { name: 'Email me a verification link' }).isVisible().catch(() => false);
            const sentShown = await s!.page.getByText('Check your account email.', { exact: false }).isVisible().catch(() => false);
            // Give a (wrongly) sent email time to land before reading the mailbox for this exact address.
            await new Promise((r) => setTimeout(r, 5_000));
            const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${acct().email}"`)}`).catch(() => null);
            const body = res?.ok ? await res.json().catch(() => null) as { messages?: MailSummary[] } | null : null;
            const mailForAddress = Array.isArray(body?.messages)
                ? body!.messages!.filter((m) => Array.isArray(m.To) && m.To.some((t) => String(t.Address ?? '').toLowerCase() === acct().email.toLowerCase())).length
                : 'unread' as const;
            const user = await admin.auth.admin.getUserById(acct().uid);
            const { data: prof, error: profErr } = await admin.from('user_profiles').select('id').eq('id', acct().uid).maybeSingle();
            return closureRefusedVerdict({ answers, refusalShown, requestOffered, sentShown, mailForAddress,
                authUser: user.error ? 'unread' : user.data?.user ? 'present' : 'absent', profile: profErr ? 'unread' : prof ? 'present' : 'absent' });
        });
        // Not provable here: loopback has no deployment binding, and the routed page supplies no completion
        // readiness, so the final button stays off even on a bound hosted project. Reported as HOLD, never PASS.
        const completion = 'deletion completion (needs the app\'s completion-readiness wiring and the hosted completion runtime; not run here)';
        rows.push({ name: completion, status: 'HOLD', reason: 'readiness_wiring_and_hosted_binding_required', ms: 0 });
        console.log(`J1EF_SMOKE_STEP J1.f HOLD ${completion} (readiness_wiring_and_hosted_binding_required, 0 ms)`);
    } finally {
        const [c, a] = [s as Ctx | null, account as Account | null];
        await c?.context.close().catch(() => undefined);
        cleanup = await cleanUp(admin, a?.uid ?? '', a?.email ?? '');
        writeReceipt(join(dirname(RECEIPT), 'j1f-receipt.json'), { kind: 'j1f-wall-to-deletion-refusal-smoke', disposable: true, productionAcceptance: false,
            seeded: 'trial expiry moved on the scratch stack only', deletionCompletion: 'HOLD readiness_wiring_and_hosted_binding_required',
            commit: process.env.J1D_SMOKE_COMMIT ?? 'unknown', run: RUN, identity: { addressSha: sha(a?.email ?? '') }, assertions: rows,
            closureAnswers: answers.map((x) => ({ status: x.status, error: typeof x.error === 'string' ? x.error : null, outcome: typeof x.outcome === 'string' ? x.outcome : null })),
            cleanup, durationMs: Date.now() - started },
        [a?.password ?? '', a?.email ?? '', SERVICE_ROLE, ANON]);
        expect(['deleted_and_read_back', 'not_created'], 'run-owned cleanup read back').toContain(cleanup);
    }
    const completed = rows.slice(0, 4);
    expect(completed.map((r) => [r.name, r.status, r.reason])).toEqual(completed.map((r) => [r.name, 'PASS', r.reason]));
    expect(completed).toHaveLength(4);
    expect(rows.slice(4).map((r) => [r.status, r.reason])).toEqual([['HOLD', 'readiness_wiring_and_hosted_binding_required']]);
});
