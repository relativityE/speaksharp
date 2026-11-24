import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { goToApp, mockLiveTranscript, navigateToRoute, programmaticLoginWithRoutes, startRecording, stopRecording } from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

// #1863 J1.e and J1.f in a real browser: the real App, router, auth provider, TrialServiceBoundary and recorder.
// Only the server is mocked (the in-page Supabase double): its entitlement answer and the save RPC's refusal are set
// exactly as the database answers once an unpaid trial has ended. No real account, payment or Stripe call is involved.
type E2EWindow = Window & {
  __E2E_USAGE_LIMIT_1863__?: Record<string, unknown>;
  __E2E_RPC_ANSWER_1863__?: Record<string, { data: unknown; error: unknown }>;
  __E2E_RPC_CALLS_1476__?: Record<string, number>;
  queryClient?: {
    invalidateQueries: (filters: { queryKey: unknown[] }) => Promise<void>;
    getQueryCache: () => { findAll: (filters: { queryKey: unknown[] }) => Array<{ state: { data?: { can_start?: boolean } } }> };
  };
};

const EXPIRED = { can_start: false, trial_active: false, error: 'trial_expired', trial_seconds_remaining: 0 };

type Answer = { data: unknown; error: unknown };
type SupabaseDouble = {
  functions: { invoke: (name: string, options?: unknown) => Promise<{ data?: unknown; error?: unknown }> };
  rpc: (fn: string, args?: unknown) => Promise<unknown>;
};

/**
 * Sets the server's answers in the page's own Supabase double (`window.supabase`, installed by the e2e manifest's init
 * script; `getSupabaseClient()` prefers it), so no shared helper changes. Registered after login, this init script runs
 * after the manifest's on every document and wraps two calls, each read live so a test can change it mid-page:
 * - `check-usage-limit`: the manifest's answer with `window.__E2E_USAGE_LIMIT_1863__` laid over it (starts as `usageLimit`).
 * - a named RPC: while `window.__E2E_RPC_ANSWER_1863__[fn]` is set, it is counted in `__E2E_RPC_CALLS_1476__` as the
 *   double counts every RPC, and answered exactly as the database answers once an unpaid trial has ended.
 */
async function setServerAnswers(page: Page, usageLimit: Record<string, unknown>) {
  await page.addInitScript((initial) => {
    const win = window as E2EWindow & { __SERVER_ANSWERS_1863__?: boolean };
    const supabase = (window as unknown as { supabase?: SupabaseDouble }).supabase;
    if (!supabase || win.__SERVER_ANSWERS_1863__) return;
    win.__SERVER_ANSWERS_1863__ = true;
    win.__E2E_USAGE_LIMIT_1863__ = initial;
    const invoke = supabase.functions.invoke.bind(supabase.functions);
    supabase.functions.invoke = async (name, options) => {
      const result = await invoke(name, options);
      const override = win.__E2E_USAGE_LIMIT_1863__;
      if (name !== 'check-usage-limit' || !override || !result?.data || typeof result.data !== 'object') return result;
      return { ...result, data: { ...(result.data as Record<string, unknown>), ...override } };
    };
    const rpc = supabase.rpc.bind(supabase);
    supabase.rpc = async (fn, args) => {
      const answer: Answer | undefined = win.__E2E_RPC_ANSWER_1863__?.[fn];
      if (!answer) return rpc(fn, args);
      win.__E2E_RPC_CALLS_1476__ = { ...(win.__E2E_RPC_CALLS_1476__ ?? {}), [fn]: (win.__E2E_RPC_CALLS_1476__?.[fn] ?? 0) + 1 };
      return answer;
    };
  }, usageLimit);
}

/** Every cached entitlement answer on the page says access is refused. */
async function waitForRefusedEntitlement(page: Page) {
  await page.waitForFunction(() => {
    const answered = ((window as E2EWindow).queryClient?.getQueryCache().findAll({ queryKey: ['usageLimit'] }) ?? [])
      .filter((q) => q.state.data !== undefined);
    return answered.length > 0 && answered.every((q) => q.state.data?.can_start === false);
  }, undefined, { timeout: 10_000 });
}

