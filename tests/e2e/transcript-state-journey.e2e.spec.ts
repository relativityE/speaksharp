import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes, waitForFeature } from './helpers';

/**
 * #1047 PR-U1 — synthetic authenticated read journey.
 *
 * An authenticated user opens saved sessions whose SERVER-OWNED transcript_state differs, and the detail
 * surface reads the honest state/copy — and the SAME copy after a full reload (proving it is read from the
 * persisted row, not inferred from a transient empty string). Uses the route mock's seeded sessions; no
 * real provider, no migration apply, no transcript mutation.
 *
 * Executed by exact-head CI/Playwright (the authoritative journey runner).
 */
const SEEDED = [
  { id: 'u1-available', title: 'Available take', transcript: 'the practiced opening words', transcript_state: 'available' as const, engine: 'private' as const },
  { id: 'u1-expired', title: 'Expired take', transcript: '', transcript_state: 'expired' as const, engine: 'private' as const },
  { id: 'u1-notcaptured', title: 'No-transcript take', transcript: '', transcript_state: 'not_captured' as const, engine: 'private' as const },
];

async function openDetail(page: import('@playwright/test').Page, id: string) {
  await navigateToRoute(page, `/analytics/${id}`);
  await waitForFeature(page, 'analytics');
  return page.getByTestId('session-detail-transcript');
}

test.describe('#1047 U1 transcript-state read journey (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: SEEDED });
  });

  test('available → renders the transcript, and the same after reload', async ({ page }) => {
    let el = await openDetail(page, 'u1-available');
    await expect(el).toHaveAttribute('data-transcript-state', 'available');
    await expect(el).toContainText('the practiced opening words');

    await page.reload();
    el = page.getByTestId('session-detail-transcript');
    await expect(el).toHaveAttribute('data-transcript-state', 'available');
    await expect(el).toContainText('the practiced opening words');
  });

  test('expired → shows the honest reason (not the removed text) and keeps measurements, before and after reload', async ({ page }) => {
    let el = await openDetail(page, 'u1-expired');
    await expect(el).toHaveAttribute('data-transcript-state', 'expired');
    await expect(el).toContainText('Transcript expired. Your measurements are still available.');
    // Measurements remain visible for an expired transcript.
    await expect(page.getByText('Speaking Pace').first()).toBeVisible();

    await page.reload();
    el = page.getByTestId('session-detail-transcript');
    await expect(el).toHaveAttribute('data-transcript-state', 'expired');
    await expect(el).toContainText('Transcript expired. Your measurements are still available.');
  });

  test('not_captured → shows the honest reason, and the same after reload', async ({ page }) => {
    let el = await openDetail(page, 'u1-notcaptured');
    await expect(el).toHaveAttribute('data-transcript-state', 'not_captured');
    await expect(el).toContainText('No transcript was captured.');

    await page.reload();
    el = page.getByTestId('session-detail-transcript');
    await expect(el).toHaveAttribute('data-transcript-state', 'not_captured');
    await expect(el).toContainText('No transcript was captured.');
  });
});

/**
 * #1047 PR-U1 — E2E mock-fidelity falsification (transcript_state authority).
 *
 * The in-browser mock DB must model the production BEFORE trigger's authority, or the journey would prove a
 * behavior production does not grant. Only a server-authoritative fixture may establish `expired` (and that
 * clears the transcript); an ordinary CLIENT write can never self-assert `expired`, and `expired` is sticky
 * only when the PREVIOUSLY persisted row was already expired. These drive the REAL mock via `window.supabase`.
 */
type Row = Record<string, unknown>;
interface MockSb {
  from: (t: string) => {
    insert: (p: Row) => Promise<{ data: Row[] }>;
    update: (p: Row) => { eq: (c: string, v: unknown) => Promise<{ data: Row[] }> };
    select: (c?: string) => { eq: (c: string, v: unknown) => { single: () => Promise<{ data: Row }> } };
  };
}

test.describe('#1047 U1 E2E mock fidelity — a client cannot self-assert `expired` (matches server SQL)', () => {
  test('client-provided `expired` on INSERT is ignored and recomputed from transcript (content retained)', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    const row = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      const res = await sb.from('sessions').insert({ id: 'fx-insert', title: 'x', transcript: 'these are real words', transcript_state: 'expired' });
      return res.data[0];
    });
    expect(row.transcript_state).toBe('available');        // client `expired` denied on insert
    expect(row.transcript).toBe('these are real words');   // production would not clear a non-expired transcript
  });

  test('client-provided `expired` when UPDATING a non-expired row is ignored (stays derived)', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    const row = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      await sb.from('sessions').insert({ id: 'fx-upd', transcript: 'spoken words', transcript_state: 'available' });
      const res = await sb.from('sessions').update({ transcript_state: 'expired' }).eq('id', 'fx-upd');
      return res.data[0];
    });
    expect(row.transcript_state).toBe('available');        // client cannot introduce `expired` from a non-expired row
    expect(row.transcript).toBe('spoken words');
  });

  test('a previously-expired row resists transcript resurrection (sticky expired + transcript null)', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: [{ id: 'fx-exp', transcript: 'gone', transcript_state: 'expired' as const, engine: 'private' as const }] });
    const result = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      const seeded = (await sb.from('sessions').select('*').eq('id', 'fx-exp').single()).data;
      const afterResurrect = (await sb.from('sessions').update({ transcript: 'brought back' }).eq('id', 'fx-exp')).data[0];
      return { seeded, afterResurrect };
    });
    expect(result.seeded.transcript_state).toBe('expired');
    expect(result.seeded.transcript).toBeNull();           // authoritative expired seed cleared content
    expect(result.afterResurrect.transcript_state).toBe('expired'); // sticky
    expect(result.afterResurrect.transcript).toBeNull();   // client resurrection denied
  });

  test('an authoritative expired fixture seed persists as `expired` with transcript null', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: [{ id: 'fx-seed', transcript: 'original text', transcript_state: 'expired' as const, engine: 'private' as const }] });
    const row = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      return (await sb.from('sessions').select('*').eq('id', 'fx-seed').single()).data;
    });
    expect(row.transcript_state).toBe('expired');
    expect(row.transcript).toBeNull();
  });
});
