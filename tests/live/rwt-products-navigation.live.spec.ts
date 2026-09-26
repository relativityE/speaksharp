/**
 * RWT — RETURNING USER + PRODUCTS NAVIGATION (PM contract #1258 item 3(b) and the Products bridge).
 *
 * The first-visit path (real signup of a brand-new account) lives in the Open Mic and Focus Points suites. This is
 * the OTHER entry path: a person who already has an account signs in through the real /auth/signin form and returns
 * to the product. It then proves the bridge between the two products:
 *   sign in (existing credential) → Practice → Products → Open Mic lands on the session → Products → Focus Points
 *   opens the setup → back to Open Mic → the Analytics control shows their history;
 *   no step opens the microphone, and navigation writes no session.
 *
 * THE ACCOUNT IS NOT THE RUN'S. It is a maintained, state-verified test account (FREE_TEST_*, per AGENTS.md reusable
 * accounts) or an explicitly authorized setup-test-users.yml disposable passed as RWT_RETURNING_*. The run never
 * creates, claims, mutates or deletes it; it only reads its state. The password comes from Actions secrets, is typed
 * into the real form (trace, video and screenshots are off) and is never logged. Missing credentials are a named
 * HOLD row, never a skip that reads as a pass.
 *
 * DISPATCH: rc-gates.yml gate=gate-3-dast diagnostic_dast_spec=tests/live/rwt-products-navigation.live.spec.ts
 */
import { createClient } from '@supabase/supabase-js';
import { test } from './helpers/deployedLiveTest';
import { expect, type Page } from '@playwright/test';
import { extractUidFromAuthStorage } from './helpers/proofAuthority';
import {
    AnalyticsTap,
    EntitlementTap,
    RWT_ACCOUNT_PREFIX,
    RwtReceipt,
    approvedSurfaceFailures,
    installMicAcquisitionCounter,
    micAcquisitions,
    receiptContentLeaks,
    rwtPreconditionFailures,
    suppressPageSnapshot,
    telemetryClassRows,
} from './helpers/rwtJourney';

const SUITE = 'returning-user-navigation';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
/** An explicitly authorized factory account wins; otherwise the maintained Free account. */
const RETURNING_EMAIL = process.env.RWT_RETURNING_EMAIL || process.env.FREE_TEST_EMAIL || '';
const RETURNING_PASSWORD = process.env.RWT_RETURNING_PASSWORD || process.env.FREE_TEST_PASSWORD || '';

test.use({ permissions: ['microphone'], trace: 'off', video: 'off', screenshot: 'off' });

/** Opens the Products menu item on whichever header this viewport renders. */
async function products(page: Page, item: 'open-mic' | 'focus-points'): Promise<void> {
    const desktop = page.getByTestId('nav-products-button');
    if (await desktop.isVisible().catch(() => false)) {
        await desktop.click();
        await page.getByTestId(`nav-products-${item}`).click();
        return;
    }
    await page.getByTestId('nav-mobile-products-button').click();
    await page.getByTestId(`nav-mobile-products-${item}`).click();
}

const readUid = async (page: Page) => extractUidFromAuthStorage(await page.evaluate(
    () => Object.keys(localStorage).map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })),
));

