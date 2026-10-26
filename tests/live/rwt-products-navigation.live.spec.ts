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
import { test } from './helpers/rwtProductionTest';
import { expect, type Page } from '@playwright/test';
import { extractUidFromAuthStorage } from './helpers/proofAuthority';
import {
    AnalyticsTap,
    EntitlementTap,
    returningAccessRow,
    RWT_ACCOUNT_PREFIX,
    RwtReceipt,
    humanObservation,
    requireApprovedSurface,
    installMicAcquisitionCounter,
    micAcquisitions,
    receiptContentLeaks,
    rwtPreconditionFailures,
    suppressPageSnapshot,
    telemetryClassRows,
    signOutThroughProduct,
} from './helpers/rwtJourney';
import { FINALIZE_SETTLE_MS, FinalizationSteps, JourneyFinalizer, armWatchdog, watchProfileFor } from './helpers/rwtWatchdog';
import { bindReadbackJourneys } from './helpers/rwtOracles';
import { RWT_BROWSER_IDENTITY_ARGS } from './helpers/rwtBrowserIdentity';
import { openProductsItem, type ProductsMenuItem } from './helpers/productsMenu';
import { CoachingGenerationTap } from './helpers/coachingGenerationTap';
import { coachingRequestBudgetRow } from './helpers/rwtCoachingCollector';
import { knownSessionCount, navigationWritesVerdict } from './helpers/rwtNavigationCounts';
import {
    armPasswordSignInObserver, deepLinkLanding, deepLinkReturnVerdict, pageAttemptEvents, returningSignInVerdict, type SignInAttemptOutcome,
} from './helpers/returningSignInAttempt';

const SUITE = 'returning-user-navigation';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
/** An explicitly authorized factory account wins; otherwise the maintained Free account. */
const RETURNING_EMAIL = process.env.RWT_RETURNING_EMAIL || process.env.FREE_TEST_EMAIL || '';
const RETURNING_PASSWORD = process.env.RWT_RETURNING_PASSWORD || process.env.FREE_TEST_PASSWORD || '';

test.use({
    permissions: ['microphone'], trace: 'off', video: 'off', screenshot: 'off',
    // #1258: `navigator.webdriver` off, so PostHog's bot filter does not discard the run's telemetry.
    launchOptions: { args: [...RWT_BROWSER_IDENTITY_ARGS] },
});

/** Chooses a Products item; false (a FAIL row, not a 5-minute hang) when the menu did not open or offer it. */
const products = (page: Page, item: ProductsMenuItem): Promise<boolean> =>
    openProductsItem(page, item).then(() => true).catch(() => false);


const readUid = async (page: Page) => extractUidFromAuthStorage(await page.evaluate(
    () => Object.keys(localStorage).map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })),
));

/** #1593 (live case 12): the journey's finalization must survive a test timeout — see `JourneyFinalizer`. */
const finalizer = new JourneyFinalizer();

