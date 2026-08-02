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

// #1089 / #1129 — exact-production-SHA Private recording proof (rigorous).
//
// Proves the DEPLOYED build, on the exact merged SHA, drives the real customer loop with NO shortcut, NO
// mocks and NO Cloud, and DURABLY persists a verified Private-v2 row:
//   fail-closed preconditions → fresh signup → /practice → visible entry → /session → Private (runtime
//   identity: Transformers.js/WASM, no fallback, no provider request) → real fixture-fed recording →
//   durable persisted row (queried by id+uid: completed, non-empty transcript, engine=private,
//   attribution_status=verified, full v2 identity tuple) → UID-scoped fail-closed cleanup.
//
// Content-free evidence only. Never merged/dispatched until the workflow is on main and explicitly authorized.

const APPROVED_ORIGIN = 'https://speaksharp-public.vercel.app';
const BASE_URL = process.env.BASE_URL || '';
const EXPECT_RELEASE_SHA = (process.env.EXPECT_RELEASE_SHA || '').trim();
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TEST_EMAIL_DOMAIN = process.env.LIVE_TEST_EMAIL_DOMAIN || 'example.com';
// Cloud/provider hosts that must NEVER be contacted during a Private recording.
const PROVIDER_RE = /assemblyai|generativelanguage|openai|deepgram|cognitiveservices|speech\.googleapis|api\.anthropic/i;

// P1.5 — fail closed BEFORE any credential enters the page. Hard errors, never skip/warn.
function assertPreconditions(): void {
    let origin = '';
    try { origin = new URL(BASE_URL).origin; } catch { origin = ''; }
    if (origin !== APPROVED_ORIGIN) throw new Error(`ORIGIN GATE: BASE_URL origin "${origin}" must be exactly ${APPROVED_ORIGIN}`);
    if (!/^[0-9a-f]{40}$/i.test(EXPECT_RELEASE_SHA)) throw new Error('SHA GATE: EXPECT_RELEASE_SHA must be a full 40-character commit SHA');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('CAPABILITY GATE: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required for persisted-row proof and UID-scoped cleanup');
}

const admin = (SUPABASE_URL && SERVICE_ROLE_KEY)
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

async function findUidByEmail(email: string): Promise<string> {
    if (!admin) throw new Error('no admin client for UID capture (fail closed)');
    for (let p = 1; p <= 50; p++) {
        const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
        if (error) throw new Error(`UID lookup failed (fail closed): ${error.message}`);
        const u = (data?.users ?? []).find((x) => x.email?.toLowerCase() === email.toLowerCase());
        if (u) return u.id;
        if ((data?.users ?? []).length < 200) break;
    }
    throw new Error('created account not found for UID capture (fail closed)');
}

test.use({
    permissions: ['microphone'],
    baseURL: BASE_URL,
    // P1.4 — no credential-bearing artifacts for this proof.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: {
        args: [...AUDIO_ARGS, '--disable-gpu', '--disable-webgpu', `--use-file-for-fake-audio-capture=${FILLER_CONV_01_AUDIO}`],
    },
});

