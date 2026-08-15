import { type Page } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';
import { goToPublicRoute, navigateToRoute } from '../e2e/helpers';
import { ROUTES, TEST_IDS } from '../constants';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// LIVE production proof for PR #1014 (report→session attribution) on top of the PR #1015 DB ownership
// boundary. Content-free and assertion-only: it submits two uniquely-marked synthetic Issue Reports
// (transcript/audio OFF), verifies attribution server-side, and deletes ONLY this run's fixtures.
//
// Account: the dedicated FREE_TEST_EMAIL fixture (an ordinary authenticated user). Any authenticated user
// may file a report, and the DB trigger enforces session ownership regardless of entitlement. No
// billing/Pro/Cloud capability is used or asserted.

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FREE_EMAIL = (process.env.FREE_TEST_EMAIL ?? '').trim();
const FREE_PASSWORD = (process.env.FREE_TEST_PASSWORD ?? '').trim();
const RUN_ID = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
const MARK = `rsa-smoke-${RUN_ID}`; // unique current-run marker embedded in each report title

// Content-free DB assertion — no visual artifacts needed.
test.use({ screenshot: 'off', video: 'off', trace: 'off' });

test.describe('Live report→session attribution (free account)', () => {
  let admin: SupabaseClient;
  let freeUserId = '';
  let ownedSessionId = '';
  let createdSessionId: string | null = null; // set only if this run creates a synthetic session

  test.beforeAll(async () => {
    // Fail closed on missing production URL / credentials / service role.
    test.skip(process.env.VITE_USE_LIVE_DB !== 'true', 'Live DB run only.');
    test.skip(
      !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FREE_EMAIL || !FREE_PASSWORD,
      'Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FREE_TEST_EMAIL, FREE_TEST_PASSWORD.',
    );
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve the free auth user EXPLICITLY by email.
    let found: { id: string; email?: string } | undefined;
    for (let pageNum = 1; pageNum <= 25 && !found; pageNum++) {
      const { data, error } = await admin.auth.admin.listUsers({ page: pageNum, perPage: 200 });
      expect(error, 'listUsers must not error').toBeFalsy();
      found = data.users.find((u) => (u.email ?? '').toLowerCase() === FREE_EMAIL.toLowerCase());
      if (data.users.length < 200) break;
    }
    expect(found, `FREE_TEST_EMAIL auth user must exist`).toBeTruthy();
    freeUserId = found!.id;

    // Verify the profile exists and the account is effectively Free (NOT pro).
    const { data: prof, error: pErr } = await admin
      .from('user_profiles').select('subscription_status').eq('id', freeUserId).maybeSingle();
    expect(pErr, 'profile lookup must not error').toBeFalsy();
    expect(prof, 'free user_profiles row must exist').toBeTruthy();
    expect(prof!.subscription_status, 'free account must not be pro').not.toBe('pro');

    // Reuse an owned session if one exists; otherwise create ONE synthetic session for this run.
    const { data: sess, error: sErr } = await admin
      .from('sessions').select('id').eq('user_id', freeUserId).limit(1);
    expect(sErr, 'session lookup must not error').toBeFalsy();
    if (sess && sess.length > 0) {
      ownedSessionId = sess[0].id;
    } else {
      const { data: created, error: cErr } = await admin
        .from('sessions').insert({ user_id: freeUserId, title: `${MARK} synthetic session` })
        .select('id').single();
      expect(cErr, 'synthetic session insert must succeed').toBeFalsy();
      ownedSessionId = created!.id;
      createdSessionId = created!.id;
    }
    expect(ownedSessionId, 'an owned session id is available for the proof').toBeTruthy();
  });

  test.afterAll(async () => {
    if (!admin || !freeUserId) return;
    // Delete ONLY this run's marked reports (by user id + exact current-run marker).
    await admin.from('user_issue_reports').delete().eq('user_id', freeUserId).ilike('title', `${MARK}%`);
    const { data: leftReports } = await admin
      .from('user_issue_reports').select('id').eq('user_id', freeUserId).ilike('title', `${MARK}%`);
    expect(leftReports?.length ?? 0, 'zero current-run reports remain after cleanup').toBe(0);
    // Delete ONLY the synthetic session this run created (never a pre-existing session).
    if (createdSessionId) {
      await admin.from('sessions').delete().eq('id', createdSessionId).eq('user_id', freeUserId);
      const { data: leftSess } = await admin.from('sessions').select('id').eq('id', createdSessionId);
      expect(leftSess?.length ?? 0, 'synthetic session removed').toBe(0);
    }
  });

  async function signIn(page: Page) {
    await goToPublicRoute(page, ROUTES.SIGN_IN);
    await page.getByTestId(TEST_IDS.EMAIL_INPUT).fill(FREE_EMAIL);
    await page.getByTestId(TEST_IDS.PASSWORD_INPUT).fill(FREE_PASSWORD);
    await page.getByTestId(TEST_IDS.SIGN_IN_SUBMIT).click();
    await expect(page.getByTestId(TEST_IDS.NAV_SIGN_OUT_BUTTON)).toBeVisible({ timeout: 20000 });
  }

  async function submitReport(page: Page, title: string) {
    await page.getByTestId('nav-report-issue-button').click();
    const titleInput = page.getByTestId('issue-report-title');
    await expect(titleInput).toBeVisible({ timeout: 10000 });
    await titleInput.fill(title);
    // Transcript/audio inclusion default OFF — intentionally not toggled (content-free).
    await page.getByTestId('issue-report-description').fill(`${title} — content-free synthetic smoke report`);
    await page.getByTestId('issue-report-submit').click();
    // Dialog closes on success; the trigger returns to the nav.
    await expect(titleInput).toBeHidden({ timeout: 15000 });
  }

  test('owned-session route attaches the session; non-session route attaches NULL; both persist', async ({ page }) => {
    const ownedTitle = `${MARK} owned`;
    const nonSessionTitle = `${MARK} none`;

    await signIn(page);

    // (1) Owned session-specific Analytics route -> report should carry the owned session id.
    await navigateToRoute(page, ROUTES.analyticsWithSession(ownedSessionId));
    await submitReport(page, ownedTitle);

    // (2) Non-session route -> report should carry session_id = NULL.
    await navigateToRoute(page, ROUTES.ANALYTICS);
    await submitReport(page, nonSessionTitle);

    // Server-side attribution proof (exactly the two current-run reports).
    await expect
      .poll(async () => {
        const { data } = await admin
          .from('user_issue_reports').select('id').eq('user_id', freeUserId).ilike('title', `${MARK}%`);
        return data?.length ?? 0;
      }, { timeout: 20000, message: 'both current-run reports persisted' })
      .toBe(2);

    const { data: reports } = await admin
      .from('user_issue_reports')
      .select('id, user_id, session_id, title')
      .eq('user_id', freeUserId)
      .ilike('title', `${MARK}%`);

    expect(reports?.length, 'exactly two current-run reports').toBe(2);
    for (const r of reports!) {
      expect(r.user_id, 'every report belongs to the free account').toBe(freeUserId);
    }
    const owned = reports!.find((r) => r.title === ownedTitle);
    const none = reports!.find((r) => r.title === nonSessionTitle);
    expect(owned?.session_id, 'owned-route report stores the exact owned session id').toBe(ownedSessionId);
    expect(none?.session_id, 'non-session report stores NULL').toBeNull();
  });
});
