import { test, expect, type Page, type Request } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { selectBenchmarkMode, preparePrivateModelIfPrompted, startBenchmarkRecording, expectBenchmarkRecordingStarted,
  expectBenchmarkDraftActivity, stopBenchmarkRecording } from '../../live/helpers/benchmark-utils';

/**
 * CUTOVER REHEARSAL B: the old-tab case, on a disposable local stack only. A BROWSER/DATABASE RECOVERY REHEARSAL
 * ONLY: the coaching Edge path is blocked here, so this neither upgrades the Edge probe nor establishes old-Edge drain.
 *
 * The production cutover ships the new frontend before #1863 and #1835. A tab that was already open keeps running the
 * old build. This proves what happens to that tab's take when the schema moves underneath it:
 *  1. the old build (446e09fa) records a synthetic Private Open Mic take;
 *  2. the schema advances to #1863 (20261114170000) then #1835 (20261117105700);
 *  3. Stop in the old tab: its transcript-bearing save is refused (the owner has no recorded choice);
 *  4. before any reload: the same-owner `finalized_pending_save` draft carries the original session id and final
 *     metrics (reloading during capture would exercise `active_interrupted`, which cannot prove Retry);
 *  5. the server switches to the new build (ffa5cdb8); the tab reloads and presses Retry Save once;
 *  6. the same session row completes once with the draft's metrics.
 * Transcript survival is reported separately and never required: the content-free draft never stored it.
 *
 * The local Edge runtime serves this checkout's functions, so check-usage-limit answers Start exactly as the new Edge
 * (released first) would for an old tab. No provider key exists in this stack, and every browser request to the coaching
 * function is aborted and counted, so no transcript can leave the runner. No Stripe, no production identifier,
 * trace/video/screenshots off. The receipt is content-free: ids become equality facts and failures are fixed stage codes.
 */

const env = process.env;
const need = (name: string): string => {
  const value = env[name];
  if (!value) throw new Error(`cutover_rehearsal_config_missing:${name}`);
  return value;
};
const API = need('CUTOVER_SUPABASE_URL');
const OLD_SHA = need('CUTOVER_OLD_SHA');
const NEW_SHA = need('CUTOVER_NEW_SHA');
const OLD_DIST = resolve(need('CUTOVER_OLD_DIST'));
const NEW_DIST = resolve(need('CUTOVER_NEW_DIST'));
const WORKDIR = resolve(need('CUTOVER_SUPABASE_WORKDIR'));
const SOURCE_MIGRATIONS = resolve(need('CUTOVER_SOURCE_MIGRATIONS'));
const DB_URL = need('CUTOVER_LOCAL_DB_URL');
const PAYMENT_WALL = '20261114170000_payment_wall_product_access_1863.sql';
const PRACTICE_PRIVACY = '20261117105700_practice_privacy_choices_1835.sql';
const PORT = 4791;
const APP = `http://127.0.0.1:${PORT}`;
const UUID = /^[0-9a-f-]{36}$/i;
const DRAFT_KEY = 'speaksharp_unsaved_session_draft';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(API)) throw new Error('cutover_rehearsal_requires_local_api');
if (!/@(127\.0\.0\.1|localhost):\d+\//.test(DB_URL)) throw new Error('cutover_rehearsal_requires_local_db');

const MIME: Record<string, string> = {
  '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.woff2': 'font/woff2',
  '.map': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
// Production's response headers (vercel.json, byte-identical at 446e09fa and ffa5cdb8), so the Private engine runs
// cross-origin isolated exactly as served. HSTS is omitted: this origin is loopback HTTP.
const PAGE_HEADERS: Record<string, string> = { 'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" };
const MODEL_HEADERS: Record<string, string> = { 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'" };
const headersFor = (path: string, type: string): Record<string, string> => ({ ...PAGE_HEADERS,
  ...(path.startsWith('/models/') ? MODEL_HEADERS : {}),
  'content-type': path.startsWith('/models/') && path.endsWith('.json') ? 'application/json'
    : path.startsWith('/models/') && path.endsWith('.txt') ? 'text/plain; charset=utf-8' : type,
  'cache-control': 'no-store' });
// One origin, switchable root: the "deployment" swaps what this server serves while the old tab stays open.
const served = { root: OLD_DIST };
let server: http.Server;

const psql = (sql: string): string => execFileSync('psql', [DB_URL, '-Atqc', sql], { encoding: 'utf8' }).trim();
const ledger = (): string[] => psql(`SELECT version FROM supabase_migrations.schema_migrations
  WHERE version IN ('20261114170000','20261117105700') ORDER BY version`).split('\n').filter(Boolean);
function applyMigration(file: string): void {
  copyFileSync(join(SOURCE_MIGRATIONS, file), join(WORKDIR, 'supabase', 'migrations', file));
  execFileSync('supabase', ['migration', 'up', '--local', '--workdir', WORKDIR], { stdio: 'inherit' });
}

type Draft = { sessionId?: string; userId?: string | null; recoveryState?: string; durationSeconds?: number;
  metrics?: { totalWords?: number; wpm?: number; clarityScore?: number } };
const readDraft = (page: Page): Promise<Draft | null> => page.evaluate((key) => {
  try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}, DRAFT_KEY);
const release = (page: Page): Promise<string | undefined> => page.evaluate(() => window.__APP_RELEASE__);

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  for (const dir of [OLD_DIST, NEW_DIST]) if (!existsSync(join(dir, 'index.html'))) throw new Error('cutover_rehearsal_dist_missing');
  server = http.createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = resolve(served.root, '.' + path);
    if (file.startsWith(served.root) && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, headersFor(path, MIME[extname(file)] ?? 'application/octet-stream'));
      res.end(readFileSync(file));
      return;
    }
    // A missing asset is a real 404 (never index HTML); every other route is the SPA shell.
    if (path.startsWith('/assets/') || path.startsWith('/models/')) { res.writeHead(404, PAGE_HEADERS); res.end(); return; }
    res.writeHead(200, headersFor(path, 'text/html; charset=utf-8'));
    res.end(readFileSync(join(served.root, 'index.html')));
  });
  await new Promise<void>(r => server.listen(PORT, '127.0.0.1', r));
});
test.afterAll(async () => { await new Promise<void>(r => server?.close(() => r())); });

