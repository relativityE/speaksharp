import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { AUDIO_ARGS, selectBenchmarkMode } from './helpers/benchmark-utils';
import { FILLER_CONV_01_AUDIO } from './helpers/audio-fixtures';

/**
 * LIVE-APP wiring proof for the Private-sample telemetry spine.
 *
 * The deterministic unit proof (privateSampleTelemetry.proof.test.ts) is the authority for the
 * v2/v4 attribution CONTRACT. This spec proves the remaining risk: that the REAL app lifecycle
 * actually emits the events and persists the arm. It mints a fresh free account (unused Private
 * sample), drives the real Private flow, and asserts — via the non-PII window mirror
 * `__SS_PRIVATE_SAMPLE_EVENTS__` and a live-DB read — that:
 *   selected → setup → recording_started → first_transcript_seen(once) → recording_stopped →
 *   saved → usage_updated fire; the saved session row's engine_version records a real arm
 *   (private_v2 / private_v4); report_issue_submitted carries session/variant/release; and NO
 *   captured event contains transcript/audio/raw payload.
 *
 * Arm note: the deterministic override is dev/test/E2E-only, so against the deployed app the
 * resolved arm is whatever the live flags select (v2 by default while broad v4 rollout = 0%).
 * This spec asserts a VALID arm is recorded, not which one — the unit proof owns v2-vs-v4.
 */

const BASE_URL = process.env.BASE_URL;

const admin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

async function findUserIdByEmail(email: string): Promise<string | null> {
    if (!admin) return null;
    for (let pageNum = 1; pageNum <= 50; pageNum++) {
        const { data } = await admin.auth.admin.listUsers({ page: pageNum, perPage: 200 });
        const users = data?.users ?? [];
        const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (match) return match.id;
        if (users.length < 200) return null;
    }
    return null;
}

async function deleteTesterByEmail(email: string): Promise<void> {
    if (!email || !admin) {
        if (!admin) console.warn(`PRIVATE_SAMPLE_TELEMETRY_CLEANUP_SKIPPED no SUPABASE_SERVICE_ROLE_KEY — ${email} will leak`);
        return;
    }
    try {
        const id = await findUserIdByEmail(email);
        if (id) await admin.auth.admin.deleteUser(id);
    } catch (err) {
        console.warn(`PRIVATE_SAMPLE_TELEMETRY_CLEANUP_WARN could not delete ${email}: ${(err as Error)?.message ?? err}`);
    }
}

