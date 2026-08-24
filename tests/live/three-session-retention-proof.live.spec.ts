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
import { extractUidFromAuthStorage, sha256Hex } from './helpers/proofAuthority';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';

// #1306 PROD-PROOF — three-session production journey on the exact deployed SHA.
//
// WHAT THIS PROVES that no other gate can. `complete_session_v2` performs the metrics+transcript write
// AND server-owned newest-two retention inside ONE transaction. Every existing check of that contract
// runs against a test double or a disposable Postgres; this drives the REAL deployed client against the
// REAL production database and reads the resulting rows with admin authority.
//
// The retention claim is asserted DIFFERENTIALLY rather than by presence. The oldest session's metric
// row is snapshotted immediately after its own completion, while its transcript is still retained. After
// the third completion evicts it, the same row is re-read and the metrics must be BYTE-IDENTICAL while
// the transcript is gone. Asserting only "metrics are non-null after expiry" would pass just as happily
// if expiry had quietly rewritten them, which is the failure that would actually hurt a user.
//
// SAFETY. Data is run-owned and synthetic: a fresh `retention-proof-` account created by this run,
// three fixture-fed recordings, and nothing else. Cleanup is the shared fail-closed implementation in
// helpers/runOwnedCleanup.ts, which refuses to delete anything not matching the run-owned prefix and
// asserts ZERO residue across every cascade surface. Evidence is content-free: digests, booleans and
// counts, never transcript text.

const APPROVED_ORIGIN = 'https://speaksharp-public.vercel.app';
const BASE_URL = process.env.BASE_URL || '';
const EXPECT_RELEASE_SHA = (process.env.EXPECT_RELEASE_SHA || '').trim();
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TEST_EMAIL_DOMAIN = process.env.LIVE_TEST_EMAIL_DOMAIN || 'example.com';
const RUN_OWNED_PREFIX = 'retention-proof-';
const PROVIDER_RE = /assemblyai|generativelanguage|openai|deepgram|cognitiveservices|speech\.googleapis|api\.anthropic/i;

/** Columns that carry the coaching value a user keeps after a transcript expires. */
const METRIC_COLUMNS = ['status', 'duration', 'total_words', 'clarity_score', 'wpm', 'filler_counts', 'next_action_signal'] as const;
const ROW_COLUMNS = `id,user_id,transcript,transcript_state,engine,created_at,${METRIC_COLUMNS.join(',')}`;

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

/** Stable, content-free view of the metrics a session must keep across expiry. */
function metricSnapshot(row: Record<string, unknown>): string {
    return JSON.stringify(Object.fromEntries(METRIC_COLUMNS.map((c) => [c, row[c] ?? null])));
}

test.use({
    permissions: ['microphone'],
    baseURL: BASE_URL,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: {
        args: [...AUDIO_ARGS, '--disable-gpu', '--disable-webgpu', `--use-file-for-fake-audio-capture=${FILLER_CONV_01_AUDIO}`],
    },
});