/**
 * J1.e's refused save is reported by three authored, content-free console errors that the shared monitor does not
 * allow, so it would fail the test before its final checks. For J1.e only, this swaps in the same rule with those three
 * added: each is matched by its exact shape and COUNTED (the test asserts the counts), every error the shared rule
 * allows is still allowed, and any other console error is collected and must be empty. `pageerror` is untouched.
 */
// The shared monitor's allowance in tests/e2e/fixtures.ts, copied verbatim so this spec changes no shared helper.
// Keep the two lists identical.
const SHARED_NON_FATAL_MARKERS = [
  'NET::ERR_', 'FAILED TO LOAD RESOURCE', '404', '500', 'FETCH', 'TRANSCRIPTION ERROR', 'TRANSCRIPTIONSERVICE',
  'ENSUREENGINEINITIALIZED', 'NETWORK_TIMEOUT', 'ABORT', 'TRIAL', 'RPC', 'HEARTBEAT', 'PROFILE', 'USERPROFILE',
  'FAILED_VISIBLE', 'DISTRIBUTEDLOCK',
] as const;
const isSharedNonFatal = (text: string) => SHARED_NON_FATAL_MARKERS.some((marker) => text.toUpperCase().includes(marker));
const REFUSED_SAVE_DIAGNOSTICS = {
  // The storage boundary rejects the { success: false, error: 'trial_expired' } envelope (logs its type only).
  unusableEnvelope: /^\{sessionId: session-[^,}]+, receivedType: object\} \[Supabase DB\] 🏁 Session completion returned an unusable result envelope$/,
  // The failed Stop, once: the controller's catch and the page's stop handler.
  stopErrorCaught: /^\{err: Error: SESSION_COMPLETION_FAILED[\s\S]*\} \[DEBUG-STOP\] ERROR caught$/,
  lifecycleStopError: /^\{err: Error: SESSION_COMPLETION_FAILED[\s\S]*\} \[useSessionLifecycle\] Error stopping recording$/,
} as const;
type RefusedSaveCounts = Record<keyof typeof REFUSED_SAVE_DIAGNOSTICS, number>;

function guardRefusedSaveConsole(page: Page): { counts: () => RefusedSaveCounts; unexpected: () => string[] } {
  page.removeAllListeners('console');
  const counts: RefusedSaveCounts = { unusableEnvelope: 0, stopErrorCaught: 0, lifecycleStopError: 0 };
  const unexpected: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const kind = (Object.keys(REFUSED_SAVE_DIAGNOSTICS) as Array<keyof typeof REFUSED_SAVE_DIAGNOSTICS>)
      .find((k) => REFUSED_SAVE_DIAGNOSTICS[k].test(text));
    if (kind) counts[kind] += 1;
    else if (isSharedNonFatal(text)) console.warn(`[E2E_NON_FATAL_LOG] ${text}`);
    else unexpected.push(text.slice(0, 200));
  });
  return { counts: () => ({ ...counts }), unexpected: () => [...unexpected] };
}

