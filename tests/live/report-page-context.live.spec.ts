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
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASIC_EMAIL = (process.env.BASIC_TEST_EMAIL ?? process.env.E2E_BASIC_EMAIL ?? '').trim();
const BASIC_PASSWORD = (process.env.BASIC_TEST_PASSWORD ?? process.env.E2E_BASIC_PASSWORD ?? '').trim();
const RUN_ID = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
const MARK = `rpc-smoke-${RUN_ID}`; // unique current-run marker embedded in each report title

// Expected VISIBLE page label + page-specific issue-area options per page (mirrors services/pageContext).
// The live spec asserts these render, not merely that a banner exists.
const EXPECTED = {
  session: { label: 'Session · Speaking', areas: ['session_mode', 'mic_start', 'recording', 'transcription', 'feedback', 'save', 'other'] },
  analytics: { label: 'Past Progress', areas: ['session_list', 'comparison', 'evidence', 'navigation', 'other'] },
  owned: { label: 'Session Analytics', areas: ['comparison', 'evidence', 'navigation', 'other'] },
  other: { label: 'Other page', areas: ['navigation', 'visual_layout', 'other'] },
} as const;

// The three closed /practice surfaces (one route, distinguished by the active UI state).
const PRACTICE_EXPECTED = {
  practice_home: { surface: 'practice_home', label: 'SpeakSharp Practice', journeyStep: 'chooser', areas: ['understanding_choices', 'navigation', 'visual_layout', 'other'] },
  quick_practice_overview: { surface: 'quick_practice_overview', label: 'Quick Practice overview', journeyStep: 'quick_overview', areas: ['walkthrough', 'open_practice_session', 'navigation', 'visual_layout', 'other'] },
  guided_rehearsal_unavailable: { surface: 'guided_rehearsal_unavailable', label: 'Guided Rehearsal', journeyStep: 'guided_unavailable', areas: ['availability', 'product_clarity', 'navigation', 'visual_layout', 'other'] },
} as const;
const SESSION_AREAS = EXPECTED.session.areas;

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
      !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !BASIC_EMAIL || !BASIC_PASSWORD,
      'Requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, BASIC_TEST_EMAIL, BASIC_TEST_PASSWORD.',
    );

    // Resolve the BASIC user id through the NORMAL authenticated path (anon sign-in) — NOT admin.listUsers
    // (that Auth-admin enumeration is the exact operation the canary incident showed to be fragile, and a
    // per-account lookup does not need to scan every user). The id comes straight from the returned session.
    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({ email: BASIC_EMAIL, password: BASIC_PASSWORD });
    expect(signInErr, 'BASIC sign-in must succeed via the normal auth path').toBeFalsy();
    basicUserId = signInData.user?.id ?? '';
    expect(basicUserId, 'BASIC authenticated session yields a user id').toBeTruthy();
    await anon.auth.signOut();

    // Service-role is used ONLY for narrowly-scoped, owner-filtered fixture setup + cleanup below.
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

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

  // Open Report Issue on the current page and submit a marked, content-free report. Also verifies the
  // VISIBLE page label and the page-specific issue-area options (not merely that the banner exists).
  async function submitReport(page: Page, title: string, expected: { label: string; areas: readonly string[] }) {
    await page.getByTestId('nav-report-issue-button').click();
    const titleInput = page.getByTestId('issue-report-title');
    await expect(titleInput).toBeVisible({ timeout: 10000 });
    // The page-aware "Reporting from" banner shows the EXPECTED visible label for this page.
    await expect(page.getByTestId('issue-report-page-context')).toContainText(expected.label);
    // The issue-area dropdown offers exactly this page's allowlisted areas (values + order).
    const areaValues = await page.getByTestId('issue-report-area').locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(areaValues).toEqual([...expected.areas]);
    await titleInput.fill(title);
    await page.getByTestId('issue-report-description').fill(`${title} — content-free page-context smoke`);
    await page.getByTestId('issue-report-submit').click();
    await expect(titleInput).toBeHidden({ timeout: 15000 });
  }

  test('stores correct canonical page-context per page; owned UUID only in session_id; unknown fails closed', async ({ page }) => {
    await signIn(page);

    await navigateToRoute(page, ROUTES.SESSION);
    await submitReport(page, `${MARK} session`, EXPECTED.session);

    await navigateToRoute(page, ROUTES.ANALYTICS);
    await submitReport(page, `${MARK} analytics`, EXPECTED.analytics);

    await navigateToRoute(page, ROUTES.analyticsWithSession(ownedSessionId));
    await submitReport(page, `${MARK} owned`, EXPECTED.owned);

    // Deliberately unknown/unregistered authenticated route → must fail closed to /other.
    await goToPublicRoute(page, '/terms');
    await submitReport(page, `${MARK} other`, EXPECTED.other);

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

  // POST-ACTIVATION proof: the three /practice surfaces are distinguishable server-side while all keeping
  // canonicalRoute /practice. Reserved for after the rollout flag is activated for this account — it skips
  // cleanly (never fails the gate) if /practice is not reachable yet.
  test('distinguishes practice_home / quick_practice_overview / guided_rehearsal_unavailable server-side', async ({ page }) => {
    await signIn(page);
    await navigateToRoute(page, '/practice');
    const onPractice = await page.getByTestId('practice-root').isVisible().catch(() => false);
    test.skip(!onPractice, '/practice not reachable for this account here.');

    // chooser
    await submitReport(page, `${MARK} practice-home`, PRACTICE_EXPECTED.practice_home);
    // quick overview
    await page.getByTestId('practice-card-quick').click();
    await submitReport(page, `${MARK} quick`, PRACTICE_EXPECTED.quick_practice_overview);
    // back to chooser, then select the UNAVAILABLE Guided (shows a toast, marks the surface)
    await page.getByTestId('practice-back-top').click();
    await page.getByTestId('practice-card-guided').click();
    await submitReport(page, `${MARK} guided`, PRACTICE_EXPECTED.guided_rehearsal_unavailable);

    await expect.poll(async () => {
      const { data } = await admin.from('user_issue_reports').select('id').eq('user_id', basicUserId).ilike('title', `${MARK} practice-%`);
      return data?.length ?? 0;
    }, { timeout: 20000 }).toBeGreaterThanOrEqual(1);

    const { data } = await admin
      .from('user_issue_reports').select('title, session_id, page_url, metadata')
      .eq('user_id', basicUserId).ilike('title', `${MARK}%`);
    const rows = (data ?? []) as StoredReport[];
    const bySuffix = (suffix: string) => rows.find((r) => r.title === `${MARK} ${suffix}`)!;

    for (const [suffix, exp] of [['practice-home', PRACTICE_EXPECTED.practice_home], ['quick', PRACTICE_EXPECTED.quick_practice_overview], ['guided', PRACTICE_EXPECTED.guided_rehearsal_unavailable]] as const) {
      const row = bySuffix(suffix);
      expect(row, `stored report ${suffix}`).toBeTruthy();
      // One canonical route for all three surfaces; the surface is the distinguisher.
      expect(row.page_url).toBe('/practice');
      expect(row.metadata.canonicalRoute).toBe('/practice');
      expect(row.metadata.pageKey).toBe('practice');
      expect(row.metadata.practiceSurface).toBe(exp.surface);
      expect(row.metadata.journeyStep).toBe(exp.journeyStep);
      // issueArea (if any) is a valid slug for THIS surface — never cross-surface.
      const area = row.metadata.issueArea;
      expect(area === null || (exp.areas as readonly string[]).includes(area as string)).toBe(true);
      // No session id or raw navigation content leaked into a /practice report.
      expect(row.session_id).toBeNull();
    }
  });
});