async function readLatestSessionEngineVersion(userId: string): Promise<string | null> {
    if (!admin) return null;
    const { data } = await admin
        .from('sessions')
        .select('engine_version, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);
    return data?.[0]?.engine_version ?? null;
}

type SampleEvent = { event: string; ts: number;[k: string]: unknown };
async function getSampleEvents(page: Page): Promise<SampleEvent[]> {
    return await page.evaluate(() => {
        const w = window as unknown as { __SS_PRIVATE_SAMPLE_EVENTS__?: SampleEvent[] };
        return w.__SS_PRIVATE_SAMPLE_EVENTS__ ?? [];
    });
}

const FORBIDDEN = ['transcript', 'text', 'audio', 'wav', 'blob', 'base64', 'raw', 'segments', 'tokens'];

test.use({
    permissions: ['microphone'],
    baseURL: BASE_URL,
    launchOptions: {
        args: [...AUDIO_ARGS, '--disable-gpu', '--disable-webgpu', `--use-file-for-fake-audio-capture=${FILLER_CONV_01_AUDIO}`],
    },
});

test.describe('Private-sample telemetry — live app wiring @live', () => {
    let createdEmail: string | null = null;
    test.afterEach(async () => {
        if (createdEmail) { await deleteTesterByEmail(createdEmail); createdEmail = null; }
    });

    test('real Private sample lifecycle emits the event spine and persists the arm', async ({ page }) => {
        test.skip(!BASE_URL, 'BASE_URL is required.');
        test.setTimeout(360_000);

        await page.addInitScript(() => {
            const w = window as unknown as { __SS_PRIVATE_SAMPLE_EVENTS__?: unknown[]; __FORCE_TRANSFORMERS_JS__?: boolean; __STT_LOAD_TIMEOUT__?: number };
            w.__SS_PRIVATE_SAMPLE_EVENTS__ = [];
            w.__FORCE_TRANSFORMERS_JS__ = true;
            w.__STT_LOAD_TIMEOUT__ = 180000;
        });

        const unique = `${Date.now()}-${process.env.GITHUB_RUN_ID ?? 'local'}`;
        const email = `private-sample-telemetry-${unique}@speaksharp.app`;
        const password = `SpeakSharpSample-${unique}!`;
        createdEmail = email;

        await test.step('Sign up a fresh free tester (unused Private sample)', async () => {
            await page.goto('/auth/signup');
            await expect(page.getByRole('heading', { name: /create account|create an account/i })).toBeVisible({ timeout: 20_000 });
            await clearPrivateModelStorage(page);
            await page.getByTestId('email-input').fill(email);
            await page.getByTestId('password-input').fill(password);
            await page.getByTestId('sign-up-submit').click();
            await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
        });

        await test.step('Select Private mode → private_sample_selected', async () => {
            await selectBenchmarkMode(page, 'private');
            await expect.poll(async () => (await getSampleEvents(page)).map((e) => e.event), { timeout: 20_000 })
                .toContain('private_sample_selected');
        });

        await test.step('Prepare Private model (setup fires via warmUp/auto-init, asserted at end)', async () => {
            await preparePrivateModelIfPrompted(page);
        });

        await test.step('Record → wait for first transcript text', async () => {
            const startStop = page.getByTestId('session-start-stop-button');
            await expect(startStop).toBeEnabled({ timeout: 60_000 });
            await startStop.click();
            await expect(startStop).toHaveAttribute('data-recording', 'true', { timeout: 60_000 });
            await expect.poll(async () =>
                (await getSampleEvents(page)).filter((e) => e.event === 'private_sample_first_transcript_seen').length,
                { timeout: 120_000 }).toBeGreaterThanOrEqual(1);
        });

        await test.step('Stop + save', async () => {
            const startStop = page.getByTestId('session-start-stop-button');
            await startStop.click();
            await expect(startStop).toHaveAttribute('data-recording', 'false', { timeout: 60_000 });
            await expect(page.locator('html[data-session-persisted="true"]')).toBeVisible({ timeout: 60_000 });
            await expect.poll(async () => (await getSampleEvents(page)).map((e) => e.event), { timeout: 30_000 })
                .toContain('private_sample_saved');
        });

        await test.step('Full event spine present (selected/setup/start/first-text/stop/save/usage)', async () => {
            await expect.poll(async () => {
                const names = new Set((await getSampleEvents(page)).map((e) => e.event));
                const required = [
                    'private_sample_selected',
                    'private_sample_setup_started',
                    'private_sample_recording_started',
                    'private_sample_first_transcript_seen',
                    'private_sample_recording_stopped',
                    'private_sample_saved',
                    'private_sample_usage_updated',
                ];
                return required.every((n) => names.has(n))
                    && (names.has('private_sample_setup_succeeded') || names.has('private_sample_setup_failed'));
            }, { timeout: 30_000 }).toBe(true);
            // first_transcript_seen fires exactly once.
            const ftsCount = (await getSampleEvents(page)).filter((e) => e.event === 'private_sample_first_transcript_seen').length;
            expect(ftsCount, 'first_transcript_seen should fire exactly once').toBe(1);
        });

        await test.step('Saved session row records a real engine arm', async () => {
            const userId = await findUserIdByEmail(email);
            expect(userId, 'created user must be resolvable for the DB assertion').toBeTruthy();
            const engineVersion = await readLatestSessionEngineVersion(userId!);
            expect(engineVersion, `engine_version=${engineVersion}`).toMatch(/^private_v(2|4):/);
        });

        await test.step('Report Issue → report_issue_submitted with context', async () => {
            await page.getByTestId('nav-report-issue-button').click();
            await page.getByTestId('issue-report-title').fill('Telemetry proof report');
            await page.getByTestId('issue-report-description').fill('Automated proof that report_issue_submitted carries context.');
            await page.getByTestId('issue-report-submit').click();
            await expect.poll(async () => (await getSampleEvents(page)).map((e) => e.event), { timeout: 20_000 })
                .toContain('report_issue_submitted');
        });

        await test.step('PRIVACY: no captured event contains transcript/audio/raw payload', async () => {
            const events = await getSampleEvents(page);
            for (const e of events) {
                for (const forbidden of FORBIDDEN) {
                    expect(e, `event ${e.event} leaked '${forbidden}'`).not.toHaveProperty(forbidden);
                }
                // every sample event carries the arm attribution
                if (e.event !== 'private_sample_selected' && e.event !== 'private_sample_setup_started') {
                    expect(e.engine_variant, `event ${e.event} missing engine_variant`).toMatch(/^private_v(2|4)$/);
                }
            }
            console.log(`PRIVATE_SAMPLE_TELEMETRY_EVIDENCE ${JSON.stringify({ email, events })}`);
        });
    });
});

async function clearPrivateModelStorage(page: Page) {
    await page.evaluate(async () => {
        if ('caches' in window) {
            for (const name of await caches.keys()) {
                if (/transformers|whisper|model/i.test(name)) await caches.delete(name);
            }
        }
        if ('indexedDB' in window && 'databases' in indexedDB) {
            const databases = await indexedDB.databases();
            await Promise.all(databases
                .map((d) => d.name)
                .filter((n): n is string => Boolean(n) && /transformers|whisper|model/i.test(n))
                .map((n) => new Promise<void>((resolve) => {
                    const req = indexedDB.deleteDatabase(n);
                    req.onsuccess = () => resolve();
                    req.onerror = () => resolve();
                    req.onblocked = () => resolve();
                })));
        }
    });
}

async function preparePrivateModelIfPrompted(page: Page) {
    const downloadButton = page.locator('[data-testid="download-model-button"], [data-testid="download-model-button-inline"]').first();
    if (await downloadButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await downloadButton.click();
    }
    await page.waitForFunction(() => {
        const root = document.documentElement;
        return root.getAttribute('data-stt-ready') === 'true'
            || root.getAttribute('data-runtime-state') === 'RECORDING'
            || root.getAttribute('data-model-status') === 'ready';
    }, { timeout: 180_000 });
}
