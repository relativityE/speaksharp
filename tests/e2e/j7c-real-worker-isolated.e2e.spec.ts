/**
 * J7.c option B, the isolated browser proof (PO: a local run "as long as it works in CI too"; Sam's preflight, 2026-11-22).
 *
 * THE REAL ENGINE, NOT A MOCK. The app runs as a built bundle WITHOUT the E2E manifest (`__SS_E2E__` is never set), so
 * `ENV.isE2E` / `ENV.isTest` stay false and the unchanged `STTStrategyFactory` constructs the real Private engine and worker; the
 * #1320 guard (a test manifest can never construct a real engine) is untouched. Auth, profile and data come from the existing
 * network-level fakes (`setupE2EMocks`, which sets only `__E2E_CONTEXT__`) plus the few spec-local answers the real start path
 * needs (`realPathFakes`). The shared fakes are not changed.
 *
 * ISOLATED (Sam): every request that is not to the loopback app server is aborted, except Supabase paths, which the fakes always
 * fulfil (their own catch-all answers 404 and never passes one on). Nothing reaches a production service; the tests fail if any
 * other host was even attempted.
 *
 * 1. Preflight: one attempt from "Download & start recording" uses the real worker and requests the pinned local model files.
 * 2. J7.c: #1941's own controller and verdicts on the SAME attempt: the next model file after one has finished is held, the
 *    browser goes offline, the held file is released into the dropped network and fails, and what the person sees (card, toasts,
 *    Retry) is read on that failed attempt and judged by `shownFailureVerdict`.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOCK_SESSION } from '@shared/test-fixtures';
import { navigateToRoute } from './helpers';
import { setupE2EMocks } from './mock-routes';
import { BetweenFilesHold, MODEL_ASSETS, ModelTransferTracker, armRuntimeStateLog, readRuntimeStateLog } from '../live/helpers/rwtAdverse';
import {
    attemptPhase, betweenFilesGate, pollShownFailure, runBetweenFilesFault, shownFailureVerdict, type BetweenFilesSnapshot, type ModelBytesRead,
} from '../live/helpers/rwtAdverseRecovery';

const PINNED = JSON.parse(readFileSync(join(process.cwd(), 'frontend', 'src', 'services', 'transcription', 'selfHostedAssetPins.json'), 'utf8')) as
    { servedFrom: string; files: Array<{ path: string }> };
const MODEL_PREFIX = `${PINNED.servedFrom}/`;
/** The files the Private pipeline loads (the same set tests/e2e/v2-cold-acquisition-scope.e2e.spec.ts names). */
const PIPELINE_FILES = ['config.json', 'generation_config.json', 'onnx/decoder_model_merged_quantized.onnx', 'onnx/encoder_model_quantized.onnx',
    'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json'];
const REAL_WORKER = /^\/assets\/transformers-js\.worker-.*\.js$/;

const isLoopback = (url: URL) => url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
const isFakedSupabase = (url: URL) => /\/(auth|rest|functions|storage|realtime)\/v1\//.test(url.pathname);

/**
 * Fails closed on every non-loopback request except faked Supabase paths, recording the host. Registered at both levels and LAST:
 * a page route registered last is consulted first (the shared fakes' page catch-all would otherwise continue a non-Supabase
 * request to the network), and the context route covers what no page route handles.
 */
async function isolate(page: Page, blocked: string[]) {
    const guard = async (route: Route) => {
        const url = new URL(route.request().url());
        if (isFakedSupabase(url) || isLoopback(url)) return route.fallback();
        blocked.push(url.host);
        return route.abort('blockedbyclient');
    };
    await page.context().route('**/*', guard);
    await page.route('**/*', guard);
}

