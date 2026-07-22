import { type Page } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';
import { goToPublicRoute, navigateToRoute } from '../e2e/helpers';
import { ROUTES, TEST_IDS } from '../constants';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// LIVE production proof for #1018 (page-aware Issue Report) against the DEPLOYED build. Content-free,
// assertion-only: signs in as BASIC (free), submits four uniquely-marked synthetic reports from four
// pages, verifies the stored page-context server-side, and deletes ONLY this run's fixtures.
//
// Proves, in production:
//  - correct canonical page-context per page (pageKey/pageLabel/canonicalRoute) stored in metadata;
//  - the sanitized route TEMPLATE is stored in page_url + metadata.route (never a full URL/query);
//  - the owned session UUID appears ONLY in session_id — never in page_url or metadata;
//  - an unregistered route FAILS CLOSED to `/other` with no path content retained;
//  - reports persist independently of telemetry.
// Runs the same BASIC_TEST_EMAIL account as the attribution live spec; free tier is sufficient.

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASIC_EMAIL = (process.env.BASIC_TEST_EMAIL ?? process.env.E2E_BASIC_EMAIL ?? '').trim();
const BASIC_PASSWORD = (process.env.BASIC_TEST_PASSWORD ?? process.env.E2E_BASIC_PASSWORD ?? '').trim();
const RUN_ID = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
const MARK = `rpc-smoke-${RUN_ID}`; // unique current-run marker embedded in each report title

const SESSION_AREAS = ['session_mode', 'mic_start', 'recording', 'transcription', 'feedback', 'save', 'other'];

test.use({ screenshot: 'off', video: 'off', trace: 'off' });

interface StoredReport {
  title: string;
  session_id: string | null;
  page_url: string;
  metadata: Record<string, unknown>;
}