test.describe('#1863 payment wall in the browser', () => {
  test('J1.f: an expired unpaid user meets the wall on product pages and can still reach deletion and billing', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free', mockProfile: EXPIRED });
    await setServerAnswers(page, EXPIRED);

    // goToApp, not navigateToRoute: the route helper waits for the page's own content, which the wall replaces.
    for (const route of ['/practice', '/session', '/progress']) {
      await goToApp(page, route);
      const wall = page.getByTestId('trial-payment-wall');
      await expect(wall).toBeVisible();
      await expect(wall.getByRole('heading', { name: 'Your free trial has ended' })).toBeVisible();
      await expect(page.getByTestId('practice-root')).toHaveCount(0);
      await expect(page.getByTestId('session-page')).toHaveCount(0);
      await expect(page.getByTestId('analytics-dashboard')).toHaveCount(0);
    }

    // The wall's own link opens the deletion page, and the wall does not follow the user there.
    await page.getByTestId('trial-payment-wall').getByRole('link', { name: 'Delete account' }).click();
    await expect(page.getByTestId('account-deletion-page')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);

    // Account and pricing stay outside the wall, and actually render.
    await navigateToRoute(page, '/account');
    await expect(page.getByTestId('account-page')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);
    await navigateToRoute(page, '/pricing');
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);
  });

  test('J1.e: a take cut off when the trial ends says "not saved", and Delete account still opens deletion', async ({ page }) => {
    // The trial is active with an hour left, so the take starts while the server confirms access and the page's
    // own deadline cannot fire during the test.
    const consoleGuard = guardRefusedSaveConsole(page);
    await programmaticLoginWithRoutes(page, { userType: 'free', mockProfile: { can_start: true, trial_active: true, trial_seconds_remaining: 3600 } });
    await setServerAnswers(page, { trial_seconds_remaining: 3600 });
    await navigateToRoute(page, '/session');
    await startRecording(page);
    await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('recorder-stop')).toBeVisible();

    // The trial ends mid-take. The server now refuses access and refuses the save, as the database does, and the page
    // asks the server again (as its recheck timer would), so the boundary sees the refusal while the take is live.
    await page.evaluate(async (expired) => {
      const win = window as E2EWindow;
      win.__E2E_USAGE_LIMIT_1863__ = expired;
      win.__E2E_RPC_ANSWER_1863__ = { complete_session_v2: { data: { success: false, error: 'trial_expired' }, error: null } };
      await win.queryClient?.invalidateQueries({ queryKey: ['usageLimit'] });
    }, EXPIRED);
    await waitForRefusedEntitlement(page);

    // The refusal is known, yet the page is kept for the live take: the wall must not cut the recorder off mid-take.
    await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING');
    await expect(page.getByTestId('session-page')).toBeVisible();
    await expect(page.getByTestId('recorder-stop')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);

    // Past the 5 s minimum, so the stop really asks the server to save the take (a shorter take is discarded unsent).
    await page.waitForTimeout(5_200);
    const savesBefore = await page.evaluate(() => (window as E2EWindow).__E2E_RPC_CALLS_1476__?.complete_session_v2 ?? 0);
    await stopRecording(page);
    await expect.poll(
      () => page.evaluate(() => (window as E2EWindow).__E2E_RPC_CALLS_1476__?.complete_session_v2 ?? 0),
      { timeout: 15_000 },
    ).toBeGreaterThan(savesBefore);

    // Once the take ends unsaved, the wall replaces the page and says so.
    const wall = page.getByTestId('trial-payment-wall');
    await expect(wall).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('trial-take-not-saved')).toHaveText(
      'The recording in progress when your free trial ended was not saved.',
    );
    await expect(page.getByTestId('session-page')).toHaveCount(0);

    await wall.getByRole('link', { name: 'Delete account' }).click();
    await expect(page.getByTestId('account-deletion-page')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);

    await expect.poll(() => consoleGuard.counts(), { message: 'one refused save, one failed Stop', timeout: 10_000 })
      .toEqual({ unusableEnvelope: 1, stopErrorCaught: 1, lifecycleStopError: 1 });
    expect(consoleGuard.unexpected(), 'no console error beyond the refused save\'s own diagnostics and the shared allowances').toEqual([]);
  });
});

