/**
 * RWT Focus Points journey (PO script rows 8–12), shared by the two INDEPENDENT Focus Points specs — the PO corpus
 * (`rwt-focus-points-session.live.spec.ts`) and the partial Dev fixture (`rwt-focus-points-partial.live.spec.ts`).
 * Each spec owns its browser (the fake microphone file is a launch option), account, receipt and cleanup.
 */
import { createClient } from '@supabase/supabase-js';
import { test } from './rwtProductionTest';
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
import { bindReadbackJourneys, takeStartedAfter, practiceArrivalVerdict, feedbackOutcomeVerdict, detectedCountExpected, expectsLiveChange, focusPointMeetsExpectation, liveChangeFailures, persistedVerdictMismatches, newSetSourcePoints, newSetEditVerdicts, setupIsBlank, switchIsolationVerdict, labelHeardIn, focusBackReloadVerdict, focusIdentityObservation } from './rwtOracles';
import { cleanupRunOwnedAccount } from './runOwnedCleanup';
import { savedFocusIdentityVerdict } from './rwtSavedFocusIdentity';
import { recordRunOwnedCleanup } from './rwtAcceptance';
import {
    AnalyticsTap,
    RwtReceipt,
    focusCoachingRows,
    railStateRows,
    type SavedCoaching,
    requireApprovedSurface,
    armCandidateSwitch,
    installMicAcquisitionCounter,
    loadRwtFixture,
    markRunOwnedAccountCanary,
    micAcquisitions,
    newDisposableEmail,
    nextStartEvidence,
    nextStartRows,
    practiceAgainEvidence,
    practiceAgainRows,
    productMarkerRows,
    modelIdentityRow,
    acquisitionTimingRow,
    shareFeedbackRows,
    openProductsMenuInPlace,
    feedbackRetentionAfterDeletionRow,
    RWT_ACCOUNT_PREFIX,
    analyticsRows,
    analyticsThroughActions,
    backFromProgressRestoresSession,
    reloadRestoredSession,
    waitForNewPersistedSession,
    performCandidateSwitch,
    readSttIdentity,
    readCpuRuntime,
    receiptContentLeaks,
    resolveRunTarget,
    rwtPreconditionFailures,
    sha256Hex,
    signUpDisposableAccount,
    suppressPageSnapshot,
    telemetryClassRows,
    canaryClaimRow,
    expectedReleaseSha,
    EntitlementTap,
    entitlementRow,
    runOwnedIdentityFailures,
    type FixtureKey,
    type RunTarget, readCoachingFailureReason,
    sentVerdict,
    sentDetail,
    readbackSettlement,
    exactCountVerdict,
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

/** Does the final rail state satisfy the fixture's expectation for this point? Exact (#1532 Codex P1 r4105978619). */
/** A setup field that cannot be read is never blank: this non-empty sentinel makes `setupIsBlank` false. */
const SETUP_FIELD_READ_FAILED = '(setup field read failed)';
const meetsExpectation = (expected: string, got: RailStatus | null): boolean => focusPointMeetsExpectation(expected, got);

export async function focusPointsJourney(page: Page, testInfo: TestInfo, fixtureKey: FixtureKey, suite: string, owner: { email: string; uid: string }) {
    const preconditions = rwtPreconditionFailures();
    if (preconditions.length > 0) throw new Error(`HOLD preconditions: ${preconditions.join('; ')}`);
    const run: RunTarget = await resolveRunTarget(JOURNEY);
    const fixture = loadRwtFixture(fixtureKey);
    const topic = fixture.entry.topic ?? '';
    const points = fixture.entry.points ?? [];
    const expectedFinal = fixture.entry.expectedFinal ?? [];

    const receipt = new RwtReceipt(suite);
    receipt.forbid(SERVICE_ROLE, topic, ...points);
    let feedbackReportId: string | null = null;
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
    // #1258: the coaching request as sent (its product marker only) and every coaching request of the journey —
    // Analytics must never request coaching again.
    const coaching: { product: string | null; status: number | null; requests: number; acceptedVersions: unknown; reason: string | null; reasonRead: Promise<void> | null } = { product: null, status: null, requests: 0, acceptedVersions: null, reason: null, reasonRead: null };
    page.on('request', (request) => {
        if (!request.url().includes('/functions/v1/get-ai-suggestions') || request.method() !== 'POST') return;
        coaching.requests += 1;
        try {
            const body = request.postDataJSON() as { product?: string; accepted_coaching_versions?: unknown } | null;
            coaching.product = body?.product ?? null;
            coaching.acceptedVersions = body?.accepted_coaching_versions ?? null;
        } catch { coaching.product = null; coaching.acceptedVersions = null; }
    });
    page.on('response', (response) => {
        if (response.url().includes('/functions/v1/get-ai-suggestions') && response.request().method() === 'POST') {
            coaching.status = response.status();
            // #1258: a failed generation names its closed, content-free reason in the receipt.
            if (response.status() >= 400) coaching.reasonRead = readCoachingFailureReason(response).then((r) => { coaching.reason = r; });
        }
    });
    let savedCoaching: SavedCoaching | null = null;

    let persistedId: string | null = null;
    /** #1258 (Browser PM 6093772463 item 3): the brief this journey set up, read right after Head to session, before any take. */
    let expectedBriefId: string | null = null;
    /** The first take's rail after Stop, in point order: the expected per-point verdicts for the saved-identity proof. */
    let firstTakeRail: (RailStatus | null)[] = [];
    // The take's own generation count, snapshotted before the Practice-again pass records more takes.
    let generationsForTake: number | null = null;
    // #1532 Codex P1 r4124290575: sent-stream windows around each take's Start, so the takes are identified by the Start the
    // page sent (takeStartedAfter), independently of whether their saves arrive.
    let firstTakeFrom = 0;
    let repeatWindow: [number, number] | null = null;
    let claimed = false;
    // Codex r4199883470: step markers the finally-block "sent" rows read — a blind beacon sent before a step cannot carry
    // that step's events. Declared here because the rows run in `finally`, outside the steps' scope.
    let rowsStoppedAt = 0;
    let focusInventoryFrom = 0;
    let rowsGenerationsAt = 0;
    try {
        await test.step('account — sign up, canary claim (if authorized), sign back in', async () => {
            await page.goto('/auth/signup');
            await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
            await requireApprovedSurface(page, receipt);
            owner.email = newDisposableEmail('focus-points');
            receipt.forbid(owner.email);
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
            // The brief this setup created (newest for this run-owned account), independent of what the take later saves.
            const { data: brief, error: briefErr } = await admin!.from('objective_brief').select('id').eq('user_id', owner.uid)
                .order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (briefErr) throw new Error(`objective_brief read failed (fail closed): ${briefErr.code ?? 'unknown'}`);
            expectedBriefId = (brief?.id as string | undefined) ?? null;
        });

        await entitlementRow(receipt, entitlement, 120);

        // ── Row 10 — live markers ───────────────────────────────────────────────────────────────────────
        let startedAt = 0;
        let stoppedAt = 0;
        const firstChange: Array<{ status: RailStatus; atSec: number; atMs: number } | null> = points.map(() => null);
        const nextSequence: number[] = [];
        firstTakeFrom = tap.events.length;
        await test.step('row 10 — markers change while each point is spoken', async () => {
            await expect(page.getByTestId('focus-points-rail')).toBeVisible({ timeout: 45_000 });
            const before = await readRail(page, points.length);
            const neutral = before.statuses.every((s) => s === 'pending');
            receipt.row('rail before speaking', neutral ? 'PASS' : 'FAIL', neutral ? 'every point starts pending' : 'a point was marked before any speech',
                { rows: before.statuses.length });
            await railStateRows(page, receipt, points.length, 'before');

            const acquisitionStarted = Date.now();
            await selectBenchmarkMode(page, 'private');
            const setup = await preparePrivateModelIfPrompted(page, 900_000);
            if (!setup.recordingAlreadyStarted) {
                await waitForPrivateEngineReady(page, 600_000);
                await startBenchmarkRecording(page, suite);
            }
            startedAt = Date.now();
            modelIdentityRow(receipt, run, await readSttIdentity(page), startedAt - acquisitionStarted, await readCpuRuntime(page));

            const until = startedAt + Math.round((fixture.entry.speechSeconds + 4) * 1000);
            while (Date.now() < until) {
                const now = await readRail(page, points.length);
                now.statuses.forEach((status, i) => {
                    if (!firstChange[i] && status && status !== 'pending') firstChange[i] = { status, atSec: Math.round((Date.now() - startedAt) / 1000), atMs: Date.now() };
                });
                if (now.next !== null && nextSequence[nextSequence.length - 1] !== now.next) nextSequence.push(now.next);
                await page.waitForTimeout(500);
            }
            // #1532 r4127572206: every point expected covered OR partial must change live (per point, not by count).
            const expectedLive = expectedFinal.filter(expectsLiveChange).length;
            const liveChanged = firstChange.filter(Boolean).length;
            const notLive = liveChangeFailures(expectedFinal, firstChange);
            const ordered = firstChange.filter(Boolean).every((c, i, all) => i === 0 || c!.atSec >= all[i - 1]!.atSec);
            receipt.row('live marker changes', notLive.length === 0 && ordered ? 'PASS' : 'FAIL',
                notLive.length === 0 ? 'every spoken point expected to be detected changed during speech, in speaking order' : 'a point expected to be detected did not change during speech (Stop-time-only detection fails this row)',
                { changedDuringSpeech: liveChanged, expected: expectedLive, notLive: notLive.map((i) => i + 1).join(','), firstChangeSec: firstChange.map((c) => (c ? `${c.status}@${c.atSec}` : 'none')).join(',') });
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
                    if (!change) return expectsLiveChange(expectedFinal[i]) ? 'no-live-change' : 'ok-no-change';
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
            // Runbook v12: red "Not detected" is a FINAL, after-Stop verdict only — never during speech.
            const redDuring = await page.locator('[data-testid="focus-points-rail-list"] [data-marker="missed"]').count();
            receipt.row('no red before Stop', redDuring === 0 ? 'PASS' : 'FAIL',
                redDuring === 0 ? 'no point shows the final red verdict while speaking' : 'a point showed red "Not detected" during the take', { redDuring });
        });

        // ── Row 11 — Stop: verdicts, n/4, average ───────────────────────────────────────────────────────
        await test.step('row 11 — Stop: verdicts, count and average', async () => {
            stoppedAt = Date.now();
            rowsStoppedAt = stoppedAt;
            await stopBenchmarkRecording(page, suite, 180_000);
            await waitForBenchmarkSaveCandidate(page, suite, 180_000);
            await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 120_000 });
            persistedId = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
            receipt.row('session saved', persistedId ? 'PASS' : 'FAIL', persistedId ? 'the take saved' : 'no persisted session id');

            // The rail's after-state settles once coverage is no longer pending.
            await expect.poll(async () => (await readRail(page, points.length)).statuses.every((s) => s !== 'pending'), { timeout: 60_000 })
                .toBe(true).catch(() => undefined);
            const final = (await readRail(page, points.length)).statuses;
            firstTakeRail = final;
            const perPoint = final.map((s, i) => meetsExpectation(expectedFinal[i] ?? '', s));
            receipt.row('final point verdicts', perPoint.every(Boolean) ? 'PASS' : 'FAIL',
                perPoint.every(Boolean) ? 'every point ended as the fixture expects' : 'a point ended differently from the fixture',
                { final: final.join(','), expected: expectedFinal.join(',') });
            const notDetectedExplained = await Promise.all(final.map(async (s, i) => s !== 'missing'
                || (await page.getByTestId(`focus-point-${i}-not-detected`).count()) > 0));
            receipt.row('not-detected explained', notDetectedExplained.every(Boolean) ? 'PASS' : 'FAIL',
                'every not-detected point carries its explanation (colour never alone)');
            await railStateRows(page, receipt, points.length, 'after');

            const covered = Number(await page.getByTestId('coverage-pace-covered').innerText().catch(() => 'NaN'));
            const total = Number((await page.getByTestId('coverage-pace-total').innerText().catch(() => '')).replace('/', ''));
            // The product persists covered OR partial evidence as detected (#1532 Codex P1 r4105978619).
            const detectedExpected = detectedCountExpected(expectedFinal);
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
            // #1532 Codex P2 r4120338752: compared PER POINT (by brief_point_id -> sort_order), never by counts — a swapped
            // detected / not-detected pair keeps both counts.
            const { data: evidence, error: eErr } = await admin!.from('objective_evidence').select('brief_point_id,verdict')
                .eq('session_id', session.id).eq('user_id', owner.uid);
            if (eErr) throw new Error(`objective evidence read failed (fail closed): ${eErr.code ?? 'unknown'}`);
            const pointIds = [...new Set((evidence ?? []).map((r) => r.brief_point_id as string))];
            const { data: briefPoints, error: pErr } = pointIds.length === 0 ? { data: [], error: null }
                : await admin!.from('objective_brief_point').select('id,sort_order,brief_id').in('id', pointIds).eq('user_id', owner.uid);
            if (pErr) throw new Error(`objective brief point read failed (fail closed): ${pErr.code ?? 'unknown'}`);
            const briefIds = new Set((briefPoints ?? []).map((p) => p.brief_id as string));
            const { data: allPoints, error: aErr } = briefIds.size !== 1 ? { data: briefPoints ?? [], error: null }
                : await admin!.from('objective_brief_point').select('id,sort_order').eq('brief_id', [...briefIds][0]).eq('user_id', owner.uid);
            if (aErr) throw new Error(`objective brief points read failed (fail closed): ${aErr.code ?? 'unknown'}`);
            const mismatches = persistedVerdictMismatches(final,
                (allPoints ?? []).map((p) => ({ id: p.id as string, sort_order: p.sort_order as number })),
                (evidence ?? []).map((r) => ({ brief_point_id: r.brief_point_id as string, verdict: r.verdict as string })));
            receipt.row('persisted verdicts', mismatches.length === 0 && briefIds.size === 1 ? 'PASS' : 'FAIL',
                mismatches.length === 0 && briefIds.size === 1 ? 'each point\'s saved verdict matches what the rail showed for that point'
                    : 'a saved verdict differs from the rail for its point, or the evidence does not map to one brief',
                { rows: (evidence ?? []).length, mismatchedPoints: mismatches.join(','), briefs: briefIds.size, shown: covered,
                    budgetSec: session.time_budget_seconds as number | null, durationSec: session.actual_duration_seconds as number | null });
        });

        // ── Row 11 (continued) — the Focus Points coaching pair after Stop ─────────────────────────────────
        await test.step('row 11 — Focus Points coaching after Stop', async () => {
            if (!persistedId) { receipt.row('Focus coaching rendered', 'HOLD', 'no saved session'); return; }
            // focusCoachingRows settles the reason after its own terminal wait (Codex r4189408865).
            savedCoaching = await focusCoachingRows(page, receipt, admin as never, persistedId, owner.uid, coaching);
        });

        // ── Row 12 — Analytics ──────────────────────────────────────────────────────────────────────────
        await test.step('Products menu opened on the session page (inventory, recording journey)', async () => {
            focusInventoryFrom = Date.now();
            // #1532 Codex P1 r4121232419: emitted inside the recording journey (a product route; nothing navigates), where the
            // analytics_inventory stage proves it was received.
            const opened = await openProductsMenuInPlace(page);
            receipt.row('Products menu opened in the session', opened ? 'PASS' : 'FAIL',
                opened ? 'the header Products menu opened and closed on the session page' : 'the header Products menu could not be opened on the session page');
        });

        // ── #1258 (Browser PM 6093772463) — Progress → browser Back → the SAME saved session → reload (existing take) ─────
        await test.step('Focus Points: Progress, Back to the saved session, then reload', async () => {
            if (!persistedId) { receipt.row('Focus Back from Progress and reload keep the saved session', 'HOLD', 'no saved session'); return; }
            // Saved identity, read fail closed: transcript digest and the point verdicts (compared in Node; only booleans leave).
            const savedIdentity = async (): Promise<{ digest: string; verdicts: string[] }> => {
                const { data: s, error: sErr } = await admin!.from('sessions').select('transcript').eq('id', persistedId!).eq('user_id', owner.uid).single();
                if (sErr) throw new Error(`session read failed (fail closed): ${sErr.code ?? 'unknown'}`);
                const { data: os, error: osErr } = await admin!.from('objective_session').select('id').eq('source_session_id', persistedId!).eq('user_id', owner.uid).maybeSingle();
                if (osErr) throw new Error(`objective_session read failed (fail closed): ${osErr.code ?? 'unknown'}`);
                const { data: ev, error: evErr } = os
                    ? await admin!.from('objective_evidence').select('brief_point_id,verdict').eq('session_id', os.id).eq('user_id', owner.uid)
                    : { data: [] as Array<{ brief_point_id: string; verdict: string }>, error: null };
                if (evErr) throw new Error(`objective_evidence read failed (fail closed): ${evErr.code ?? 'unknown'}`);
                return { digest: sha256Hex(s?.transcript), verdicts: (ev ?? []).map((r) => `${r.brief_point_id}:${r.verdict}`).sort() };
            };
            const before = await savedIdentity();
            const requestsBefore = coaching.requests;
            const back = await backFromProgressRestoresSession(page, persistedId, savedCoaching ?? undefined);
            const reload = back.restored ? await reloadRestoredSession(page, persistedId, before.digest, savedCoaching ?? undefined)
                : { restored: false, sameSession: false, idleShown: back.idleShown, liveTracks: null, transcriptMatches: false, review: 'missing' as const };
            const after = await savedIdentity();
            const result = focusBackReloadVerdict({
                leftForProgress: back.left, restoredAfterBack: back.restored, liveMicTracksAfterBack: back.liveTracks,
                restoredAfterReload: reload.restored, sameSessionAfterReload: reload.sameSession,
                idleRecorderShown: back.idleShown || reload.idleShown, liveMicTracks: reload.liveTracks, transcriptMatchesSaved: reload.transcriptMatches,
                reviewAfterBack: back.review, reviewAfterReload: reload.review, coachingSaved: Boolean(savedCoaching),
                verdictsBefore: before.verdicts, verdictsAfter: after.verdicts,
                coachingRequestsBefore: requestsBefore, coachingRequestsAfter: coaching.requests,
            });
            receipt.row('Focus Back from Progress and reload keep the saved session', result.verdict, result.detail, {
                left: back.left, restoredAfterBack: back.restored, liveTracksAfterBack: back.liveTracks, restoredAfterReload: reload.restored, sameSession: reload.sameSession,
                idleShown: back.idleShown || reload.idleShown, liveTracks: reload.liveTracks, transcriptMatches: reload.transcriptMatches,
                reviewAfterBack: back.review, reviewAfterReload: reload.review, verdictsUnchanged: before.verdicts.length > 0 && before.verdicts.join(',') === after.verdicts.join(','),
                coachingRequestsBefore: requestsBefore, coachingRequestsAfter: coaching.requests,
            });
        });

        await test.step('row 12 — the saved session in Analytics', async () => {
            if (!persistedId) { receipt.row('analytics', 'HOLD', 'no saved session'); return; }
            const { data: row, error } = await admin!.from('sessions').select('transcript').eq('id', persistedId).eq('user_id', owner.uid).single();
            if (error) throw new Error(`session read failed (fail closed): ${error.code ?? 'unknown'}`);
            const digest = sha256Hex(row?.transcript);
            // Through the on-screen Analytics action the person clicks after Stop, then the session's own control.
            const requestsBefore = coaching.requests;
            if (!savedCoaching) receipt.row('analytics detail shows both AI suggestions', 'HOLD', 'no saved coaching response to look for');
            // Focus Points evidence is the saved point results ("Detected: point 1 at 0:21." / "Not detected: point 3.").
            analyticsRows(receipt, await analyticsThroughActions(page, persistedId, digest, savedCoaching ?? undefined, /(Detected|Not detected): point \d/));
            receipt.row('Analytics generates no coaching', coaching.requests === requestsBefore ? 'PASS' : 'FAIL',
                coaching.requests === requestsBefore ? 'opening and reloading Analytics requested no new review' : 'Analytics requested coaching again (regeneration / quota)',
                { coachingRequestsBefore: requestsBefore, coachingRequestsAfter: coaching.requests });
            // #1258 (Browser PM 6093772463 item 3): point-level proof from the CURRENT saved-review evidence the person sees on
            // the Analytics detail ("Detected: point 1 at 0:21." …), bound to the saved point identity: the setup brief, each
            // saved point's id / order / label, exactly one evidence verdict per point, and the first take's rail. Replaces the
            // stale recording-rail / count-only check. Labels and ids stay local; the receipt gets ordinals and reasons only.
            if (!savedCoaching) {
                receipt.row('analytics point detail', 'HOLD', 'no saved coaching, so the saved review shows no point evidence to read');
            } else {
                const visibleEvidence = (await page.getByTestId('review-evidence').first().innerText().catch(() => '')).split('\n');
                const { data: os, error: osErr } = await admin!.from('objective_session').select('id,brief_id').eq('source_session_id', persistedId).eq('user_id', owner.uid).maybeSingle();
                if (osErr) throw new Error(`objective_session read failed (fail closed): ${osErr.code ?? 'unknown'}`);
                const { data: bp, error: bpErr } = os
                    ? await admin!.from('objective_brief_point').select('id,brief_id,sort_order,label').eq('brief_id', os.brief_id).eq('user_id', owner.uid)
                    : { data: [] as Array<{ id: string; brief_id: string; sort_order: number; label: string }>, error: null };
                if (bpErr) throw new Error(`objective_brief_point read failed (fail closed): ${bpErr.code ?? 'unknown'}`);
                const { data: ev, error: evErr } = os
                    ? await admin!.from('objective_evidence').select('brief_point_id,verdict').eq('session_id', os.id).eq('user_id', owner.uid)
                    : { data: [] as Array<{ brief_point_id: string; verdict: string }>, error: null };
                if (evErr) throw new Error(`objective_evidence read failed (fail closed): ${evErr.code ?? 'unknown'}`);
                const identity = savedFocusIdentityVerdict(focusIdentityObservation({
                    expectedBriefId, savedBriefId: (os?.brief_id as string | undefined) ?? null, labels: points, railStatuses: firstTakeRail,
                    savedPoints: (bp ?? []).map((p) => ({ id: p.id as string, brief_id: p.brief_id as string, sort_order: p.sort_order as number, label: p.label as string })),
                    evidence: (ev ?? []).map((r) => ({ brief_point_id: r.brief_point_id as string, verdict: r.verdict as string })),
                    visibleEvidence,
                }));
                receipt.row('analytics point detail', identity.verdict,
                    identity.verdict === 'PASS'
                        ? 'the saved review shows each point\'s verdict, bound to the setup brief, the saved point order and labels, one saved verdict per point, and the take\'s rail'
                        : 'the visible saved-review evidence, the saved points / verdicts and the take\'s rail do not agree',
                    { mismatchedOrdinals: identity.mismatchedOrdinals.join(','), errors: identity.errors.join('; '), expectedBriefKnown: expectedBriefId !== null });
            }
        });

        // Share Feedback belongs to the full journey only; the partial fixture stays a coverage probe. It runs AFTER Analytics,
        // in the PO's manual v12 order (PM RETURN 5870036039): the Analytics reload minted a new journey, so feedback is bound
        // and qualified there for its own stages (share_feedback), never claimed for the recording journey.
        if (fixtureKey === 'focus_points_tts') {
            await test.step('share feedback', async () => {
                feedbackReportId = await shareFeedbackRows(page, receipt, admin as never, owner.uid, tap);
            });
        }

        // ── Practice again through the rendered controls: Analytics → the same set → the review's Retry (#1533) ──
        await test.step('Practice again — Analytics action, then the completed review\'s Retry this set', async () => {
            generationsForTake = tap.sent('practice_loop_review_requested').length;
            rowsGenerationsAt = Date.now();
            if (!persistedId) {
                practiceAgainRows(receipt, 'focus_points', { analyticsActionOpened: null, sameSetPending: null, reviewReached: null, afterActionEnabledMs: null, holdSeen: false, afterStartMs: null, stopped: false, liveTracksAfterStop: null, reason: 'no saved session', savedSessionId: null, actionBefore: null, actionAfter: null });
                await productMarkerRows(receipt, admin as never, owner.uid, 'focus_points', []);
                return;
            }
            const repeatFrom = tap.events.length;
            let saveTakeEnd = -1;
            const again = await practiceAgainEvidence(page, `${suite}-again`, persistedId, 'focus_points', points, () => { saveTakeEnd = tap.events.length; });
            // The window closes at the SAVE take's Stop, so the review's repeat Start can never stand in for it.
            repeatWindow = [repeatFrom, saveTakeEnd >= 0 ? saveTakeEnd : tap.events.length];
            practiceAgainRows(receipt, 'focus_points', again);
            // #1258 / #1537: every session this journey saved (its take + the Practice-again take) is marked Focus Points.
            await productMarkerRows(receipt, admin as never, owner.uid, 'focus_points', [persistedId, again.savedSessionId]);
        });

        await test.step('next Start without a hold', async () => {
            const next = await nextStartEvidence(page, `${suite}-next`);
            nextStartRows(receipt, next);
        });

        // ── #1258 Focus-only: the product-switch take, then New Set / Edit from that take's completed review ──
        if (fixtureKey === 'focus_points_tts') {
            // The switch step's saved Focus take is the completed review New Set / Edit starts from (Browser PM 6097978379).
            let switchFocusId: string | null = null;
            // ── #1258 (Browser PM 6089889070) — Open Mic → Focus Points: the take right after the switch hears only itself ──
            await test.step('Open Mic take, then a Focus take right after the product switch', async () => {
                // The transcript stays in Node (marker support only); the receipt gets the product, a digest and booleans.
                const sessionRow = async (id: string): Promise<{ product: string | null; digest: string | null; transcript: string }> => {
                    const { data, error } = await admin!.from('sessions').select('product,transcript').eq('id', id).eq('user_id', owner.uid).maybeSingle();
                    if (error) throw new Error(`session read failed (fail closed): ${error.code ?? 'unknown'}`);
                    return { product: (data?.product as string | null) ?? null, digest: data ? sha256Hex(data.transcript) : null, transcript: typeof data?.transcript === 'string' ? data.transcript : '' };
                };
                const lastSaved = () => page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
                const openProduct = async (item: 'open-mic' | 'focus-points') => {
                    const desktop = page.getByTestId('nav-products-button');
                    if (await desktop.isVisible().catch(() => false)) {
                        await desktop.click();
                        await page.getByTestId(`nav-products-${item}`).click();
                    } else {
                        await page.getByTestId('nav-mobile-products-button').click();
                        await page.getByTestId(`nav-mobile-products-${item}`).click();
                    }
                };
                // 1. A full Open Mic take: the replayed Focus fixture speaks all four points into it.
                const before = await lastSaved();
                await openProduct('open-mic');
                await page.waitForURL(/\/session/, { timeout: 45_000 });
                await startBenchmarkRecording(page, `${suite}-switch-openmic`);
                await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
                await stopBenchmarkRecording(page, `${suite}-switch-openmic`, 180_000);
                await waitForBenchmarkSaveCandidate(page, `${suite}-switch-openmic`, 180_000);
                const openMicId = await waitForNewPersistedSession(page, before);
                const openMicBefore = openMicId && openMicId !== before ? await sessionRow(openMicId) : { product: null, digest: null, transcript: '' };
                // A point is a carry-over marker only if the Open Mic take actually recognised it (6090552875).
                const markerSupport = points.slice(1).map((label) => labelHeardIn(label, openMicBefore.transcript));

                // 2. Products → Focus Points, the fixture's four points, then a short take that hears only point 1.
                await openProduct('focus-points');
                await page.getByTestId('objective-setup-dialog').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
                await page.getByTestId('objective-goal-select').selectOption('other');
                await page.getByTestId('objective-goal-input').fill(topic);
                for (let i = 0; i < points.length; i += 1) {
                    if ((await page.getByTestId(`objective-point-label-${i}`).count()) === 0) await page.getByTestId('objective-add-point').click();
                    await page.getByTestId(`objective-point-label-${i}`).fill(points[i]);
                }
                await page.getByTestId('objective-setup-submit').click();
                await page.waitForURL(/\/session/, { timeout: 45_000 }).catch(() => undefined);
                await expect(page.getByTestId('focus-points-rail')).toBeVisible({ timeout: 45_000 }).catch(() => undefined);
                const railPendingBefore = (await readRail(page, points.length)).statuses.every((s) => s === 'pending');
                // Pre-Start boundary: no Focus review can exist yet, so any coaching pair here is the Open Mic take's.
                const staleCoachingBeforeStart = (await page.getByTestId('ai-suggestions-pair').count()) > 0;
                const windows = fixture.entry.pointAudioWindows ?? [];
                // Past point 1's window, short of point 2's start (focus_points_tts: [2.91,6.21] then [11.98,…]).
                const shortTakeSeconds = windows[1] ? Math.max(8, Math.min(9, windows[1][0] - 2)) : 9;
                await startBenchmarkRecording(page, `${suite}-switch-focus`);
                await page.waitForTimeout(shortTakeSeconds * 1000);
                await stopBenchmarkRecording(page, `${suite}-switch-focus`, 180_000);
                await waitForBenchmarkSaveCandidate(page, `${suite}-switch-focus`, 180_000);
                const focusId = await waitForNewPersistedSession(page, openMicId);
                switchFocusId = focusId && focusId !== openMicId ? focusId : null;
                await expect.poll(async () => (await readRail(page, points.length)).statuses.every((s) => s !== 'pending'), { timeout: 60_000 })
                    .toBe(true).catch(() => undefined);
                const finalStatuses = (await readRail(page, points.length)).statuses;
                const savedProduct = focusId && focusId !== openMicId ? (await sessionRow(focusId)).product : null;
                const openMicAfter = openMicId && openMicId !== before ? await sessionRow(openMicId) : { product: null, digest: null, transcript: '' };
                const iso = switchIsolationVerdict({
                    railPendingBefore, openMicId: openMicId !== before ? openMicId : null, focusId: focusId !== openMicId ? focusId : null,
                    savedProduct, finalStatuses, staleCoachingBeforeStart, markerSupport,
                    openMicBefore: { product: openMicBefore.product, digest: openMicBefore.digest },
                    openMicAfter: { product: openMicAfter.product, digest: openMicAfter.digest },
                });
                receipt.row('take after switching products is clean', iso.verdict, iso.detail, {
                    railPendingBefore, shortTakeSeconds, final: finalStatuses.join(','), staleCoachingBeforeStart, markerSupport: markerSupport.join(','),
                    openMicSaved: Boolean(openMicId && openMicId !== before), openMicUnchanged: openMicBefore.digest !== null && openMicBefore.digest === openMicAfter.digest,
                });
            });

            // ── #1258 (Browser PM 6087216991, option B) — Start a new set, Edit it, and the next take is scored on the edit ──
            await test.step('Focus: Start a new set, Edit it, and the next take is scored on the edited set', async () => {
                const source = newSetSourcePoints(expectedFinal);
                if (!persistedId || !source || !switchFocusId) {
                    const why = !persistedId ? 'no saved first take' : !source ? 'the fixture expects fewer than three covered points'
                        : 'no saved Focus take after the product switch, so no completed review offers Start a new set';
                    receipt.row('Focus New Set', 'HOLD', why);
                    receipt.row('Focus Edit', 'HOLD', why);
                    return;
                }
                // Browser PM 6089313104: an infrastructure read failure is never turned into a product verdict.
                // Browser PM 6089313104 / 6093772463: every read fails closed, and the saved verdicts are bound to the brief's
                // points (label + sort order), not a bare id list.
                const savedFocus = async (sessionId: string): Promise<{ verdicts: string[]; brief: string | null; ordered: Array<{ label: string; verdict: string }> }> => {
                    const { data: os, error: osErr } = await admin!.from('objective_session').select('id,brief_id').eq('source_session_id', sessionId).eq('user_id', owner.uid).maybeSingle();
                    if (osErr) throw new Error(`objective_session read failed (fail closed): ${osErr.code ?? 'unknown'}`);
                    if (!os) return { verdicts: [], brief: null, ordered: [] };
                    const { data: ev, error: evErr } = await admin!.from('objective_evidence').select('brief_point_id,verdict').eq('session_id', os.id).eq('user_id', owner.uid);
                    if (evErr) throw new Error(`objective_evidence read failed (fail closed): ${evErr.code ?? 'unknown'}`);
                    const { data: bp, error: bpErr } = await admin!.from('objective_brief_point').select('id,label,sort_order').eq('brief_id', os.brief_id).eq('user_id', owner.uid);
                    if (bpErr) throw new Error(`objective_brief_point read failed (fail closed): ${bpErr.code ?? 'unknown'}`);
                    const verdictOf = new Map((ev ?? []).map((r) => [r.brief_point_id as string, r.verdict as string]));
                    const pointIds = new Set((bp ?? []).map((p) => p.id as string));
                    const outOfBrief = (ev ?? []).some((r) => !pointIds.has(r.brief_point_id as string));
                    const ordered = [...(bp ?? [])].sort((a, b) => (a.sort_order as number) - (b.sort_order as number))
                        .map((p) => ({ label: p.label as string, verdict: verdictOf.get(p.id as string) ?? 'missing' }));
                    return {
                        verdicts: (ev ?? []).map((r) => `${r.brief_point_id}:${r.verdict}`).sort(),
                        brief: outOfBrief ? null : (os.brief_id as string),
                        ordered: outOfBrief ? [] : ordered,
                    };
                };
                const takeA = await savedFocus(persistedId);
                const unspoken = 'A closing promise we never make';
                const newPoints = [points[source[0]], points[source[1]], unspoken];
                const edited = [points[source[0]], points[source[1]], points[source[2]]];

                // #1576 Codex P1 4237701739 / Browser PM 6097978379: Start a new set renders only in the LIVE completed review
                // (FocusPointsRail, sessionState 'after'); a reopened saved review (SavedSessionReturn) has no rail, and the
                // Practice-again Retry and next-Start probes both stop below the 5 s persist guard. So this step runs right after
                // the switch step's saved Focus take, from ITS completed review: no extra recording, no extra coaching request.
                const predecessor = switchFocusId;
                const onPredecessorReview = predecessor !== null
                    && (await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'))) === predecessor;
                const newSetButton = page.getByTestId('focus-points-new-set');
                const offered = onPredecessorReview && await newSetButton.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false);
                let newSetBlank = false;
                if (offered) {
                    await newSetButton.click();
                    // Blank = goal unchosen, topic empty, EVERY rendered point empty, no old-set label (6089313104).
                    const opened = await page.getByTestId('objective-setup-dialog').waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
                    const topicInput = page.getByTestId('objective-goal-input');
                    newSetBlank = opened && setupIsBlank({
                        goal: await page.getByTestId('objective-goal-select').inputValue().catch(() => SETUP_FIELD_READ_FAILED),
                        topic: (await topicInput.count()) > 0 ? await topicInput.inputValue().catch(() => SETUP_FIELD_READ_FAILED) : null,
                        pointValues: await page.locator('[data-testid^="objective-point-label-"]').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value)),
                        staleLabels: [topic, ...points],
                    });
                }
                let editSeeded = false;
                let railLabelsMatchEdit = false;
                let takeBId: string | null = null;
                let railOrdered: Array<{ label: string; status: RailStatus | null }> = [];
                if (newSetBlank) {
                    await page.getByTestId('objective-goal-select').selectOption('other');
                    await page.getByTestId('objective-goal-input').fill(topic);
                    for (let i = 0; i < newPoints.length; i += 1) {
                        if ((await page.getByTestId(`objective-point-label-${i}`).count()) === 0) await page.getByTestId('objective-add-point').click();
                        await page.getByTestId(`objective-point-label-${i}`).fill(newPoints[i]);
                    }
                    await page.getByTestId('objective-setup-submit').click();
                    await page.getByTestId('objective-setup-dialog').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined);

                    // Edit before the take opens the setup seeded with the new set; replace the unspoken point.
                    const edit = page.getByTestId('focus-points-edit');
                    if (await edit.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false)) {
                        await edit.click();
                        await page.getByTestId('objective-setup-dialog').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
                        editSeeded = (await page.getByTestId('objective-point-label-2').inputValue().catch(() => '')) === unspoken;
                        await page.getByTestId('objective-point-label-2').fill(edited[2]);
                        await page.getByTestId('objective-setup-submit').click();
                        await page.getByTestId('objective-setup-dialog').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined);
                        const labels = await Promise.all(edited.map((_, i) => page.getByTestId(`focus-point-${i}`).innerText().catch(() => '')));
                        railLabelsMatchEdit = labels.every((text, i) => text.includes(edited[i])) && !(await page.getByTestId('focus-points-rail').innerText()).includes(unspoken);
                    }

                    // The next take, on the deployed engine with the same spoken fixture, is scored on the EDITED set.
                    if (railLabelsMatchEdit) {
                        await startBenchmarkRecording(page, `${suite}-edited`);
                        await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 10) * 1000));
                        await stopBenchmarkRecording(page, `${suite}-edited`, 180_000);
                        await waitForBenchmarkSaveCandidate(page, `${suite}-edited`, 180_000);
                        // Bound to its IMMEDIATE predecessor, the switch take whose review offered New Set.
                        takeBId = await waitForNewPersistedSession(page, predecessor);
                        await expect.poll(async () => (await readRail(page, edited.length)).statuses.every((s) => s !== 'pending'), { timeout: 60_000 })
                            .toBe(true).catch(() => undefined);
                        const statuses = (await readRail(page, edited.length)).statuses;
                        railOrdered = await Promise.all(statuses.map(async (status, i) => ({
                            label: await page.getByTestId(`focus-point-${i}`).innerText().catch(() => ''), status,
                        })));
                    }
                }
                const takeB = takeBId && takeBId !== predecessor && takeBId !== persistedId ? await savedFocus(takeBId) : { verdicts: [], brief: null, ordered: [] };
                const takeAAfter = await savedFocus(persistedId);
                const v = newSetEditVerdicts({
                    newSetBlank, editSeeded, railLabelsMatchEdit, takeAId: persistedId, takeBId, briefA: takeA.brief, briefB: takeB.brief,
                    takeAVerdictsBefore: takeA.verdicts, takeAVerdictsAfter: takeAAfter.verdicts,
                    editedLabels: edited, railOrdered, takeBSavedOrdered: takeB.ordered,
                });
                const evidence = { onPredecessorReview, offered, newSetBlank, editSeeded, railLabelsMatchEdit, takeBSaved: takeBId !== null && takeBId !== predecessor && takeBId !== persistedId, final: railOrdered.map((r) => r.status).join(','), savedVerdicts: takeB.ordered.map((r) => r.verdict).join(',') };
                receipt.row('Focus New Set', v.newSet.verdict, v.newSet.detail, evidence);
                receipt.row('Focus Edit', v.edit.verdict, v.edit.detail, evidence);
            });
        }
    } finally {
        const { userJourneys } = telemetryClassRows(receipt, tap, claimed);
        const coverageSeen = tap.sent('coverage_evaluation').length > 0;
        const coverageReceivedBy = ['session_after_focus_points'] as const;
        receipt.row('coverage_evaluation sent', sentVerdict(coverageSeen, tap, rowsStoppedAt),
            sentDetail('the coverage evaluation left the page (sent, not yet received)', coverageSeen, tap, rowsStoppedAt, coverageReceivedBy),
            { sent: tap.sent('coverage_evaluation').length, blindBeacons: tap.blindBeacons, ...readbackSettlement(coverageReceivedBy, tap, rowsStoppedAt) });
        // The Focus review's coaching receipts (the readback's Focus stage now requires the coaching card's rendered
        // receipt, not only the rail's) and the PM's inventory events. SENT here; RECEIVED = the PostHog readback.
        const focusTelemetry = {
            reviewRequested: tap.sent('practice_loop_review_requested').length,
            reviewRendered: tap.sent('practice_loop_review_rendered').length,
            productsMenuOpened: tap.sent('products_menu_opened').length,
            savedReviewRevisited: tap.sent('saved_review_revisited').length,
        };
        const focusCoachingSeen = focusTelemetry.reviewRendered > 0;
        receipt.row('Focus coaching telemetry sent', sentVerdict(focusCoachingSeen, tap, rowsStoppedAt),
            sentDetail('the coaching review rendered receipt (practice_loop_review_rendered) left the page (sent; no readback stage requires this event)', focusCoachingSeen, tap, rowsStoppedAt), { ...focusTelemetry, blindBeacons: tap.blindBeacons });
        // Counted up to the Practice-again pass: that pass records its own take, which generates its own review.
        const generationsForFirstTake = generationsForTake ?? focusTelemetry.reviewRequested;
        const generationVerdict = exactCountVerdict(generationsForFirstTake, 1, tap, rowsStoppedAt, generationsForTake === null ? Date.now() : rowsGenerationsAt);
        receipt.row('revisit is not a generation', generationVerdict,
            generationVerdict === 'PASS' ? 'one generated review for the take; the Analytics revisits added none' : generationVerdict === 'HOLD' ? 'unproven: a PostHog beacon in the Stop-to-count window carried a body the browser does not expose (a second request could be hidden); no readback stage counts generation requests, so this row stays HOLD' : 'the generation count is not exactly one for this take',
            { reviewRequested: generationsForFirstTake, blindBeacons: tap.blindBeacons });
        const focusInventorySeen = focusTelemetry.productsMenuOpened > 0 && focusTelemetry.savedReviewRevisited > 0;
        const focusInventoryReceivedBy = ['analytics_inventory'] as const;
        receipt.row('inventory events sent', sentVerdict(focusInventorySeen, tap, focusInventoryFrom),
            sentDetail('products_menu_opened and saved_review_revisited left the page (sent; received is qualified in the recording journey by the analytics_inventory stage)', focusInventorySeen, tap, focusInventoryFrom, focusInventoryReceivedBy),
            { ...focusTelemetry, blindBeacons: tap.blindBeacons, ...readbackSettlement(focusInventoryReceivedBy, tap, focusInventoryFrom) });
        // #1258 (#1563, Codex r4197420116): Focus presses Practice again too, so it proves the same correlation Open Mic does —
        // each press reached its intended route (same boot + action_seq) — and, in the full run that shares feedback, each
        // attempt resolved (same boot + submit_seq). Sent here; received is the `practice_again` / `share_feedback` readback.
        // A Blob beacon can hide these events from the tap (Codex P1 4219466523); the readback stage that runs the same
        // correlation on RECEIVED events then settles the row at finalization.
        const practiceArrival = practiceArrivalVerdict(tap.events);
        const practiceArrivalReceivedBy = ['practice_again'] as const;
        receipt.row('Practice again press → arrival (sent)', practiceArrival.verdict, practiceArrival.detail,
            { ...practiceArrival.evidence, ...readbackSettlement(practiceArrivalReceivedBy, tap, rowsStoppedAt) });
        if (fixtureKey === 'focus_points_tts') {
            const feedbackOutcome = feedbackOutcomeVerdict(tap.events);
            const feedbackOutcomeReceivedBy = ['share_feedback'] as const;
            receipt.row('feedback outcome (sent)', feedbackOutcome.verdict, feedbackOutcome.detail,
                { ...feedbackOutcome.evidence, ...readbackSettlement(feedbackOutcomeReceivedBy, tap, rowsStoppedAt) });
        }
        // Point text and topic are the person's content: they must never reach the receipt.
        const leaks = receiptContentLeaks(receipt, [owner.email, SERVICE_ROLE, topic, ...points].filter(Boolean));
        receipt.row('receipt content-free', leaks.length === 0 ? 'PASS' : 'FAIL', leaks.length === 0 ? 'no point text, topic or credential in the receipt' : 'the receipt carried a forbidden value');
        // v12 preflight: first-use model download vs engine setup, from the app's own acquisition receipt.
        acquisitionTimingRow(receipt, tap, tap.journeyIds());
        if (fixtureKey === 'focus_points_tts') {
            // Feedback retention is proven only after the run-owned account is deleted (#1532 Codex P1 r4105978630).
            // On success the owner is cleared so the spec's afterEach does not repeat the deletion.
            const deleted = await feedbackRetentionAfterDeletionRow(receipt, admin as never, feedbackReportId,
                () => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
            if (deleted) { owner.uid = ''; owner.email = ''; }
        } else if (fixtureKey === 'focus_points_partial_tts') {
            // #1532 Codex P1 r4126745141: the partial run's receipt carries its own cleanup verdict. Cleanup runs HERE,
            // before write(); a failure is a FAIL row (the test still ends failed) and never skips the receipt. Only a
            // verified deletion clears the owner, so the spec's afterEach stays an idempotent fallback.
            const cleaned = await recordRunOwnedCleanup((step, verdict, detail, evidence) => receipt.row(step, verdict, detail, evidence),
                () => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
            if (cleaned) { owner.uid = ''; owner.email = ''; }
        }
        receipt.write(testInfo,
            bindReadbackJourneys(tap.events, {
                recording: ['session_during', 'session_after_focus_points', 'analytics_inventory'], repeatRecording: ['session_during', 'session_after_focus_points'],
                takes: {
                    first: takeStartedAfter(tap.events, firstTakeFrom, repeatWindow?.[0] ?? tap.events.length),
                    repeat: repeatWindow ? takeStartedAfter(tap.events, repeatWindow[0], repeatWindow[1]) : null,
                },
                feedback: fixtureKey === 'focus_points_tts',
                // #1258 (#1563, Codex r4197420116): the received press→arrival is required of Focus as of Open Mic.
                practiceAgain: true,
                actionBindings: tap.actionBindings,
                expectedReleaseSha: expectedReleaseSha(), expectedRunId: process.env.GITHUB_RUN_ID,
                expectedRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
            }),
            tap.trafficTypes(), userJourneys);
    }
}