test.describe('RWT — returning user and Products navigation @live', () => {
    // #1593 (Sam, #1662 RETURN control 1): the journey's ONE owned finalization (rows and receipt) — the same memoized run
    // the body's finally starts, so a test timeout still writes the receipt. This journey writes nothing, so nothing to delete.
    test.afterEach(async () => {
        await finalizer.drain();
    });

    test('an existing user signs in and moves between Open Mic and Focus Points without opening the microphone', async ({ page }, testInfo) => {
        test.setTimeout(300_000);
        // This test writes nothing, so the disposable-account write acknowledgement does not apply to it.
        const preconditions = rwtPreconditionFailures().filter((f) => !f.startsWith('AUTHORIZATION GATE'));
        if (preconditions.length > 0) throw new Error(`HOLD preconditions: ${preconditions.join('; ')}`);

        const receipt = new RwtReceipt(SUITE);
        receipt.forbid(RETURNING_EMAIL, RETURNING_PASSWORD, SERVICE_ROLE);
        receipt.meta.account = process.env.RWT_RETURNING_EMAIL ? 'authorized factory disposable' : 'maintained FREE_TEST account';
        const tap = new AnalyticsTap();
        tap.attach(page);
        // #1593 fail early: an unexpected failure, refusal or stall ends the journey in seconds, not at the timeout.
        const watch = armWatchdog({ page, tap, profile: watchProfileFor(SUITE), label: SUITE });
        const entitlement = new EntitlementTap();
        entitlement.attach(page);
        // #1593 (CLI Dev 2026-10-18): case 15's budget maximum is 0, so the campaign needs an OBSERVED zero, not an absent
        // row. The same request-boundary tap the recording journeys use counts every coaching request this page sends.
        const generations = new CoachingGenerationTap();
        generations.attach(page);
        await installMicAcquisitionCounter(page);
        await suppressPageSnapshot(testInfo);

        const finish = finalizer.once(async () => {
            // Sam, #1662 RETURN: every step is bounded and isolated, so the receipt always runs.
            const steps = new FinalizationSteps();
            await steps.step('telemetry observed', () => tap.awaitObserved(page, { journey_step: 1 }));
            // Codex P2 r4316425029: an event-specific wait returns at once when its events were decoded after the FIRST take,
            // so a lifecycle failure from the LAST take may still be queued — settle every attached page's own flush first.
            await steps.step('telemetry settle', () => tap.settleEveryPage((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
            await steps.step('watchdog', () => watch.record(receipt));
            await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
            await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations, { maximum: 0 }));
            let userJourneys: string[] = [];
            await steps.step('telemetry rows', () => {
                receipt.row('journey_step sent', tap.sent('journey_step').length > 0 ? 'PASS' : 'HOLD',
                    'journey_step left the page (sent, not yet received)', { sent: tap.sent('journey_step').length });
                // A maintained account is never given the canary claim, so its telemetry is not readback-eligible here.
                ({ userJourneys } = telemetryClassRows(receipt, tap, false, false)); // qualifies no journey (#1532)
            });
            await steps.step('receipt content check', () => {
                const leaks = receiptContentLeaks(receipt, [RETURNING_EMAIL, RETURNING_PASSWORD, SERVICE_ROLE].filter(Boolean));
                receipt.row('receipt content-free', leaks.length === 0 ? 'PASS' : 'FAIL', 'no credential or email in the receipt');
            });
            steps.report(receipt);
            receipt.write(testInfo, bindReadbackJourneys(tap.events, { recording: [], feedback: false }), tap.trafficTypes(), userJourneys);
        });
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
                await requireApprovedSurface(page, receipt);
                // G18 (#1491 item 9): judge THIS submit's own password-token exchange, not a missing uid. A refused shared
                // credential is account repair and a setup/network/service fault is inconclusive (both HOLD); only a valid
                // token that fails to establish its own session, or Practice, is a product FAIL.
                const started = Date.now();
                const after = { sessionUserMatches: false, landed: false };
                let outcome: SignInAttemptOutcome;
                if (await readUid(page)) {
                    outcome = { kind: 'inconclusive', status: null, reason: 'preexisting_session' };
                } else {
                    const attempt = armPasswordSignInObserver(pageAttemptEvents(page), {
                        authOrigin: SUPABASE_URL ? new URL(SUPABASE_URL).origin : '', timeoutMs: 60_000,
                    });
                    try {
                        try {
                            await page.getByTestId('email-input').fill(RETURNING_EMAIL);
                            await page.getByTestId('password-input').fill(RETURNING_PASSWORD);
                            await page.getByTestId('sign-in-submit').click();
                        } catch (error) {
                            if (!page.isClosed()) throw error;
                        }
                        const first = await attempt.settle();
                        if (first.kind === 'token_ok') {
                            const expected = first.userId;
                            // A boolean poll, so no identifier reaches an assertion message.
                            after.sessionUserMatches = await expect.poll(async () => (await readUid(page)) === expected, { timeout: 60_000 })
                                .toBe(true).then(() => true, () => false);
                            after.landed = after.sessionUserMatches && await page.getByTestId('practice-root')
                                .waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false);
                        }
                        // Read AFTER the session/Practice wait: another password grant in that window could have supplied
                        // this session, so it makes the attempt ambiguous (Sam 1793003212.501819).
                        outcome = attempt.final();
                        if (outcome.kind === 'token_ok' && page.isClosed()) outcome = { kind: 'inconclusive', status: null, reason: 'context_closed' };
                    } finally {
                        attempt.dispose();
                    }
                }
                const verdict = returningSignInVerdict(outcome, after, 'Practice');
                receipt.row('returning-user sign-in', verdict.verdict, verdict.detail, {
                    outcome: outcome.kind, status: outcome.status, reason: outcome.kind === 'inconclusive' ? outcome.reason : null,
                    signinMs: Date.now() - started,
                });
                if (!verdict.proceed) throw new Error(`${verdict.verdict} returning-user sign-in: ${verdict.detail}`);
            });

            // ── State verification (read-only): the intended account, with a profile and its history ─────
            let uid = '';
            let sessionsBefore: number | null = null;
            let completedBefore: number | null = null;
            let accountVerified = false;
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
                if (!knownSessionCount(all) || !knownSessionCount(done)) {
                    receipt.row('returning account state', 'HOLD', 'session counts are unavailable or invalid; account history is unverified');
                    throw new Error('HOLD returning account state: session counts are unverified');
                }
                sessionsBefore = all;
                completedBefore = done;
                accountVerified = sameAccount && Boolean(profile);
                receipt.row('returning account state', sameAccount && profile ? 'PASS' : 'FAIL',
                    sameAccount ? (profile ? 'the signed-in account is the intended existing account, with a profile' : 'the existing account has no profile') : 'the session is not the intended account',
                    { priorCompletedSessions: completedBefore });
            });

            // ── Products bridge ───────────────────────────────────────────────────────────────────────────
            await test.step('Products → Open Mic ↔ Focus Points', async () => {
                const toOpenMic = await products(page, 'open-mic') && await page.waitForURL(/\/session/, { timeout: 30_000 }).then(() => true).catch(() => false);
                receipt.row('Products → Open Mic', toOpenMic ? 'PASS' : 'FAIL', toOpenMic ? 'landed on the Open Mic session' : 'did not reach the session');
                // The returning user's access as the session page received it. This test records nothing, so an
                // expired account is a state fact (HOLD for a recording journey), not a product failure.
                await returningAccessRow(receipt, entitlement);

                const setup = await products(page, 'focus-points') && await page.getByTestId('objective-setup-dialog').waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
                receipt.row('Products → Focus Points', setup ? 'PASS' : 'FAIL', setup ? 'the Focus Points setup opened' : 'the setup did not open');

                await page.keyboard.press('Escape');
                const back = await products(page, 'open-mic') && await page.waitForURL(/\/session/, { timeout: 30_000 }).then(() => true).catch(() => false);
                receipt.row('back to Open Mic', back ? 'PASS' : 'FAIL', back ? 'returned to Open Mic' : 'could not return to Open Mic');
            });

            // ── The returning user's history through the Analytics control ───────────────────────────────
            await test.step('Analytics shows the returning user\'s history', async () => {
                const clicked = await page.getByTestId('nav-analytics-link').first().click({ timeout: 20_000 }).then(() => true).catch(() => false);
                // #1548: the Progress control lands on exactly the canonical /progress list (the /analytics alias only redirects).
                const arrived = clicked && await page.waitForURL((url) => url.pathname === '/progress', { timeout: 30_000 }).then(() => true).catch(() => false);
                if (!arrived) { receipt.row('returning history', 'FAIL', 'the Analytics control did not open Analytics'); return; }
                if (completedBefore === null || completedBefore === 0) { receipt.row('returning history', 'HOLD', 'this account has no verified completed sessions to show'); return; }
                const listed = await page.locator('[data-testid^="open-session-detail-"]').first()
                    .waitFor({ state: 'visible', timeout: 45_000 }).then(() => page.locator('[data-testid^="open-session-detail-"]').count()).catch(() => 0);
                receipt.row('returning history', listed > 0 ? 'PASS' : 'FAIL',
                    listed > 0 ? 'Analytics lists the returning user\'s saved sessions' : 'the account has saved sessions but Analytics lists none',
                    { listed, priorCompletedSessions: completedBefore });
            });

            // ── Release-level real-phone check (PM plan decision 5849354099) ────────────────────────────────
            // Once per release, in this suite only (it runs once against the final deployed SHA; the worksheet binds that
            // SHA). #1536's momentum-guard evidence is Chrome/CDP simulation; a real phone's fling is a human observation.
            // v12 preflight: real browser permissions. Automation pre-grants the microphone, so the first-use prompt is
            // never exercised here; it is a named human observation against the final deployed SHA (Dev mapping 5860497358).
            humanObservation(receipt, 'real_microphone_permission_prompt', 'v12 preflight — real permissions',
                'On a real device, does the first recording ask for the microphone and behave truthfully when allowed or denied?',
                'On a fresh browser profile at the deployed SHA: press Start. PASS only if the browser microphone prompt appears; '
                + 'Allow records normally; Deny shows the product\'s explanation and never records. Record device, OS and browser.');
            humanObservation(receipt, 'mobile_stop_confirmation_visible', 'mobile Stop (#1536)',
                'On a real phone, does the saved confirmation stay visible when Stop is tapped during a flick?',
                'On a real phone at the deployed SHA: start a take, flick the recording page, tap Stop while it is still moving, '
                + 'wait for it to rest. PASS only if the saved confirmation is within the viewport. Record the phone, OS and '
                + 'browser in the Observer cell.');

            // A returning user must have history to return to; without it the history half of this proof is missing,
            // and the run ends visibly HOLD/red rather than green (PM r4 review). Other rows above are still recorded.
            const historyUnproven = completedBefore === null || completedBefore === 0;

            // ── Nothing opened the microphone; navigation wrote nothing ──────────────────────────────────
            const mic = (await micAcquisitions(page)).length;
            receipt.row('no mic on navigation', mic === 0 ? 'PASS' : 'FAIL', mic === 0 ? 'no step opened the microphone' : 'navigation opened the microphone', { acquisitions: mic });
            const { count: after, error } = await admin!.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid);
            if (error) throw new Error(`session count failed (fail closed): ${error.code ?? 'unknown'}`);
            const writes = navigationWritesVerdict(sessionsBefore, after);
            receipt.row('navigation writes nothing', writes.status, writes.detail, { sessionsBefore, sessionsAfter: after });

            // #1258 R9 (run 38312345563): the journey takes seconds; wait (bounded) until its navigation telemetry is
            // observed leaving the page before signing out, or the queued events are lost when the page goes.
            receipt.meta.navigationTelemetryObserved = (await tap.awaitObserved(page, { journey_step: 1 })).observed;
            // Leave the shared account signed out through the product's own control; it is never deleted. A failed
            // sign-out is REPORTED (PM 6149152089), never swallowed: the next run would otherwise start signed in.
            let signOutPath: 'direct' | 'menu' | null = null;
            try { signOutPath = await signOutThroughProduct(page as never); } catch { signOutPath = null; }
            const sessionCleared = signOutPath !== null
                && await expect.poll(() => readUid(page), { timeout: 30_000 }).toBeFalsy().then(() => true, () => false);
            receipt.row('signed out after the journey', sessionCleared ? 'PASS' : 'FAIL',
                sessionCleared ? 'the product sign-out cleared the session'
                    : signOutPath === null ? 'no product sign-out control could be used' : 'sign-out did not clear the session',
                { path: signOutPath ?? 'none', sessionCleared });

            // ── G04 (#1548 / #1718): a signed-out deep link returns, after sign-in, to its exact Progress session ─────────
            // Routing only; the rendered detail is not claimed. Gated on the verified account and its cleared first session, and
            // the second sign-in must be that same account. The session is read by id only and forbidden in the receipt.
            await test.step('a signed-out deep link returns to its exact Progress session after sign-in', async () => {
                if (!accountVerified || !sessionCleared) {
                    receipt.row('signed-in deep-link return', 'HOLD', 'routing unproven: needs the verified returning account and its cleared first session');
                    return;
                }
                const { data: newest, error: newestErr } = await admin!.from('sessions').select('id')
                    .eq('user_id', uid).eq('status', 'completed').order('created_at', { ascending: false }).limit(1).maybeSingle();
                const targetId = !newestErr && typeof newest?.id === 'string' && newest.id.length > 0 ? newest.id : null;
                if (!targetId) {
                    receipt.row('signed-in deep-link return', 'HOLD', 'routing unproven: no completed session to link to, or the read failed');
                    return;
                }
                receipt.forbid(targetId);
                const target = { pathname: `/progress/${targetId}`, search: '?g04=1', hash: '#history' };
                try {
                    // A hard navigation to the legacy link while signed out, then the auth form it produced. Opening the auth
                    // page directly would discard the return state.
                    await page.goto(`/analytics/${targetId}?g04=1#history`);
                    await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
                    let sessionUserMatches = false;
                    let landedUrl: URL | null = null;
                    const observer = armPasswordSignInObserver(pageAttemptEvents(page), {
                        authOrigin: SUPABASE_URL ? new URL(SUPABASE_URL).origin : '', timeoutMs: 60_000,
                    });
                    try {
                        try {
                            await page.getByTestId('email-input').fill(RETURNING_EMAIL);
                            await page.getByTestId('password-input').fill(RETURNING_PASSWORD);
                            await page.getByTestId('sign-in-submit').click();
                        } catch (error) {
                            if (!page.isClosed()) throw error;
                        }
                        const first = await observer.settle();
                        if (first.kind === 'token_ok') {
                            const expected = first.userId;
                            // Boolean poll and pathname-only wait, so no identifier reaches an assertion message.
                            sessionUserMatches = await expect.poll(async () => (await readUid(page)) === expected, { timeout: 60_000 })
                                .toBe(true).then(() => true, () => false);
                            await page.waitForURL((url) => url.pathname === target.pathname, { timeout: 30_000 }).catch(() => undefined);
                            landedUrl = page.isClosed() ? null : new URL(page.url());
                        }
                        // Read AFTER the landing wait: another password grant in that window makes the attempt ambiguous.
                        const outcome = observer.final();
                        const landing = landedUrl ? deepLinkLanding(landedUrl, target) : { pathnameMatches: false, searchMatches: false, hashMatches: false };
                        const verdict = deepLinkReturnVerdict({ outcome, verifiedUserId: uid, sessionUserMatches, landing });
                        receipt.row('signed-in deep-link return', verdict.verdict, verdict.detail, { outcome: outcome.kind, ...landing });
                    } finally {
                        observer.dispose();
                    }
                } finally {
                    // Cleanup runs even after a failed landing: sign out again, then read back that nothing was written.
                    let returnSignOut: 'direct' | 'menu' | null = null;
                    try { returnSignOut = await signOutThroughProduct(page as never); } catch { returnSignOut = null; }
                    const cleared = returnSignOut !== null
                        && await expect.poll(() => readUid(page), { timeout: 30_000 }).toBeFalsy().then(() => true, () => false);
                    receipt.row('signed out after the deep-link return', cleared ? 'PASS' : 'FAIL',
                        cleared ? 'the product sign-out cleared the second session' : 'the second session was not cleared',
                        { path: returnSignOut ?? 'none', sessionCleared: cleared });
                    const { count: afterDeepLink, error: countErr } = await admin!.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid);
                    const writes = countErr ? { status: 'HOLD' as const, detail: 'the session count could not be read back' } : navigationWritesVerdict(sessionsBefore, afterDeepLink);
                    receipt.row('deep-link return writes nothing', writes.status, writes.detail, { sessionsBefore, sessionsAfter: countErr ? null : afterDeepLink });
                }
            });
            // ── end G04 ───────────────────────────────────────────────────────────────────────────────────────────────

            if (historyUnproven) throw new Error('HOLD returning history: the returning-user account has no saved session, so returning history is unproven');
        } finally {
            await finish();
        }
    });
});
