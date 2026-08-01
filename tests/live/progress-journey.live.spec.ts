/**
 * #1045 deployed journey — proves the LIVE Progress loop on the deployed app, AFTER the two migrations are
 * applied. Uses the MAINTAINED reusable Free account and seeds the Private SAMPLE entitlement through the
 * sanctioned service-role path (as tests/live/stt-switching-contract.live.spec.ts does). Real Private
 * recordings; no mocks. GitHub Actions injects all credentials (run via rc-gates gate-3-dast).
 *
 * The Private sample is ONE-SHOT (availability flips off once private_sample_session_id is set), so the
 * two-session loop re-seeds the sample between sessions via the same service-role path. This is a harness
 * precondition for exercising the Progress MECHANICS; it is not a claim about the sample business rule.
 *
 * A deterministic preflight fails in SECONDS before either long recording unless every precondition holds:
 * deployed SHA present, sample resolves available server-side, Private control enabled+selected, model
 * reaches ready, and (re-seeded) allowance covers each session. Each assertion names its gate.
 */
import { test, expect, Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyCredentialsAndInjectSession } from '../e2e/helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const EMAIL = process.env.FREE_TEST_EMAIL || process.env.BASIC_TEST_EMAIL || process.env.VISUAL_TEST_EMAIL || '';
const PASSWORD = process.env.FREE_TEST_PASSWORD || process.env.BASIC_TEST_PASSWORD || process.env.VISUAL_TEST_PASSWORD || '';
const RECORD_MS = Number(process.env.PROGRESS_RECORD_MS || 45000); // ≥30s AND enough audio for ≥75 words
const EXPECTED_RELEASE_SHA = (process.env.EXPECTED_RELEASE_SHA || '').trim();

test.use({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } });

/** Fresh, unused 5-minute Private sample on the maintained Free account (service-role; the sanctioned path). */
async function seedUnusedSample(admin: SupabaseClient, uid: string): Promise<void> {
    const { error } = await admin.from('user_profiles').upsert({
        id: uid,
        subscription_status: 'free',
        private_sample_limit_seconds: 300,
        private_sample_seconds_used: 0,
        private_sample_completed_at: null,
        private_sample_session_id: null,
    }, { onConflict: 'id' });
    if (error) throw new Error(`seed sample failed: ${error.message}`);
}

async function resolveUid(): Promise<string> {
    const c = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error || !data.user) throw new Error(`preflight: cannot authenticate maintained Free account: ${error?.message}`);
    return data.user.id;
}

async function waitPrivateReady(page: Page): Promise<void> {
    // Durable model status projected onto <html data-model-status>; v2 auto-loads from /models/.
    await expect(async () => {
        const status = await page.evaluate(() => document.documentElement.getAttribute('data-model-status'));
        expect(status, `model status is '${status}', not 'ready'`).toBe('ready');
    }).toPass({ timeout: 180000 });
}

async function selectPrivate(page: Page): Promise<void> {
    await page.goto('/session');
    await page.waitForSelector('[data-testid="live-recording-card"]', { timeout: 30000 });
    await page.getByTestId('stt-mode-select').click();
    const priv = page.getByTestId('stt-mode-private');
    await expect(priv, 'Private option present').toBeVisible({ timeout: 10000 });
    expect(await priv.getAttribute('aria-disabled'), 'Private DISABLED — sample entitlement did not resolve').not.toBe('true');
    await priv.click();
    await page.keyboard.press('Escape').catch(() => { /* menu may be closed */ });
}

async function recordOneSession(page: Page): Promise<void> {
    await waitPrivateReady(page);
    const startStop = page.getByTestId('session-start-stop-button');
    await expect(startStop, 'record: start/stop present').toBeVisible({ timeout: 20000 });
    await startStop.click();
    await expect(page.getByTestId('recording-indicator'), 'record: RECORDING engaged (Private)').toBeVisible({ timeout: 240000 });
    await page.waitForTimeout(RECORD_MS);
    await startStop.click();
    await expect(page.getByTestId('recording-indicator'), 'record: finalize completes').toBeHidden({ timeout: 240000 });
    await page.waitForTimeout(6000);
}

async function latestSessionId(admin: SupabaseClient, uid: string): Promise<string> {
    const { data } = await admin.from('sessions').select('id, created_at, status, attribution_status')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(1);
    const row = data?.[0] as { id: string } | undefined;
    if (!row) throw new Error('gate 1: no session persisted — recording discarded (non-speech) or not saved');
    return row.id;
}

