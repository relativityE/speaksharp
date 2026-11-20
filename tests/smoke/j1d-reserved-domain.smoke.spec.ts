/**
 * J1.d reserved-namespace smoke, against a DISPOSABLE local Supabase stack only.
 *
 * A fresh `speaksharp.test` account signs up through the real app, is refused before it confirms, confirms through the local
 * Mailpit link, signs out, is redirected away from its protected Account page, and signs back into the same account and its own
 * detail, with the microphone off and no session created. Negative controls prove the same checks fail for the intended reason.
 * The run-owned cleanup path then deletes both accounts and the result is read back.
 *
 * Disposable smoke evidence only: not a production J1.d pass, and not proof that hosted Supabase accepts `.test`.
 * Run by scripts/j1d-smoke/stack.sh (`up`, then this spec, then `down`); every target must be loopback or nothing starts.
 */
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page, type Response } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { cleanupRunOwnedAccount } from '../live/helpers/runOwnedCleanup';
import {
    confirmationLink, confirmationMessage, loopbackTargets, quietReturnVerdict, receiptLeaks, sameAccountVerdict, signedOutRedirectVerdict,
    smokeIdentity, type MailSummary, type SmokeVerdict,
} from './j1dSmokeChecks';
import { openFromHomepage, sessionUid, signInThroughForm, signOutThroughApp, signedOutLinks, visibleReady } from './smokePage';

const APP = process.env.J1D_SMOKE_APP_URL ?? '';
const API = process.env.J1D_SMOKE_API_URL ?? '';
const MAIL = process.env.J1D_SMOKE_MAIL_URL ?? '';
const SERVICE_ROLE = process.env.J1D_SMOKE_SERVICE_ROLE_KEY ?? '';
const RECEIPT = process.env.J1D_SMOKE_RECEIPT ?? '';
const RUN = /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') ? process.env.GITHUB_RUN_ID! : 'local';
const PROTECTED = '/account';

type Row = { name: string } & SmokeVerdict & { ms: number };
const sha = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 16);


test.describe.configure({ mode: 'serial' });

