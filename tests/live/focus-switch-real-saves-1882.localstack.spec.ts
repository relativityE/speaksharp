import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { openProductsItem } from './helpers/productsMenu';
import { selectBenchmarkMode, preparePrivateModelIfPrompted, startBenchmarkRecording, expectBenchmarkRecordingStarted,
  stopBenchmarkRecording } from './helpers/benchmark-utils';

/**
 * #1882 — the Focus switch sequence with REAL saves, on a DISPOSABLE LOCAL stack only.
 *
 * The isolated #1882 specs (tests/e2e/focusSwitch1882Flow.ts) replay the live order on the mocked backend and do not
 * reproduce the live failure (run 43715342978: the Focus take right after a product switch was reviewed with no rail
 * rows, so Start a new set was never offered). The difference left untested is real persistence and real speech. This
 * spec replays the same order against a local Supabase built from this commit, with a fake microphone playing a real
 * recording through the Private engine, and checks Sam's three facts at the source:
 *   1. Open Mic is active for the Open Mic take (no Focus rail on the page, and its saved row says open_mic);
 *   2. the Focus take after the switch actually saves (exactly one new completed focus_points row);
 *   3. after a reload the same Focus set is shown, and Edit reopens it with the same topic and points.
 * It also records what the post-switch review shows (rail rows, Start a new set), which is the live symptom, and the
 * switch take's controller trace from this branch (states and counts only), so a failure names the branch taken.
 *
 * Safety: it refuses to run unless the app's runtime config names the loopback API and real auth, the served release is
 * the dispatched commit, and the API URL is a loopback address. It creates one throwaway account on that local stack and
 * deletes it. No trace, video or screenshot (the DOM holds transcript text). Run only by focus-local-stack-repro.yml.
 */

const env = process.env;
const LOCAL_API = env.FOCUS_LOCAL_API_URL ?? '';
const APP = env.FOCUS_LOCAL_APP_URL ?? '';
const SERVICE_KEY = env.FOCUS_LOCAL_SERVICE_ROLE_KEY ?? '';
const RELEASE = env.FOCUS_LOCAL_RELEASE_SHA ?? '';

const TOPIC = 'Quarterly update';
const POINTS = ['Name the revenue number', 'Explain the hiring plan', 'Describe the product launch', 'Ask for the budget'] as const;
/** Long enough to pass the 5 s minimum with margin and carry meaningful words from the fixture. */
const TAKE_MS = 12_000;
const STEP_MS = 30_000;
const UUID = /^[0-9a-f-]{36}$/i;

type TraceEvent = Record<string, unknown> & { event?: string };
/** This branch's controller trace (states and counts only); armed by the page's init script below. */
async function controllerTrace(page: Page): Promise<TraceEvent[]> {
  const all = await page.evaluate(() => (window as unknown as { __NATIVE_BROWSER_TRACE__?: TraceEvent[] }).__NATIVE_BROWSER_TRACE__ ?? []);
  return all.filter((e) => String(e.event ?? '').startsWith('controller_'));
}

const loopback = (url: string) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Row = { id: string; user_id: string; status: string | null; product: string | null };

async function persistedId(page: Page): Promise<string | null> {
  return page.locator('html').getAttribute('data-session-persisted-id');
}

/** Fills the Focus setup dialog with the fixed topic and four points and submits it. */
async function saveSet(page: Page) {
  const dialog = page.getByTestId('objective-setup-dialog');
  await expect(dialog).toBeVisible({ timeout: STEP_MS });
  await page.getByTestId('objective-goal-select').selectOption('other', { timeout: STEP_MS });
  await page.getByTestId('objective-goal-input').fill(TOPIC, { timeout: STEP_MS });
  for (let i = 0; i < POINTS.length; i += 1) {
    if ((await page.getByTestId(`objective-point-label-${i}`).count()) === 0) {
      await page.getByTestId('objective-add-point').click({ timeout: STEP_MS });
    }
    await page.getByTestId(`objective-point-label-${i}`).fill(POINTS[i], { timeout: STEP_MS });
  }
  await page.getByTestId('objective-setup-submit').click({ timeout: STEP_MS });
  await expect(dialog).toHaveCount(0, { timeout: STEP_MS });
}

/**
 * One real take from a page on /session; returns the NEW persisted session id. `alreadyRunning` is for the first take on a
 * cold model: the one setup press downloads the model AND starts the take, so Start must not be pressed again.
 */
async function realTake(page: Page, label: string, before: string | null, alreadyRunning = false): Promise<string> {
  if (!alreadyRunning) await startBenchmarkRecording(page, label, 600_000);
  await expectBenchmarkRecordingStarted(page, label);
  await sleep(TAKE_MS);
  await stopBenchmarkRecording(page, label, 120_000);
  await expect.poll(() => persistedId(page), { timeout: 120_000 }).not.toBe(before);
  await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 60_000 });
  const id = await persistedId(page);
  expect(id && UUID.test(id), `${label}: a persisted session id`).toBeTruthy();
  return id as string;
}

test.use({ trace: 'off', video: 'off', screenshot: 'off', permissions: ['microphone'] });