test('#1045 deployed journey: record → Progress panel → accept → next session resolves outcome', async ({ page }) => {
    test.setTimeout(15 * 60 * 1000);
    test.skip(!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE || !EMAIL, 'requires GitHub-injected Supabase + maintained Free creds');
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
    const uid = await resolveUid();

    // ── Preflight (fail fast, seconds) ──
    await seedUnusedSample(admin, uid);                                  // gate 2 precondition
    const { data: prof } = await admin.from('user_profiles')
        .select('subscription_status, private_sample_seconds_used, private_sample_completed_at, private_sample_session_id, private_sample_limit_seconds')
        .eq('id', uid).maybeSingle();
    const p = prof as Record<string, unknown> | null;
    expect(p?.private_sample_completed_at, 'preflight: sample must be unused (completed_at null)').toBeNull();
    expect(p?.private_sample_session_id, 'preflight: sample must be unused (session_id null)').toBeNull();
    expect(Number(p?.private_sample_limit_seconds) - Number(p?.private_sample_seconds_used),
        'preflight: sample allowance must cover a session').toBeGreaterThanOrEqual(RECORD_MS / 1000);

    await verifyCredentialsAndInjectSession(page, EMAIL, PASSWORD, 'free');
    await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 15000 });
    const deployedSha = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? '');
    expect(deployedSha, 'preflight: deployed SHA must be a full 40-char commit').toMatch(/^[0-9a-f]{40}$/i);
    if (EXPECTED_RELEASE_SHA) expect(deployedSha, `preflight: deployed ${deployedSha} != expected ${EXPECTED_RELEASE_SHA}`).toBe(EXPECTED_RELEASE_SHA);
    test.info().annotations.push({ type: 'deployed_sha', description: deployedSha });
    console.log(`[journey] deployed_sha=${deployedSha} uid=${uid}`);

    await selectPrivate(page);   // gate 3: Private enabled + selected

    // ── Gate 1 — first eligible Private session ──
    await recordOneSession(page);
    const s1 = await latestSessionId(admin, uid);
    console.log(`[journey] session1=${s1}`);

    // ── Gate 2 — Session-review renders the Progress panel ──
    await page.goto(`/analytics/${s1}`);
    await expect(page.getByTestId('progress-panel'), 'gate 2: Progress panel renders').toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('progress-direction')).toBeVisible();
    await expect(page.getByTestId('progress-what-worked')).toBeVisible();
    await expect(page.getByTestId('progress-practice-next')).toBeVisible();
    const accept = page.getByTestId('progress-accept');
    await expect(accept, 'gate 2: Practice this next action present').toBeVisible();

    // ── Gate 3 — accept records an attempt + enters the next practice ──
    await accept.click();
    await expect(page).toHaveURL(/\/session/, { timeout: 20000 });

    // Re-seed the one-shot sample so session 2 can also use Private (sanctioned service-role path).
    await seedUnusedSample(admin, uid);

    // ── Gate 4 — second eligible session resolves the attempt (server-derived outcome) ──
    await selectPrivate(page);
    await recordOneSession(page);
    const s2 = await latestSessionId(admin, uid);
    console.log(`[journey] session2=${s2}`);

    // ── Verify persisted rows (service-role; sanitized) ──
    const { data: evalRow } = await admin.from('session_progress_evaluations')
        .select('session_id, eligible, clarity_raw, cohort_key').eq('session_id', s1).maybeSingle();
    expect((evalRow as { eligible?: boolean } | null)?.eligible, 'session 1 evaluation must be eligible').toBe(true);
    const { data: rec } = await admin.from('progress_recommendations')
        .select('id, target_metric, source_metric_value').eq('source_session_id', s1).maybeSingle();
    expect((rec as { id?: string } | null)?.id, 'recommendation persisted for session 1').toBeTruthy();

    let attempt: { lifecycle: string; outcome: string | null } | null = null;
    for (let i = 0; i < 12 && !attempt; i++) {
        const { data } = await admin.from('progress_recommendation_attempts')
            .select('lifecycle, outcome, accepted_at, recommendation_id')
            .eq('recommendation_id', (rec as { id: string }).id).order('accepted_at', { ascending: false }).limit(1);
        const row = data?.[0] as { lifecycle: string; outcome: string | null } | undefined;
        if (row && row.lifecycle !== 'pending') attempt = row;
        else await page.waitForTimeout(3000);
    }
    console.log(`[journey] evaluation=eligible recommendation=${(rec as { id: string }).id} attempt=${JSON.stringify(attempt)}`);
    expect(attempt, 'gate 4: attempt resolved to a terminal lifecycle').not.toBeNull();
    expect(['completed', 'not_comparable']).toContain(attempt!.lifecycle);
    expect(['moved', 'did_not_move', 'not_comparable']).toContain(attempt!.outcome);

    // Restore the shared account to a clean unused-sample state.
    await seedUnusedSample(admin, uid);
});