test('J1.d smoke: a disposable speaksharp.test account confirms, signs out, is redirected, and returns to its own detail', async ({ page, browser }) => {
    test.setTimeout(420_000);
    const started = Date.now();
    const rows: Row[] = [];
    const controls: Row[] = [];
    const observations: string[] = [];
    // Every step is bounded (60 s) and the main flow stops at its first non-PASS, so cleanup and the receipt always run in time.
    let stopped = false;
    const step = async (into: Row[], name: string, run: () => Promise<SmokeVerdict>) => {
        const main = into === rows;
        if (main && stopped) { into.push({ name, status: 'HOLD', reason: 'not_run_after_earlier_step', ms: 0 }); return; }
        const t = Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const bound = new Promise<SmokeVerdict>((resolve) => { timer = setTimeout(() => resolve({ status: 'HOLD', reason: 'step_timeout' }), 60_000); });
        const v = await Promise.race([run().catch((e: unknown): SmokeVerdict => ({ status: 'HOLD', reason: `error_${e instanceof Error ? e.name : 'unknown'}` })), bound]);
        clearTimeout(timer);
        into.push({ name, ...v, ms: Date.now() - t });
        console.log(`J1D_SMOKE_STEP ${v.status} ${name} (${v.reason}, ${Date.now() - t} ms)`);
        if (main && v.status !== 'PASS') stopped = true;
    };

    // Fail closed before ANY data exists: every target is loopback, and the service key is present (Node only, never the page).
    const targets = loopbackTargets({ app: APP, api: API, mail: MAIL });
    expect(targets, 'every target must be loopback before anything is created').toEqual({ status: 'PASS', reason: 'loopback_only' });
    expect(SERVICE_ROLE.length > 20 && RECEIPT.length > 0, 'the disposable stack key and receipt path come from scripts/j1d-smoke/stack.sh').toBe(true);
    const admin = createClient(API, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

    const email = smokeIdentity(Date.now(), RUN);
    const password = randomBytes(18).toString('base64url');
    const controlEmail = smokeIdentity(Date.now() + 1, RUN);
    const controlPassword = randomBytes(18).toString('base64url');
    let link = '';
    let uid = '';
    let controlUid = '';
    const userByEmail = async (address: string) => {
        for (let p = 1; p <= 20; p++) {
            const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
            if (error) throw new Error('listUsers failed');
            const hit = data.users.find((u) => u.email?.toLowerCase() === address.toLowerCase());
            if (hit) return hit;
            if (data.users.length < 200) return null;
        }
        return null;
    };
    const sessionsOf = async (id: string): Promise<number | null> => {
        const { count, error } = await admin.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', id);
        return error ? null : count ?? 0;
    };
    const mailFor = async (address: string, waitMs: number) => {
        const deadline = Date.now() + waitMs;
        for (;;) {
            const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`).catch(() => null);
            const body = res?.ok ? await res.json().catch(() => null) as { messages?: MailSummary[] } | null : null;
            const found = confirmationMessage(body?.messages ?? (res?.ok ? [] : null), address);
            if (found.state !== 'unavailable' || Date.now() >= deadline) return found;
            await new Promise((r) => setTimeout(r, 1_000));
        }
    };
    // The microphone counter runs in every document of each page it is installed on.
    const micCounter = () => {
        const w = window as unknown as { __j1dMic: number };
        w.__j1dMic = 0;
        const md = navigator.mediaDevices;
        if (md && typeof md.getUserMedia === 'function') {
            const original = md.getUserMedia.bind(md);
            md.getUserMedia = (c?: MediaStreamConstraints) => { w.__j1dMic += 1; return original(c); };
        }
    };
    await page.addInitScript(micCounter);
    // The password sign-in is proven in a FRESH browser context after the link, so the link's own session can
    // never count as the sign-in proof. Steps 4 to 8 run there.
    let freshContext: BrowserContext | null = null;
    let main: Page = page;

    try {
        // 1. Sign up through the app. With confirmation on, the app's own post-signup sign-in is refused (the account is unconfirmed).
        await step(rows, 'signup from the homepage Get Started link creates an unconfirmed account', async () => {
            await openFromHomepage(page, 'Get Started', '/auth/signup');
            await page.getByTestId('email-input').fill(email);
            await page.getByTestId('password-input').fill(password);
            await page.getByTestId('sign-up-submit').click();
            await page.getByTestId('signup-inline-error').or(page.getByTestId('auth-error-message')).first().waitFor({ state: 'visible', timeout: 30_000 });
            const created = await userByEmail(email);
            if (!created) return { status: 'FAIL', reason: 'account_not_created' };
            uid = created.id;
            if (created.email_confirmed_at) return { status: 'FAIL', reason: 'confirmed_without_link' };
            if (await sessionUid(page)) return { status: 'FAIL', reason: 'session_before_confirmation' };
            observations.push('with confirmation on, the app shows its generic error after signup (its post-signup sign-in is refused), not the check-your-email message');
            return { status: 'PASS', reason: 'created_unconfirmed' };
        });
        // 2. Sign-in is refused before confirmation.
        await step(rows, 'sign-in is refused before confirmation', async () => {
            await page.goto(`${APP}/auth/signin`);
            await visibleReady(page);
            await signInThroughForm(page, email, password);
            await page.getByTestId('auth-error-message').waitFor({ state: 'visible', timeout: 30_000 });
            return (await sessionUid(page)) ? { status: 'FAIL', reason: 'signed_in_unconfirmed' } : { status: 'PASS', reason: 'refused_unconfirmed' };
        });
        // 3. The confirmation message for exactly this address, from local Mailpit; its local link confirms the account.
        await step(rows, 'confirmation through the local Mailpit link', async () => {
            const msg = await mailFor(email, 30_000);
            if (msg.state !== 'found') return { status: 'HOLD', reason: `confirmation_${msg.state}` };
            const res = await fetch(`${MAIL}/api/v1/message/${encodeURIComponent(msg.id)}`);
            const body = res.ok ? await res.json() as { Text?: string; HTML?: string } : null;
            const found = body ? confirmationLink(`${body.Text ?? ''}\n${body.HTML ?? ''}`, API) : null;
            if (!found) return { status: 'HOLD', reason: 'confirmation_link_unusable' };
            link = found;
            await page.goto(link);
            await visibleReady(page);
            const confirmed = await userByEmail(email);
            return confirmed?.email_confirmed_at ? { status: 'PASS', reason: 'confirmed' } : { status: 'FAIL', reason: 'not_confirmed_after_link' };
        });
        // 4. Password sign-in after confirmation, in a fresh browser context (no session from the link), and the owner's own detail.
        await step(rows, 'password sign-in from the homepage Sign In link, in a fresh browser context', async () => {
            freshContext = await browser.newContext();
            main = await freshContext.newPage();
            await main.addInitScript(micCounter);
            await main.goto(`${APP}/`);
            await visibleReady(main);
            if (await sessionUid(main)) return { status: 'HOLD', reason: 'fresh_context_not_fresh' };
            await openFromHomepage(main, 'Sign In', '/auth/signin');
            await signInThroughForm(main, email, password);
            await expect.poll(() => sessionUid(main), { timeout: 30_000 }).toBe(uid);
            // Signed in, the header's two signed-out links are gone and the account menu is there (not the whole header).
            await main.getByTestId('nav-account-avatar').waitFor({ state: 'visible', timeout: 30_000 });
            for (const name of ['Sign In', 'Get Started']) {
                if (await signedOutLinks(main).getByRole('link', { name, exact: true }).count() !== 0) return { status: 'FAIL', reason: 'signed_out_links_still_shown' };
            }
            await main.goto(`${APP}${PROTECTED}`);
            await visibleReady(main);
            await main.getByTestId('membership-status').waitFor({ state: 'visible', timeout: 30_000 });
            return { status: 'PASS', reason: 'signed_in_with_owned_detail' };
        });
        const sessionsBefore = await sessionsOf(uid);
        // 5. Sign out through the app: the session clears.
        await step(rows, 'sign-out through the app clears the session', async () => {
            await signOutThroughApp(main);
            await expect.poll(() => sessionUid(main), { timeout: 15_000 }).toBeNull();
            return { status: 'PASS', reason: 'session_cleared' };
        });
        // 6. Signed out, the exact protected link redirects to sign-in, shows no protected content, and reads no owned row.
        await step(rows, 'signed-out protected link redirects to sign-in', async () => {
            let ownedRead = false;
            const watch = async (r: Response) => {
                if (!r.url().startsWith(`${API}/rest/v1/`) || r.status() !== 200) return;
                const text = await r.text().catch(() => '');
                if (text.trim() !== '' && text.trim() !== '[]' && text.trim() !== 'null') ownedRead = true;
            };
            main.on('response', watch);
            await main.goto(`${APP}${PROTECTED}`);
            await visibleReady(main);
            await main.waitForTimeout(2_000);
            const visible = await main.getByTestId('account-page').or(main.getByTestId('membership-status')).first().isVisible().catch(() => false);
            main.off('response', watch);
            return signedOutRedirectVerdict({ requested: PROTECTED, landedPath: new URL(main.url()).pathname, protectedContentVisible: visible, ownedReadSucceeded: ownedRead });
        });
        // 7. Sign back in from that redirect: the same account returns to the exact protected route and its own detail.
        await step(rows, 'sign back in to the same account and its own detail', async () => {
            await signInThroughForm(main, email, password);
            await main.waitForURL((u) => u.pathname === PROTECTED, { timeout: 30_000 }).catch(() => undefined);
            const owned = await main.getByTestId('membership-status').waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
            return sameAccountVerdict({ createdUid: uid, sessionUid: await sessionUid(main), landedPath: new URL(main.url()).pathname, requested: PROTECTED,
                ownedDetailVisible: owned });
        });
        // 8. Returning opened no microphone and created no recording or session.
        await step(rows, 'return is quiet: no microphone, no new session', async () => quietReturnVerdict({
            micAcquisitions: await main.evaluate(() => (window as unknown as { __j1dMic?: number }).__j1dMic ?? 0), sessionsBefore, sessionsAfter: await sessionsOf(uid) }));

        // ── Negative controls, same stack: each must fail for its intended reason with the app booted ─────────────────────────
        // A fresh browser context per control, so a main-flow stop cannot leave them in an unknown signed-in state.
        const fresh = async <T>(run: (p: Page) => Promise<T>): Promise<T> => {
            const ctx = await browser.newContext();
            try { return await run(await ctx.newPage()); } finally { await ctx.close().catch(() => undefined); }
        };
        await step(controls, 'CONTROL no redirect: a signed-out public route is not a redirect', () => fresh(async (p) => {
            await p.goto(`${APP}/`);
            await visibleReady(p);
            if (await sessionUid(p)) return { status: 'HOLD', reason: 'control_not_signed_out' };
            const v = signedOutRedirectVerdict({ requested: '/', landedPath: new URL(p.url()).pathname, protectedContentVisible: false, ownedReadSucceeded: false });
            return v.reason === 'no_redirect' ? { status: 'PASS', reason: 'caught_no_redirect' } : { status: 'FAIL', reason: `control_missed_${v.reason}` };
        }));
        await step(controls, 'CONTROL different account: another account is not the created one', () => fresh(async (p) => {
            if (!uid) return { status: 'HOLD', reason: 'control_needs_the_created_account' };
            // The control account is made directly on this disposable stack (labelled control, already confirmed): it is the
            // wrong account the check must reject, not a second signup under test.
            const { data, error } = await admin.auth.admin.createUser({ email: controlEmail, password: controlPassword, email_confirm: true });
            if (error || !data.user) return { status: 'HOLD', reason: 'control_account_not_created' };
            controlUid = data.user.id;
            await p.goto(`${APP}${PROTECTED}`);
            await visibleReady(p);
            await signInThroughForm(p, controlEmail, controlPassword);
            await p.waitForURL((u) => u.pathname === PROTECTED, { timeout: 30_000 }).catch(() => undefined);
            const owned = await p.getByTestId('membership-status').waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
            const v = sameAccountVerdict({ createdUid: uid, sessionUid: await sessionUid(p), landedPath: new URL(p.url()).pathname, requested: PROTECTED,
                ownedDetailVisible: owned });
            return v.reason === 'different_account' ? { status: 'PASS', reason: 'caught_different_account' } : { status: 'FAIL', reason: `control_missed_${v.reason}` };
        }));
        await step(controls, 'CONTROL confirmation unavailable: an address with no message holds', async () => {
            const v = await mailFor(smokeIdentity(Date.now() + 2, RUN), 3_000);
            return v.state === 'unavailable' ? { status: 'PASS', reason: 'caught_confirmation_unavailable' } : { status: 'FAIL', reason: `control_missed_${v.state}` };
        });
    } finally {
        // ── The run-owned cleanup path for both accounts, then a read-back ──────────────────────────────────────────────────────
        const cleanup: Record<string, string | number | boolean> = {};
        await page.close().catch(() => undefined);
        await (freshContext as BrowserContext | null)?.close().catch(() => undefined);
        for (const [label, id, address] of [['account', uid, email], ['control', controlUid, controlEmail]] as const) {
            if (!id) { cleanup[label] = 'not_created'; continue; }
            try {
                await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: id, createdEmail: address, runOwnedPrefix: 'rwt-journey-' });
                const after = await admin.auth.admin.getUserById(id);
                const sessions = await sessionsOf(id);
                cleanup[label] = !after.data?.user && sessions === 0 ? 'deleted_and_read_back' : 'residue';
            } catch (e) {
                cleanup[label] = `failed_${e instanceof Error ? e.name : 'unknown'}`;
            }
        }
        const receipt = {
            kind: 'j1d-reserved-namespace-smoke', disposable: true, productionAcceptance: false, hostedAuthAcceptsTest: 'unproven',
            commit: process.env.J1D_SMOKE_COMMIT ?? 'unknown', migrationBaseline: process.env.J1D_SMOKE_MIGRATION_BASELINE ?? 'unknown',
            tools: process.env.J1D_SMOKE_TOOLS ?? 'unknown', run: RUN, identity: { domain: 'speaksharp.test', addressSha: sha(email) },
            assertions: rows, controls, observations, cleanup, durationMs: Date.now() - started,
        };
        const text = JSON.stringify(receipt, null, 2);
        const leaks = receiptLeaks(text, [password, controlPassword, SERVICE_ROLE, email, controlEmail, link].filter(Boolean));
        if (leaks.length === 0) writeFileSync(RECEIPT, text, { mode: 0o600 });
        expect(leaks, 'the receipt carries no secret, token, link or address').toEqual([]);
        expect(Object.values(cleanup).every((v) => v === 'deleted_and_read_back' || v === 'not_created'), 'run-owned cleanup read back').toBe(true);
    }
    expect(rows.map((r) => [r.name, r.status, r.reason])).toEqual(rows.map((r) => [r.name, 'PASS', r.reason]));
    expect(controls.map((r) => [r.name, r.status])).toEqual(controls.map((r) => [r.name, 'PASS']));
    expect(rows).toHaveLength(8);
    expect(controls).toHaveLength(3);
});