test.describe('RWT — returning user and Products navigation @live', () => {
    test('an existing user signs in and moves between Open Mic and Focus Points without opening the microphone', async ({ page }, testInfo) => {
        test.setTimeout(300_000);
        // This test writes nothing, so the disposable-account write acknowledgement does not apply to it.
        const preconditions = rwtPreconditionFailures().filter((f) => !f.startsWith('AUTHORIZATION GATE'));
        if (preconditions.length > 0) throw new Error(`HOLD preconditions: ${preconditions.join('; ')}`);

        const receipt = new RwtReceipt(SUITE);
        receipt.meta.account = process.env.RWT_RETURNING_EMAIL ? 'authorized factory disposable' : 'maintained FREE_TEST account';
        const tap = new AnalyticsTap();
        tap.attach(page);
        const entitlement = new EntitlementTap();
        entitlement.attach(page);
        await installMicAcquisitionCounter(page);
        await suppressPageSnapshot(testInfo);

        try {
            if (!RETURNING_EMAIL || !RETURNING_PASSWORD) {
                receipt.row('returning-user sign-in', 'HOLD',
                    'no returning-user credential in this run: needs vars.FREE_TEST_EMAIL + secrets.FREE_TEST_PASSWORD, or an authorized setup-test-users account as RWT_RETURNING_*');
                // Visibly red: a run that proved neither sign-in nor history must never report success (PM r4 review).
                throw new Error('HOLD returning-user sign-in: no returning-user credential was supplied to this run');
            }
            // Never a run-owned account: this test must not be pointed at anything a cleanup could delete.
            if (RETURNING_EMAIL.startsWith(RWT_ACCOUNT_PREFIX)) throw new Error('HOLD the returning-user account must not be a run-owned rwt-journey- account');

            // ── Real sign-in through /auth/signin ────────────────────────────────────────────────────────
            await test.step('returning user signs in through the real form', async () => {
                await page.goto('/auth/signin');
                await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
                const surface = await approvedSurfaceFailures(page);
                if (surface.length > 0) throw new Error(`HOLD surface: ${surface.join('; ')}`);
                const started = Date.now();
                await page.getByTestId('email-input').fill(RETURNING_EMAIL);
                await page.getByTestId('password-input').fill(RETURNING_PASSWORD);
                await page.getByTestId('sign-in-submit').click();
                const signedIn = await expect.poll(() => readUid(page), { timeout: 60_000 }).toBeTruthy().then(() => true).catch(() => false);
                const landed = await page.getByTestId('practice-root').waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false);
                receipt.row('returning-user sign-in', signedIn && landed ? 'PASS' : 'FAIL',
                    signedIn ? (landed ? 'signed in with an existing credential and landed on Practice' : 'signed in but Practice did not load') : 'sign-in with the existing credential failed',
                    { signinMs: Date.now() - started });
                if (!signedIn) throw new Error('FAIL returning-user sign-in');
            });

            // ── State verification (read-only): the intended account, with a profile and its history ─────
            let uid = '';
            let sessionsBefore = 0;
            let completedBefore = 0;
            await test.step('the existing account is state-verified (read-only)', async () => {
                uid = (await readUid(page)) ?? '';
                const { data: user, error } = await admin!.auth.admin.getUserById(uid);
                if (error) throw new Error(`account lookup failed (fail closed): ${error.code ?? 'unknown'}`);
                const sameAccount = (user.user?.email ?? '').toLowerCase() === RETURNING_EMAIL.toLowerCase();
                const { data: profile, error: pErr } = await admin!.from('user_profiles').select('id').eq('id', uid).maybeSingle();
                if (pErr) throw new Error(`profile lookup failed (fail closed): ${pErr.code ?? 'unknown'}`);
                const { count: all, error: sErr } = await admin!.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid);
                const { count: done, error: dErr } = await admin!.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'completed');
                if (sErr || dErr) throw new Error('session count failed (fail closed)');
                sessionsBefore = all ?? 0;
                completedBefore = done ?? 0;
                receipt.row('returning account state', sameAccount && profile ? 'PASS' : 'FAIL',
                    sameAccount ? (profile ? 'the signed-in account is the intended existing account, with a profile' : 'the existing account has no profile') : 'the session is not the intended account',
                    { priorCompletedSessions: completedBefore });
            });

            // ── Products bridge ───────────────────────────────────────────────────────────────────────────
            await test.step('Products → Open Mic ↔ Focus Points', async () => {
                await products(page, 'open-mic');
                const toOpenMic = await page.waitForURL(/\/session/, { timeout: 30_000 }).then(() => true).catch(() => false);
                receipt.row('Products → Open Mic', toOpenMic ? 'PASS' : 'FAIL', toOpenMic ? 'landed on the Open Mic session' : 'did not reach the session');
                // The returning user's access as the session page received it. This test records nothing, so an
                // expired account is a state fact (HOLD for a recording journey), not a product failure.
                await entitlement.settle();
                const verdict = entitlement.responses[0];
                receipt.row('returning-user access', !verdict ? 'HOLD' : verdict.can_start === true ? 'PASS' : 'HOLD',
                    !verdict ? 'no check-usage-limit response was observed' : verdict.can_start === true
                        ? 'the server lets this returning user start a recording' : 'this account cannot start a recording (expired or unentitled); not used for a recording journey',
                    { canStart: verdict?.can_start === true, trialActive: verdict?.trial_active === true, isPro: verdict?.is_pro === true });

                await products(page, 'focus-points');
                const setup = await page.getByTestId('objective-setup-dialog').waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
                receipt.row('Products → Focus Points', setup ? 'PASS' : 'FAIL', setup ? 'the Focus Points setup opened' : 'the setup did not open');

                await page.keyboard.press('Escape');
                await products(page, 'open-mic');
                const back = await page.waitForURL(/\/session/, { timeout: 30_000 }).then(() => true).catch(() => false);
                receipt.row('back to Open Mic', back ? 'PASS' : 'FAIL', back ? 'returned to Open Mic' : 'could not return to Open Mic');
            });

            // ── The returning user's history through the Analytics control ───────────────────────────────
            await test.step('Analytics shows the returning user\'s history', async () => {
                const clicked = await page.getByTestId('nav-analytics-link').first().click({ timeout: 20_000 }).then(() => true).catch(() => false);
                const arrived = clicked && await page.waitForURL(/\/analytics/, { timeout: 30_000 }).then(() => true).catch(() => false);
                if (!arrived) { receipt.row('returning history', 'FAIL', 'the Analytics control did not open Analytics'); return; }
                if (completedBefore === 0) { receipt.row('returning history', 'HOLD', 'this account has no completed sessions to show'); return; }
                const listed = await page.locator('[data-testid^="open-session-detail-"]').first()
                    .waitFor({ state: 'visible', timeout: 45_000 }).then(() => page.locator('[data-testid^="open-session-detail-"]').count()).catch(() => 0);
                receipt.row('returning history', listed > 0 ? 'PASS' : 'FAIL',
                    listed > 0 ? 'Analytics lists the returning user\'s saved sessions' : 'the account has saved sessions but Analytics lists none',
                    { listed, priorCompletedSessions: completedBefore });
            });

            // A returning user must have history to return to; without it the history half of this proof is missing,
            // and the run ends visibly HOLD/red rather than green (PM r4 review). Other rows above are still recorded.
            const historyUnproven = completedBefore === 0;

            // ── Nothing opened the microphone; navigation wrote nothing ──────────────────────────────────
            const mic = (await micAcquisitions(page)).length;
            receipt.row('no mic on navigation', mic === 0 ? 'PASS' : 'FAIL', mic === 0 ? 'no step opened the microphone' : 'navigation opened the microphone', { acquisitions: mic });
            const { count: after, error } = await admin!.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid);
            if (error) throw new Error(`session count failed (fail closed): ${error.code ?? 'unknown'}`);
            receipt.row('navigation writes nothing', (after ?? 0) === sessionsBefore ? 'PASS' : 'FAIL',
                'navigation alone created no session', { sessionsBefore, sessionsAfter: after ?? null });

            // Leave the shared account signed out through the product's own control; it is never deleted.
            await page.getByTestId('sign-out-button').or(page.getByTestId('nav-sign-out-button')).first().click({ timeout: 10_000 }).catch(() => undefined);
            if (historyUnproven) throw new Error('HOLD returning history: the returning-user account has no saved session, so returning history is unproven');
        } finally {
            receipt.row('journey_step sent', tap.sent('journey_step').length > 0 ? 'PASS' : 'HOLD',
                'journey_step left the page (sent, not yet received)', { sent: tap.sent('journey_step').length });
            // A maintained account is never given the canary claim, so its telemetry is not readback-eligible here.
            const { canaryJourneys, userJourneys } = telemetryClassRows(receipt, tap, false);
            const leaks = receiptContentLeaks(receipt, [RETURNING_EMAIL, RETURNING_PASSWORD, SERVICE_ROLE].filter(Boolean));
            receipt.row('receipt content-free', leaks.length === 0 ? 'PASS' : 'FAIL', 'no credential or email in the receipt');
            receipt.write(testInfo, canaryJourneys, tap.trafficTypes(), [], userJourneys);
        }
    });
});
