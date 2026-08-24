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
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          testid: element.dataset.testid ?? null,
          className: typeof element.className === 'string' ? element.className.slice(0, 160) : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollWidth: element.scrollWidth,
          text: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ?? '',
        };
      })
      .filter(({ left, right, width }) => width > 0 && (right > viewport + 1 || left < -1))
      .slice(0, 12);
    const unclippedOffenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || (rect.right <= viewport + 1 && rect.left >= -1)) return false;
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== document.body) {
          const overflowX = getComputedStyle(ancestor).overflowX;
          if (overflowX === 'hidden' || overflowX === 'clip' || overflowX === 'auto' || overflowX === 'scroll') {
            return false;
          }
          ancestor = ancestor.parentElement;
        }
        return true;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          testid: element.dataset.testid ?? null,
          className: typeof element.className === 'string' ? element.className.slice(0, 220) : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          text: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 100) ?? '',
        };
      })
      .slice(0, 20);
    return {
      viewport,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      scrollX: window.scrollX,
      bodyChildren: Array.from(document.body.children).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: typeof element.className === 'string' ? element.className.slice(0, 200) : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollWidth: element.scrollWidth,
          overflowX: getComputedStyle(element).overflowX,
        };
      }),
      carousels: Array.from(document.querySelectorAll<HTMLElement>('[aria-roledescription="carousel"]')).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollWidth: element.scrollWidth,
          overflowX: getComputedStyle(element).overflowX,
        };
      }),
      unclippedOffenders,
      offenders,
    };
  });
  expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
  expect(overflow.body, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
}

async function assertAxe(page: Page): Promise<void> {
  // Axe must inspect the settled product state, not a transient Framer opacity frame that blends text
  // toward its background and reports a contrast ratio the user never rests on.
  await page.waitForTimeout(600);
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

function eligibleProgressTruth() {
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
    formula_version: 'clarity_v1',
  };
  const reference = { ...current, session_id: REFERENCE_ID, clarity_raw: 82, filler_count: 7, wpm: 136,
    baseline_session_id: null, previous_comparable_session_id: null };
  return {
    evaluations: [current, reference],
    recommendations: [{
      id: 'recommendation-u3',
      source_session_id: SESSION_ID,
      formula_version: 'clarity_v1',
      target_metric: 'filler_rate',
      target_direction: 'decrease',
      target_value: 2,
      target_units: 'percent of words',
      shown_text: 'Close the next attempt with the requested decision and owner.',
    }],
    attempts: [],
    chronology: [
      { id: REFERENCE_ID, created_at: '2025-01-17T13:00:00.000Z' },
      { id: SESSION_ID, created_at: '2025-01-17T14:00:00.000Z' },
    ],
  };
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
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupE2EMocks(page, { userType: 'free' });
    await goToApp(page, '/');
    await expect(page.getByTestId('practice-root')).toBeVisible();
    await expect(page.getByText(/testimonial|customers (?:love|say)|trusted by/i)).toHaveCount(0);
    await assertAxe(page);
    await screenshotMatrix(page, 'marketing');
  });

  test('same saved session stays truthful across Practice, Session, History, Progress, Analytics and PDF', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const forbiddenCloudRequests: string[] = [];
    page.on('request', (request) => {
      if (/assemblyai|cloud[-_/]?token|realtime.*websocket|transcription\/token/i.test(request.url())) {
        forbiddenCloudRequests.push(request.url());
      }
    });

    await programmaticLoginWithRoutes(page, {
      userType: 'free',
      progressFixtures: eligibleProgressTruth(),
      sessions: [{
        id: SESSION_ID,
        user_id: 'test-user-123',
        created_at: '2025-01-17T14:00:00.000Z',
        duration: 420,
        title: 'U3 Cross-page Session',
        total_words: 245,
        engine: 'private',
        clarity_score: 88,
        wpm: 142,
        // #1306 metrics-only: flat filler_counts + one next_action_signal; NO transcript / transcript_state /
        // ai_suggestions cross any persistence or review surface.
        filler_counts: { um: 4 },
        status: 'completed',
        next_action_signal: {
          reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
          value: 4, comparator: 'above_target', templateVersion: 'rec_v1',
        },
      }],
    });

    await navigateToRoute(page, '/practice');
    await expect(page.getByTestId('practice-root')).toBeVisible();
    await assertAxe(page);
    await screenshotMatrix(page, 'practice');

    await navigateToRoute(page, '/session');
    await expect(page.getByTestId('mic-start')).toBeVisible();
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
    await expect(page.getByTestId('progress-direction')).toHaveText(/improved 7\.3% vs your previous comparable session/i);
    await expect(page.getByTestId('progress-baseline-context')).toHaveText(/previous comparable session is also your first-session baseline/i);
    await expect(page.getByTestId('progress-accept')).toHaveText(/Practice this next/i);
    await expect(page.getByText(/SpeakSharp Score/i)).toHaveCount(0);
    // #1306 Step 3: absence is correct HERE for a specific reason — this journey's session is seeded
    // with no transcript and no transcript_state (see the fixture above), so it is genuinely
    // not-captured rather than retained. Do not flip this to positive proof: a retained-transcript
    // assertion belongs on a session that actually produced one (saved-session-metrics-journey).
    // Assert the honest STATE, not just the absence, so a silently-empty pane cannot pass.
    await expect(page.getByTestId('session-detail-transcript')).toHaveCount(0);
    await expect(page.getByTestId('session-detail-transcript-unavailable')).toHaveCount(1);
    await expect(page.getByText(/same saved session truth with clear evidence/i)).toHaveCount(0);
    await expect(page.getByText('The saved-session evidence made the recommendation concrete.')).toHaveCount(0);
    // The ONE durable next action (from the server-owned Progress read model) still renders.
    await expect(page.getByTestId('progress-practice-next').getByText('Close the next attempt with the requested decision and owner.')).toBeVisible();
    await assertAxe(page);
    await screenshotMatrix(page, 'review-progress');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export PDF/i }).click();
    const download = await downloadPromise;
    const pdfPath = testInfo.outputPath('u3-session.pdf');
    await download.saveAs(pdfPath);
    const pdfText = await extractPdfText(pdfPath);
    expect(pdfText).toContain(SESSION_ID);
    // #1306 Step 3: this session has no retained transcript (not-captured, above), so the artifact
    // carries none — and free-form AI coaching prose stays excluded regardless of transcript state.
    // The retained-transcript-reaches-PDF claim is proven in saved-session-metrics-journey, against a
    // session that actually produced one.
    expect(pdfText).not.toContain('Today I presented the same saved session truth with clear evidence.');
    expect(pdfText).not.toContain('SpeakSharp Score');
    expect(pdfText).not.toContain('The saved-session evidence made the recommendation concrete.');
    expect(pdfText).toContain('Close the next attempt with the requested decision and owner.');
    expect(pdfText).toContain('Comparable Progress');
    expect(pdfText).toContain('improved 7.3% vs your previous comparable session');
    expect(forbiddenCloudRequests).toEqual([]);
  });
});