test.describe('#1306 three-session newest-two retention production proof @live', () => {
    let createdEmail = '';
    let capturedUid = '';

    test.beforeAll(() => { assertPreconditions(); });   // fail closed, never skip

    test.afterEach(async () => {
        await cleanupRunOwnedAccount({
            admin: admin as never, capturedUid, createdEmail, runOwnedPrefix: RUN_OWNED_PREFIX,
        });
        capturedUid = '';
    });

    test('three real Private completions → newest two retained, oldest expired, metrics untouched', async ({ page }) => {
        test.setTimeout(1_500_000);

        const providerHits: string[] = [];
        const noteIfProvider = (rawUrl: string) => {
            if (!PROVIDER_RE.test(rawUrl)) return;
            try { providerHits.push(new URL(rawUrl).host); } catch { providerHits.push(rawUrl); }
        };
        page.on('request', (req) => noteIfProvider(req.url()));
        page.on('websocket', (ws) => noteIfProvider(ws.url()));

        const readRow = async (id: string) => {
            if (!admin) throw new Error('admin client required (fail closed)');
            const { data, error } = await admin.from('sessions').select(ROW_COLUMNS)
                .eq('id', id).eq('user_id', capturedUid).single();
            if (error) throw new Error(`row query failed for ${id} (fail closed): ${error.message}`);
            return data as Record<string, unknown>;
        };

        /** Drive ONE complete recording through the deployed customer UI; return the persisted id. */
        const recordOneSession = async (label: string): Promise<string> => {
            await page.goto('/practice');
            await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 45_000 });
            await expect(page.getByTestId('practice-card-quick')).toBeVisible({ timeout: 20_000 });
            await page.getByTestId('practice-card-quick').click();
            await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
            await selectBenchmarkMode(page, 'private');
            await preparePrivateModelIfPrompted(page, 180_000);     // no-op once the model is cached
            await assertPreStartMode(page, 'private');

            const startStop = page.getByTestId('session-start-stop-button');
            await expect(startStop).toBeEnabled({ timeout: 60_000 });
            await startStop.click();
            await expectBenchmarkRecordingStarted(page, label);
            await expectBenchmarkTranscriptOutput(page, label, 60_000, 3);
            await startStop.click();
            await expect(startStop).toHaveAttribute('data-recording', 'false', { timeout: 120_000 });
            await waitForBenchmarkSaveCandidate(page, label, 120_000);

            await expect.poll(async () => page.evaluate(() =>
                document.documentElement.getAttribute('data-session-persisted') === 'true'
                && document.documentElement.getAttribute('data-session-persisted-id'),
            ), { timeout: 120_000, message: `${label} must durably persist` }).toBeTruthy();
            const id = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
            expect(id, `${label} persisted id`).toMatch(/^[0-9a-f-]{36}$/i);
            return id as string;
        };

        const ids: string[] = [];
        let oldestMetricsBeforeExpiry = '';
        let oldestTranscriptShaBeforeExpiry = '';

        await test.step('Exact SHA + no test/mock injection BEFORE any credential is entered', async () => {
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

        await test.step('Fresh run-owned signup — capture cleanup UID from the session immediately', async () => {
            const unique = `${Date.now()}-${process.env.GITHUB_RUN_ID ?? 'local'}`;
            createdEmail = `${RUN_OWNED_PREFIX}${unique}@${TEST_EMAIL_DOMAIN}`;
            await page.getByTestId('email-input').fill(createdEmail);
            await page.getByTestId('password-input').fill(`SpeakSharpProof-${unique}!`);
            await page.getByTestId('sign-up-submit').click();
            await expect.poll(async () => {
                const entries = await page.evaluate(() => Object.keys(localStorage).map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })));
                return extractUidFromAuthStorage(entries);
            }, { timeout: 45_000, message: 'must capture session UID immediately after signup' }).toBeTruthy();
            const entries = await page.evaluate(() => Object.keys(localStorage).map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })));
            capturedUid = extractUidFromAuthStorage(entries) ?? '';
            expect(capturedUid, 'cleanup UID captured from session').toBeTruthy();
            const { data: got, error } = await admin!.auth.admin.getUserById(capturedUid);
            if (error) throw new Error(`UID/email cross-check failed (fail closed): ${error.message}`);
            if ((got?.user?.email ?? '').toLowerCase() !== createdEmail.toLowerCase()) throw new Error('captured UID does not match the created email (fail closed)');
            await expect(page).toHaveURL(/\/practice/, { timeout: 45_000 });
        });

        await test.step('Session 1 (oldest) — completes v2 and its transcript IS retained', async () => {
            ids.push(await recordOneSession('retention-proof-1'));
            const row = await readRow(ids[0]);
            expect(row.status, 'session 1 completed').toBe('completed');
            expect(String(row.transcript ?? '').trim().length, 'session 1 transcript retained at write time').toBeGreaterThan(0);
            expect(row.transcript_state, 'session 1 transcript_state at write time').toBe('available');
            // Snapshot BEFORE eviction — this is what expiry must not touch.
            oldestMetricsBeforeExpiry = metricSnapshot(row);
            oldestTranscriptShaBeforeExpiry = sha256Hex(row.transcript);
            expect(row.total_words, 'session 1 persisted a word count').not.toBeNull();
        });

        await test.step('Session 2 — both sessions retained (nothing evicted below three)', async () => {
            ids.push(await recordOneSession('retention-proof-2'));
            for (const [i, id] of ids.entries()) {
                const row = await readRow(id);
                expect(row.transcript_state, `session ${i + 1} still available with only two sessions`).toBe('available');
                expect(String(row.transcript ?? '').trim().length, `session ${i + 1} transcript still present`).toBeGreaterThan(0);
            }
        });

        await test.step('Session 3 — newest two retained, OLDEST evicted, metrics byte-identical', async () => {
            ids.push(await recordOneSession('retention-proof-3'));

            const [oldest, middle, newest] = await Promise.all(ids.map(readRow));

            // The two newest keep their transcripts...
            for (const [label, row] of [['middle', middle], ['newest', newest]] as const) {
                expect(row.transcript_state, `${label} transcript_state`).toBe('available');
                expect(String(row.transcript ?? '').trim().length, `${label} transcript retained`).toBeGreaterThan(0);
            }

            // ...and the oldest is expired: state flipped AND the content is actually gone. Asserting the
            // state alone would pass while the transcript still sat in the row.
            expect(oldest.transcript_state, 'oldest transcript_state is expired').toBe('expired');
            expect(oldest.transcript ?? null, 'oldest transcript CONTENT is gone, not merely relabelled').toBeNull();

            // POSITIVE CONTROL: the oldest genuinely HAD a transcript before this step, so the null above
            // is eviction and not a session that never captured one.
            expect(oldestTranscriptShaBeforeExpiry, 'oldest had a NON-EMPTY transcript before eviction')
                .not.toBe(sha256Hex(''));

            // THE CENTRAL CLAIM: expiry removed the transcript and NOTHING else.
            expect(metricSnapshot(oldest), 'expiry must not alter the oldest session metrics or next action')
                .toBe(oldestMetricsBeforeExpiry);
            expect(oldest.next_action_signal ?? null, 'oldest keeps its next action after expiry').not.toBeNull();

            // Retention is newest-two by created_at, so the evicted row must be the actually-oldest one.
            const byAge = [oldest, middle, newest].map((r) => String(r.created_at));
            expect([...byAge].sort(), 'the EVICTED row must be the genuinely oldest by created_at').toEqual(byAge);
        });

        await test.step('Customer UI agrees: newest two render transcripts, oldest renders the expired state', async () => {
            const newestRow = await readRow(ids[2]);
            await page.goto(`/analytics/${ids[2]}`);
            const detail = page.getByTestId('session-detail-transcript');
            await expect(detail, 'newest session renders its retained transcript').toBeVisible({ timeout: 45_000 });
            expect(sha256Hex(await detail.innerText()) === sha256Hex(newestRow.transcript),
                'rendered transcript digest must equal the persisted digest').toBe(true);

            await page.goto(`/analytics/${ids[0]}`);
            await expect(page.getByTestId('session-detail-transcript-expired'),
                'oldest session tells the user its transcript expired').toBeVisible({ timeout: 45_000 });
            await expect(page.getByTestId('session-detail-transcript'),
                'oldest session renders no transcript pane').toHaveCount(0);
            // The metrics the user keeps are still on screen — expiry is not a silent data loss.
            await expect(page.getByTestId('session-next-action-title'),
                'oldest session still shows its next action').toHaveCount(1);

            expect(providerHits, `no Cloud/provider contact at any point: ${providerHits.join(',')}`).toEqual([]);
        });

        // Content-free evidence only: digests, booleans, counts. No transcript text, no identifiers.
        console.log(`THREE_SESSION_RETENTION_PROOF_EVIDENCE ${JSON.stringify({
            release: EXPECT_RELEASE_SHA,
            sessionsCompleted: ids.length,
            oldestExpired: true,
            oldestTranscriptNulled: true,
            oldestMetricsUnchanged: true,
            newestTwoRetained: true,
            providerRequests: providerHits.length,
        })}`);
    });
});