/** What the real start path asks that the shared network fakes do not answer (spec-local). */
async function realPathFakes(page: Page) {
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    // An explicit owner choice, read by the real client: Save Yes / Coaching No (no coaching provider involved).
    await page.route(/\/rest\/v1\/practice_privacy_choices(\?.*)?$/, (route) =>
        route.fulfill(json({ transcript_save: true, ai_coaching: false, consent_version: 1, choice_revision: 1 })));
    // No Progress debt owed (the in-page harness answers the same).
    await page.route(/\/rest\/v1\/rpc\/get_progress_obligations$/, (route) => route.fulfill(json([])));
    await page.route(/\/rest\/v1\/session_progress_evaluations(\?.*)?$/, (route) => route.fulfill(json([])));
    await page.route(/\/rest\/v1\/rpc\/acquire_recording_lease$/, (route) => route.fulfill(json({ acquired: true, took_over: false })));
    await page.route(/\/rest\/v1\/rpc\/heartbeat_recording_lease$/, (route) => route.fulfill(json({ valid: true })));
    await page.route(/\/rest\/v1\/rpc\/release_recording_lease$/, (route) => route.fulfill(json({ released: true })));
}

/** A signed-in fake session: the app requires a JWT-SHAPED access token (unsigned; only the fakes ever see it). */
async function signIn(page: Page) {
    const url = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
    const key = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const user = (MOCK_SESSION as { user: { id: string } }).user;
    const session = { ...(MOCK_SESSION as object), expires_at: exp,
        access_token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', exp })}.isolated` };
    await page.addInitScript(({ k, s }) => { try { localStorage.setItem(k, JSON.stringify(s)); } catch { /* fresh origin */ } }, { k: key, s: session });
}

/** To the Open Mic session's cold Private card, with the microphone granted. */
async function toPrivateDownload(page: Page) {
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-freeform').click();
    await expect(page.getByTestId('mic-download')).toBeVisible({ timeout: 30_000 });
    await page.context().grantPermissions(['microphone']);
}

test.describe('J7.c isolated: the real Private worker in the app', () => {
    test('preflight: one attempt uses the real worker and requests the pinned local model files', async ({ page }) => {
        test.setTimeout(240_000);
        const blocked: string[] = [];
        await setupE2EMocks(page, { userType: 'pro' });
        await realPathFakes(page);
        await isolate(page, blocked);
        await signIn(page);
        const workers: string[] = [];
        page.on('worker', (w) => workers.push(new URL(w.url()).pathname));
        const modelFiles = new Set<string>();
        page.context().on('requestfinished', (r) => { const p = new URL(r.url()).pathname; if (p.startsWith(MODEL_PREFIX)) modelFiles.add(p.slice(MODEL_PREFIX.length)); });

        await toPrivateDownload(page);
        await page.getByTestId('mic-download').click();
        await expect.poll(() => PIPELINE_FILES.every((f) => modelFiles.has(f)), { timeout: 180_000 }).toBe(true);

        expect(await page.evaluate(() => Boolean((window as unknown as { __SS_E2E__?: unknown }).__SS_E2E__))).toBe(false);
        expect(workers.some((w) => REAL_WORKER.test(w))).toBe(true);
        const pinned = new Set(PINNED.files.map((f) => f.path));
        expect([...modelFiles].every((f) => pinned.has(f))).toBe(true);
        expect([...modelFiles].sort()).toEqual([...PIPELINE_FILES].sort());
        expect(blocked).toEqual([]);
    });
});

test.describe('J7.c isolated: the network drops between model files', () => {
    test('the held next model file fails after release, and the failed attempt states it with Retry enabled', async ({ page }) => {
        test.setTimeout(420_000);
        const blocked: string[] = [];
        await setupE2EMocks(page, { userType: 'pro' });
        await realPathFakes(page);
        // The hold is a PAGE route registered after the shared fakes (their page catch-all continues every non-Supabase request,
        // and page routes come before context routes) and before the guard. Page routes see a dedicated worker's fetches.
        const transfer = new ModelTransferTracker<object>();
        const hold = new BetweenFilesHold<object>();
        await page.route(MODEL_ASSETS, (route) => hold.onRoute(route.request(), route.request().url(), transfer.snapshot().finished, () => route.continue()));
        await isolate(page, blocked);
        await signIn(page);
        const workers: string[] = [];
        page.on('worker', (w) => workers.push(new URL(w.url()).pathname));
        const context = page.context();
        context.on('request', (r) => transfer.onRequest(r, r.url()));
        context.on('requestfinished', (r) => transfer.onFinished(r));
        context.on('requestfailed', (r) => transfer.onFailed(r));

        await toPrivateDownload(page);
        const token = `j7c-${Date.now()}`;
        await page.evaluate(armRuntimeStateLog, token);
        const phaseOf = async (from: number) => {
            const log = await page.evaluate(readRuntimeStateLog).catch(() => ({ token: null, states: [] as string[] }));
            return attemptPhase({ observed: log.token === token, states: log.states }, from);
        };
        let heldRequest: object | null = null;
        const files = (): BetweenFilesSnapshot => {
            const held = hold.held();
            if (held) heldRequest = held;
            return { ...transfer.snapshot(), held: held === null ? 'none' : (transfer.stateOf(held) === 'none' ? 'unseen' : transfer.stateOf(held)) };
        };
        const readBytes = (): Promise<ModelBytesRead | null> => page.evaluate(() => {
            const pct = Number.parseInt(document.querySelector('[data-testid="mic-progress"]')?.textContent ?? '', 10);
            const root = document.documentElement;
            return { pct: Number.isFinite(pct) ? pct : null, status: root.getAttribute('data-model-status'), runtimeState: root.getAttribute('data-runtime-state') };
        }).catch(() => null);

        const pressIndex = (await page.evaluate(readRuntimeStateLog)).states.length;
        transfer.startAttempt();
        hold.startAttempt();
        await page.getByTestId('mic-download').click();
        const run = await runBetweenFilesFault({
            setOffline: (offline) => context.setOffline(offline).then(() => true, () => false),
            phase: () => phaseOf(pressIndex),
            files,
            read: readBytes,
            release: () => hold.release(),
            isOnline: () => page.evaluate(() => navigator.onLine).catch(() => null),
            armFault: () => transfer.armFault(),
            disarmFault: () => transfer.disarm(),
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            now: () => Date.now(),
        }, { holdBoundMs: 300_000, boundMs: 300_000, pollMs: 50 });

        // What the person sees, on that same failed attempt, still offline and before anything is pressed.
        const shown = await pollShownFailure(async () => {
            const sameAttempt = (await phaseOf(pressIndex)) === 'setup-failed';
            const cardText = await page.getByTestId('mic-card').innerText({ timeout: 2_000 }).catch(() => null);
            const toastTexts = await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => null);
            const retry = page.getByTestId('mic-retry');
            const retryVisible = await retry.isVisible().catch(() => null);
            const retryEnabled = retryVisible ? await retry.isEnabled().catch(() => null) : false;
            return { sameAttempt: sameAttempt && (await phaseOf(pressIndex)) === 'setup-failed', cardText, toastTexts, retryVisible, retryEnabled };
        }, { budgetMs: 5_000, sleep: (ms) => page.waitForTimeout(ms) });
        const heldEnded = heldRequest ? transfer.stateOf(heldRequest) : 'none';
        await context.setOffline(false);
        await hold.releaseAll();
        const verdict = shownFailureVerdict(shown);
        // Content-free evidence line (closed values only).
        console.log(JSON.stringify({ outcome: run.outcome, gate: run.gateFiles, heldEnded, sameAttempt: shown.sameAttempt,
            retryEnabled: shown.retryEnabled, toastCount: shown.toastTexts?.length ?? null, verdict: verdict.status }));

        expect(blocked).toEqual([]);
        expect(workers.some((w) => REAL_WORKER.test(w))).toBe(true);
        expect(betweenFilesGate(run.gateRead, run.gateFiles).inject).toBe(true);
        expect(run.outcome).toEqual({ kind: 'exercised', settled: true });
        expect(heldEnded).toBe('failed');
        expect(shown.sameAttempt).toBe(true);
        expect(verdict).toMatchObject({ status: 'PASS' });
    });
});
