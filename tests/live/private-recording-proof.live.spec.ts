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
import {
    isPrivateV2PersistedDeviceType, extractUidFromAuthStorage, isNotFoundError, isPrivateRuntimeIdentity,
    matchesPrivatePersistedArm, contentSafeSessionSnapshot, contentSafeSnapshotsEqual, resolveRecoveryMatch,
} from './helpers/proofAuthority';

// #1089 / #1129 — exact-production-SHA Private recording proof (rigorous).
//
// Proves the DEPLOYED build, on the exact merged SHA, drives the real customer loop with NO shortcut, NO
// mocks and NO Cloud, and DURABLY persists a Private recording whose SERVER-recorded attribution authority is
// trusted (not the advisory sessions.attribution_status):
//   fail-closed preconditions → fresh signup → /practice → visible entry → /session → Private (runtime
//   identity: Transformers.js/WASM, no fallback, no HTTP/WS provider contact) → real fixture-fed recording →
//   durable persisted row (completed, non-empty transcript, engine=private) with the EXACT runtime↔persisted
//   arm mapping (fix 3) and a #1163 `session_attribution_authority` row (engine_class='private',
//   authority_version='attrib_v1' — fix 5) → HARD RELOAD content-safe re-read (fix 4) → UID-scoped fail-closed
//   cleanup with explicit auth/profile/session/attribution ZERO readback (fix 1 + fix 5 residue).
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
            // fix 1 (RETURN) — bounded full-pagination recovery POLLING. Each attempt FULLY paginates the user
            // list, then resolveRecoveryMatch decides: 'one' (uid), 'ambiguous'/'not_run_owned' (fail closed), or
            // 'zero' (retry — eventual consistency after signup). Persistent 'zero' across the bound FAILS CLOSED
            // (never silently give up and orphan a just-created account).
            const emailLower = createdEmail.toLowerCase();
            const RUN_PREFIX = 'private-proof-';
            const MAX_ATTEMPTS = 12;
            let recovered = '';
            for (let attempt = 1; attempt <= MAX_ATTEMPTS && !recovered; attempt++) {
                const all: Array<{ id?: string; email?: string | null }> = [];
                for (let p = 1; p <= 50; p++) {
                    const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
                    if (error) throw new Error(`cleanup recovery listUsers failed (fail closed): ${error.message}`);
                    const users = data?.users ?? [];
                    all.push(...users);
                    if (users.length < 200) break; // last page
                }
                const verdict = resolveRecoveryMatch(all, emailLower, RUN_PREFIX);
                if (verdict.status === 'one') { recovered = verdict.uid; break; }
                if (verdict.status === 'ambiguous') throw new Error(`cleanup recovery found ${verdict.count} accounts for the run email — refusing ambiguous delete (fail closed)`);
                if (verdict.status === 'not_run_owned') throw new Error(`recovered account is not run-owned (${verdict.email}) — refusing to delete`);
                if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1000)); // 'zero' → back off + retry
            }
            if (!recovered) throw new Error(`cleanup recovery exhausted ${MAX_ATTEMPTS} attempts with no account for the run email (fail closed — possible orphan)`);
            capturedUid = recovered;
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
        // fix 1 + fix 5 — EXPLICIT zero readback across every run-owned surface (fail-closed). Auth is proven gone
        // above (not-found re-fetch); now prove profile, session, and the #1163 attribution tables carry ZERO
        // rows for this uid (they all cascade on the auth-user delete — this asserts the cascade actually cleared).
        const residueChecks: Array<{ table: string; column: string }> = [
            { table: 'sessions', column: 'user_id' },
            { table: 'user_profiles', column: 'id' },                       // PK = auth user id
            { table: 'session_attribution_authority', column: 'user_id' },
            { table: 'session_attribution_challenge', column: 'user_id' },
            { table: 'session_attribution_unattributed', column: 'user_id' },
        ];
        for (const { table, column } of residueChecks) {
            const { count, error: rErr } = await admin
                .from(table).select(column, { count: 'exact', head: true }).eq(column, capturedUid);
            if (rErr) throw new Error(`cleanup residue query on ${table} failed (fail closed): ${rErr.message}`);
            expect(count ?? 0, `no run-owned residue in ${table}`).toBe(0);
        }
        capturedUid = '';
    });

    test('signup → /practice → visible entry → Private (no Cloud) → durable verified persisted row', async ({ page }) => {
        test.setTimeout(300_000);

        // P1.2 (fix 2) — any Cloud/provider contact during the run is a hard failure, over BOTH transports: an
        // HTTP(S) request AND a WebSocket upgrade (AssemblyAI realtime streams over WS, so an HTTP-only sentinel
        // would miss a live Cloud session). Both feed the same zero-tolerance list.
        const providerHits: string[] = [];
        const noteIfProvider = (rawUrl: string) => {
            if (!PROVIDER_RE.test(rawUrl)) return;
            try { providerHits.push(new URL(rawUrl).host); } catch { providerHits.push(rawUrl); }
        };
        page.on('request', (req) => noteIfProvider(req.url()));
        page.on('websocket', (ws) => noteIfProvider(ws.url()));

        // Cross-step state: the INSTANTIATED runtime arm (fix 3), the persisted id + its content-safe snapshot
        // (fix 4 reload equality).
        let runtimeIdentity: { runtimeProvider: string | null; modelId: string | null } = { runtimeProvider: null, modelId: null };
        let persistedId: string | null = null;
        let preReloadSnapshot: Record<string, unknown> | null = null;

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
            // P1.2 runtime identity during recording — anchored on the ACTUAL INSTANTIATED engine, not a
            // serviceMode label. Read the producing mode (serviceMode) AND the running engine's OWN provider from
            // __PRIVATE_STT_RUNTIME_DEBUG__.provider (published by PrivateSTT's PrivateRuntimeDecision; carries
            // v2 'transformers-js' and v4 'transformers-js-v4') AND the running model (__STT_IDENTITY__.modelId,
            // P1.1) + fallback flags. A 'private' serviceMode with a Browser/Cloud/missing/ambiguous running
            // engine is rejected. Device type is NOT constrained here (the persisted row proves device_type='browser').
            const identity = await page.evaluate(() => {
                const w = window as unknown as {
                    __SPEECH_RUNTIME_DEBUG__?: () => Record<string, unknown>;
                    __STT_IDENTITY__?: () => Record<string, unknown>;
                    __PRIVATE_STT_RUNTIME_DEBUG__?: { provider?: unknown };
                    __PRIVATE_V4_RUNTIME__?: { fallbackOccurred?: boolean };
                };
                const dbg = typeof w.__SPEECH_RUNTIME_DEBUG__ === 'function' ? w.__SPEECH_RUNTIME_DEBUG__() : null;
                const id = typeof w.__STT_IDENTITY__ === 'function' ? w.__STT_IDENTITY__() : null;
                return {
                    serviceMode: (dbg?.serviceMode ?? id?.mode) ?? null,
                    // The INSTANTIATED running engine's own provider (ground truth), NOT a serviceMode-derived label.
                    runtimeProvider: w.__PRIVATE_STT_RUNTIME_DEBUG__?.provider ?? null,
                    // The model actually running (P1.1 — the real field, not the nonexistent privateModelKey).
                    modelId: id?.modelId ?? null,
                    // Any fallback/handoff fails: the v4 runtime flag OR the engine identity's own fallback.
                    fallbackOccurred: (w.__PRIVATE_V4_RUNTIME__?.fallbackOccurred === true) || (id?.fallbackOccurred === true),
                };
            });
            const runtimeVerdict = isPrivateRuntimeIdentity(identity);
            expect(runtimeVerdict.ok, `Private runtime identity: ${runtimeVerdict.reason} (${JSON.stringify(identity)})`).toBe(true);
            // fix 3: remember the INSTANTIATED arm/model so the persisted row can be checked to MATCH it exactly.
            runtimeIdentity = { runtimeProvider: runtimeVerdict.runtimeProvider, modelId: runtimeVerdict.modelId };
            await expectBenchmarkTranscriptOutput(page, 'private-proof', 60_000, 3);
            await startStop.click();
            await expect(startStop).toHaveAttribute('data-recording', 'false', { timeout: 120_000 });
            await waitForBenchmarkSaveCandidate(page, 'private-proof', 120_000);
            expect(providerHits, `no Cloud/provider requests allowed: ${providerHits.join(',')}`).toEqual([]);
        });

        await test.step('Prove DURABLE persistence: exact row + SERVER authority (not advisory status) + exact arm', async () => {
            await expect.poll(async () => page.evaluate(() =>
                document.documentElement.getAttribute('data-session-persisted') === 'true'
                && document.documentElement.getAttribute('data-session-persisted-id'),
            ), { timeout: 120_000 }).toBeTruthy();
            persistedId = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
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
            expect(isPrivateV2PersistedDeviceType(row!.device_type), `Private persisted device_type must be exactly 'browser', got ${JSON.stringify(row!.device_type)}`).toBe(true);

            // fix 2/3 (RETURN) — EXACT Private v2/v4 identity via the repository dictionaries + exact string
            // equality (engine_version === `${variant}:${model}`, model ∈ the arm's exact set, engine==='private',
            // device==='browser'); a runtime↔persisted arm mismatch or a tiny/fallback model fails.
            const armVerdict = matchesPrivatePersistedArm({
                runtimeProvider: runtimeIdentity.runtimeProvider, runtimeModelId: runtimeIdentity.modelId,
                persistedEngine: row!.engine, persistedEngineVersion: row!.engine_version,
                persistedModelName: row!.model_name, persistedDeviceType: row!.device_type,
            });
            expect(armVerdict.ok, `exact Private identity mapping: ${armVerdict.reason}`).toBe(true);

            // fix 5 — the trusted verdict is the SERVER-recorded #1163 authority, NOT the advisory
            // sessions.attribution_status. A clean Private run MUST have an attrib_v1 authority with class 'private'.
            const { data: authority, error: aErr } = await admin
                .from('session_attribution_authority')
                .select('engine_class,authority_version')
                .eq('session_id', persistedId).eq('user_id', capturedUid).single();
            if (aErr) throw new Error(`authority-row query failed (fail closed): ${aErr.message}`);
            expect(authority!.authority_version, 'server authority is attrib_v1').toBe('attrib_v1');
            expect(authority!.engine_class, 'server authority engine_class=private').toBe('private');

            preReloadSnapshot = contentSafeSessionSnapshot(row as Record<string, unknown>);
            // Content-free evidence: NO identifiers. Booleans + release SHA + engine identity + authority verdict +
            // provider-call count only.
            console.log(`PRIVATE_RECORDING_PROOF_EVIDENCE ${JSON.stringify({
                release: EXPECT_RELEASE_SHA, engine: row!.engine, engineVersion: row!.engine_version,
                deviceType: row!.device_type, arm: armVerdict.arm, expectedEngineVersion: armVerdict.expectedEngineVersion,
                authorityVersion: authority!.authority_version, engineClass: authority!.engine_class,
                transcriptPersisted: (row!.transcript ?? '').trim().length > 0, providerRequests: providerHits.length,
            })}`);
        });

        await test.step('fix 3 (RETURN) — customer-UI REOPEN of the exact session, HARD RELOAD, content-safe equal', async () => {
            if (!admin) throw new Error('admin client required for reopen readback (fail closed)');
            // Reopen the EXACT session through the CUSTOMER UI — the History/Analytics detail route a user visits.
            await page.goto(`/analytics/${persistedId}`);
            await expect(page).toHaveURL(new RegExp(`/analytics/${persistedId}`), { timeout: 45_000 });
            await expect(page.getByTestId('session-detail-transcript'), 'the exact session reopens in the customer UI').toBeVisible({ timeout: 45_000 });
            // HARD RELOAD: the deployed build re-boots from scratch and must re-read the SAME durable session on the
            // exact SHA — the detail survives, and the DB re-read is content-safe-equal (measurements + identity;
            // transcript LENGTH only, never raw text). No provider contact permitted during reopen/reload.
            await page.reload({ waitUntil: 'domcontentloaded' });
            const reloadRelease = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? null);
            expect(reloadRelease, 'still the exact deployed SHA after reload').toBe(EXPECT_RELEASE_SHA);
            await expect(page.getByTestId('session-detail-transcript'), 'the session detail survives a hard reload').toBeVisible({ timeout: 45_000 });
            const { data: reread, error } = await admin
                .from('sessions')
                .select('id,user_id,status,transcript,engine,engine_version,model_name,device_type')
                .eq('id', persistedId).eq('user_id', capturedUid).single();
            if (error) throw new Error(`post-reload re-read failed (fail closed): ${error.message}`);
            const after = contentSafeSessionSnapshot(reread as Record<string, unknown>);
            const eq = contentSafeSnapshotsEqual(preReloadSnapshot as Record<string, unknown>, after);
            expect(eq.ok, `content-safe session equality across reopen+reload: ${eq.reason}`).toBe(true);
            const { count: authCount, error: aErr } = await admin
                .from('session_attribution_authority')
                .select('session_id', { count: 'exact', head: true })
                .eq('session_id', persistedId).eq('user_id', capturedUid);
            if (aErr) throw new Error(`post-reload authority re-read failed (fail closed): ${aErr.message}`);
            expect(authCount ?? 0, 'authority row persists across reopen+reload').toBe(1);
            expect(providerHits, `no Cloud/provider contact during reopen/reload: ${providerHits.join(',')}`).toEqual([]);
        });
    });
});
