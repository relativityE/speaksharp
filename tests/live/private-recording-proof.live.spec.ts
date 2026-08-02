import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
    AUDIO_ARGS,
    assertPreStartMode,
    selectBenchmarkMode,
    preparePrivateModelIfPrompted,
    expectBenchmarkRecordingStarted,
    expectBenchmarkTranscriptOutput,
    waitForBenchmarkSaveCandidate,
} from './helpers/benchmark-utils';
import { FILLER_CONV_01_AUDIO } from './helpers/audio-fixtures';

// #1089 / #1129 — TINY exact-production-SHA Private recording proof harness.
//
// Proves the DEPLOYED build, on the exact merged SHA, drives the real customer loop with NO shortcut, NO
// mocks and NO Cloud:
//   fresh signup → lands on /practice → VISIBLE practice entry (not a /session deep-link) → /session →
//   Private selected → real (fixture-fed, non-mocked) Private WASM recording → live transcript → durable save.
//
// It is deliberately small and self-cleaning; the broad cradle-to-grave journey is #1143 (DevGPT).

const BASE_URL = process.env.BASE_URL;
// The exact deployed SHA the workflow expects (deploy-race gate). Injected; the proof FAILS CLOSED on
// mismatch so it can never silently validate a different build than the one under test.
const EXPECT_RELEASE_SHA = (process.env.EXPECT_RELEASE_SHA || '').trim();
const TEST_EMAIL_DOMAIN = process.env.LIVE_TEST_EMAIL_DOMAIN || 'example.com';

const cleanupAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

async function deleteTesterByEmail(email: string): Promise<void> {
    if (!email || !cleanupAdmin) {
        if (email && !cleanupAdmin) console.warn(`PRIVATE_PROOF_CLEANUP_SKIPPED no service-role key — ${email} leaks as residue`);
        return;
    }
    try {
        for (let p = 1; p <= 50; p++) {
            const { data } = await cleanupAdmin.auth.admin.listUsers({ page: p, perPage: 200 });
            const users = data?.users ?? [];
            const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
            if (match) { await cleanupAdmin.auth.admin.deleteUser(match.id); return; }
            if (users.length < 200) return;
        }
    } catch (err) {
        console.warn(`PRIVATE_PROOF_CLEANUP_WARN could not delete ${email}: ${(err as Error)?.message ?? err}`);
    }
}

test.use({
    permissions: ['microphone'],
    baseURL: BASE_URL,
    launchOptions: {
        args: [
            ...AUDIO_ARGS,
            '--disable-gpu',
            '--disable-webgpu',
            `--use-file-for-fake-audio-capture=${FILLER_CONV_01_AUDIO}`,
        ],
    },
});

test.describe('#1089 exact-SHA Private recording proof @live', () => {
    let createdEmail = '';

    test.beforeEach(() => {
        test.skip(!BASE_URL, 'BASE_URL is required so this proof targets the intended deployed app.');
        test.skip(!EXPECT_RELEASE_SHA, 'EXPECT_RELEASE_SHA must be injected so the proof binds to the exact deployed SHA.');
    });

    test.afterEach(async () => { await deleteTesterByEmail(createdEmail); });

    test('fresh signup → /practice → visible entry → Private (no Cloud) → mock-free recording → durable save', async ({ page }) => {
        test.setTimeout(300_000);

        await test.step('Fresh signup', async () => {
            const unique = `${Date.now()}-${process.env.GITHUB_RUN_ID ?? 'local'}`;
            createdEmail = `private-proof-${unique}@${TEST_EMAIL_DOMAIN}`;
            await page.goto('/auth/signup');
            await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
            await page.getByTestId('email-input').fill(createdEmail);
            await page.getByTestId('password-input').fill(`SpeakSharpProof-${unique}!`);
            await page.getByTestId('sign-up-submit').click();
        });

        await test.step('Lands on /practice (no /session deep-link) and reports the EXACT deployed SHA', async () => {
            await expect(page).toHaveURL(/\/practice/, { timeout: 45_000 });
            await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 20_000 });
            // Deploy-race gate: the deployed build MUST be the exact SHA under test — fail closed otherwise.
            const release = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? null);
            expect(release, `deployed __APP_RELEASE__ (${release}) must equal EXPECT_RELEASE_SHA (${EXPECT_RELEASE_SHA})`).toBe(EXPECT_RELEASE_SHA);
        });

        await test.step('Click the VISIBLE practice entry → /session (real navigation, no deep-link)', async () => {
            await expect(page.getByTestId('practice-card-quick')).toBeVisible({ timeout: 20_000 });
            await page.getByTestId('practice-card-quick').click();
            await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
        });

        await test.step('Select Private (NOT Cloud) and prepare the real Private model', async () => {
            await selectBenchmarkMode(page, 'private');
            await preparePrivateModelIfPrompted(page, 180_000);
            await assertPreStartMode(page, 'private'); // proves Private is the pre-start engine; never Cloud
        });

        await test.step('Mock-free Private recording produces a live transcript', async () => {
            const startStop = page.getByTestId('session-start-stop-button');
            await expect(startStop).toBeEnabled({ timeout: 60_000 });
            await startStop.click();
            await expectBenchmarkRecordingStarted(page, 'private-proof');
            await expectBenchmarkTranscriptOutput(page, 'private-proof', 60_000, 3);
            await startStop.click();
            await expect(startStop).toHaveAttribute('data-recording', 'false', { timeout: 120_000 });
        });

        await test.step('Session durably saved with a real transcript', async () => {
            const save = await waitForBenchmarkSaveCandidate(page, 'private-proof', 120_000);
            const saved = (save.selectedForSave ?? '').trim();
            expect(saved.length, `saved transcript must be non-empty: ${JSON.stringify(save)}`).toBeGreaterThan(0);
            expect(saved, JSON.stringify(save)).not.toMatch(/words appear here|listening|no speech/i);
            console.log(`PRIVATE_RECORDING_PROOF_EVIDENCE ${JSON.stringify({
                email: createdEmail, release: EXPECT_RELEASE_SHA, savedLength: saved.length, url: page.url(),
            })}`);
        });
    });
});
