import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes, waitForFeature } from './helpers';

/**
 * #1306 metrics-only saved-session read journey (authenticated).
 *
 * Replaces the retired #1047 transcript-state journey. A saved session persists METRICS + exactly one
 * next_action_signal — never a transcript, transcript_state, or AI prose. This journey proves the review
 * surface reads that persisted truth (and the same after a full reload), that the mock DB (mirroring the
 * metrics-only persistence firewall) STRIPS any transcript a client tries to write, and that a completed
 * session missing its next action surfaces a data-integrity failure rather than a friendly empty state.
 *
 * Executed by exact-head CI/Playwright (the authoritative journey runner).
 */
const NEXT_ACTION = {
  reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
  value: 4, comparator: 'above_target', templateVersion: 'rec_v1',
} as const;

const SEEDED = [
  { id: 'm1-measured', title: 'Measured take', status: 'completed' as const, engine: 'private' as const,
    total_words: 245, clarity_score: 88, wpm: 142, filler_counts: { um: 4 }, next_action_signal: NEXT_ACTION },
  { id: 'm1-zero', title: 'Clean take', status: 'completed' as const, engine: 'private' as const,
    total_words: 210, clarity_score: 95, wpm: 138, filler_counts: {}, next_action_signal: NEXT_ACTION },
];

async function openDetail(page: import('@playwright/test').Page, id: string) {
  await navigateToRoute(page, `/analytics/${id}`);
  await waitForFeature(page, 'analytics');
}

test.describe('#1306 metrics-only saved-session read journey (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: SEEDED });
  });

  test('a completed session shows metrics + exactly one next action, and NO transcript pane — same after reload', async ({ page }) => {
    await openDetail(page, 'm1-measured');
    // Measurements render.
    await expect(page.getByText('Speaking Pace').first()).toBeVisible();
    // Exactly one valid next action; never a transcript pane or AI prose.
    await expect(page.getByTestId('session-next-action-title')).toHaveCount(1);
    await expect(page.getByTestId('session-next-action-integrity-error')).toHaveCount(0);
    await expect(page.getByTestId('session-detail-transcript')).toHaveCount(0);

    await page.reload();
    await waitForFeature(page, 'analytics');
    await expect(page.getByTestId('session-next-action-title')).toHaveCount(1);
    await expect(page.getByTestId('session-detail-transcript')).toHaveCount(0);
  });

  test('a measured-zero session ({}) is truthful (no transcript, still one next action)', async ({ page }) => {
    await openDetail(page, 'm1-zero');
    await expect(page.getByTestId('session-detail-transcript')).toHaveCount(0);
    await expect(page.getByTestId('session-next-action-title')).toHaveCount(1);
  });

  test('the saved session appears in History', async ({ page }) => {
    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');
    await expect(page.getByTestId('session-history-item-m1-measured')).toContainText('Measured take');
  });
});

/**
 * #1306 E2E mock-fidelity falsification — the mock DB mirrors the metrics-only persistence firewall: a
 * transcript a client tries to INSERT/UPDATE/finalize is STRIPPED and never round-trips. These drive the REAL
 * mock via `window.supabase`.
 */
type Row = Record<string, unknown>;
interface MockSb {
  from: (t: string) => {
    insert: (p: Row) => Promise<{ data: Row[] }>;
    update: (p: Row) => { eq: (c: string, v: unknown) => Promise<{ data: Row[] }> };
    select: (c?: string) => { eq: (c: string, v: unknown) => { single: () => Promise<{ data: Row }> } };
  };
}

test.describe('#1306 E2E mock fidelity — a transcript never crosses the persistence boundary', () => {
  test('a client INSERT carrying a transcript persists the metrics but STRIPS the transcript', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    const row = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      const res = await sb.from('sessions').insert({ id: 'fx-insert', title: 'x', total_words: 100, filler_counts: { um: 2 }, transcript: 'these are real words' } as Row);
      return res.data[0];
    });
    expect(row.transcript == null).toBe(true);        // transcript stripped on write
    expect(row.transcript_state).toBeUndefined();      // no transcript_state exists anymore
    expect(row.total_words).toBe(100);                 // metrics persist
  });

  test('a client UPDATE that adds a transcript is ignored; metrics still round-trip through reload', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: [{ id: 'm1-persist', title: 'Persisted take', status: 'completed' as const, engine: 'private' as const, filler_counts: { um: 3 }, next_action_signal: NEXT_ACTION }] });
    const row = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      await sb.from('sessions').update({ transcript: 'brought back', total_words: 321 }).eq('id', 'm1-persist');
      return (await sb.from('sessions').select('*').eq('id', 'm1-persist').single()).data;
    });
    expect(row.transcript == null).toBe(true);   // transcript never persisted
    expect(row.total_words).toBe(321);           // metric update survives
  });

  test('reload reads the PERSISTED mock DB (a metric mutation survives reload — not a reseed)', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: [{ id: 'm1-reload', title: 'Reload take', status: 'completed' as const, engine: 'private' as const, total_words: 150, filler_counts: { um: 2 }, next_action_signal: NEXT_ACTION }] });
    await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      await sb.from('sessions').update({ total_words: 999 }).eq('id', 'm1-reload');
    });
    await page.reload();
    await openDetail(page, 'm1-reload');
    // The mutated metric survived reload ⇒ read from the persisted mock DB, not reseeded.
    await expect(page.getByTestId('session-detail-transcript')).toHaveCount(0);
    await expect(page.getByTestId('session-next-action-title')).toHaveCount(1);
  });
});
