import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { test, expect, type Page } from '@playwright/test';
import { setupE2EMocks } from './mock-routes';
import { goToApp, navigateToRoute, programmaticLoginWithRoutes, waitForFeature } from './helpers';

const SHOTS = 'test-results/1047-u3-cross-page';
const SESSION_ID = 'session-4';
const REFERENCE_ID = 'session-3';
const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 800 },
  { name: 'tablet-768', width: 768, height: 900 },
  { name: 'desktop-1280', width: 1280, height: 900 },
] as const;

async function assertNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
  expect(overflow.body, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
}

async function assertAxe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

async function screenshotMatrix(page: Page, surface: string): Promise<void> {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertNoOverflow(page);
    await page.screenshot({ path: `${SHOTS}/${surface}-${viewport.name}.png`, fullPage: true });
  }
}

async function installEligibleProgressTruth(page: Page): Promise<void> {
  const current = {
    session_id: SESSION_ID,
    eligible: true,
    exclusion_reasons: [],
    clarity_raw: 88,
    filler_count: 4,
    wpm: 142,
    word_count: 245,
    cohort_key: 'private|v2|base|clarity_v1',
    baseline_session_id: REFERENCE_ID,
    previous_comparable_session_id: REFERENCE_ID,
  };
  const reference = { ...current, session_id: REFERENCE_ID, clarity_raw: 82, filler_count: 7, wpm: 136,
    baseline_session_id: null, previous_comparable_session_id: null };

  await page.route(/\/rest\/v1\/session_progress_evaluations(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const ids = url.searchParams.get('session_id') ?? '';
    const isReferenceRead = ids.startsWith('in.');
    await route.fulfill({
      status: 200,
      contentType: isReferenceRead ? 'application/json' : 'application/vnd.pgrst.object+json',
      body: JSON.stringify(isReferenceRead ? [reference] : current),
    });
  });
  await page.route(/\/rest\/v1\/progress_recommendations(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/vnd.pgrst.object+json',
    body: JSON.stringify({ id: 'recommendation-u3' }),
  }));
  await page.route(/\/rest\/v1\/progress_recommendation_attempts(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/vnd.pgrst.object+json',
    body: 'null',
  }));
  await page.route(/\/rest\/v1\/sessions(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const select = url.searchParams.get('select') ?? '';
    if (!select.includes('created_at') || !select.includes('id')) return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: REFERENCE_ID, created_at: '2025-01-15T09:00:00.000Z' },
        { id: SESSION_ID, created_at: '2025-01-17T14:00:00.000Z' },
      ]),
    });
  });
}

async function extractPdfText(path: string): Promise<string> {
  const data = new Uint8Array(await readFile(path));
  const pdf = await getDocument({ data }).promise;
  const chunks: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    chunks.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
  }
  return chunks.join('\n');
}

test.describe('#1047 U3 canonical cross-page truth', () => {
  test('Marketing is testimonial-free, accessible, and has no viewport overflow', async ({ page }) => {
    await setupE2EMocks(page, { userType: 'free' });
    await goToApp(page, '/');
    await expect(page.getByTestId('practice-root')).toBeVisible();
    await expect(page.getByText(/testimonial|customers (?:love|say)|trusted by/i)).toHaveCount(0);
    await assertAxe(page);
    await screenshotMatrix(page, 'marketing');
  });

  test('same saved session stays truthful across Practice, Session, History, Progress, Analytics and PDF', async ({ page }, testInfo) => {
    const forbiddenCloudRequests: string[] = [];
    page.on('request', (request) => {
      if (/assemblyai|cloud[-_/]?token|realtime.*websocket|transcription\/token/i.test(request.url())) {
        forbiddenCloudRequests.push(request.url());
      }
    });

    await programmaticLoginWithRoutes(page, {
      userType: 'free',
      sessions: [{
        id: SESSION_ID,
        user_id: 'test-user-123',
        created_at: '2025-01-17T14:00:00.000Z',
        duration: 420,
        transcript_state: 'available',
        transcript: 'Today I presented the same saved session truth with clear evidence.',
        title: 'U3 Cross-page Session',
        total_words: 245,
        engine: 'private',
        clarity_score: 88,
        wpm: 142,
        filler_words: { um: { count: 4 }, total: { count: 4 } },
      }],
    });
    await installEligibleProgressTruth(page);

    await navigateToRoute(page, '/practice');
    await expect(page.getByTestId('practice-root')).toBeVisible();
    await assertAxe(page);
    await screenshotMatrix(page, 'practice');

    await navigateToRoute(page, '/session');
    await expect(page.getByTestId('session-start-stop-button')).toBeVisible();
    await assertAxe(page);
    await screenshotMatrix(page, 'session');

    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');
    const history = page.getByTestId(`session-history-item-${SESSION_ID}`);
    await expect(history).toContainText('U3 Cross-page Session');
    await screenshotMatrix(page, 'history');

    await navigateToRoute(page, `/analytics/${SESSION_ID}`);
    await expect(page.getByTestId('progress-panel')).toBeVisible();
    await expect(page.getByTestId('progress-what-worked')).toHaveCount(1);
    await expect(page.getByTestId('progress-practice-next')).toHaveCount(1);
    await expect(page.getByTestId('progress-accept')).toHaveText(/Practice this next/i);
    await expect(page.getByText(/SpeakSharp Score/i)).toHaveCount(0);
    await expect(page.getByText(/same saved session truth with clear evidence/i)).toBeVisible();
    await assertAxe(page);
    await screenshotMatrix(page, 'review-progress');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export PDF/i }).click();
    const download = await downloadPromise;
    const pdfPath = testInfo.outputPath('u3-session.pdf');
    await download.saveAs(pdfPath);
    const pdfText = await extractPdfText(pdfPath);
    expect(pdfText).toContain(SESSION_ID);
    expect(pdfText).toContain('Today I presented the same saved session truth with clear evidence.');
    expect(pdfText).not.toContain('SpeakSharp Score');
    expect(pdfText).not.toContain('Coaching Suggestion');
    expect(forbiddenCloudRequests).toEqual([]);
  });
});