// J1.f / J7.d fail closed in a real browser: the real App route renders the deletion page with no completion readiness,
// so even when the server reports the owner's pending deletion as settled and the secured status read succeeds, the page
// offers no permanent-deletion confirmation and sends no completion effect. Every closure request, in-page or on the
// network, bare `/functions/v1/account-closure` or any sub-path, is answered or refused here; nothing reaches a real
// project, and nothing is deleted.
const PENDING_REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const PENDING_SETTLED = { outcome: 'pending', requestId: PENDING_REQUEST_ID, phase: 'pending', destructiveEnabled: false, checkoutPending: 0 };
/** Both URL forms: the bare closure function and every sub-path (completion-status, completion-execute, anything else). */
const CLOSURE_ROUTE = /\/functions\/v1\/account-closure(?:[/?#]|$)/;
type ClosureCall = { origin: string; path: string; action: unknown };
type ClosureNetwork = { completion: () => ClosureCall[]; readiness: () => ClosureCall[]; status: () => ClosureCall[]; refused: () => ClosureCall[] };
type ClosureWindow = Window & { __CLOSURE_ACTIONS_J7D__?: unknown[]; __CLOSURE_ANSWER_J7D__?: boolean };

/**
 * Answers the owner's deletion as pending and settled. In the page, the Supabase double's `account-closure` call is
 * wrapped whenever a client is installed, even one assigned after this script runs, so the wrapper cannot be skipped.
 * On the network, one route takes both URL forms: completion-status reads and a bare status call are answered; every
 * other closure request (an effect, a confirm, anything unknown) is refused with 403 and recorded.
 */
async function answerSettledPendingDeletion(page: Page): Promise<ClosureNetwork> {
  await page.addInitScript((pending) => {
    const win = window as ClosureWindow;
    if (win.__CLOSURE_ANSWER_J7D__) return;
    win.__CLOSURE_ANSWER_J7D__ = true;
    win.__CLOSURE_ACTIONS_J7D__ = [];
    const patched = new WeakSet<object>();
    const patch = (client: SupabaseDouble | undefined) => {
      if (!client || patched.has(client)) return;
      patched.add(client);
      const invoke = client.functions.invoke.bind(client.functions);
      client.functions.invoke = async (name, options) => {
        if (name !== 'account-closure') return invoke(name, options);
        const action = (options as { body?: { action?: unknown } } | undefined)?.body?.action;
        win.__CLOSURE_ACTIONS_J7D__?.push(action);
        return action === 'status' ? { data: pending, error: null } : { data: null, error: { message: 'closure action refused by the test' } };
      };
    };
    let client = (window as unknown as { supabase?: SupabaseDouble }).supabase;
    patch(client);
    Object.defineProperty(window, 'supabase', {
      configurable: true, get: () => client,
      set: (next: SupabaseDouble) => { client = next; patch(client); },
    });
  }, PENDING_SETTLED);
  const completion: ClosureCall[] = [];
  const readiness: ClosureCall[] = [];
  const status: ClosureCall[] = [];
  const refused: ClosureCall[] = [];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  await page.route(CLOSURE_ROUTE, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let action: unknown = null;
    try { action = (JSON.parse(request.postData() ?? '') as { action?: unknown }).action; } catch { /* recorded as null */ }
    const url = new URL(request.url());
    const call = { origin: url.origin, path: url.pathname, action };
    const completionReply = !url.pathname.endsWith('/functions/v1/account-closure/completion-status') ? null
      : action === 'completion_status_issue'
        ? { outcome: 'status_capability', requestId: PENDING_REQUEST_ID, token: 'b'.repeat(64), expiresAt: Date.now() + 60_000 }
        : action === 'completion_status_ack' ? { outcome: 'status_acknowledged', requestId: PENDING_REQUEST_ID }
          : action === 'completion_status_read' ? { outcome: 'pending', requestId: PENDING_REQUEST_ID, reason: 'ready', canRetry: false }
            : null;
    if (completionReply) { completion.push(call); return route.fulfill({ status: 200, headers: cors, json: completionReply }); }
    // #1903: a 'ready' pending read makes the page ask the server's readiness decision. That READ is answered here as
    // unavailable (no execution grant), separately from any effect, so the page has no way to complete.
    if (url.pathname.endsWith('/functions/v1/account-closure/completion-status') && action === 'completion_readiness') {
      readiness.push(call);
      return route.fulfill({ status: 200, headers: cors, json: { outcome: 'unavailable', canRetry: false } });
    }
    if (url.pathname.endsWith('/functions/v1/account-closure') && action === 'status') {
      status.push(call);
      return route.fulfill({ status: 200, headers: cors, json: PENDING_SETTLED });
    }
    refused.push(call);
    return route.fulfill({ status: 403, headers: cors, json: { outcome: 'refused_by_test' } });
  });
  return { completion: () => [...completion], readiness: () => [...readiness], status: () => [...status], refused: () => [...refused] };
}

async function expectSettledButNotCompletable(page: Page, closure: ClosureNetwork) {
  const deletion = page.getByTestId('account-deletion-page');
  await expect(deletion).toBeVisible();
  // The secured status path ran to the end: the page shows the settled read it obtained.
  await expect(deletion.getByTestId('account-completion-status')).toContainText('Earlier work is settled. Deletion has not started.');
  expect(closure.completion().map((c) => c.action)).toEqual(['completion_status_issue', 'completion_status_ack', 'completion_status_read']);
  // The page asked the server's readiness decision (a read) and was told unavailable; wait for that before judging effects.
  await expect.poll(() => closure.readiness().length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(closure.readiness().every((c) => c.path.endsWith('/functions/v1/account-closure/completion-status'))).toBe(true);
  // ...and still no way to complete: no confirmation, no button, no effect, and no closure request the test refused.
  await expect(deletion.getByRole('checkbox', { name: 'I confirm permanent account deletion now, with no refund.' })).toHaveCount(0);
  await expect(deletion.getByRole('button', { name: 'Complete permanent account deletion' })).toHaveCount(0);
  expect(closure.refused()).toEqual([]);
  // The in-page wrapper was installed and saw only status reads (a skipped install would leave this empty).
  const actions = await page.evaluate(() => (window as ClosureWindow).__CLOSURE_ACTIONS_J7D__ ?? []);
  expect(actions.length + closure.status().length).toBeGreaterThan(0);
  expect(actions.every((a) => a === 'status')).toBe(true);

  // Control: a direct write to the BARE closure path from this page is caught by the same route and refused, so a
  // real closure request could not have left the browser unseen.
  const origin = closure.completion()[0].origin;
  const answered = await page.evaluate(async (url) => (await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }),
  })).status, `${origin}/functions/v1/account-closure`);
  expect(answered).toBe(403);
  expect(closure.refused()).toEqual([{ origin, path: '/functions/v1/account-closure', action: 'confirm' }]);
}

