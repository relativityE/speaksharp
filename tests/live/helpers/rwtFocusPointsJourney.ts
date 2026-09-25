/**
 * RWT Focus Points journey (PO script rows 8–12), shared by the two INDEPENDENT Focus Points specs — the PO corpus
 * (`rwt-focus-points-session.live.spec.ts`) and the partial Dev fixture (`rwt-focus-points-partial.live.spec.ts`).
 * Each spec owns its browser (the fake microphone file is a launch option), account, receipt and cleanup.
 */
import { createClient } from '@supabase/supabase-js';
import { test } from './deployedLiveTest';
import { expect, type Page, type TestInfo } from '@playwright/test';
import {
    selectBenchmarkMode,
    preparePrivateModelIfPrompted,
    waitForPrivateEngineReady,
    startBenchmarkRecording,
    stopBenchmarkRecording,
    waitForBenchmarkSaveCandidate,
} from './benchmark-utils';
import { MODEL_COMPARISON_AUTH_KEY } from './practiceLoopJourney';
import {
    AnalyticsTap,
    RwtReceipt,
    approvedSurfaceFailures,
    armCandidateSwitch,
    installMicAcquisitionCounter,
    loadRwtFixture,
    markRunOwnedAccountCanary,
    micAcquisitions,
    newDisposableEmail,
    nextStartEvidence,
    nextStartRows,
    modelIdentityRow,
    shareFeedbackRows,
    analyticsRows,
    analyticsThroughActions,
    performCandidateSwitch,
    readSttIdentity,
    receiptContentLeaks,
    resolveRunTarget,
    rwtPreconditionFailures,
    sha256Hex,
    signUpDisposableAccount,
    suppressPageSnapshot,
    telemetryClassRows,
    canaryClaimRow,
    EntitlementTap,
    entitlementRow,
    runOwnedIdentityFailures,
    type FixtureKey,
    type RunTarget,
} from './rwtJourney';

const JOURNEY = 'focus_points';
export const WEBGPU = process.env.RWT_WEBGPU === '1';
/** The pace guide the script sets (1:00 per point). The measured average must NOT simply echo it. */
const GUIDE_SECONDS = 60;
/** Tolerance on elapsed ÷ detected: the take's wall clock vs the product's own duration, in seconds. */
const AVERAGE_TOLERANCE_SECONDS = 4;
/**
 * The live-marker timing oracle (PM 2026-09-25). Audio time zero is the take's own microphone acquisition (Chromium
 * starts the fake file when the capture opens), so each marker change is placed on the audio's clock against the
 * point's waveform-pinned window: it must land while the point is spoken or at most 5 s after it ends, AND before the
 * next point begins. The alignment slack only absorbs capture-start jitter; observed latency is always recorded.
 */
const MARKER_ALIGNMENT_SLACK_SECONDS = 1;
const LIVE_MARKER_MAX_AFTER_SECONDS = 5;

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

type RailStatus = 'pending' | 'partial' | 'covered' | 'missing';

const readRail = async (page: Page, count: number): Promise<{ statuses: (RailStatus | null)[]; next: number | null }> => {
    const statuses: (RailStatus | null)[] = [];
    let next: number | null = null;
    for (let i = 0; i < count; i += 1) {
        const row = page.getByTestId(`focus-point-${i}`);
        statuses.push((await row.getAttribute('data-status', { timeout: 1_000 }).catch(() => null)) as RailStatus | null);
        if (next === null && (await row.getByText('Still to cover', { exact: true }).count().catch(() => 0)) > 0) next = i;
    }
    return { statuses, next };
};

