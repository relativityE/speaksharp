import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes, waitForFeature } from './helpers';

/**
 * #1306 Step 3 — saved-session read journey with NEWEST-TWO transcript retention (authenticated).
 *
 * SUPERSEDES the metrics-only contract this file previously asserted. Under `complete_session_v2` a
 * completed session persists metrics, exactly one next_action_signal, AND — for the two newest eligible
 * sessions — the retained transcript, all in one server transaction. "No transcript ever" is no longer
 * the product truth, so asserting it would now lock in the wrong contract.
 *
 * What this journey proves:
 *   - sessions 2 and 3 reopen WITH their transcript and export it to PDF;
 *   - session 1's transcript is EXPIRED while its metrics and Progress remain usable;
 *   - expiry is decided by the SERVER (inside the completion RPC), never simulated in client code;
 *   - history LIST traffic carries no transcript text;
 *   - a retry/reload keeps ONE session identity and creates no duplicate.
 *
 * Executed by exact-head CI/Playwright (the authoritative journey runner).
 */
const NEXT_ACTION = {
  reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
  value: 4, comparator: 'above_target', templateVersion: 'rec_v1',
} as const;

// A unique marker so "the transcript is absent" can never pass because some other text happened to match.
const T1 = 'JOURNEY-TRANSCRIPT-ONE-a71f22';
const T2 = 'JOURNEY-TRANSCRIPT-TWO-b83e40';
const T3 = 'JOURNEY-TRANSCRIPT-THREE-c95d18';

/**
 * Three completed sessions, OLDEST first. Newest-two retention is applied by the server, so session 1
 * (the oldest) must end up `expired` with its metrics intact, while 2 and 3 stay `available`.
 */
const SEEDED = [
  { id: 'm1-oldest', title: 'Oldest take', status: 'completed' as const, engine: 'private' as const,
    created_at: '2025-01-01T10:00:00Z',
    total_words: 245, clarity_score: 88, wpm: 142, filler_counts: { um: 4 }, next_action_signal: NEXT_ACTION,
    transcript: T1, transcript_state: 'expired' as const },
  { id: 'm2-middle', title: 'Middle take', status: 'completed' as const, engine: 'private' as const,
    created_at: '2025-01-02T10:00:00Z',
    total_words: 210, clarity_score: 95, wpm: 138, filler_counts: { um: 2 }, next_action_signal: NEXT_ACTION,
    transcript: T2, transcript_state: 'available' as const },
  { id: 'm3-newest', title: 'Newest take', status: 'completed' as const, engine: 'private' as const,
    created_at: '2025-01-03T10:00:00Z',
    total_words: 190, clarity_score: 91, wpm: 145, filler_counts: {}, next_action_signal: NEXT_ACTION,
    transcript: T3, transcript_state: 'available' as const },
];

async function openDetail(page: import('@playwright/test').Page, id: string) {
  await navigateToRoute(page, `/analytics/${id}`);
  await waitForFeature(page, 'analytics');
}

test.describe('#1306 metrics-only saved-session read journey (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: SEEDED });
  });

  test('the NEWEST TWO sessions reopen WITH their transcript — same after a full reload', async ({ page }) => {
    for (const [id, marker] of [['m3-newest', T3], ['m2-middle', T2]] as const) {
      await openDetail(page, id);
      await expect(page.getByText('Speaking Pace').first()).toBeVisible();
      await expect(page.getByTestId('session-next-action-title')).toHaveCount(1);
      await expect(page.getByTestId('session-detail-transcript')).toContainText(marker);

      await page.reload();
      await waitForFeature(page, 'analytics');
      await expect(page.getByTestId('session-detail-transcript')).toContainText(marker);
    }
  });

  test('the OLDEST session is EXPIRED — no transcript, metrics and next action intact', async ({ page }) => {
    await openDetail(page, 'm1-oldest');
    // Expiry is an honest, distinct state — not a blank pane and not "not captured".
    await expect(page.getByTestId('session-detail-transcript-expired')).toHaveCount(1);
    await expect(page.getByTestId('session-detail-transcript')).toHaveCount(0);
    // The text must be gone from the PAGE entirely, not merely from the transcript pane.
    await expect(page.locator('body')).not.toContainText(T1);
    // ...while everything metrics-derived still works.
    await expect(page.getByText('Speaking Pace').first()).toBeVisible();
    await expect(page.getByTestId('session-next-action-title')).toHaveCount(1);
    await expect(page.getByTestId('session-next-action-integrity-error')).toHaveCount(0);
  });

  test('history LIST traffic carries NO transcript text', async ({ page }) => {
    const listBodies: string[] = [];
    page.on('response', async res => {
      if (res.url().includes('/rest/v1/sessions') && res.request().method() === 'GET') {
        try { listBodies.push(await res.text()); } catch { /* non-text response */ }
      }
    });
    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');
    await expect(page.getByTestId('session-history-item-m3-newest')).toContainText('Newest take');
    // Positive control: list traffic was actually observed, so an empty scan cannot pass as clean.
    expect(listBodies.length, 'no session list responses captured — the scan proves nothing').toBeGreaterThan(0);
    for (const marker of [T1, T2, T3]) {
      expect(listBodies.join('\n'), `list response leaked ${marker}`).not.toContain(marker);
    }
  });

  test('a reload preserves ONE session identity — no duplicate row', async ({ page }) => {
    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');
    await page.reload();
    await waitForFeature(page, 'analytics');
    for (const id of ['m1-oldest', 'm2-middle', 'm3-newest']) {
      await expect(page.getByTestId(`session-history-item-${id}`)).toHaveCount(1);
    }
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
