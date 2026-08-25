import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
    AUDIO_ARGS,
    assertPreStartMode,
    expectBenchmarkRecordingStarted,
    expectBenchmarkTranscriptOutput,
    expectMicControlForState,
    preparePrivateModelIfPrompted,
    selectBenchmarkMode,
    stopBenchmarkRecording,
    waitForBenchmarkSaveCandidate,
} from './helpers/benchmark-utils';
import { FILLER_CONV_01_AUDIO } from './helpers/audio-fixtures';
import { extractUidFromAuthStorage, sha256Hex } from './helpers/proofAuthority';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';
import { evaluateThreeRecordingEntitlement } from './helpers/entitlementAuthority';
import { extractPdfText, normalizeForMatch } from '../helpers/pdfText';
import { validateNextActionSignal } from '../../frontend/src/contracts/nextActionSignal';

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
/** Bounded fixture recordings: ~90s of wall clock each is a generous per-recording ceiling. */
const RECORDING_BUDGET_SECONDS = 90;
const THREE_RECORDING_BUDGET_SECONDS = RECORDING_BUDGET_SECONDS * 3;
const PROVIDER_RE = /assemblyai|generativelanguage|openai|deepgram|cognitiveservices|speech\.googleapis|api\.anthropic/i;

/**
 * The EXACT fields that must survive transcript expiry — deliberately not a whole-row comparison.
 * Comparing the entire row byte-for-byte would fail on legitimate retention mutations (`transcript`,
 * `transcript_state`) and on ordinary timestamp churn (`updated_at`), so it would be abandoned the
 * first time it went red rather than being trusted. These are the fields whose loss would actually
 * cost the user their coaching history.
 */
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
        // Runs on EVERY outcome, including a failed or timed-out test, from the earliest captured UID —
        // so a partial journey still deletes exactly what it created. A cleanup or residue failure
        // throws here and is reported ALONGSIDE the original test failure rather than replacing it:
        // Playwright attaches hook errors to the already-failed test, so the first failure is never
        // hidden behind a cleanup error.
        await cleanupRunOwnedAccount({
            admin: admin as never, capturedUid, createdEmail, runOwnedPrefix: RUN_OWNED_PREFIX,
        });
        capturedUid = '';
    });

    test('three real Private completions → newest two retained, oldest expired, metrics untouched', async ({ page }) => {
        test.setTimeout(2_400_000);   // 40min: attempt 4 hit the old 25min ceiling mid-diagnosis

        const providerHits: string[] = [];
        const noteIfProvider = (rawUrl: string) => {
            if (!PROVIDER_RE.test(rawUrl)) return;
            try { providerHits.push(new URL(rawUrl).host); } catch { providerHits.push(rawUrl); }
        };
        page.on('request', (req) => noteIfProvider(req.url()));
        page.on('websocket', (ws) => noteIfProvider(ws.url()));

        // #1337 A — count the ACTUAL completion RPCs the deployed client issues. On production these are
        // real HTTP calls to PostgREST, so this is direct observation, not inference. The v2 path name
        // CONTAINS the v1 name, so both are matched on the exact final path segment; a substring test
        // would count every v2 call as a v1 call and make the zero-v1 assertion unfalsifiable.
        const rpcCalls: Record<string, number> = { complete_session: 0, complete_session_v2: 0 };
        const usageChecks: Array<Record<string, unknown>> = [];
        const v2Responses: Array<Record<string, unknown>> = [];
        const listBodies: string[] = [];
        page.on('request', (req) => {
            const fn = new URL(req.url()).pathname.split('/').pop() ?? '';
            if (fn in rpcCalls) rpcCalls[fn] += 1;
        });
        // ── ATTEMPT-5 MODEL DIAGNOSTICS ────────────────────────────────────────────────────────────
        // Attempt 4 stalled 25 minutes at `modelStatus: download-required` with `runtimeState: IDLE`.
        // Direct probes already eliminated two causes: the deployed app is correctly cross-origin
        // isolated (COOP same-origin + COEP credentialless), and the whole 77MB model serves in ~2.5s
        // (encoder 23.2MB/0.92s, decoder 53.7MB/1.54s). So it is neither COEP nor network.
        //
        // Two candidates remain, and they need DIFFERENT fixes, so the run must distinguish them:
        //   (a) acquisition never starts  -> zero /models/ requests
        //   (b) the #1258 reclaim loop    -> requests COMPLETE, yet status returns to download-required
        //
        // TIMESTAMPS ARE THE POINT. A bare status sequence only shows that it reverted; the interval
        // between `ready` and the reversion is the reclaim signature, which is what separates
        // "confirms #1258" from "merely consistent with #1258".
        //
        // PRIVACY: counts, URL PATHS of static model assets, status strings and elapsed milliseconds
        // only. Console capture is allowlisted to engine/model/isolation topics so no transcript,
        // hypothesis or identifier can ride along in a message body.
        const modelRequests: Array<{ path: string; ms: number }> = [];
        const modelResponses: Array<{ path: string; status: number; ms: number }> = [];
        const engineConsole: string[] = [];
        const t0 = Date.now();
        const CONSOLE_ALLOWLIST = /model|engine|worker|onnx|transformers|whisper|sharedarraybuffer|cross-origin|isolat|wasm|reclaim/i;

        page.on('request', (req) => {
            const path = new URL(req.url()).pathname;
            if (path.startsWith('/models/')) modelRequests.push({ path, ms: Date.now() - t0 });
        });
        page.on('response', (res) => {
            const path = new URL(res.url()).pathname;
            if (path.startsWith('/models/')) modelResponses.push({ path, status: res.status(), ms: Date.now() - t0 });
        });
        page.on('console', (msg) => {
            const text = msg.text();
            if (engineConsole.length < 80 && CONSOLE_ALLOWLIST.test(text)) {
                engineConsole.push(`${msg.type()}:${text.slice(0, 160)}`);
            }
        });
        // UNHANDLED PROMISE REJECTIONS — Playwright's `pageerror` catches uncaught EXCEPTIONS, not
        // rejected promises, so without this the most likely acquisition failure is invisible.
        //
        // Why it matters here: both model-download call sites in SessionPage are
        // `void import(...).then(m => m.initiateModelDownload('private'))` with NO `.catch`. If
        // acquisition rejects, the rejection is unhandled, no status change occurs, and the button
        // silently does nothing — matching attempt 4 exactly (download-required persisting through two
        // force-clicks with no error). Capturing rejections turns that hypothesis into evidence.
        await page.addInitScript(() => {
            const w = window as unknown as { __unhandledRejections__?: string[] };
            w.__unhandledRejections__ = [];
            window.addEventListener('unhandledrejection', (event) => {
                const list = w.__unhandledRejections__!;
                const reason = (event as PromiseRejectionEvent).reason;
                const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
                if (list.length < 40) list.push(text.slice(0, 200));
            });
        });

        page.on('pageerror', (err) => {
            // Allowlisted on the SAME topics as console. A page error can carry arbitrary text, and
            // this run publishes to a public Actions log, so an ungated capture would be a privacy
            // hole in exactly the surface #1338 closed for thrown messages.
            const text = String(err.message);
            if (engineConsole.length < 80 && CONSOLE_ALLOWLIST.test(text)) {
                engineConsole.push(`pageerror:${text.slice(0, 160)}`);
            }
        });

        // #1338/4 — DETERMINISTIC CAPTURE. Playwright does not await an async `response` handler, so a
        // body still being parsed is invisible to a synchronous length check: asserting
        // `v2Responses.length === 3` could fail on a slow parse even though all three arrived. Every
        // parse is registered as a PROMISE here and awaited before any assertion reads the set, which
        // makes the capture bounded and order-independent rather than racy.
        const v2Parsing: Array<Promise<void>> = [];
        const listParsing: Array<Promise<void>> = [];
        page.on('response', (res) => {
            const url = new URL(res.url());
            const fn = url.pathname.split('/').pop() ?? '';
            if (fn === 'complete_session_v2') {
                v2Parsing.push(res.json().then((b) => { v2Responses.push(b as Record<string, unknown>); }, () => { /* non-JSON body */ }));
            }
            // #1337 B — the SERVER entitlement authority the app itself consulted. Observing the
            // response the client received is stronger than re-deriving the decision here: it is the
            // exact verdict the product acted on, and it cannot be elevated by this test.
            if (fn === 'check-usage-limit') {
                v2Parsing.push(res.json().then((b) => { usageChecks.push(b as Record<string, unknown>); }, () => { /* non-JSON */ }));
            }
            // #1337 C — the history/list read must never carry transcript text over the wire.
            if (url.pathname.endsWith('/rest/v1/sessions') && res.request().method() === 'GET') {
                listParsing.push(res.text().then((t) => { listBodies.push(t); }, () => { /* non-text */ }));
            }
        });
        /** Await every in-flight body parse so a capture assertion reads a settled set. */
        const settleCaptures = async () => { await Promise.all([...v2Parsing, ...listParsing]); };

        const readRow = async (id: string) => {
            if (!admin) throw new Error('admin client required (fail closed)');
            const { data, error } = await admin.from('sessions').select(ROW_COLUMNS)
                .eq('id', id).eq('user_id', capturedUid).single();
            // PRIVACY: never echo the session UUID or a raw provider message into a public log.
            if (error) throw new Error(`row_query_failed code=${error.code ?? 'unknown'} (fail closed)`);
            // `.single()` widens to a union that includes GenericStringError, so a direct cast is not
            // provably safe; go through `unknown` rather than silently asserting the happy shape.
            return data as unknown as Record<string, unknown>;
        };

        /**
         * Record TIMESTAMPED `data-model-status` transitions from inside the page.
         *
         * TranscriptionService owns this attribute on <html>. A MutationObserver captures the whole
         * arc — download-required -> loading -> ready -> (reversion?) — with elapsed milliseconds, so
         * a `ready` that is later torn down is visible AS a reclaim rather than inferred from a final
         * value. Installed before navigation so nothing early is missed.
         */
        await page.addInitScript(() => {
            const w = window as unknown as { __modelStatusLog__?: Array<{ status: string; ms: number }> };
            w.__modelStatusLog__ = [];
            const start = Date.now();
            const record = () => {
                const status = document.documentElement.getAttribute('data-model-status') ?? 'absent';
                const log = w.__modelStatusLog__!;
                if (log.length === 0 || log[log.length - 1].status !== status) {
                    log.push({ status, ms: Date.now() - start });
                }
            };
            const boot = () => {
                record();
                new MutationObserver(record).observe(document.documentElement, {
                    attributes: true, attributeFilter: ['data-model-status'],
                });
            };
            if (document.documentElement) boot();
            else document.addEventListener('DOMContentLoaded', boot);
        });

        /**
         * Emit the acquisition diagnosis. Called on EVERY outcome, so a stall cannot truncate it the
         * way attempt 4's 25-minute timeout truncated everything.
         */
        const emitModelDiagnosis = async (at: string) => {
            const statusLog = await page.evaluate(
                () => (window as unknown as { __modelStatusLog__?: Array<{ status: string; ms: number }> }).__modelStatusLog__ ?? [],
            ).catch(() => [] as Array<{ status: string; ms: number }>);
            const ok = modelResponses.filter((r) => r.status >= 200 && r.status < 300);
            const reachedReady = statusLog.some((e) => e.status === 'ready');
            console.log(`MODEL_ACQUISITION_DIAGNOSIS ${JSON.stringify({
                at,
                // INFORMATIONAL ONLY — known blind to worker-issued loads. A zero here proves nothing.
                modelRequestsInformationalOnly: modelRequests.length,
                modelResponsesOkInformationalOnly: ok.length,
                requestCountersAreWorkerBlind: true,
                firstRequestMs: modelRequests[0]?.ms ?? null,
                lastResponseMs: ok[ok.length - 1]?.ms ?? null,
                statusTransitions: statusLog,
                // The acquisition call sites have no `.catch`, so a failure lands HERE and nowhere else.
                unhandledRejections: await page.evaluate(
                    () => (window as unknown as { __unhandledRejections__?: string[] }).__unhandledRejections__ ?? [],
                ).catch(() => [] as string[]),
                // VERDICT KEYS ON STATUS TRANSITIONS ONLY. The request counts below are INFORMATIONAL
                // and must never decide anything: the model loads inside a WORKER, and that was
                // measured, not assumed — during a production load that demonstrably reached `ready`,
                // neither a `window.fetch` patch nor a main-thread PerformanceObserver (buffered:true)
                // observed a single /models/ request. A verdict keyed on those counts would emit
                // "acquisition never started" for a run that acquired the model perfectly.
                verdictHint: reachedReady && statusLog[statusLog.length - 1]?.status !== 'ready'
                    ? 'READY_THEN_REVERTED_reclaim_signature'
                    : reachedReady
                        ? 'READY_AND_HELD'
                        : statusLog.some((e) => e.status === 'loading')
                            ? 'LOADING_NEVER_REACHED_READY'
                            : 'NEVER_LEFT_DOWNLOAD_REQUIRED_after_CTA',
                engineConsole,
            })}`);
        };

        /** Drive ONE complete recording through the deployed customer UI; return the persisted id. */
        const recordOneSession = async (label: string, ordinal: number): Promise<string> => {
            const seenBefore = usageChecks.length;
            await page.goto('/practice');
            await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 45_000 });
            await expect(page.getByTestId('practice-card-freeform')).toBeVisible({ timeout: 20_000 });
            await page.getByTestId('practice-card-freeform').click();
            await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
            await selectBenchmarkMode(page, 'private');
            // CTA EVIDENCE. The closure contract requires the ACTUAL customer path, so record the
            // model status IMMEDIATELY BEFORE and AFTER the setup CTA. Attempt 4 showed
            // BUTTON_VISIBLE -> CLICKED -> FORCE_CLICK_RETRY x2 and then a 25-minute stall, which says
            // the click landed but acquisition never progressed. A before/after pair around the CTA
            // separates "the click did nothing" from "the click started work that then failed" —
            // a distinction the phase markers alone could not make.
            const statusBeforeCta = await page.evaluate(
                () => document.documentElement.getAttribute('data-model-status'),
            ).catch(() => null);
            const ctaRequired = statusBeforeCta === 'download-required';

            // The acquisition diagnosis must survive a stall here, which is exactly where attempt 4 died.
            try {
                await preparePrivateModelIfPrompted(page, 600_000);
            } catch (err) {
                await emitModelDiagnosis(`${label}:model-prepare-FAILED:ctaRequired=${ctaRequired}:before=${statusBeforeCta}`);
                throw err;
            }
            const statusAfterCta = await page.evaluate(
                () => document.documentElement.getAttribute('data-model-status'),
            ).catch(() => null);
            await emitModelDiagnosis(`${label}:model-prepare-ok:before=${statusBeforeCta}:after=${statusAfterCta}`);

            // When setup WAS required, the CTA must have moved the status off download-required.
            // Otherwise the customer-visible outcome is a button that does nothing — which is exactly
            // what the un-`.catch`ed acquisition call sites would produce.
            if (ctaRequired) {
                expect(statusAfterCta,
                    `the setup CTA must move the model off download-required; it stayed at ${String(statusAfterCta)}`,
                ).not.toBe('download-required');
            }
            await assertPreStartMode(page, 'private');

            // ENTITLEMENT GATE, re-evaluated before EVERY recording from the same server authority.
            // `can_start` is checked again ahead of recordings 2 and 3 because a mid-run entitlement
            // change (trial expiry, quota exhaustion) would otherwise surface as an unexplained
            // recording failure after the run had already written to production.
            await expect.poll(() => usageChecks.length, {
                timeout: 45_000,
                message: `no check-usage-limit response observed before ${label} — the entitlement gate proves nothing`,
            }).toBeGreaterThan(seenBefore);
            const usage = usageChecks[usageChecks.length - 1];
            expect(usage.can_start, `server authority must allow starting ${label}`).toBe(true);
            if (ordinal === 1) {
                // Headroom for ALL THREE bounded recordings, not merely for this one. `can_start` alone
                // is a per-start verdict and would happily allow recording 1 on an account that cannot
                // finish the journey.
                // TRIAL HEADROOM FAILS CLOSED — the decision itself lives in entitlementAuthority.ts
                // so every rejection path (short budget, missing field, non-numeric field, trial that
                // also reports pro, neither trial nor pro) is falsified by unit tests rather than only
                // by a live production run.
                const verdict = evaluateThreeRecordingEntitlement(usage, THREE_RECORDING_BUDGET_SECONDS);
                expect(verdict.ok,
                    `entitlement must cover THREE bounded recordings before recording 1 ` +
                    `(${'reason' in verdict ? verdict.reason : 'ok'})`,
                ).toBe(true);
            }

            // DESKTOP STATE JOURNEY. start and stop are SPLIT controls in different rendered states —
            // MicCard's `mic-start` in `before`, RecorderBar's `recorder-stop` in `during`. There is no
            // combined toggle: `session-start-stop-button` is rendered by nothing on any viewport
            // (MobileActionBar renders the SUFFIXED `-mobile` id), which is why clicking it burned all
            // 40 minutes of attempt 5's budget without ever invoking acquisition.
            const startControl = await expectMicControlForState(page, 'ready');
            await startControl.click();
            await expectBenchmarkRecordingStarted(page, label);
            await expectBenchmarkTranscriptOutput(page, label, 60_000, 3);
            // Stop through the `during` control, and prove the recorder is GONE rather than asserting an
            // attribute on an element that no longer exists.
            await stopBenchmarkRecording(page, label, 120_000);
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
            if (error) throw new Error(`UID/email cross-check failed (fail closed): ${error.code ?? 'unknown'}`);
            if ((got?.user?.email ?? '').toLowerCase() !== createdEmail.toLowerCase()) throw new Error('captured UID does not match the created email (fail closed)');
            await expect(page).toHaveURL(/\/practice/, { timeout: 45_000 });
        });

        await test.step('Session 1 (oldest) — completes v2 and its transcript IS retained', async () => {
            ids.push(await recordOneSession('retention-proof-1', 1));
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
            ids.push(await recordOneSession('retention-proof-2', 2));
            for (const [i, id] of ids.entries()) {
                const row = await readRow(id);
                expect(row.transcript_state, `session ${i + 1} still available with only two sessions`).toBe('available');
                expect(String(row.transcript ?? '').trim().length, `session ${i + 1} transcript still present`).toBeGreaterThan(0);
            }
        });

        await test.step('Session 3 — newest two retained, OLDEST evicted, metrics byte-identical', async () => {
            ids.push(await recordOneSession('retention-proof-3', 3));

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
            // A VALIDATED next action, not merely a non-null column: expiry must leave behind a signal
            // the product can actually render, and `not.toBeNull()` would accept a corrupted blob.
            const oldestSignal = validateNextActionSignal(oldest.next_action_signal);
            expect(oldestSignal.ok,
                `oldest keeps a VALID next action after expiry (${'reason' in oldestSignal ? String(oldestSignal.reason) : 'invalid'})`,
            ).toBe(true);

            // #1338/3 — EVERY session must retain a STRUCTURALLY VALID next action and truthful
            // measurements, not just the expired one. Proving a UI title renders says nothing about the
            // persisted signal being usable, and the outcome claims all three keep theirs.
            for (const [i, row] of [oldest, middle, newest].entries()) {
                const signal = validateNextActionSignal(row.next_action_signal);
                expect(signal.ok,
                    `session ${i + 1} must retain a VALID next action (${'reason' in signal ? String(signal.reason) : 'invalid'})`,
                ).toBe(true);
                expect(row.status, `session ${i + 1} status`).toBe('completed');
                expect(typeof row.total_words === 'number', `session ${i + 1} persisted a numeric word count`).toBe(true);
                expect(row.filler_counts ?? null, `session ${i + 1} persisted its filler map`).not.toBeNull();
                expect(typeof row.duration === 'number', `session ${i + 1} persisted a numeric duration`).toBe(true);
            }

            // Retention is newest-two by created_at, so the evicted row must be the actually-oldest one.
            const byAge = [oldest, middle, newest].map((r) => String(r.created_at));
            expect([...byAge].sort(), 'the EVICTED row must be the genuinely oldest by created_at').toEqual(byAge);
        });

        await test.step('EXACTLY three v2 completions, ZERO v1, distinct ids, full success envelope each', async () => {
            // #1338/4 — settle every in-flight body parse, then bound the wait on the third envelope,
            // so the exact-count assertion below reflects what arrived rather than what finished parsing.
            await settleCaptures();
            await expect.poll(async () => { await settleCaptures(); return v2Responses.length; }, {
                timeout: 30_000,
                message: 'the three v2 response bodies did not settle — the envelope scan would be racy',
            }).toBe(3);

            // #1337 A/B — the deployed client must have used v2 three times and v1 never. Exact counts:
            // "at least three" would pass if a retry silently double-saved a session.
            expect(rpcCalls.complete_session_v2, 'exactly three complete_session_v2 completions').toBe(3);
            expect(rpcCalls.complete_session, 'ZERO legacy complete_session (v1) calls in production').toBe(0);

            // Non-vacuous capture control: the envelope assertions below are meaningless over an empty set.
            expect(v2Responses.length, 'no v2 response bodies captured — the envelope scan proves nothing').toBe(3);
            for (const [i, env] of v2Responses.entries()) {
                expect(env.success, `v2 envelope ${i + 1} success`).toBe(true);
                expect(env.session_saved, `v2 envelope ${i + 1} session_saved`).toBe(true);
                expect(env.final_status, `v2 envelope ${i + 1} final_status`).toBe('completed');
                // The typed outcome must be one the client can switch on exhaustively, and a completion
                // that retained its transcript must say so rather than leaving it to be inferred.
                expect(['retained', 'expired', 'not_provided', 'not_captured', 'retention_failed'])
                    .toContain(env.transcript_outcome);
                expect(env.transcript_outcome, `v2 envelope ${i + 1} retained its transcript`).toBe('retained');
                expect(env.transcript_retained, `v2 envelope ${i + 1} retained flag agrees with the outcome`).toBe(true);
            }

            // Distinct ids, and exactly ONE row per id — a reused or duplicated id would make the
            // newest-two assertions above describe a different set of rows than the journey created.
            expect(new Set(ids).size, 'three DISTINCT session ids').toBe(3);
            if (!admin) throw new Error('admin client required (fail closed)');
            for (const id of ids) {
                const { count, error } = await admin.from('sessions')
                    .select('id', { count: 'exact', head: true }).eq('id', id).eq('user_id', capturedUid);
                if (error) throw new Error(`row_count_query_failed code=${error.code ?? 'unknown'} (fail closed)`);
                expect(count ?? 0, 'exactly one row per persisted session id').toBe(1);
            }
        });

        await test.step('History LIST traffic carries no transcript text', async () => {
            listBodies.length = 0;
            await page.goto('/analytics');
            await expect(page.getByTestId('session-history-list')).toBeVisible({ timeout: 45_000 });
            await expect.poll(async () => { await settleCaptures(); return listBodies.length; }, {
                timeout: 30_000, message: 'no session LIST responses captured — the scan proves nothing',
            }).toBeGreaterThan(0);
            const joined = listBodies.join('\n');
            // Compare by DIGEST-bearing marker, never by printing transcript text: assert the retained
            // transcripts' own text never appears in a list body.
            for (const [i, id] of ids.entries()) {
                const row = await readRow(id);
                const text = String(row.transcript ?? '');
                if (text.trim().length === 0) continue;              // expired row has none to leak
                expect(joined.includes(text), `list response leaked session ${i + 1} transcript text`).toBe(false);
            }
        });

        await test.step('Every exact session opens truthfully in the customer UI — before AND after hard reload', async () => {
            // #1337 C — open EACH of the three by its captured id. "Newest" is never inferred from query
            // order or the dashboard's two-row limit; each assertion is bound to an exact id.
            const assertSurfaces = async (phase: string) => {
                for (const [i, id] of ids.entries()) {
                    const isOldest = i === 0;
                    await page.goto(`/analytics/${id}`);
                    await expect(page.getByTestId('session-next-action-title'),
                        `${phase}: session ${i + 1} keeps exactly one next action`).toHaveCount(1);
                    if (isOldest) {
                        await expect(page.getByTestId('session-detail-transcript-expired'),
                            `${phase}: oldest tells the user its transcript expired`).toBeVisible({ timeout: 45_000 });
                        await expect(page.getByTestId('session-detail-transcript'),
                            `${phase}: oldest renders no transcript pane`).toHaveCount(0);
                    } else {
                        const detail = page.getByTestId('session-detail-transcript');
                        await expect(detail, `${phase}: session ${i + 1} renders its retained transcript`)
                            .toBeVisible({ timeout: 45_000 });
                        const row = await readRow(id);
                        expect(sha256Hex(await detail.innerText()) === sha256Hex(row.transcript),
                            `${phase}: session ${i + 1} rendered digest must equal its OWN persisted digest`).toBe(true);
                    }
                    // Measurements survive on every session, expired or not.
                    await expect(page.getByTestId('filler-count-value'),
                        `${phase}: session ${i + 1} still shows its measurements`).toBeVisible({ timeout: 20_000 });
                }
            };

            await assertSurfaces('first open');
            // HARD RELOAD: re-boot from scratch on the exact SHA and repeat every state assertion, so the
            // truth comes from persisted server state rather than surviving in-memory state.
            await page.reload({ waitUntil: 'domcontentloaded' });
            const reloadRelease = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? null);
            expect(reloadRelease, 'still the exact deployed SHA after reload').toBe(EXPECT_RELEASE_SHA);
            await assertSurfaces('after hard reload');
        });

        await test.step('PDF truth through the REAL control — parsed text layer, not raw bytes', async () => {
            // The export control is rendered by SessionHistoryItem, i.e. it exists ONLY on the
            // /analytics dashboard row, never on the detail route. The dashboard renders the newest two
            // by design, so the two RETAINED sessions have a control and the EXPIRED one has none.
            //
            // MARKER CHOICE. All three recordings are fed the SAME audio fixture, so their transcript
            // text is effectively identical and cannot identify which session an artifact belongs to.
            // The per-session marker is therefore the session id, which the export writes into the
            // document; transcript text is used only to prove the extractor can see transcripts at all.
            const exportPdfText = async (id: string, ordinal: string): Promise<string> => {
                await page.goto('/analytics');
                const control = page.getByTestId(`download-pdf-btn-${id}`).first();
                // A failing `toBeVisible` prints the LOCATOR, which serializes the exact session UUID
                // into a public log. Catch it and re-raise with an ordinal label instead.
                try {
                    await expect(control).toBeVisible({ timeout: 45_000 });
                } catch {
                    throw new Error(`export_control_missing for the ${ordinal} retained session (fail closed)`);
                }
                const [download] = await Promise.all([
                    page.waitForEvent('download', { timeout: 60_000 }),
                    control.click(),
                ]);
                const path = await download.path();
                if (!path) throw new Error('no downloaded artifact path (fail closed)');
                return normalizeForMatch(await extractPdfText(path));
            };

            // Each retained row's transcript is read and normalised SEPARATELY. All three recordings
            // share one audio fixture, but decode output is not guaranteed byte-identical, so the
            // newest transcript cannot stand in for the middle one — checking only the newest would
            // leave the stated two-PDF transcript claim unproven.
            const newestText = normalizeForMatch(String((await readRow(ids[2])).transcript ?? ''));
            const middleText = normalizeForMatch(String((await readRow(ids[1])).transcript ?? ''));
            const newestPdf = await exportPdfText(ids[2], 'newest');
            const middlePdf = await exportPdfText(ids[1], 'middle');

            // POSITIVE CONTROLS FIRST — without these the absence assertions below prove nothing.
            expect(newestPdf.length, 'newest artifact produced parseable text').toBeGreaterThan(0);
            expect(middlePdf.length, 'middle artifact produced parseable text').toBeGreaterThan(0);
            expect(newestPdf.includes(ids[2]), 'newest artifact carries its OWN session marker').toBe(true);
            expect(middlePdf.includes(ids[1]), 'middle artifact carries its OWN session marker').toBe(true);
            // ...and the extractor demonstrably surfaces retained transcript text, so "no transcript in
            // the artifact" is a real observation rather than an extraction failure.
            expect(newestText.length, 'newest session has retained transcript text to find').toBeGreaterThan(0);
            expect(middleText.length, 'middle session has retained transcript text to find').toBeGreaterThan(0);
            expect(newestPdf.includes(newestText), 'newest artifact carries its OWN retained transcript').toBe(true);
            expect(middlePdf.includes(middleText), 'middle artifact carries its OWN retained transcript').toBe(true);

            // THE EXPIRED SESSION'S MARKER IS ABSENT from every artifact that could be produced.
            expect(newestPdf.includes(ids[0]), 'expired session marker must not appear in another artifact').toBe(false);
            expect(middlePdf.includes(ids[0]), 'expired session marker must not appear in another artifact').toBe(false);

            // ...and it exposes no export control at all, so no artifact of its own can be produced.
            await page.goto('/analytics');
            await expect(page.getByTestId('session-history-list')).toBeVisible({ timeout: 45_000 });
            await expect(page.getByTestId(`download-pdf-btn-${ids[0]}`),
                'expired session exposes no export control on the newest-two dashboard').toHaveCount(0);
            expect(oldestTranscriptShaBeforeExpiry, 'the expired session HAD a transcript to leak (control)')
                .not.toBe(sha256Hex(''));

            expect(providerHits, `no Cloud/provider contact at any point: ${providerHits.join(',')}`).toEqual([]);
        });

        // Content-free evidence only: digests, booleans, counts. No transcript text, no identifiers.
        console.log(`THREE_SESSION_RETENTION_PROOF_EVIDENCE ${JSON.stringify({
            release: EXPECT_RELEASE_SHA,
            sessionsCompleted: ids.length,
            distinctSessionIds: new Set(ids).size,
            completeSessionV2Calls: rpcCalls.complete_session_v2,
            legacyV1Calls: rpcCalls.complete_session,
            v2EnvelopesVerified: v2Responses.length,
            oldestExpired: true,
            oldestTranscriptNulled: true,
            oldestMetricsUnchanged: true,
            newestTwoRetained: true,
            listResponsesScanned: listBodies.length,
            providerRequests: providerHits.length,
        })}`);
    });
});
