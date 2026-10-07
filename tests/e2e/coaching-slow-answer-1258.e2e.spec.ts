import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { navigateToRoute, programmaticLoginWithRoutes, simulateTranscription, startRecording, stopRecording } from './helpers';

/**
 * #1258 (RWT runs 37547966019 and 37550720328) — a SLOW coaching answer must still reach the card.
 *
 * Production received exactly one coaching request per saved take and answered it (+8 s, +25 s), but the card stayed on
 * "Your review is on its way". This journey drives the real session page through Stop → save → the automatic request,
 * with the E2E double answering only after `delayMs`, and records the card's published review state the whole time.
 */
const PAIR = { version: 'gemini_coaching_v1', what_worked: 'You opened with a clear plan.', what_to_try_next: 'Pause before each of the three steps.' };

async function watchCard(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __cardStates?: string[] };
    w.__cardStates = [];
    const sample = () => {
      const card = document.querySelector('[data-testid="ai-suggestions-card"]');
      const v = card ? `${card.getAttribute('data-review-state')}|${card.getAttribute('data-lifecycle')}` : 'absent';
      if (w.__cardStates!.at(-1) !== v) w.__cardStates!.push(v);
    };
    setInterval(sample, 100);
  });
}
const cardStates = (page: Page) => page.evaluate(() => (window as unknown as { __cardStates?: string[] }).__cardStates ?? []);
const requestCount = (page: Page) => page.evaluate(() =>
  ((window as unknown as { __E2E_COACHING_REQUESTS_1258__?: unknown[] }).__E2E_COACHING_REQUESTS_1258__ ?? []).length);

for (const delayMs of [0, 8_000, 25_000]) {
  test(`Open Mic: a coaching answer after ${delayMs / 1000} s renders the pair`, async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await page.evaluate((cfg) => {
      (window as unknown as { __E2E_COACHING_1258__?: unknown }).__E2E_COACHING_1258__ = cfg;
    }, { pending: 0, suggestions: PAIR, delayMs });
    await watchCard(page);

    await startRecording(page);
    await simulateTranscription(page, 'Today I will explain the plan in three clear steps for the team.', true);
    await page.waitForTimeout(5_200);
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });

    let rendered = true;
    try {
      await expect(page.getByTestId('ai-suggestions-pair')).toBeVisible({ timeout: delayMs + 20_000 });
    } catch { rendered = false; }
    const states = await cardStates(page);
    const requests = await requestCount(page);
    await testInfo.attach('card-states', { body: JSON.stringify({ delayMs, rendered, requests, states }, null, 2), contentType: 'application/json' });
    console.log(`[1258-slow] delay=${delayMs} rendered=${rendered} requests=${requests} states=${states.join(' > ')}`);
    expect(rendered, `card states: ${states.join(' > ')}; requests: ${requests}`).toBe(true);
    await expect(page.getByTestId('ai-suggestions-pair')).toContainText(PAIR.what_worked);
  });
}