test.describe('#1089 exact-SHA Private recording proof @live', () => {
    let createdEmail = '';
    let capturedUid = '';

    test.beforeAll(() => { assertPreconditions(); }); // fail closed, never skip

    test.afterEach(async () => {
        // P1.3 — UID-scoped, fail-closed cleanup. Delete ONLY the exact run-owned UID; prove no residue.
        if (!capturedUid) return;
        if (!admin) throw new Error('cleanup requires admin client (fail closed)');
        const { data: got, error: getErr } = await admin.auth.admin.getUserById(capturedUid);
        if (getErr) throw new Error(`cleanup getUserById failed (fail closed): ${getErr.message}`);
        const foundEmail = got?.user?.email?.toLowerCase() ?? '';
        if (foundEmail !== createdEmail.toLowerCase()) throw new Error(`UID/email disagreement — refusing to delete (uid=${capturedUid})`);
        if (!/^private-proof-/.test(foundEmail)) throw new Error(`refusing to delete a non-run-owned account (${foundEmail})`);
        const { error: delErr } = await admin.auth.admin.deleteUser(capturedUid);
        if (delErr) throw new Error(`cleanup deleteUser failed (fail closed): ${delErr.message}`);
        // Prove no residue: auth user gone AND no run-owned session rows remain.
        const { data: after } = await admin.auth.admin.getUserById(capturedUid);
        expect(after?.user ?? null, 'auth user must be gone after cleanup').toBeNull();
        const { data: leftover, error: sErr } = await admin.from('sessions').select('id').eq('user_id', capturedUid);
        if (sErr) throw new Error(`cleanup residue query failed (fail closed): ${sErr.message}`);
        expect(leftover?.length ?? 0, 'no run-owned session residue').toBe(0);
        capturedUid = '';
    });

    test('signup → /practice → visible entry → Private (no Cloud) → durable verified persisted row', async ({ page }) => {
        test.setTimeout(300_000);

        // P1.2 — any Cloud/provider request during the run is a hard failure.
        const providerHits: string[] = [];
        page.on('request', (req) => { if (PROVIDER_RE.test(req.url())) providerHits.push(new URL(req.url()).host); });

        await test.step('Open signup and assert NO test/mock injection + exact SHA before credentials', async () => {
            await page.goto('/auth/signup');
            await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
            const surface = await page.evaluate(() => {
                const w = window as unknown as Record<string, unknown> & { __APP_RELEASE__?: string; __APP_RUNTIME_CONFIG__?: { testMode?: boolean } };
                return {
                    release: w.__APP_RELEASE__ ?? null,
                    testMode: w.__APP_RUNTIME_CONFIG__?.testMode ?? false,
                    injected: Object.keys(w).some((k) => /__E2E|__MOCK|__MSW|TEST_MODE/i.test(k)),
                    origin: location.origin,
                };
            });
            expect(surface.origin, 'exact approved origin').toBe(APPROVED_ORIGIN);
            expect(surface.release, `deployed __APP_RELEASE__ must equal EXPECT_RELEASE_SHA (${EXPECT_RELEASE_SHA})`).toBe(EXPECT_RELEASE_SHA);
            expect(surface.injected, 'no test/mock injection surfaces on production').toBe(false);
            expect(surface.testMode, 'runtime config must not be test-mode').toBe(false);
        });

        await test.step('Fresh signup', async () => {
            const unique = `${Date.now()}-${process.env.GITHUB_RUN_ID ?? 'local'}`;
            createdEmail = `private-proof-${unique}@${TEST_EMAIL_DOMAIN}`;
            await page.getByTestId('email-input').fill(createdEmail);
            await page.getByTestId('password-input').fill(`SpeakSharpProof-${unique}!`);
            await page.getByTestId('sign-up-submit').click();
            await expect(page).toHaveURL(/\/practice/, { timeout: 45_000 });
            await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 20_000 });
            capturedUid = await findUidByEmail(createdEmail); // P1.3 retain exact UID
        });

        await test.step('Click the visible practice entry → /session, select Private (never Cloud)', async () => {
            await expect(page.getByTestId('practice-card-quick')).toBeVisible({ timeout: 20_000 });
            await page.getByTestId('practice-card-quick').click();
            await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
            await selectBenchmarkMode(page, 'private');
            await preparePrivateModelIfPrompted(page, 180_000);
            await assertPreStartMode(page, 'private');
        });

        await test.step('Mock-free Private recording — prove Private runtime identity WHILE recording', async () => {
            const startStop = page.getByTestId('session-start-stop-button');
            await expect(startStop).toBeEnabled({ timeout: 60_000 });
            await startStop.click();
            await expectBenchmarkRecordingStarted(page, 'private-proof');
            // P1.2 runtime identity during recording: Private service mode + Transformers.js/WASM, no fallback.
            const runtime = await page.evaluate(() => {
                const w = window as unknown as { __SPEECH_RUNTIME_DEBUG__?: () => Record<string, unknown> };
                return typeof w.__SPEECH_RUNTIME_DEBUG__ === 'function' ? w.__SPEECH_RUNTIME_DEBUG__() : null;
            });
            expect(runtime, 'runtime debug must be present while recording').toBeTruthy();
            const runtimeStr = JSON.stringify(runtime).toLowerCase();
            expect(runtimeStr, `Private runtime identity expected: ${runtimeStr}`).toMatch(/private/);
            expect(runtimeStr).toMatch(/wasm|transformers/);
            expect(runtimeStr, 'no Browser/Cloud/native engine during a Private recording').not.toMatch(/"cloud"|"browser"|"native"|assemblyai|gemini/);
            await expectBenchmarkTranscriptOutput(page, 'private-proof', 60_000, 3);
            await startStop.click();
            await expect(startStop).toHaveAttribute('data-recording', 'false', { timeout: 120_000 });
            await waitForBenchmarkSaveCandidate(page, 'private-proof', 120_000);
            expect(providerHits, `no Cloud/provider requests allowed: ${providerHits.join(',')}`).toEqual([]);
        });

        await test.step('Prove DURABLE persistence: query the exact row by id + uid', async () => {
            await expect.poll(async () => page.evaluate(() =>
                document.documentElement.getAttribute('data-session-persisted') === 'true'
                && document.documentElement.getAttribute('data-session-persisted-id'),
            ), { timeout: 120_000 }).toBeTruthy();
            const persistedId = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
            expect(persistedId, 'valid persisted session id').toMatch(/^[0-9a-f-]{36}$/i);
            if (!admin) throw new Error('admin client required for persisted-row proof (fail closed)');
            const { data: row, error } = await admin
                .from('sessions')
                .select('id,user_id,status,transcript,engine,engine_version,model_name,device_type,attribution_status')
                .eq('id', persistedId).eq('user_id', capturedUid).single();
            if (error) throw new Error(`persisted-row query failed (fail closed): ${error.message}`);
            expect(row!.status, 'completed session').toBe('completed');
            expect((row!.transcript ?? '').trim().length, 'non-empty persisted transcript').toBeGreaterThan(0);
            expect(String(row!.engine).toLowerCase(), 'engine=private').toContain('private');
            expect(row!.attribution_status, 'verified Private attribution').toBe('verified');
            expect(row!.engine_version, 'Private-v2 identity: engine_version').toBeTruthy();
            expect(row!.model_name, 'Private-v2 identity: model_name').toBeTruthy();
            expect(String(row!.device_type ?? '').toLowerCase(), 'Private-v2 identity: wasm device').toContain('wasm');
            // Content-free evidence: ids only, never transcript/email/credentials.
            console.log(`PRIVATE_RECORDING_PROOF_EVIDENCE ${JSON.stringify({
                release: EXPECT_RELEASE_SHA, sessionId: row!.id, engine: row!.engine,
                engineVersion: row!.engine_version, deviceType: row!.device_type, attribution: row!.attribution_status,
                transcriptPersisted: (row!.transcript ?? '').trim().length > 0, providerRequests: providerHits.length,
            })}`);
        });
    });
});
