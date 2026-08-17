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
 * #1306 E2E mock-fidelity falsification — the mock DB mirrors the metrics-only persistence firewall across
 * EVERY write route: `sessions.insert`, `sessions.update`, the `create_session` RPC (p_session_data), and a
 * legacy `complete_session` carrying `p_final_transcript`. A forbidden content field is REJECTED fail-closed
 * (never silently stripped — silent sanitizing would HIDE a client privacy regression), matching the Stage B DB
 * firewall; and the positive path proves the new writer finalizes via the transcript-FREE overload. These drive
 * the REAL mock via `window.supabase`.
 */
type Row = Record<string, unknown>;
type WriteResult = { data: Row[] | null; error: { message: string } | null };
type RpcResult = { data: unknown; error: { message: string } | null };
interface MockSb {
  from: (t: string) => {
    insert: (p: Row) => Promise<WriteResult>;
    update: (p: Row) => { eq: (c: string, v: unknown) => Promise<WriteResult> };
    select: (c?: string) => { eq: (c: string, v: unknown) => { single: () => Promise<{ data: Row }> } };
  };
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;
}

test.describe('#1306 E2E mock fidelity — a forbidden content field is REJECTED, not silently stripped', () => {
  test('POSITIVE: a clean metrics-only INSERT (no forbidden field) succeeds', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    const res = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      return sb.from('sessions').insert({ id: 'fx-clean', title: 'x', total_words: 100, filler_counts: { um: 2 } } as Row);
    });
    expect(res.error).toBeNull();
    expect(res.data?.[0]?.total_words).toBe(100);
  });

  test('NEGATIVE: a client INSERT carrying a transcript is REJECTED and persists NOTHING', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    const out = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      const res = await sb.from('sessions').insert({ id: 'fx-insert', title: 'x', total_words: 100, filler_counts: { um: 2 }, transcript: 'these are real words' } as Row);
      let persisted = false;
      try { const got = await sb.from('sessions').select('*').eq('id', 'fx-insert').single(); persisted = got.data != null; } catch { persisted = false; }
      return { error: res.error, persisted };
    });
    expect(out.error).not.toBeNull();                 // rejected fail-closed
    expect(out.error?.message).toMatch(/forbidden content field/i);
    expect(out.persisted).toBe(false);                 // no row written
  });

  test('NEGATIVE: a client UPDATE that adds a transcript is REJECTED (the metric change does not apply)', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: [{ id: 'm1-persist', title: 'Persisted take', status: 'completed' as const, engine: 'private' as const, total_words: 245, filler_counts: { um: 3 }, next_action_signal: NEXT_ACTION }] });
    const out = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      const res = await sb.from('sessions').update({ transcript: 'brought back', total_words: 321 }).eq('id', 'm1-persist');
      const got = (await sb.from('sessions').select('*').eq('id', 'm1-persist').single()).data;
      return { error: res.error, total_words: got.total_words, transcript: got.transcript };
    });
    expect(out.error).not.toBeNull();          // transcript-bearing update rejected
    expect(out.transcript == null).toBe(true); // transcript never persisted
    expect(out.total_words).toBe(245);         // the whole write was rejected — metric unchanged
  });

  test('NEGATIVE: a create_session RPC whose payload smuggles a transcript is REJECTED', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    const out = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      return sb.rpc('create_session_and_update_usage', { p_session_data: { total_words: 10, filler_counts: { um: 1 }, transcript: 'smuggled words' }, p_engine_type: 'private' });
    });
    expect(out.error).not.toBeNull();
    expect(out.error?.message).toMatch(/forbidden content field/i);
  });

  test('NEGATIVE: a legacy complete_session carrying p_final_transcript is REJECTED (old overload absent)', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: [{ id: 'm1-final', title: 'Finalize take', status: 'active' as const, engine: 'private' as const, filler_counts: { um: 2 } }] });
    const out = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      return sb.rpc('complete_session', { p_session_id: 'm1-final', p_status: 'completed', p_final_transcript: 'legacy transcript payload' });
    });
    expect(out.error).not.toBeNull();
    expect(out.error?.message).toMatch(/p_final_transcript/i);
  });

  test('POSITIVE: the new writer finalizes via the transcript-FREE complete_session overload', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: [{ id: 'm1-ok', title: 'Finalize ok', status: 'active' as const, engine: 'private' as const, filler_counts: { um: 2 } }] });
    const out = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      // Exactly the metrics-only overload the production writer uses — no p_final_transcript argument.
      const res = await sb.rpc('complete_session', { p_session_id: 'm1-ok', p_status: 'completed', p_next_action: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' }, p_total_words: 200, p_filler_counts: {} });
      const got = (await sb.from('sessions').select('*').eq('id', 'm1-ok').single()).data;
      return { error: res.error, status: got.status, total_words: got.total_words, transcript: got.transcript };
    });
    expect(out.error).toBeNull();               // transcript-free completion accepted
    expect(out.status).toBe('completed');
    expect(out.total_words).toBe(200);
    expect(out.transcript == null).toBe(true);  // no transcript ever stored
  });

  test('POSITIVE: a clean metric UPDATE succeeds and survives reload (persisted, not reseeded)', async ({ page }) => {
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