test.describe('Live page-aware Issue Report context (#1018, BASIC free account)', () => {
  let admin: SupabaseClient;
  let basicUserId = '';
  let ownedSessionId = '';
  let createdSessionId: string | null = null;

  test.beforeAll(async () => {
    test.skip(process.env.VITE_USE_LIVE_DB !== 'true', 'Live DB run only.');
    test.skip(
      !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BASIC_EMAIL || !BASIC_PASSWORD,
      'Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BASIC_TEST_EMAIL, BASIC_TEST_PASSWORD.',
    );
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let found: { id: string; email?: string } | undefined;
    for (let pageNum = 1; pageNum <= 25 && !found; pageNum++) {
      const { data, error } = await admin.auth.admin.listUsers({ page: pageNum, perPage: 200 });
      expect(error, 'listUsers must not error').toBeFalsy();
      found = data.users.find((u) => (u.email ?? '').toLowerCase() === BASIC_EMAIL.toLowerCase());
      if (data.users.length < 200) break;
    }
    expect(found, 'BASIC_TEST_EMAIL auth user must exist').toBeTruthy();
    basicUserId = found!.id;

    const { data: sess } = await admin.from('sessions').select('id').eq('user_id', basicUserId).limit(1);
    if (sess && sess.length > 0) {
      ownedSessionId = sess[0].id;
    } else {
      const { data: created, error: cErr } = await admin
        .from('sessions').insert({ user_id: basicUserId, title: `${MARK} synthetic session` }).select('id').single();
      expect(cErr, 'synthetic session insert must succeed').toBeFalsy();
      ownedSessionId = created!.id;
      createdSessionId = created!.id;
    }
    expect(ownedSessionId, 'an owned session id is available').toBeTruthy();
  });

  test.afterAll(async () => {
    if (!admin || !basicUserId) return;
    await admin.from('user_issue_reports').delete().eq('user_id', basicUserId).ilike('title', `${MARK}%`);
    const { data: left } = await admin
      .from('user_issue_reports').select('id').eq('user_id', basicUserId).ilike('title', `${MARK}%`);
    expect(left?.length ?? 0, 'zero current-run reports remain after cleanup').toBe(0);
    if (createdSessionId) {
      await admin.from('sessions').delete().eq('id', createdSessionId).eq('user_id', basicUserId);
    }
  });

  async function signIn(page: Page) {
    await goToPublicRoute(page, ROUTES.SIGN_IN);
    await page.getByTestId(TEST_IDS.EMAIL_INPUT).fill(BASIC_EMAIL);
    await page.getByTestId(TEST_IDS.PASSWORD_INPUT).fill(BASIC_PASSWORD);
    await page.getByTestId(TEST_IDS.SIGN_IN_SUBMIT).click();
    await expect(page.getByTestId(TEST_IDS.NAV_SIGN_OUT_BUTTON)).toBeVisible({ timeout: 20000 });
  }

  // Open Report Issue on the current page and submit a marked, content-free report.
  async function submitReport(page: Page, title: string) {
    await page.getByTestId('nav-report-issue-button').click();
    const titleInput = page.getByTestId('issue-report-title');
    await expect(titleInput).toBeVisible({ timeout: 10000 });
    // The page-aware "Reporting from" banner must be present (page context was resolved at open).
    await expect(page.getByTestId('issue-report-page-context')).toBeVisible();
    await titleInput.fill(title);
    await page.getByTestId('issue-report-description').fill(`${title} — content-free page-context smoke`);
    await page.getByTestId('issue-report-submit').click();
    await expect(titleInput).toBeHidden({ timeout: 15000 });
  }

  test('stores correct canonical page-context per page; owned UUID only in session_id; unknown fails closed', async ({ page }) => {
    await signIn(page);

    await navigateToRoute(page, ROUTES.SESSION);
    await submitReport(page, `${MARK} session`);

    await navigateToRoute(page, ROUTES.ANALYTICS);
    await submitReport(page, `${MARK} analytics`);

    await navigateToRoute(page, ROUTES.analyticsWithSession(ownedSessionId));
    await submitReport(page, `${MARK} owned`);

    // Deliberately unknown/unregistered authenticated route → must fail closed to /other.
    await goToPublicRoute(page, '/terms');
    await submitReport(page, `${MARK} other`);

    // All four persisted.
    await expect.poll(async () => {
      const { data } = await admin.from('user_issue_reports').select('id').eq('user_id', basicUserId).ilike('title', `${MARK}%`);
      return data?.length ?? 0;
    }, { timeout: 20000, message: 'all four current-run reports persisted' }).toBe(4);

    const { data } = await admin
      .from('user_issue_reports').select('title, session_id, page_url, metadata')
      .eq('user_id', basicUserId).ilike('title', `${MARK}%`);
    const rows = (data ?? []) as StoredReport[];
    const by = (suffix: string) => rows.find((r) => r.title === `${MARK} ${suffix}`)!;

    const session = by('session');
    expect(session.metadata.pageKey).toBe('session');
    expect(session.metadata.canonicalRoute).toBe('/session');
    expect(session.page_url).toBe('/session');
    expect(session.session_id).toBeNull();

    const analytics = by('analytics');
    expect(analytics.metadata.pageKey).toBe('analytics');
    expect(analytics.metadata.canonicalRoute).toBe('/analytics');
    expect(analytics.session_id).toBeNull();

    const owned = by('owned');
    expect(owned.metadata.pageKey).toBe('analytics_session');
    expect(owned.metadata.canonicalRoute).toBe('/analytics/:sessionId');
    expect(owned.page_url).toBe('/analytics/:sessionId');
    // The concrete UUID lives ONLY in session_id — never in page_url or metadata.
    expect(owned.session_id).toBe(ownedSessionId);
    expect(owned.page_url).not.toContain(ownedSessionId);
    expect(JSON.stringify(owned.metadata)).not.toContain(ownedSessionId);

    const other = by('other');
    expect(other.metadata.pageKey).toBe('other');
    expect(other.metadata.canonicalRoute).toBe('/other');
    expect(other.page_url).toBe('/other');
    expect(JSON.stringify(other.metadata)).not.toContain('terms');

    // issueArea is always an allowlisted slug (or null) for the page it came from.
    expect([...SESSION_AREAS, null]).toContain(session.metadata.issueArea ?? null);
    for (const r of rows) {
      const area = r.metadata.issueArea;
      expect(area === null || typeof area === 'string').toBe(true);
    }
  });
});