test('cutover B (browser/database only): an old tab\'s refused save after #1863 + #1835 recovers once on the new build', async ({ page }) => {
  const receipt: Record<string, unknown> = { schemaVersion: 2, kind: 'cutover-rehearsal-b-old-tab', scope: 'browser-database-recovery-only',
    oldRelease: OLD_SHA, newRelease: NEW_SHA, status: 'INCOMPLETE', stage: 'setup' };
  const save = () => writeFileSync('cutover-rehearsal-b-receipt.json', JSON.stringify(receipt, null, 2));
  // Fixed failure codes only: the artifact never carries assertion or exception text.
  let stage = 'setup';
  const at = (name: string) => { stage = name; receipt.stage = name; save(); };

  // Coaching egress: every browser request to the coaching function is aborted and counted (no provider key exists either).
  let coachingRequests = 0;
  await page.route('**/functions/v1/get-ai-suggestions**', route => { coachingRequests++; return route.abort(); });

  // Completion REQUESTS, classified when they are sent (phase, origin, method, session), each settled by its own
  // response or failure. A late or extra POST is still counted; an unanswered one can never PASS.
  type Completion = { phase: 'old' | 'retry' | 'closed'; bound: boolean; answered: boolean; failed: boolean;
    status: number | null; code: string | null; refusal: boolean; success: boolean; settled: Promise<void> };
  const completions: Completion[] = [];
  const byRequest = new Map<Request, { entry: Completion; settle: () => void }>();
  let phase: 'old' | 'retry' | 'closed' = 'closed';
  let sessionId = '';
  page.on('request', request => {
    if (!request.url().includes('/rest/v1/rpc/complete_session_v2')) return;
    const posted = (() => { try { return request.postDataJSON() as { p_session_id?: unknown } | null; } catch { return null; } })();
    let settle = () => {};
    const settled = new Promise<void>(r => { settle = r; });
    const entry: Completion = { phase, bound: new URL(request.url()).origin === new URL(API).origin && request.method() === 'POST'
      && sessionId !== '' && posted?.p_session_id === sessionId,
      answered: false, failed: false, status: null, code: null, refusal: false, success: false, settled };
    completions.push(entry);
    byRequest.set(request, { entry, settle });
  });
  page.on('response', response => {
    const tracked = byRequest.get(response.request());
    if (!tracked) return;
    void (async () => {
      const { entry, settle } = tracked;
      entry.answered = true; entry.status = response.status();
      try { const body = await response.json();
        entry.code = typeof body?.code === 'string' ? body.code : null; entry.refusal = body?.message === 'transcript_consent_required';
        // Success only from a body that was actually read: a 200 whose body read rejects or times out stays unsuccessful.
        entry.success = entry.status === 200 && entry.code === null;
      } catch { entry.success = false; }
      settle();
    })();
  });
  // The entitlement answers the app receives (both builds), as content-free facts: phase, HTTP status, can_start, error code.
  const usageAnswers: Array<{ phase: string; status: number; canStart: boolean | null; trialActive: boolean | null; error: string | null }> = [];
  let usagePhase = 'old';
  page.on('response', response => {
    if (!response.url().includes('/functions/v1/check-usage-limit') || response.request().method() !== 'POST') return;
    const at = usagePhase;
    void response.json().then((body: { can_start?: unknown; trial_active?: unknown; error?: unknown }) => {
      usageAnswers.push({ phase: at, status: response.status(), canStart: typeof body?.can_start === 'boolean' ? body.can_start : null,
        trialActive: typeof body?.trial_active === 'boolean' ? body.trial_active : null,
        error: typeof body?.error === 'string' && /^[a-z_]{1,40}$/.test(body.error) ? body.error : body?.error == null ? null : 'unrecognized' });
    }, () => { usageAnswers.push({ phase: at, status: response.status(), canStart: null, trialActive: null, error: 'unreadable' }); });
  });
  page.on('requestfailed', request => {
    const tracked = byRequest.get(request);
    if (!tracked) return;
    tracked.entry.failed = true;
    tracked.settle();
  });
  // Bounded: a request that never settles (e.g. dropped when the page closes) stays unanswered and fails the check below.
  const settledAll = async (list: Completion[]) => {
    await Promise.race([Promise.all(list.map(c => c.settled)), new Promise<void>(r => setTimeout(r, 30_000))]);
  };

  try {
    at('baseline_ledger');
    expect(ledger()).toEqual([]);

    at('fixture_account');
    const admin: SupabaseClient = createClient(API, need('CUTOVER_SERVICE_ROLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false } });
    const email = `cutover-rehearsal-${randomUUID()}@example.com`;
    const password = `Test-${randomUUID()}!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    const uid = created.data.user!.id;

    // 1. Old build, signed in, active trial (check-usage-limit answered by the local Edge runtime), synthetic take.
    at('old_build_signin');
    await page.goto(`${APP}/auth/signin`);
    expect(await release(page)).toBe(OLD_SHA);
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('password-input').fill(password);
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('nav-account-avatar')).toBeVisible();
    at('old_build_take');
    await page.goto(`${APP}/practice`);
    await page.getByTestId('practice-card-freeform').click();
    await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
    await selectBenchmarkMode(page, 'private');
    const setup = await preparePrivateModelIfPrompted(page, 600_000);
    if (!setup.recordingAlreadyStarted) await startBenchmarkRecording(page, 'cutover-old-tab');
    await expectBenchmarkRecordingStarted(page, 'cutover-old-tab');
    await expectBenchmarkDraftActivity(page, 'cutover-old-tab', 60_000);
    const open = await admin.from('sessions').select('id').eq('user_id', uid);
    expect(open.error).toBeNull();
    expect(open.data?.length).toBe(1);
    sessionId = String(open.data![0].id);
    expect(sessionId).toMatch(UUID);
    receipt.oldBuildRecording = true;
    await page.waitForTimeout(20_000);

    // 2. The schema advances underneath the open tab, in the release order.
    at('schema_advance');
    applyMigration(PAYMENT_WALL);
    applyMigration(PRACTICE_PRIVACY);
    expect(ledger()).toEqual(['20261114170000', '20261117105700']);
    expect(psql(`SELECT count(*) FROM public.practice_privacy_choices WHERE user_id='${uid}'`)).toBe('0');
    receipt.schemaAdvanced = ['20261114170000', '20261117105700'];

    // 3. Stop in the old tab: every bound completion is refused as transcript_consent_required; nothing completes.
    at('old_stop_refused');
    phase = 'old';
    await stopBenchmarkRecording(page, 'cutover-old-tab', 120_000);
    await expect.poll(async () => (await readDraft(page))?.recoveryState, { timeout: 120_000 }).toBe('finalized_pending_save');
    phase = 'closed';
    const old = completions.filter(c => c.phase === 'old');
    await settledAll(old);
    receipt.oldStopCompletions = old.map(({ bound, answered, status, code, refusal }) => ({ bound, answered, status, code, refusal }));
    expect(old.length).toBeGreaterThan(0);
    expect(old.every(c => c.bound && c.answered && c.refusal && c.code === '42501' && !c.success)).toBe(true);
    const afterStop = await admin.from('sessions').select('status,transcript').eq('id', sessionId).single();
    expect(afterStop.error).toBeNull();
    receipt.refusedSave = afterStop.data!.status !== 'completed' && afterStop.data!.transcript === null;
    expect(receipt.refusedSave).toBe(true);

    // 4. Before any reload: the draft is finalized and names the authenticated owner's sole row (independent binding).
    at('draft_bound_to_owner');
    const draft = (await readDraft(page))!;
    const member: SupabaseClient = createClient(API, need('CUTOVER_ANON_KEY'), { auth: { autoRefreshToken: false, persistSession: false } });
    const signedIn = await member.auth.signInWithPassword({ email, password });
    expect(signedIn.error === null && signedIn.data.user?.id === uid).toBe(true);
    const owned = await member.from('sessions').select('id');
    expect(owned.error).toBeNull();
    receipt.draft = { state: draft.recoveryState, ownerSoleRow: owned.data?.length === 1,
      sessionIsOwnersSoleRow: owned.data?.length === 1 && String(owned.data[0].id) === draft.sessionId,
      sameAsRecordedRow: draft.sessionId === sessionId, draftOwnerField: draft.userId == null ? 'absent' : draft.userId === uid,
      hasFinalMetrics: Number.isFinite(draft.metrics?.totalWords) && Number.isFinite(draft.metrics?.wpm) };
    expect(owned.data?.map(r => String(r.id))).toEqual([draft.sessionId]);
    expect(draft.sessionId).toBe(sessionId);
    if (draft.userId != null) expect(draft.userId).toBe(uid);
    expect(Number.isFinite(draft.metrics?.totalWords) && Number.isFinite(draft.metrics?.wpm)).toBe(true);

    // 5. Deployment: the same origin now serves the new build; the tab reloads and presses Retry Save once.
    at('new_build_retry');
    receipt.beforeReloadRoute = new URL(page.url()).pathname.replace(/[0-9a-f-]{36}/gi, ':id');
    // Content-free rehydration signal: only whether the controller's fixed rehydration log line appeared.
    let rehydrationLogged = false;
    let chunkLoadError = false;
    page.on('console', message => {
      const text = message.text();
      if (text.includes('rehydrated FINALIZED unresolved recording')) rehydrationLogged = true;
      if (/Failed to fetch dynamically imported module|ChunkLoadError|Importing a module script failed/.test(text)) chunkLoadError = true;
    });
    page.on('pageerror', error => { if (/dynamically imported module|ChunkLoadError/.test(error.message)) chunkLoadError = true; });
    served.root = NEW_DIST;
    usagePhase = 'new';
    await page.reload();
    expect(await release(page)).toBe(NEW_SHA);
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
    // Diagnostics (review 05:07): separate routing/auth from product rehydration, as content-free facts, BEFORE the
    // unchanged expectation below. Nothing here relaxes it.
    await page.waitForTimeout(15_000);
    const afterReloadDraft = await readDraft(page);
    receipt.afterReload = await page.evaluate(({ uid }) => {
      const tokenKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      let ownerResolved: boolean | 'no_token' = 'no_token';
      try { if (tokenKey) ownerResolved = JSON.parse(localStorage.getItem(tokenKey) ?? 'null')?.user?.id === uid; } catch { ownerResolved = false; }
      const banner = document.querySelector('[data-testid="session-unresolved-recovery"]');
      const mic = document.querySelector('[data-testid="session-start-stop-button"], [data-testid="mic-start"]') as HTMLButtonElement | null;
      return {
        route: location.pathname.replace(/[0-9a-f-]{36}/gi, ':id'),
        sessionPageMounted: Boolean(document.querySelector('[data-testid="session-page"]')),
        avatarVisible: Boolean(document.querySelector('[data-testid="nav-account-avatar"]')),
        ownerResolved,
        bannerPresent: Boolean(banner), bannerResolution: banner?.getAttribute('data-resolution') ?? null,
        recoveryActionsPresent: Boolean(document.querySelector('[data-testid="session-recovery-actions"]')),
        recoveryActionsState: document.querySelector('[data-testid="session-recovery-actions"]')?.getAttribute('data-recovery-state') ?? null,
        micFound: Boolean(mic), micDisabled: mic ? mic.disabled : null,
        accessChecking: Boolean(document.querySelector('[data-testid="trial-access-checking"]')),
        paymentWall: Boolean(document.querySelector('[data-testid="trial-payment-wall"]')),
        takeNotSavedNotice: Boolean(document.querySelector('[data-testid="trial-take-not-saved"]')),
        // Not the gate: a lazy route still loading, an error boundary, or the stale-chunk recovery overlay.
        errorBoundary: /Oops! Something went wrong/.test(document.body.innerText),
        staleChunkOverlay: Boolean(document.querySelector('#ss-stale-chunk-recovery')),
        // App.tsx's route Suspense fallback (PageLoader) has no test id; its unique wrapper class identifies it.
        routeLoader: Boolean(document.querySelector('[class*="min-h-[calc(100vh-var(--header-height))]"]')),
        mainChildren: document.querySelector('main')?.childElementCount ?? null,
      };
    }, { uid });
    (receipt.afterReload as Record<string, unknown>).draft = afterReloadDraft === null ? null : {
      state: afterReloadDraft.recoveryState ?? null, sameSession: afterReloadDraft.sessionId === sessionId,
      sameOwner: afterReloadDraft.userId == null ? 'absent' : afterReloadDraft.userId === uid,
      nextActionValid: Boolean((afterReloadDraft as { nextActionSignal?: unknown }).nextActionSignal
        && typeof (afterReloadDraft as { nextActionSignal?: unknown }).nextActionSignal === 'object') };
    (receipt.afterReload as Record<string, unknown>).rehydrationLogged = rehydrationLogged;
    (receipt.afterReload as Record<string, unknown>).chunkLoadError = chunkLoadError;
    receipt.usageAnswers = usageAnswers;
    save();
    await expect(page.getByTestId('session-unresolved-recovery')).toBeVisible({ timeout: 60_000 });
    const retry = page.getByTestId('session-retry-save');
    await expect(retry).toBeVisible();
    phase = 'retry';
    await retry.click();
    receipt.retryClicks = 1;

    // 6. Exactly one bound, successful Retry completion; the same row completes once with the draft's metrics.
    at('recovered_once');
    await expect.poll(async () => (await admin.from('sessions').select('status').eq('id', sessionId).single()).data?.status,
      { timeout: 120_000 }).toBe('completed');
    await expect.poll(() => readDraft(page), { timeout: 30_000 }).toBeNull();
    await page.waitForTimeout(5_000);
    // Close the page BEFORE the final count, so no later POST can arrive after judgement; then settle every request.
    await page.close();
    phase = 'closed';
    await settledAll(completions);
    const retried = completions.filter(c => c.phase === 'retry');
    receipt.retryCompletions = retried.map(({ bound, answered, status, code, success }) => ({ bound, answered, status, code, success }));
    expect(retried.length).toBe(1);
    expect(retried[0].bound && retried[0].answered && retried[0].success).toBe(true);
    const final = await admin.from('sessions').select('id,status,transcript,total_words,wpm').eq('user_id', uid);
    expect(final.error).toBeNull();
    expect(final.data?.length).toBe(1);
    const row = final.data![0];
    receipt.recovered = { sameSession: String(row.id) === sessionId, completedOnce: row.status === 'completed' && final.data!.length === 1,
      metricsPersisted: row.total_words === draft.metrics?.totalWords && Number(row.wpm) === Number(draft.metrics?.wpm) };
    // Reported, never required: the content-free draft never held transcript text.
    receipt.transcriptSurvived = row.transcript !== null;
    expect(receipt.recovered).toEqual({ sameSession: true, completedOnce: true, metricsPersisted: true });
    receipt.draftCleared = true;

    at('isolation');
    const foreign = completions.filter(c => !c.bound || c.phase === 'closed' || !c.answered || c.failed);
    receipt.completionRequests = { total: completions.length, old: old.length, retry: retried.length, foreign: foreign.length };
    receipt.coachingRequestsBlocked = coachingRequests;
    expect(foreign.length).toBe(0);
    expect(completions.length).toBe(old.length + 1);
    receipt.status = 'PASS';
    receipt.stage = 'complete';
  } catch (error) {
    receipt.status = 'FAIL';
    receipt.reason = `${stage}_failed`;
    throw error;
  } finally {
    save();
  }
});
