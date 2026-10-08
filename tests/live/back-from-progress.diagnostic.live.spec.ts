/**
 * DIAGNOSTIC — #1258 PR 4 (Rev 2 §4): does browser Back from Progress return to the session the person just completed?
 *
 * The PO's real-engine take (7 Oct) came back from Progress to a blank session page ("Start recording", 0 words); the
 * client trace showed a runtime teardown about 61 s after save with the session no longer marked persisted. The E2E build
 * never loads the Private model, so only Production can show it. This spec OBSERVES and RECORDS; it changes nothing.
 *
 * One take, in the order the PO did it:
 *   1. a fresh disposable account (created and deleted by this run, residue proven zero);
 *   2. the Private engine on Production (real model acquisition);
 *   3. ONE take of at least 90 s from the pinned synthetic Open Mic fixture (Chrome's fake microphone; the file loops);
 *   4. Stop → "saved" (data-session-persisted + its id);
 *   5. header Progress at once, and stay there until at least 75 s after the save (past the reported ~61 s boundary);
 *   6. browser Back, then observe the session page for 30 s.
 * Throughout: a timestamped, content-free timeline of the document's runtime/persisted signals and path, the coaching
 * responses (status + latency), and console classes (counts only) — in the job log. No transcript, email or credential
 * is ever written; trace, video and screenshots are off.
 *
 * AI SUGGESTIONS (PO 2026-10-07): the coaching call runs as in the product (Production's Gemini key, within the
 * provider's no-charge allowance per the PO), and the phrases shown and saved are captured into the run SUMMARY only — synthetic
 * take, the PO's "public run summary" choice — never into the job-log record.
 *
 * This is NOT an RWT suite (no `rwt-` prefix, no receipt, no PostHog readback) and NOT release evidence. The deployed
 * frontend release is RECORDED as observed, not bound to the dispatched commit.
 *
 * DISPATCH (PO authorization per run — one disposable account's Production writes and the take's coaching call within
 *          the provider's no-charge allowance):
 *   rc-gates.yml  ref=<this branch>  gate=gate-3-dast  base_url=https://speaksharp-public.vercel.app
 *                 diagnostic_dast_spec=tests/live/back-from-progress.diagnostic.live.spec.ts
 *                 rwt_writes_ack=RWT-DISPOSABLE-ACCOUNT-WRITES
 */
import { appendFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { Page, Response } from '@playwright/test';
import { test, expect } from './helpers/rwtProductionTest';
import {
    selectBenchmarkMode,
    preparePrivateModelIfPrompted,
    waitForPrivateEngineReady,
    startBenchmarkRecording,
    stopBenchmarkRecording,
    waitForBenchmarkSaveCandidate,
} from './helpers/benchmark-utils';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';
import { DiagnosticRecord } from './helpers/rwtDiagnosticWindow';
import {
    SESSION_CONTROL_IDS, aiSuggestionsLogLine, backDiagnosticPreconditionFailures, coachingSummaryMarkdown, flatScalars, safeValue,
    sessionViewFields, shownMatchesSaved, timelineFields, type CoachingCapture, type SessionView,
} from './helpers/backFromProgressDiagnostic';
import {
    APPROVED_ORIGIN,
    RWT_ACCOUNT_PREFIX,
    loadRwtFixture,
    newDisposableEmail,
    readCpuRuntime,
    readSttIdentity,
    rwtLaunchArgs,
    signUpDisposableAccount,
    suppressPageSnapshot,
} from './helpers/rwtJourney';

const SUITE = 'back-from-progress';
/** The take: at least 90 s of recording (PM 6047932245). */
const TAKE_MS = 95_000;
/** Stay on Progress until at least this long after the save — past the PO's ~61 s teardown. */
const AWAY_UNTIL_AFTER_SAVE_MS = 75_000;
/** After Back: observe the session page this long, sampling every SAMPLE_MS. */
const OBSERVE_AFTER_BACK_MS = 30_000;
const SAMPLE_MS = 5_000;

const fixture = loadRwtFixture('open_mic_tts');
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

const readSessionView = (page: Page): Promise<SessionView> => page.evaluate((controlIds) => {
    const shown = (id: string) => {
        const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        return Boolean(el && el.offsetParent !== null);
    };
    const root = document.documentElement;
    return {
        path: location.pathname + location.search,
        verdict: shown('session-verdict'),
        thisRun: shown('this-run-card'),
        transcript: shown('transcript-card'),
        control: controlIds.find(shown) ?? null,
        runtimeState: root.getAttribute('data-runtime-state'),
        persisted: root.getAttribute('data-session-persisted'),
        persistedId: root.getAttribute('data-session-persisted-id'),
    };
}, SESSION_CONTROL_IDS);

test.use({
    permissions: ['microphone'],
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: false }) },
});

