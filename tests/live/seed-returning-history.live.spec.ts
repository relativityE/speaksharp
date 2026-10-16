/**
 * #1258 — ONE-TIME SEED, PO-authorized 2026-10-16: give the maintained FREE_TEST returning-user account the history the
 * returning-user RWT (`rwt-products-navigation`, row "returning history") needs. The account records ONE short Private
 * Open Mic take through the real product and saves it — exactly how a returning user acquires history. Nothing is
 * deleted afterwards: the saved session IS the seed.
 *
 * Content-free output: counts only (never the email, the user id, the transcript or the coaching text).
 */
import { createClient } from '@supabase/supabase-js';
import { expect, test } from './helpers/rwtProductionTest';
import { loadRwtFixture, rwtLaunchArgs } from './helpers/rwtJourney';
import {
    preparePrivateModelIfPrompted, selectBenchmarkMode, startBenchmarkRecording, stopBenchmarkRecording, waitForPrivateEngineReady,
} from './helpers/benchmark-utils';

const EMAIL = process.env.FREE_TEST_EMAIL ?? '';
const PASSWORD = process.env.FREE_TEST_PASSWORD ?? '';
const admin = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
const fixture = loadRwtFixture('open_mic_tts');

test.use({
    permissions: ['microphone'], trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: false }) },
});

test('seed: the FREE_TEST returning user records and saves one Open Mic take @live', async ({ page }) => {
    test.setTimeout(1_200_000);
    expect(EMAIL && PASSWORD, 'FREE_TEST credentials are injected by the workflow').toBeTruthy();
    expect(admin, 'service-role readback is required to prove the seed').not.toBeNull();

    await page.goto('/auth/signin');
    await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('email-input').fill(EMAIL);
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-submit').click();
    const readUid = () => page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
            if (!/^sb-.*-auth-token$/.test(key)) continue;
            try { const id = JSON.parse(localStorage.getItem(key) ?? '{}')?.user?.id; if (typeof id === 'string') return id; } catch { /* next */ }
        }
        return null;
    });
    await expect.poll(readUid, { timeout: 60_000, message: 'sign-in must produce a session' }).toBeTruthy();
    const uid = (await readUid())!;
    const completed = async () => {
        const { count, error } = await admin!.from('sessions').select('id', { count: 'exact', head: true })
            .eq('user_id', uid).eq('status', 'completed');
        if (error) throw new Error(`completed-session count failed (fail closed): ${error.code ?? 'unknown'}`);
        return count ?? 0;
    };
    const before = await completed();

    await page.goto('/session');
    await selectBenchmarkMode(page, 'private');
    const setup = await preparePrivateModelIfPrompted(page, 900_000);
    if (!setup.recordingAlreadyStarted) {
        await waitForPrivateEngineReady(page, 600_000);
        await startBenchmarkRecording(page, 'seed-returning-history');
    }
    await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
    await stopBenchmarkRecording(page, 'seed-returning-history', 180_000);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 180_000 });

    await expect.poll(completed, { timeout: 60_000, message: 'the saved take is a completed session' }).toBeGreaterThan(before);
    const after = await completed();
    // Counts only.
    console.log(`SEED_RESULT ${JSON.stringify({ completedBefore: before, completedAfter: after })}`);
});