test('#1882 local stack: Open Mic → Focus switch → reload → Edit, with real saves', async ({ page }) => {
  test.setTimeout(1_800_000);
  expect(loopback(LOCAL_API) && loopback(APP), 'refuses anything but a loopback API and app').toBe(true);
  expect(SERVICE_KEY && RELEASE, 'the local service key and dispatched commit are required').toBeTruthy();

  const admin = createClient(LOCAL_API, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `focus-1882-${randomUUID()}@example.com`;
  const password = `Test-${randomUUID()}!`;
  let uid = '';
  const rows = async (): Promise<Row[]> => {
    const read = await admin.from('sessions').select('id,user_id,status,product').eq('user_id', uid);
    expect(read.error, 'sessions read').toBeNull();
    return (read.data ?? []) as Row[];
  };
  const row = async (id: string): Promise<Row | undefined> => (await rows()).find((r) => r.id === id);

  try {
    // Arm the #1882 controller trace on every load, so a failure names which branch the switch take took.
    await page.addInitScript(() => { (window as unknown as { __NATIVE_BROWSER_TRACE__: unknown[] }).__NATIVE_BROWSER_TRACE__ = []; });
    // ── The served app is this commit's build against the loopback API with real auth ──
    await page.goto(`${APP}/auth/signin`);
    await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: STEP_MS });
    const runtime = await page.evaluate(() => ({ release: window.__APP_RELEASE__,
      api: window.__APP_RUNTIME_CONFIG__?.supabaseUrl, authMode: window.__APP_RUNTIME_CONFIG__?.authMode }));
    expect(runtime, 'served identity').toEqual({ release: RELEASE, api: LOCAL_API, authMode: 'real' });

    // ── One throwaway account on the local stack, signed in through the page ──
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error, 'local account').toBeNull();
    uid = created.data.user?.id ?? '';
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('password-input').fill(password);
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('nav-account-avatar')).toBeVisible({ timeout: STEP_MS });

    // ── 1. A Focus take on the set ──
    await page.goto(`${APP}/practice`);
    await page.getByTestId('practice-card-objective').click({ timeout: STEP_MS });
    await saveSet(page);
    await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
    await selectBenchmarkMode(page, 'private');
    // Read before the setup press: on a cold model that press also starts the first take.
    const beforeFirst = await persistedId(page);
    const setup = await preparePrivateModelIfPrompted(page, 600_000);
    const firstFocus = await realTake(page, 'focus-1882-first', beforeFirst, setup.recordingAlreadyStarted);
    expect(await row(firstFocus), 'first Focus take saved').toMatchObject({ status: 'completed', product: 'focus_points' });

    // ── 2. Open Mic, reached from the session page at rest (as the live journey does) ──
    await page.goto(`${APP}/session`);
    await openProductsItem(page, 'open-mic', STEP_MS);
    await page.waitForURL(/\/session/, { timeout: 45_000 });
    await expect(page.getByTestId('focus-points-rail'), 'Open Mic is active: no Focus rail').toHaveCount(0);
    const openMic = await realTake(page, 'focus-1882-openmic', await persistedId(page));
    expect(await row(openMic), 'check 1: the Open Mic take saved as open_mic')
      .toMatchObject({ status: 'completed', product: 'open_mic' });
    await expect(page.getByTestId('focus-points-rail'), 'still no Focus rail on the Open Mic review').toHaveCount(0);

    // ── 3. Switch to Focus Points and take one right after the switch ──
    await openProductsItem(page, 'focus-points', STEP_MS);
    await saveSet(page);
    await page.waitForURL(/\/session/, { timeout: 45_000 });
    await expect(page.getByTestId('focus-points-rail')).toBeVisible({ timeout: 45_000 });
    const countBefore = (await rows()).length;
    const traceBefore = (await controllerTrace(page)).length;
    const switched = await realTake(page, 'focus-1882-switch', await persistedId(page));
    const after = await rows();
    expect(after.length, 'check 2: exactly one new row for the take after the switch').toBe(countBefore + 1);
    expect(await row(switched), 'check 2: the take after the switch saved as focus_points')
      .toMatchObject({ status: 'completed', product: 'focus_points' });

    // The live symptom: the post-switch review lost its rail rows, so Start a new set was never offered.
    await sleep(2_000);
    const railRows = await page.locator('[data-testid^="focus-point-"]').count();
    const newSetOffered = await page.getByTestId('focus-points-new-set').count();
    const switchTrace = JSON.stringify((await controllerTrace(page)).slice(traceBefore));
    test.info().annotations.push({ type: 'post-switch-review', description: JSON.stringify({ railRows, newSetOffered }) });
    test.info().annotations.push({ type: 'switch-take-trace', description: switchTrace });
    // States and counts only, so the run log shows the verdict inputs whether it passes or fails.
    console.log(`[1882-local-stack] post-switch review ${JSON.stringify({ railRows, newSetOffered })} trace ${switchTrace}`);
    expect(railRows, `the post-switch review shows the four points; trace ${switchTrace}`).toBeGreaterThanOrEqual(POINTS.length);
    expect(newSetOffered, `the post-switch review offers Start a new set; trace ${switchTrace}`).toBe(1);

    // ── 4. Reload: the same Focus set comes back, and Edit reopens it unchanged ──
    await page.reload();
    await expect(page.getByTestId('focus-points-topic')).toHaveText(TOPIC, { timeout: 60_000 });
    for (let i = 0; i < POINTS.length; i += 1) {
      await expect(page.getByTestId(`focus-point-${i}`), `check 3: point ${i + 1} after reload`).toContainText(POINTS[i]);
    }
    await page.getByTestId('focus-points-edit').click({ timeout: STEP_MS });
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible({ timeout: STEP_MS });
    for (let i = 0; i < POINTS.length; i += 1) {
      await expect(page.getByTestId(`objective-point-label-${i}`), `check 3: Edit reopens point ${i + 1}`).toHaveValue(POINTS[i]);
    }
  } finally {
    // The throwaway account and every row it owns go with it (ON DELETE CASCADE); the stack itself is torn down after.
    if (uid) await admin.auth.admin.deleteUser(uid);
  }
});