test.describe('DIAGNOSTIC — Back from Progress after a real-engine take @live', () => {
    let createdEmail = '';
    let capturedUid = '';

    test.afterEach(async () => {
        // Deletes exactly this run's account and proves no residue remains (fail-closed readback).
        await cleanupRunOwnedAccount({ admin: admin as never, capturedUid, createdEmail, runOwnedPrefix: RWT_ACCOUNT_PREFIX });
        createdEmail = '';
        capturedUid = '';
    });

    test('a ≥90 s take, Progress past the ~61 s boundary, then browser Back', async ({ page }, testInfo) => {
        test.setTimeout(1_500_000); // cold model acquisition + a 95 s take + Stop/save + 75 s away + 30 s observation
        const preconditions = backDiagnosticPreconditionFailures();
        if (preconditions.length > 0) throw new Error(`HOLD preconditions: ${preconditions.join('; ')}`);
        await suppressPageSnapshot(testInfo);

        const diag = new DiagnosticRecord(SUITE);
        const t0 = Date.now();
        const rel = () => Date.now() - t0;

        // Timeline of the document's runtime/persisted signals and the path, installed before any navigation.
        await page.addInitScript(() => {
            const NAMES = ['data-runtime-state', 'data-session-persisted', 'data-session-save-status', 'data-session-persisted-id', 'data-engine-ready', 'data-stt-ready'];
            const log: Array<{ t: number; k: string; v: string | null }> = [];
            (window as unknown as { __ssBackDiag__?: typeof log }).__ssBackDiag__ = log;
            const start = () => {
                const root = document.documentElement;
                for (const n of NAMES) log.push({ t: Date.now(), k: n, v: root.getAttribute(n) });
                new MutationObserver((records) => {
                    for (const r of records) if (r.attributeName) log.push({ t: Date.now(), k: r.attributeName, v: root.getAttribute(r.attributeName) });
                }).observe(root, { attributes: true, attributeFilter: NAMES });
                let path = location.pathname + location.search;
                log.push({ t: Date.now(), k: 'path', v: path });
                setInterval(() => {
                    const next = location.pathname + location.search;
                    if (next !== path) { path = next; log.push({ t: Date.now(), k: 'path', v: next }); }
                }, 250);
                const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
                log.push({ t: Date.now(), k: 'document_load', v: nav?.type ?? 'unknown' });
            };
            if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
        });
        const readTimeline = () => page.evaluate(() => (window as unknown as { __ssBackDiag__?: Array<{ t: number; k: string; v: string | null }> }).__ssBackDiag__ ?? [])
            .catch(() => [] as Array<{ t: number; k: string; v: string | null }>);

        // Coaching responses: time, status and latency (one take = at most its two lifecycle attempts, #1473; Back must not
        // request coaching again). The phrases themselves are read from the page and the saved row below.
        const coaching: Array<{ at: number; status: number; latencyMs: number | null }> = [];
        page.on('response', (response: Response) => {
            if (response.url().includes('/functions/v1/get-ai-suggestions') && response.request().method() === 'POST') {
                const end = response.request().timing().responseEnd;
                coaching.push({ at: rel(), status: response.status(), latencyMs: end >= 0 ? end : null });
            }
        });
        const capture: CoachingCapture = { fixtureKind: fixture.entry.kind, responses: coaching, shownWell: '', shownNext: '', savedWell: '', savedNext: '' };
        // Console: classes and counts only — never the text.
        const consoleClasses: Record<string, number> = { error: 0, warning: 0, teardown_like: 0 };
        const teardownAt: number[] = [];
        page.on('console', (msg) => {
            const type = msg.type();
            if (type === 'error') consoleClasses.error += 1;
            if (type === 'warning') consoleClasses.warning += 1;
            if (/teardown|dispos|terminat|unmount|reset/i.test(msg.text())) { consoleClasses.teardown_like += 1; teardownAt.push(rel()); }
        });

        let savedId = '';
        let savedAt = 0;
        // #1519: on a fresh account the model is cold, and the product's download control starts the take once the model
        // is ready. That take IS the take (run 37700194032 HOLDed here by mistake); only a warm account needs a Start press.
        let takeAlreadyRunning = false;
        let backPressedAt = -1;
        try {
            await test.step('fresh disposable account', async () => {
                await page.goto('/auth/signup');
                const surface = await page.evaluate(() => {
                    const w = window as unknown as Record<string, unknown> & { __APP_RELEASE__?: string; __APP_RUNTIME_CONFIG__?: { testMode?: boolean } };
                    return {
                        origin: location.origin,
                        release: w.__APP_RELEASE__ ?? null,
                        testMode: w.__APP_RUNTIME_CONFIG__?.testMode ?? false,
                        injected: Object.keys(w).some((k) => /__E2E|__MOCK|__MSW|TEST_MODE/i.test(k)),
                    };
                });
                diag.update({ observed_origin: surface.origin, observed_release: surface.release, test_mode: surface.testMode, injected_surface: surface.injected });
                if (surface.origin !== APPROVED_ORIGIN || surface.testMode || surface.injected) throw new Error('HOLD surface: not the approved, uninjected Production surface');
                createdEmail = newDisposableEmail('back-diag');
                const account = await signUpDisposableAccount(page, createdEmail);
                capturedUid = account.uid;
                diag.mark('account_ready');
            });

            await test.step('Open Mic with the Private engine', async () => {
                await page.goto('/session');
                await selectBenchmarkMode(page, 'private');
                const setup = await preparePrivateModelIfPrompted(page, 900_000);
                takeAlreadyRunning = setup.recordingAlreadyStarted;
                if (!takeAlreadyRunning) await waitForPrivateEngineReady(page, 600_000);
                diag.update({ take_started_by_setup: takeAlreadyRunning });
                // The engine/model actually loaded (content-free identity + CPU thread configuration).
                diag.update({ ...flatScalars('stt', await readSttIdentity(page)), ...flatScalars('cpu', await readCpuRuntime(page)) });
                diag.mark('engine_ready');
            });

            await test.step('one take of at least 90 s, then Stop and save', async () => {
                // Delegated start (#1519): presses Start only when setup did not already start the take.
                if (!takeAlreadyRunning) await startBenchmarkRecording(page, SUITE);
                const startedAt = rel();
                await page.waitForTimeout(TAKE_MS);
                const stopAt = rel();
                await stopBenchmarkRecording(page, SUITE, 180_000);
                await waitForBenchmarkSaveCandidate(page, SUITE, 180_000);
                await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 120_000 });
                savedAt = rel();
                savedId = (await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'))) ?? '';
                diag.update({ take_started_ms: startedAt, take_length_ms: stopAt - startedAt, saved_ms: savedAt, saved_id: savedId || null });
                if (!savedId) throw new Error('FAIL: no persisted session id after save');
            });

            await test.step('the AI suggestions shown after Stop', async () => {
                // Bounded: a slow or failed review is recorded, never waited on forever; the Back timing is unaffected
                // because the away window below is measured from the save, not from here.
                const shown = await page.getByTestId('review-try-next').first().waitFor({ state: 'visible', timeout: 90_000 }).then(() => true, () => false);
                if (shown) {
                    capture.shownWell = (await page.getByTestId('review-what-went-well').first().innerText({ timeout: 15_000 }).catch(() => '')).trim();
                    capture.shownNext = (await page.getByTestId('review-try-next').first().innerText({ timeout: 15_000 }).catch(() => '')).trim();
                }
                diag.update({ coaching_shown: shown, coaching_shown_after_save_ms: rel() - savedAt });
            });

            await test.step('Progress, away past the ~61 s boundary', async () => {
                const before = await readSessionView(page);
                diag.update(sessionViewFields('before', before, savedId));
                const desktop = page.getByTestId('nav-analytics-link');
                await desktop.first().click();
                await page.waitForURL(/\/analytics(\?|$)/, { timeout: 45_000 });
                diag.update({ left_for_progress_ms: rel(), left_after_save_ms: rel() - savedAt });
                const remaining = savedAt + AWAY_UNTIL_AFTER_SAVE_MS - rel();
                if (remaining > 0) await page.waitForTimeout(remaining);
                diag.update({ back_pressed_after_save_ms: rel() - savedAt });
            });

            await test.step('browser Back, then observe the session page', async () => {
                backPressedAt = rel();
                await page.goBack({ waitUntil: 'commit', timeout: 45_000 });
                const backAt = rel();
                let last: SessionView | null = null;
                let index = 0;
                for (let elapsed = 0; elapsed <= OBSERVE_AFTER_BACK_MS; elapsed += SAMPLE_MS) {
                    if (elapsed > 0) await page.waitForTimeout(SAMPLE_MS);
                    last = await readSessionView(page);
                    diag.update({ ...sessionViewFields(`back_s${index}`, last, savedId), [`back_s${index}_ms`]: rel() - backAt });
                    index += 1;
                }
                // The headline: what the session page shows once the observation window has passed.
                if (last) diag.update({ back_result: sessionViewFields('back_final', last, savedId).back_final_class, back_samples: index });
            });
        } finally {
            if (savedId && admin) {
                const { data: row } = await admin.from('sessions').select('ai_suggestions').eq('id', savedId).maybeSingle();
                const saved = (row?.ai_suggestions ?? null) as { what_worked?: unknown; what_to_try_next?: unknown } | null;
                capture.savedWell = typeof saved?.what_worked === 'string' ? saved.what_worked.trim() : '';
                capture.savedNext = typeof saved?.what_to_try_next === 'string' ? saved.what_to_try_next.trim() : '';
            }
            // The phrases (synthetic take only): the run summary for signed-in viewers, and one job-log line that is readable
            // without a session (PO: "captured any way"). The diagnostic record itself carries flags and numbers only.
            const summary = coachingSummaryMarkdown(capture);
            if (summary && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
            const logLine = aiSuggestionsLogLine(capture);
            if (logLine) console.log(logLine);
            const timeline = (await readTimeline()).map((e) => ({ ...e, t: e.t - t0 }));
            diag.update({
                ...timelineFields(timeline, savedId),
                coaching_responses: safeValue(coaching.map((r) => `${r.at}:${r.status}:${r.latencyMs === null ? 'na' : Math.round(r.latencyMs)}`).join(';') || 'none'),
                coaching_attempts: coaching.length,
                coaching_attempts_after_back: backPressedAt < 0 ? null : coaching.filter((r) => r.at >= backPressedAt).length,
                coaching_saved: capture.savedWell !== '' && capture.savedNext !== '',
                coaching_shown_matches_saved: shownMatchesSaved(capture),
                coaching_in_run_summary: Boolean(summary && process.env.GITHUB_STEP_SUMMARY),
                coaching_in_job_log: Boolean(logLine),
                console_error: consoleClasses.error,
                console_warning: consoleClasses.warning,
                console_teardown_like: consoleClasses.teardown_like,
                teardown_like_console_ms: safeValue(teardownAt.slice(0, 20).join(';') || 'none'),
            });
        }
        // The diagnostic passes when the observation was collected; the RESULT line names what was seen. One take makes at most
        // its two lifecycle attempts (#1473), and Back must not request coaching again.
        expect(coaching.length, 'at most the two lifecycle attempts for the one take (#1473)').toBeLessThanOrEqual(2);
        expect(coaching.filter((r) => r.at >= backPressedAt).length, 'Back must not request coaching again').toBe(0);
    });
});
