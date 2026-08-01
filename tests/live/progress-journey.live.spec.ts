/**
 * #1045 deployed journey — verifies the LIVE Progress loop on the deployed app with a synthetic account,
 * AFTER the two migrations are applied. Real Private recordings (no mocks). Each assertion names the exact
 * gate so a failure reports precisely where the journey broke (per PO: on failure, do not close #1045).
 *
 * Gates: (1) eligible session records + saves → (2) Session-review renders the Progress panel with a
 * direction + two takeaways + "Practice this next" → (3) accepting records an attempt → (4) a second
 * eligible session resolves that attempt with a server-derived outcome.
 *
 * Run (against prod, synthetic account, long fixture for ≥75 words / ≥30s):
 *   BASE_URL=<prod> LIVE_AUDIO_FIXTURE=tests/fixtures/stt-isomorphic/audio/washington_01.wav \
 *   VISUAL_TEST_EMAIL=… VISUAL_TEST_PASSWORD=… \
 *   npx playwright test tests/live/progress-journey.live.spec.ts --config=playwright.live.config.ts
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { verifyCredentialsAndInjectSession } from '../e2e/helpers';

// Prefer the MAINTAINED reusable Pro account (real Pro → Private enabled), injected by GitHub Actions
// (rc-gates.yml gate-3-dast). VISUAL_TEST_* remains an explicit local override. Private requires a real
// Pro entitlement — a comped/disposable "pro" does not satisfy prod's isProUser, so do NOT use one here.
const EMAIL = process.env.VISUAL_TEST_EMAIL || process.env.PRO_TEST_EMAIL || '';
const PASSWORD = process.env.VISUAL_TEST_PASSWORD || process.env.PRO_TEST_PASSWORD || '';
const RECORD_MS = Number(process.env.PROGRESS_RECORD_MS || 35000); // ≥30s eligibility gate
const EXPECTED_RELEASE_SHA = (process.env.EXPECTED_RELEASE_SHA || '').trim();

test.use({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } });

/**
 * Deterministic preflight — fails in SECONDS (before the two ~4-minute recordings) when any precondition
 * that doomed earlier runs is wrong: missing creds/fixture, wrong deployed SHA, or — the one that cost two
 * 15-minute timeouts — an account whose entitlement leaves Private DISABLED. Every gate names itself.
 */
async function preflight(page: Page): Promise<void> {
    expect(EMAIL, 'preflight: a maintained Pro account (PRO_TEST_EMAIL) or VISUAL_TEST_EMAIL is required').not.toBe('');
    // Audio fixture is owned by playwright.deployed-live.config.ts (fake-audio launch arg); only assert a
    // local override when one is explicitly provided.
    const overrideFixture = process.env.LIVE_AUDIO_FIXTURE;
    if (overrideFixture) expect(existsSync(resolve(overrideFixture)), `preflight: fixture missing at ${overrideFixture}`).toBe(true);

    // Deployed SHA — prove we are testing the intended build (fail fast on a stale/rolling deploy).
    const deployedSha = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? '');
    if (EXPECTED_RELEASE_SHA) {
        expect(deployedSha, `preflight: deployed SHA ${deployedSha} != expected ${EXPECTED_RELEASE_SHA}`).toBe(EXPECTED_RELEASE_SHA);
    }
    test.info().annotations.push({ type: 'deployed_sha', description: deployedSha });

    // Entitlement + Private availability, server-resolved: open the mode menu and require the Private radio
    // to be ENABLED. A non-Pro / no-sample account leaves it aria-disabled — catch it now, not after 30s of
    // recording that silently falls back to native and gets discarded as non-speech.
    await page.goto('/session');
    await page.waitForSelector('[data-testid="live-recording-card"]', { timeout: 30000 });
    await page.getByTestId('stt-mode-select').click();
    const priv = page.getByTestId('stt-mode-private');
    await expect(priv, 'preflight: Private option must exist').toBeVisible({ timeout: 10000 });
    const disabled = await priv.getAttribute('aria-disabled');
    expect(disabled, 'preflight: Private is DISABLED — account lacks Pro/private-sample entitlement (wrong account?)').not.toBe('true');
    await priv.click(); // select Private for the run
    // Close the menu deterministically.
    await page.keyboard.press('Escape').catch(() => { /* menu may already be closed */ });
}

