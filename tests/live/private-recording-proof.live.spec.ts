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
import { isPrivateV2PersistedDeviceType, extractUidFromAuthStorage, isNotFoundError } from './helpers/proofAuthority';

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
        // NEVER return silently after a signup that may have created an account.
        if (!capturedUid && !createdEmail) return; // no signup was attempted
        if (!admin) throw new Error('cleanup requires admin client (fail closed)');
        // Recovery: signup can create the user before the in-page UID capture times out. If the UID is
        // missing but an email was attempted, recover it by an EXACT-email, unique-result admin lookup
        // (pagination/errors fail closed) so the account is never orphaned.
        if (!capturedUid) {
            let matches = [];
            for (let p = 1; p <= 50; p++) {
                const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
                if (error) throw new Error(`cleanup recovery listUsers failed (fail closed): ${error.message}`);
                const users = data?.users ?? [];
                matches = matches.concat(users.filter((u) => u.email?.toLowerCase() === createdEmail.toLowerCase()));
                if (users.length < 200) break;
            }
            if (matches.length === 0) return; // signup did not create an account — nothing to clean
            if (matches.length > 1) throw new Error(`cleanup recovery found ${matches.length} accounts for the run email — refusing ambiguous delete (fail closed)`);
            if (!/^private-proof-/.test(createdEmail.toLowerCase())) throw new Error(`recovered account is not run-owned (${createdEmail}) — refusing to delete`);
            capturedUid = matches[0].id;
        }
        const { data: got, error: getErr } = await admin.auth.admin.getUserById(capturedUid);
        if (getErr) throw new Error(`cleanup getUserById failed (fail closed): ${getErr.message}`);
        const foundEmail = got?.user?.email?.toLowerCase() ?? '';
        if (foundEmail !== createdEmail.toLowerCase()) throw new Error(`UID/email disagreement — refusing to delete (uid=${capturedUid})`);
        if (!/^private-proof-/.test(foundEmail)) throw new Error(`refusing to delete a non-run-owned account (${foundEmail})`);
        const { error: delErr } = await admin.auth.admin.deleteUser(capturedUid);
        if (delErr) throw new Error(`cleanup deleteUser failed (fail closed): ${delErr.message}`);
        // Prove deletion: ONLY an expected not-found re-fetch is proof. A returned user = still exists (fail);
        // any OTHER error (network/auth/rate-limit) is NOT proof of deletion and must fail closed.
        const { data: after, error: afterErr } = await admin.auth.admin.getUserById(capturedUid);
        if (afterErr) {
            if (!isNotFoundError(afterErr as { status?: number; code?: string; message?: string })) {
                throw new Error(`post-delete verify returned a non-not-found error — deletion UNPROVEN (fail closed): ${afterErr.message}`);
            }
            // not-found → confirmed deleted
        } else {
            expect(after?.user ?? null, 'auth user must be gone after cleanup (returned a user)').toBeNull();
        }
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

        await test.step('Fresh signup — capture cleanup UID from the session BEFORE any nav/list assertion', async () => {
            const unique = `${Date.now()}-${process.env.GITHUB_RUN_ID ?? 'local'}`;
            createdEmail = `private-proof-${unique}@${TEST_EMAIL_DOMAIN}`;
            await page.getByTestId('email-input').fill(createdEmail);
            await page.getByTestId('password-input').fill(`SpeakSharpProof-${unique}!`);
            await page.getByTestId('sign-up-submit').click();
            // P1.2(new): the instant the session exists, capture cleanup authority from auth storage — before
            // the /practice nav assertion or any admin list-users call — so ANY later failure still deletes
            // exactly this run's account.
            await expect.poll(async () => {
                const entries = await page.evaluate(() => Object.keys(localStorage).map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })));
                return extractUidFromAuthStorage(entries);
            }, { timeout: 45_000, message: 'must capture session UID immediately after signup' }).toBeTruthy();
            const entries = await page.evaluate(() => Object.keys(localStorage).map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })));
            capturedUid = extractUidFromAuthStorage(entries) ?? '';
            expect(capturedUid, 'cleanup UID captured from session').toBeTruthy();
            // Cross-check UID/email agreement via admin (fail closed).
            const { data: got, error } = await admin!.auth.admin.getUserById(capturedUid);
            if (error) throw new Error(`UID/email cross-check failed (fail closed): ${error.message}`);
            if ((got?.user?.email ?? '').toLowerCase() !== createdEmail.toLowerCase()) throw new Error('captured UID does not match the created email (fail closed)');
            await expect(page).toHaveURL(/\/practice/, { timeout: 45_000 });
            await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 20_000 });
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
            // P1.2 runtime identity during recording — STRUCTURED (not a stringify that would wrongly reject
            // the valid device_type='browser'). Read the authoritative producing mode (serviceMode) + the
            // Private model identity + v4 fallback flag, and assert Private + default (non-tiny) model + no
            // fallback. Device type is NOT constrained here (the persisted row proves device_type='browser').
            const identity = await page.evaluate(() => {
                const w = window as unknown as {
                    __SPEECH_RUNTIME_DEBUG__?: () => Record<string, unknown>;
                    __STT_IDENTITY__?: () => Record<string, unknown>;
                    __PRIVATE_V4_RUNTIME__?: { fallbackOccurred?: boolean };
                };
                const dbg = typeof w.__SPEECH_RUNTIME_DEBUG__ === 'function' ? w.__SPEECH_RUNTIME_DEBUG__() : null;
                const id = typeof w.__STT_IDENTITY__ === 'function' ? w.__STT_IDENTITY__() : null;
                return {
                    serviceMode: (dbg?.serviceMode ?? id?.mode) ?? null,
                    privateModelKey: id?.privateModelKey ?? null,
                    fallbackOccurred: w.__PRIVATE_V4_RUNTIME__?.fallbackOccurred ?? false,
                };
            });
            const runtimeVerdict = isPrivateRuntimeIdentity(identity);
            expect(runtimeVerdict.ok, `Private runtime identity: ${runtimeVerdict.reason} (${JSON.stringify(identity)})`).toBe(true);
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
            expect(isPrivateV2PersistedDeviceType(row!.device_type), `Private-v2 persisted device_type must be exactly 'browser', got ${JSON.stringify(row!.device_type)}`).toBe(true);
            // Content-free evidence: NO identifiers (no session id / UID / email). Booleans + release SHA +
            // engine identity + provider-call count only. The exact row was asserted above.
            console.log(`PRIVATE_RECORDING_PROOF_EVIDENCE ${JSON.stringify({
                release: EXPECT_RELEASE_SHA, engine: row!.engine,
                engineVersion: row!.engine_version, deviceType: row!.device_type, attribution: row!.attribution_status,
                transcriptPersisted: (row!.transcript ?? '').trim().length > 0, providerRequests: providerHits.length,
            })}`);
        });
    });
});