test.describe('J1.f / J7.d deletion fails closed from both entry routes', () => {
  test('J1.f: from the wall, a settled pending deletion is shown but cannot be completed', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free', mockProfile: EXPIRED });
    await setServerAnswers(page, EXPIRED);
    const closure = await answerSettledPendingDeletion(page);
    await goToApp(page, '/practice');
    const wall = page.getByTestId('trial-payment-wall');
    await expect(wall).toBeVisible();
    await wall.getByRole('link', { name: 'Delete account' }).click();
    await expect(page).toHaveURL(/\/account\/delete$/);
    await expectSettledButNotCompletable(page, closure);
  });

  test('J7.d: during an active trial, Account → Delete account shows a settled pending deletion that cannot be completed', async ({ page }) => {
    const ACTIVE = { can_start: true, trial_active: true, trial_seconds_remaining: 3600 };
    await programmaticLoginWithRoutes(page, { userType: 'free', mockProfile: ACTIVE });
    await setServerAnswers(page, ACTIVE);
    const closure = await answerSettledPendingDeletion(page);
    await navigateToRoute(page, '/account');
    const account = page.getByTestId('account-page');
    await expect(account).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => ((window as E2EWindow).queryClient?.getQueryCache()
      .findAll({ queryKey: ['usageLimit'] }) ?? []).some((q) => q.state.data?.can_start === true)), { timeout: 10_000 }).toBe(true);
    await account.getByRole('link', { name: 'Delete account' }).click();
    await expect(page).toHaveURL(/\/account\/delete$/);
    await expectSettledButNotCompletable(page, closure);
  });
});