const parseClock = (text: string): number | null => {
    const match = /(\d+):(\d{2})/.exec(text);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** Does the final rail state satisfy the fixture's expectation for this point? */
const meetsExpectation = (expected: string, got: RailStatus | null): boolean => {
    if (expected === 'covered') return got === 'covered';
    if (expected === 'missing') return got === 'missing';
    if (expected === 'not-covered-or-partial') return got === 'partial' || got === 'missing';
    return false;
};

export async function focusPointsJourney(page: Page, testInfo: TestInfo, fixtureKey: FixtureKey, suite: string, owner: { email: string; uid: string }) {
    const preconditions = rwtPreconditionFailures();
    if (preconditions.length > 0) throw new Error(`HOLD preconditions: ${preconditions.join('; ')}`);
    const run: RunTarget = await resolveRunTarget(JOURNEY);
    const fixture = loadRwtFixture(fixtureKey);
    const topic = fixture.entry.topic ?? '';
    const points = fixture.entry.points ?? [];
    const expectedFinal = fixture.entry.expectedFinal ?? [];

    const receipt = new RwtReceipt(suite);
    receipt.meta.fixture = fixture.key;
    receipt.meta.fixtureKind = fixture.entry.kind;
    receipt.meta.fixtureSha256 = fixture.entry.sha256;
    receipt.meta.target = run.label;
    receipt.meta.webgpu = WEBGPU;
    receipt.meta.points = points.length;
    receipt.row('base_q4 primary', 'HOLD', 'the one-run switch cannot select v4 base_q4 yet; this run is not base_q4 evidence');

    const tap = new AnalyticsTap();
    tap.attach(page);
    const entitlement = new EntitlementTap();
    entitlement.attach(page);
    await installMicAcquisitionCounter(page);
    await armCandidateSwitch(page, run, MODEL_COMPARISON_AUTH_KEY);
    await suppressPageSnapshot(testInfo);

    let persistedId: string | null = null;
    let claimed = false;
    try {
        await test.step('account — sign up, canary claim (if authorized), sign back in', async () => {
            await page.goto('/auth/signup');
            await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
            const surface = await approvedSurfaceFailures(page);
            if (surface.length > 0) throw new Error(`HOLD surface: ${surface.join('; ')}`);
            owner.email = newDisposableEmail('focus-points');
            const account = await signUpDisposableAccount(page, owner.email);
            owner.uid = account.uid;
            const identity = await runOwnedIdentityFailures(admin as never, owner.uid, owner.email);
            if (identity.length > 0) throw new Error(`FAIL first-visit identity: ${identity.join('; ')}`);
            claimed = await markRunOwnedAccountCanary(admin as never, owner.uid, owner.email);
            receipt.meta.canaryClaim = claimed;
            await account.signOutAndSignIn();
            await canaryClaimRow(page, receipt, claimed);
        });

        // ── Row 8 — Products → Focus Points ─────────────────────────────────────────────────────────────
        await test.step('row 8 — Products → Focus Points opens the setup', async () => {
            await page.goto('/practice');
            await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 60_000 });
            const switched = await performCandidateSwitch(page, run, JOURNEY);
            receipt.meta.switchOutcome = switched;
            if (run.mode === 'switch' && switched !== 'ok') throw new Error(`HOLD candidate switch: ${switched}`);
            const desktop = page.getByTestId('nav-products-button');
            if (await desktop.isVisible().catch(() => false)) {
                await desktop.click();
                await page.getByTestId('nav-products-focus-points').click();
            } else {
                await page.getByTestId('nav-mobile-products-button').click();
                await page.getByTestId('nav-mobile-products-focus-points').or(page.getByTestId('nav-mobile-focus-points-link')).first().click();
            }
            const opened = await page.getByTestId('objective-setup-dialog').waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
            const mic = (await micAcquisitions(page)).length;
            receipt.row('Products → Focus Points', opened ? 'PASS' : 'FAIL', opened ? 'the setup opened' : 'the setup did not open');
            receipt.row('no mic on navigation', mic === 0 ? 'PASS' : 'FAIL', mic === 0 ? 'navigation opened no microphone' : 'the microphone opened on navigation', { acquisitions: mic });
            if (!opened) throw new Error('row 8 FAIL: Focus Points setup did not open');
        });

        // ── Row 9 — the brief ───────────────────────────────────────────────────────────────────────────
        await test.step('row 9 — topic, four points, pace 1:00, Head to session', async () => {
            await page.getByTestId('objective-goal-select').selectOption('other');
            await page.getByTestId('objective-goal-input').fill(topic);
            for (let i = 0; i < points.length; i += 1) {
                if ((await page.getByTestId(`objective-point-label-${i}`).count()) === 0) await page.getByTestId('objective-add-point').click();
                await page.getByTestId(`objective-point-label-${i}`).fill(points[i]);
            }
            const pace = parseClock(await page.getByTestId('objective-pace-value').innerText());
            receipt.row('pace guide', pace === GUIDE_SECONDS ? 'PASS' : 'FAIL', pace === GUIDE_SECONDS ? 'the default guide is 1:00 per point' : 'the guide is not 1:00', { paceSeconds: pace });
            await page.getByTestId('objective-setup-submit').click();
            const arrived = await page.waitForURL(/\/session/, { timeout: 45_000 }).then(() => true).catch(() => false);
            const mic = (await micAcquisitions(page)).length;
            receipt.row('Head to session', arrived && mic === 0 ? 'PASS' : 'FAIL',
                arrived ? (mic === 0 ? 'the session opened with the microphone still off' : 'the microphone opened on Head to session') : 'the session did not open',
                { acquisitions: mic });
            if (!arrived) throw new Error('row 9 FAIL: Head to session did not navigate');
        });

        await entitlementRow(receipt, entitlement, 120);

        // ── Row 10 — live markers ───────────────────────────────────────────────────────────────────────
        let startedAt = 0;
        let stoppedAt = 0;
        const firstChange: Array<{ status: RailStatus; atSec: number; atMs: number } | null> = points.map(() => null);
        const nextSequence: number[] = [];
        await test.step('row 10 — markers change while each point is spoken', async () => {
            await expect(page.getByTestId('focus-points-rail')).toBeVisible({ timeout: 45_000 });
            const before = await readRail(page, points.length);
            const neutral = before.statuses.every((s) => s === 'pending');
            receipt.row('rail before speaking', neutral ? 'PASS' : 'FAIL', neutral ? 'every point starts pending' : 'a point was marked before any speech',
                { rows: before.statuses.length });

            const acquisitionStarted = Date.now();
            await selectBenchmarkMode(page, 'private');
            const setup = await preparePrivateModelIfPrompted(page, 900_000);
            if (!setup.recordingAlreadyStarted) {
                await waitForPrivateEngineReady(page, 600_000);
                await startBenchmarkRecording(page, suite);
            }
            startedAt = Date.now();
            modelIdentityRow(receipt, run, await readSttIdentity(page), startedAt - acquisitionStarted);

            const until = startedAt + Math.round((fixture.entry.speechSeconds + 4) * 1000);
            while (Date.now() < until) {
                const now = await readRail(page, points.length);
                now.statuses.forEach((status, i) => {
                    if (!firstChange[i] && status && status !== 'pending') firstChange[i] = { status, atSec: Math.round((Date.now() - startedAt) / 1000), atMs: Date.now() };
                });
                if (now.next !== null && nextSequence[nextSequence.length - 1] !== now.next) nextSequence.push(now.next);
                await page.waitForTimeout(500);
            }
            const expectedLive = expectedFinal.filter((e) => e === 'covered').length;
            const liveChanged = firstChange.filter(Boolean).length;
            const ordered = firstChange.filter(Boolean).every((c, i, all) => i === 0 || c!.atSec >= all[i - 1]!.atSec);
            receipt.row('live marker changes', liveChanged >= expectedLive && ordered ? 'PASS' : 'FAIL',
                liveChanged >= expectedLive ? 'markers changed during speech, in speaking order' : 'markers did not change during speech (Stop-time-only detection fails this row)',
                { changedDuringSpeech: liveChanged, expected: expectedLive, firstChangeSec: firstChange.map((c) => (c ? `${c.status}@${c.atSec}` : 'none')).join(',') });
            receipt.row('next point marked', nextSequence.length > 1 ? 'PASS' : 'FAIL',
                nextSequence.length > 1 ? 'the "Still to cover" marker advanced as points were detected' : 'the next point was not visibly advanced',
                { nextSequence: nextSequence.join('>') });
            // Time-anchored oracle: each marker change placed on the audio clock against the manifest's spoken window.
            const windows = fixture.entry.pointAudioWindows;
            const takeOpen = (await micAcquisitions(page)).filter((at) => at <= startedAt + 1_000).pop() ?? null;
            if (!windows || takeOpen === null) {
                receipt.row('marker timing vs audio', 'HOLD', windows ? 'the take\'s microphone acquisition was not observed' : 'this fixture has no point audio windows');
            } else {
                const nextStart = (i: number): number | null => {
                    for (let j = i + 1; j < windows.length; j += 1) { const w = windows[j]; if (w) return w[0]; }
                    return null;
                };
                const verdicts = points.map((_, i) => {
                    const window = windows[i] ?? null;
                    const change = firstChange[i];
                    // A point never spoken must never be marked, at any time.
                    if (window === null) return change ? 'marked-though-never-spoken' : 'ok-unspoken';
                    if (!change) return expectedFinal[i] === 'covered' ? 'no-live-change' : 'ok-no-change';
                    const audioSec = (change.atMs - takeOpen) / 1000;
                    const latency = (audioSec - window[1]).toFixed(1); // negative = during the point
                    const next = nextStart(i);
                    const deadline = Math.min(window[1] + LIVE_MARKER_MAX_AFTER_SECONDS, next ?? Number.POSITIVE_INFINITY);
                    if (audioSec < window[0] - MARKER_ALIGNMENT_SLACK_SECONDS) return `early@${audioSec.toFixed(1)}`;
                    if (audioSec > deadline) return `late@${audioSec.toFixed(1)}(+${latency}s)`;
                    return `ok@${audioSec.toFixed(1)}(${latency}s)`;
                });
                const ok = verdicts.every((v) => v.startsWith('ok'));
                receipt.row('marker timing vs audio', ok ? 'PASS' : 'FAIL',
                    ok ? 'each marker changed while its point was spoken or within 5 s after, before the next point' : 'a marker changed before its point was spoken, more than 5 s after it or after the next point began, or for an unspoken point',
                    { perPoint: verdicts.join(','), maxAfterPointSec: LIVE_MARKER_MAX_AFTER_SECONDS });
            }
        });

        // ── Row 11 — Stop: verdicts, n/4, average ───────────────────────────────────────────────────────
        await test.step('row 11 — Stop: verdicts, count and average', async () => {
            stoppedAt = Date.now();
            await stopBenchmarkRecording(page, suite, 180_000);
            await waitForBenchmarkSaveCandidate(page, suite, 180_000);
            await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 120_000 });
            persistedId = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
            receipt.row('session saved', persistedId ? 'PASS' : 'FAIL', persistedId ? 'the take saved' : 'no persisted session id');

            // The rail's after-state settles once coverage is no longer pending.
            await expect.poll(async () => (await readRail(page, points.length)).statuses.every((s) => s !== 'pending'), { timeout: 60_000 })
                .toBe(true).catch(() => undefined);
            const final = (await readRail(page, points.length)).statuses;
            const perPoint = final.map((s, i) => meetsExpectation(expectedFinal[i] ?? '', s));
            receipt.row('final point verdicts', perPoint.every(Boolean) ? 'PASS' : 'FAIL',
                perPoint.every(Boolean) ? 'every point ended as the fixture expects' : 'a point ended differently from the fixture',
                { final: final.join(','), expected: expectedFinal.join(',') });
            const notDetectedExplained = await Promise.all(final.map(async (s, i) => s !== 'missing'
                || (await page.getByTestId(`focus-point-${i}-not-detected`).count()) > 0));
            receipt.row('not-detected explained', notDetectedExplained.every(Boolean) ? 'PASS' : 'FAIL',
                'every not-detected point carries its explanation (colour never alone)');

            const covered = Number(await page.getByTestId('coverage-pace-covered').innerText().catch(() => 'NaN'));
            const total = Number((await page.getByTestId('coverage-pace-total').innerText().catch(() => '')).replace('/', ''));
            const detectedExpected = expectedFinal.filter((e) => e === 'covered').length;
            receipt.row('coverage count', covered === detectedExpected && total === points.length ? 'PASS' : 'FAIL',
                `${covered}/${total} detected`, { covered, total, expected: detectedExpected });

            const average = parseClock(await page.getByTestId('coverage-pace-perpoint').innerText().catch(() => ''));
            const elapsedSec = (stoppedAt - startedAt) / 1000;
            const expectedAverage = covered > 0 ? elapsedSec / covered : null;
            const close = average !== null && expectedAverage !== null && Math.abs(average - expectedAverage) <= AVERAGE_TOLERANCE_SECONDS;
            const echoesGuide = average === GUIDE_SECONDS && expectedAverage !== null && Math.abs(expectedAverage - GUIDE_SECONDS) > AVERAGE_TOLERANCE_SECONDS;
            receipt.row('average per point', close && !echoesGuide ? 'PASS' : 'FAIL',
                close ? 'average = elapsed ÷ detected' : echoesGuide ? 'the average echoes the 1:00 guide' : 'the average does not match elapsed ÷ detected',
                { averageSec: average, elapsedSec: Math.round(elapsedSec), expectedAverageSec: expectedAverage === null ? null : Math.round(expectedAverage) });

            if (!persistedId) return;
            const { data: session, error } = await admin!.from('objective_session').select('id,actual_duration_seconds,time_budget_seconds')
                .eq('source_session_id', persistedId).eq('user_id', owner.uid).maybeSingle();
            if (error) throw new Error(`objective session read failed (fail closed): ${error.code ?? 'unknown'}`);
            if (!session) { receipt.row('persisted verdicts', 'FAIL', 'no objective session was persisted for this take'); return; }
            const { data: evidence, error: eErr } = await admin!.from('objective_evidence').select('verdict')
                .eq('session_id', session.id).eq('user_id', owner.uid);
            if (eErr) throw new Error(`objective evidence read failed (fail closed): ${eErr.code ?? 'unknown'}`);
            const detected = (evidence ?? []).filter((r) => r.verdict === 'detected').length;
            receipt.row('persisted verdicts', (evidence ?? []).length === points.length && detected === covered ? 'PASS' : 'FAIL',
                'the saved evidence matches what the rail showed',
                { rows: (evidence ?? []).length, detected, shown: covered, budgetSec: session.time_budget_seconds as number | null, durationSec: session.actual_duration_seconds as number | null });
        });

        // ── Row 12 — Analytics ──────────────────────────────────────────────────────────────────────────
        await test.step('row 12 — the saved session in Analytics', async () => {
            if (!persistedId) { receipt.row('analytics', 'HOLD', 'no saved session'); return; }
            const { data: row, error } = await admin!.from('sessions').select('transcript').eq('id', persistedId).eq('user_id', owner.uid).single();
            if (error) throw new Error(`session read failed (fail closed): ${error.code ?? 'unknown'}`);
            const digest = sha256Hex(row?.transcript);
            // Through the on-screen Analytics action the person clicks after Stop, then the session's own control.
            analyticsRows(receipt, await analyticsThroughActions(page, persistedId, digest));
            // Point-level detail as the customer sees it on the reopened session. The current Analytics detail renders
            // transcript availability only and reads no Focus Points data, so its absence is recorded as a named
            // product gap (HOLD) — never a pass. If coverage does render, it must agree with the saved verdicts.
            const shownPoints = await page.locator('[data-testid^="focus-point-"][data-status]').count();
            const shownCovered = await page.locator('[data-testid^="focus-point-"][data-status="covered"]').count();
            if (shownPoints === 0) {
                receipt.row('analytics point detail', 'HOLD',
                    'product gap: the saved-session Analytics view shows no Focus Points point-level coverage (smallest repair proposed to PM)');
            } else {
                const { data: saved } = await admin!.from('objective_session').select('id').eq('source_session_id', persistedId).eq('user_id', owner.uid).maybeSingle();
                const { data: ev } = saved
                    ? await admin!.from('objective_evidence').select('verdict').eq('session_id', saved.id).eq('user_id', owner.uid)
                    : { data: [] as Array<{ verdict: string }> };
                const detected = (ev ?? []).filter((r) => r.verdict === 'detected').length;
                receipt.row('analytics point detail', shownPoints === points.length && shownCovered === detected ? 'PASS' : 'FAIL',
                    'Analytics shows each point, and its covered points agree with the saved verdicts', { shownPoints, shownCovered, savedDetected: detected });
            }
        });

        // Share Feedback belongs to the full journey only; the partial fixture stays a coverage probe.
        if (fixtureKey === 'focus_points_tts') {
            await test.step('share feedback', async () => {
                await shareFeedbackRows(page, receipt, admin as never, owner.uid);
            });
        }

        await test.step('next Start without a hold', async () => {
            const next = await nextStartEvidence(page, `${suite}-next`);
            nextStartRows(receipt, next);
        });
    } finally {
        const { canaryJourneys, userJourneys } = telemetryClassRows(receipt, tap, claimed);
        receipt.row('coverage_evaluation sent', tap.sent('coverage_evaluation').length > 0 ? 'PASS' : 'FAIL',
            'the coverage evaluation left the page (sent, not yet received)', { sent: tap.sent('coverage_evaluation').length });
        // Point text and topic are the person's content: they must never reach the receipt.
        const leaks = receiptContentLeaks(receipt, [owner.email, SERVICE_ROLE, topic, ...points].filter(Boolean));
        receipt.row('receipt content-free', leaks.length === 0 ? 'PASS' : 'FAIL', leaks.length === 0 ? 'no point text, topic or credential in the receipt' : 'the receipt carried a forbidden value');
        receipt.write(testInfo, canaryJourneys, tap.trafficTypes(),
            fixtureKey === 'focus_points_tts' ? ['session_during', 'session_after_focus_points', 'share_feedback'] : ['session_during', 'session_after_focus_points'],
            userJourneys);
    }
}