async function recordOneSession(page: Page): Promise<void> {
    await page.goto('/session');
    await page.waitForSelector('[data-testid="live-recording-card"]', { timeout: 30000 });
    // EXPLICITLY select Private (a dropdown radio item) — a mere ?trial preselect fell back to native,
    // which cannot transcribe fake-file audio. Private (Whisper) processes the fake-audio WAV directly.
    await page.getByTestId('stt-mode-select').click();
    await page.getByTestId('stt-mode-private').click();
    const startStop = page.getByTestId('session-start-stop-button');
    await expect(startStop, 'record: start/stop control present').toBeVisible({ timeout: 20000 });
    // Clicking start with Private selected downloads the model (if needed) then records; the durable
    // model status lives on <html data-model-status>. Wait for RECORDING to actually engage.
    await startStop.click();
    await expect(page.getByTestId('recording-indicator'), 'record: RECORDING engaged (Private)')
        .toBeVisible({ timeout: 240000 });
    await page.waitForTimeout(RECORD_MS);                 // ≥30s spoken length
    await startStop.click();
    await expect(page.getByTestId('recording-indicator'), 'record: finalize completes')
        .toBeHidden({ timeout: 240000 });
    await page.waitForTimeout(6000);
}

async function latestSessionId(): Promise<string> {
    const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);
    const { data: auth } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    const uid = auth.user!.id;
    const { data } = await supabase.from('sessions').select('id, created_at, status, attribution_status')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(1);
    const row = data?.[0] as { id: string; status?: string; attribution_status?: string } | undefined;
    if (!row) throw new Error('gate 1: no session persisted — the recording was discarded (non-speech/low-quality) or never saved');
    return row.id;
}

test('#1045 deployed journey: record → Progress panel → accept → next session resolves outcome', async ({ page }) => {
    test.setTimeout(15 * 60 * 1000);
    expect(EMAIL, 'gate 0: synthetic account email required').not.toBe('');

    await verifyCredentialsAndInjectSession(page, EMAIL, PASSWORD, 'pro');
    await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

    // Deterministic preflight — fail in seconds if account/entitlement/Private/fixture/SHA is wrong.
    await preflight(page);

    // Gate 1 — first eligible session
    await recordOneSession(page);
    const s1 = await latestSessionId();

    // Gate 2 — Session-review renders the Progress panel (direction + two takeaways + action)
    await page.goto(`/analytics/${s1}`);
    const panel = page.getByTestId('progress-panel');
    await expect(panel, 'gate 2: Progress panel must render for an eligible session').toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('progress-direction')).toBeVisible();
    await expect(page.getByTestId('progress-what-worked')).toBeVisible();
    await expect(page.getByTestId('progress-practice-next')).toBeVisible();
    const accept = page.getByTestId('progress-accept');
    await expect(accept, 'gate 2: "Practice this next" action present').toBeVisible();

    // Gate 3 — accept records an attempt + enters the next practice
    await accept.click();
    await expect(page).toHaveURL(/\/session/, { timeout: 20000 });

    // Gate 4 — second eligible session resolves the attempt (server-derived outcome)
    await recordOneSession(page);
    const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);
    await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    // Give the save seam a moment to resolve the open attempt.
    let resolved: { lifecycle: string; outcome: string | null } | null = null;
    for (let i = 0; i < 10 && !resolved; i++) {
        const { data } = await supabase.from('progress_recommendation_attempts')
            .select('lifecycle, outcome, accepted_at').order('accepted_at', { ascending: false }).limit(1);
        const row = data?.[0] as { lifecycle: string; outcome: string | null } | undefined;
        if (row && row.lifecycle !== 'pending') resolved = row;
        else await page.waitForTimeout(3000);
    }
    expect(resolved, 'gate 4: the accepted attempt must resolve to a terminal lifecycle').not.toBeNull();
    expect(['completed', 'not_comparable'], 'gate 4: lifecycle terminal').toContain(resolved!.lifecycle);
    expect(['moved', 'did_not_move', 'not_comparable'], 'gate 4: outcome server-derived').toContain(resolved!.outcome);
});
