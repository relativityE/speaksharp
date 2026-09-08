import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes, waitForFeature } from './helpers';
import { TEST_IDS } from '../../frontend/src/constants/testIds';

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

// Unique TAIL markers. A tail (not a head) is used deliberately: it proves the END of a transcript
// survived retention, reload, and PDF pagination — a head marker would pass even if the content were
// truncated. Distinct per session so an export can never satisfy the wrong assertion.
const TAIL1 = 'JOURNEYTAILONEa71f22';
const TAIL2 = 'JOURNEYTAILTWOb83e40';
const TAIL3 = 'JOURNEYTAILTHREEc95d18';

/** Three ACTIVE sessions. Terminal state is PRODUCED by driving real v2 completions, never seeded. */
const SEEDED = [
  { id: 'm1-oldest', title: 'Oldest take', status: 'active' as const, engine: 'private' as const,
    created_at: '2025-01-01T10:00:00Z', filler_counts: { um: 4 } },
  { id: 'm2-middle', title: 'Middle take', status: 'active' as const, engine: 'private' as const,
    created_at: '2025-01-02T10:00:00Z', filler_counts: { um: 2 } },
  { id: 'm3-newest', title: 'Newest take', status: 'active' as const, engine: 'private' as const,
    created_at: '2025-01-03T10:00:00Z', filler_counts: {} },
];

type V2Result = { data: unknown; error: { message: string } | null };

/**
 * Drive the three completions through the SERVER-OWNED retention boundary, oldest first, and return
 * both the envelopes and the resulting rows. Nothing here injects `transcript_state`: newest-ONE
 * expiry is whatever the RPC produced.
 */
async function completeThreeSessions(page: import('@playwright/test').Page) {
  return page.evaluate(async ({ t1, t2, t3 }) => {
    const sb = (window as unknown as { supabase: MockSb }).supabase;
    const NA = { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' };
    const results: V2Result[] = [];
    for (const [id, tail] of [['m1-oldest', t1], ['m2-middle', t2], ['m3-newest', t3]] as const) {
      results.push(await sb.rpc('complete_session_v2', {
        p_session_id: id, p_status: 'completed', p_final_duration: 60, p_reason: null,
        p_next_action: NA, p_total_words: 120, p_clarity_score: 90, p_wpm: 130,
        p_filler_counts: { um: 1 }, p_pause_metrics: {},
        p_final_transcript: `spoken practice content for ${id} ending with ${tail}`,
      }));
    }
    const rows: Record<string, { transcript_state?: string | null; transcript?: string | null; total_words?: number }> = {};
    for (const id of ['m1-oldest', 'm2-middle', 'm3-newest']) {
      rows[id] = (await sb.from('sessions').select('*').eq('id', id).single()).data as never;
    }
    return { results, rows };
  }, { t1: TAIL1, t2: TAIL2, t3: TAIL3 });
}

async function openDetail(page: import('@playwright/test').Page, id: string) {
  await navigateToRoute(page, `/analytics/${id}`);
  await waitForFeature(page, 'analytics');
}

/**
 * Click the real export control and return the downloaded artifact's text.
 *
 * The export button is rendered by SessionHistoryItem — i.e. it exists ONLY on the /analytics
 * dashboard row, never on the detail route. Driving it from a detail page (as this helper first did)
 * clicked a control that was not on the page, so the download never fired and the test proved nothing.
 */
async function exportPdfText(page: import('@playwright/test').Page, id: string): Promise<string> {
  await navigateToRoute(page, '/analytics');
  await waitForFeature(page, 'analytics');
  const control = page.getByTestId(`download-pdf-btn-${id}`).first();
  await expect(control, `no export control rendered for ${id}`).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    control.click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('no downloaded artifact path');
  const { readFileSync } = await import('node:fs');
  return readFileSync(path, 'latin1');
}

test.describe('#1306 Step 3 — PRODUCED newest-one retention (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: SEEDED });
  });

  test('three real v2 completions PRODUCE newest-one retention — only the newest transcript survives', async ({ page }) => {
    const { results, rows } = await completeThreeSessions(page);

    // POSITIVE CONTROL: the RPC was actually exercised three times and accepted each one. Without this,
    // every state assertion below could pass on rows that were simply seeded that way.
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.error).toBeNull();
      expect((r.data as { success?: boolean })?.success).toBe(true);
    }

    // PRODUCED, not injected: the server-owned retention inside the RPC decided these. Under
    // newest-ONE the third completion leaves exactly one readable transcript — the middle session
    // expires too, which is the whole behavioural difference from newest-two.
    expect(rows['m3-newest'].transcript_state).toBe('available');
    expect(rows['m2-middle'].transcript_state).toBe('expired');
    expect(rows['m1-oldest'].transcript_state).toBe('expired');
    // Both expired transcripts are gone as TEXT; their metrics and history survive intact.
    for (const id of ['m1-oldest', 'm2-middle'] as const) {
      expect(rows[id].transcript == null || rows[id].transcript === '').toBe(true);
      expect(rows[id].total_words).toBe(120);
    }
  });

  test('ONLY the newest reopens with its transcript tail after a full reload', async ({ page }) => {
    await completeThreeSessions(page);
    await page.reload();

    await openDetail(page, 'm3-newest');
    await expect(page.getByTestId('session-detail-transcript')).toContainText(TAIL3);

    // The middle session is the one newest-two used to keep readable. It must now read as expired,
    // and its tail must not appear anywhere on the page.
    await openDetail(page, 'm2-middle');
    await expect(page.getByTestId('session-detail-transcript-expired')).toHaveCount(1);
    await expect(page.getByTestId('session-detail-transcript')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(TAIL2);
  });

  test('every earlier session is EXPIRED — no transcript anywhere on the page, metrics intact', async ({ page }) => {
    await completeThreeSessions(page);

    for (const [id, tail] of [['m1-oldest', TAIL1], ['m2-middle', TAIL2]] as const) {
      await openDetail(page, id);
      await expect(page.getByTestId('session-detail-transcript-expired'), `${id} expired notice`).toHaveCount(1);
      await expect(page.getByTestId('session-detail-transcript'), `${id} transcript`).toHaveCount(0);
      await expect(page.locator('body'), `${id} tail leaked`).not.toContainText(tail);
      // Expiry removes the TEXT, never the evidence: the next action and its integrity survive.
      await expect(page.getByTestId('session-next-action-title')).toHaveCount(1);
      await expect(page.getByTestId('session-next-action-integrity-error')).toHaveCount(0);
    }
  });

  test('PDF export carries ONLY the newest tail — no expired session can put text in an artifact', async ({ page }) => {
    await completeThreeSessions(page);

    // The single RETAINED session exports its own tail, and only its own. Under newest-two this
    // assertion had a sibling for the middle session; that sibling is now the negative case below.
    const pdf3 = await exportPdfText(page, 'm3-newest');
    expect(pdf3).toContain(TAIL3);
    expect(pdf3).not.toContain(TAIL2);
    expect(pdf3).not.toContain(TAIL1);

    // An expired session STILL OFFERS an export, and that is correct: expiry removes the transcript,
    // never the measurements, and the user is entitled to export the metrics that survived. The claim
    // worth proving is therefore not "the button is gone" — it is that the artifact carries NO
    // transcript. Asserting the missing button was inherited from newest-two, where an expired session
    // was always off the two-row dashboard and its control was unreachable by accident rather than by
    // design; newest-one makes an expired session visible, which is what exposed the wrong assertion.
    const middlePdf = await exportPdfText(page, 'm2-middle');
    expect(middlePdf.length, 'the expired session still produces a parseable metrics artifact').toBeGreaterThan(0);
    for (const [label, tail] of [['its own', TAIL2], ['the oldest', TAIL1], ['the newest', TAIL3]] as const) {
      expect(middlePdf.includes(tail), `expired artifact must not carry ${label} transcript`).toBe(false);
    }

    // The oldest is off the two-row dashboard slice, so it has no control to click at all.
    await expect(page.getByTestId('download-pdf-btn-m1-oldest'), 'oldest export control').toHaveCount(0);
    const expiredRows = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      const out: Record<string, { transcript?: string | null; transcript_state?: string | null }> = {};
      for (const id of ['m1-oldest', 'm2-middle']) {
        const { data } = await sb.from('sessions').select('*').eq('id', id).single();
        out[id] = data as { transcript?: string | null; transcript_state?: string | null };
      }
      return out;
    });
    for (const id of ['m1-oldest', 'm2-middle'] as const) {
      expect(expiredRows[id].transcript_state, `${id} state`).toBe('expired');
      expect(expiredRows[id].transcript ?? null, `${id} text`).toBeNull();
    }
  });

  test('the history LIST never requests or renders transcript text', async ({ page }) => {
    await completeThreeSessions(page);
    await page.evaluate(() => { (window as unknown as { __e2eSessionSelects__?: string[] }).__e2eSessionSelects__ = []; });

    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');
    await expect(page.getByTestId('session-history-item-m3-newest')).toContainText('Newest take');

    // The metrics-only read firewall is a property of the COLUMN LIST the client asks for. This
    // previously scanned `page.on('response')` for /rest/v1/sessions GETs — but the E2E client is the
    // in-process `window.supabase` double, so NO http response is ever emitted and the scan captured
    // zero bodies. It asserted over an empty set: it could not have failed, whatever the client sent.
    const selects = await page.evaluate(() => (window as unknown as { __e2eSessionSelects__?: string[] }).__e2eSessionSelects__ ?? []);
    expect(selects.length, 'no session selects captured — the scan proves nothing').toBeGreaterThan(0);
    for (const columns of selects) {
      expect(columns, `list read requested the transcript column: ${columns}`).not.toMatch(/\btranscript\b/);
    }
    // ...and nothing transcript-shaped reached the rendered list either.
    for (const tail of [TAIL1, TAIL2, TAIL3]) {
      await expect(page.getByTestId(TEST_IDS.SESSION_HISTORY_LIST), `list rendered ${tail}`).not.toContainText(tail);
    }
  });

  test('a reload preserves exactly ONE identity per session — no duplicate row', async ({ page }) => {
    await completeThreeSessions(page);
    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');
    await page.reload();
    await waitForFeature(page, 'analytics');

    // PRODUCT CONTRACT: the dashboard renders the NEWEST TWO by design (AnalyticsDashboard slices the
    // history to 2). That display slice is NOT retention and does not change under newest-one — the
    // middle session still appears in history with its metrics, while its TRANSCRIPT is expired.
    // Conflating the two would read as "newest-one broke the dashboard".
    for (const id of ['m3-newest', 'm2-middle']) {
      await expect(page.getByTestId(`session-history-item-${id}`)).toHaveCount(1);
    }
    await expect(page.getByTestId('session-history-item-m1-oldest')).toHaveCount(0);

    // The oldest is NOT lost — it is off the two-row dashboard slice, and detail access still resolves
    // it with its metrics and next action intact and its transcript expired.
    await openDetail(page, 'm1-oldest');
    await expect(page.getByTestId('session-detail-transcript-expired')).toHaveCount(1);
    await expect(page.getByTestId('session-detail-transcript')).toHaveCount(0);
    await expect(page.getByTestId('session-next-action-title')).toHaveCount(1);
    await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toBeVisible();

    // ...and the identity claim itself: exactly one persisted row per id after the reload, so the
    // reload re-read the round-tripped rows instead of re-seeding or double-inserting.
    const counts = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      const out: Record<string, number> = {};
      for (const id of ['m1-oldest', 'm2-middle', 'm3-newest']) {
        const { data } = await sb.from('sessions').select('id').eq('id', id);
        out[id] = Array.isArray(data) ? data.length : -1;
      }
      return out;
    });
    expect(counts).toEqual({ 'm1-oldest': 1, 'm2-middle': 1, 'm3-newest': 1 });
  });
});

/**
 * #1306 E2E mock-fidelity falsification — the mock DB mirrors the metrics-only persistence firewall across
 * EVERY write route: `sessions.insert`, `sessions.update`, the `create_session` RPC (p_session_data), and a
 * legacy `complete_session` carrying `p_final_transcript`. A forbidden content field is REJECTED fail-closed
 * (never silently stripped — silent sanitizing would HIDE a client privacy regression), matching the Stage B DB
 * firewall. The positive path proves the production writer finalizes via `complete_session_v2` — the v1
 * overload is REJECTED outright, so a fallback regression fails loudly. These drive the REAL mock via
 * `window.supabase`.
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

  test('NEGATIVE: the legacy complete_session overload is REJECTED outright — any v1 call fails loudly', async ({ page }) => {
    // Step 3 cut the client over to v2 with NO fallback. v1 is rejected whether or not it carries a
    // transcript, so a regression that reintroduced a fallback cannot pass quietly.
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: [{ id: 'm1-final', title: 'Finalize take', status: 'active' as const, engine: 'private' as const, filler_counts: { um: 2 } }] });
    const out = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      return {
        withTranscript: await sb.rpc('complete_session', { p_session_id: 'm1-final', p_status: 'completed', p_final_transcript: 'legacy transcript payload' }),
        withoutTranscript: await sb.rpc('complete_session', { p_session_id: 'm1-final', p_status: 'completed' }),
      };
    });
    expect(out.withTranscript.error).not.toBeNull();
    expect(out.withoutTranscript.error).not.toBeNull();
    expect(out.withoutTranscript.error?.message).toMatch(/complete_session_v2|not callable/i);
  });

  test('POSITIVE: the production writer finalizes via complete_session_v2 AND retains the transcript', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: [{ id: 'm1-ok', title: 'Finalize ok', status: 'active' as const, engine: 'private' as const, filler_counts: { um: 2 } }] });
    const out = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      const res = await sb.rpc('complete_session_v2', {
        p_session_id: 'm1-ok', p_status: 'completed', p_final_duration: 60, p_reason: null,
        p_next_action: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' },
        p_total_words: 200, p_clarity_score: 90, p_wpm: 130, p_filler_counts: {}, p_pause_metrics: {},
        p_final_transcript: 'retained words for the newest session',
      });
      const got = (await sb.from('sessions').select('*').eq('id', 'm1-ok').single()).data;
      return { error: res.error, envelope: res.data, status: got.status, total_words: got.total_words, transcript: got.transcript, transcript_state: got.transcript_state };
    });
    expect(out.error).toBeNull();
    // The envelope is the full v2 contract, not a bare success.
    expect(out.envelope).toMatchObject({ success: true, session_saved: true, transcript_outcome: 'retained', transcript_retained: true });
    expect(out.status).toBe('completed');
    expect(out.total_words).toBe(200);
    // The transcript IS retained now — the superseded "no transcript ever" assertion is gone.
    expect(out.transcript).toBe('retained words for the newest session');
    expect(out.transcript_state).toBe('available');
  });

  test('POSITIVE: a clean metric UPDATE succeeds and survives reload (persisted, not reseeded)', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: [{ id: 'm1-reload', title: 'Reload take', status: 'completed' as const, engine: 'private' as const, total_words: 150, filler_counts: { um: 2 }, next_action_signal: NEXT_ACTION }] });
    await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      await sb.from('sessions').update({ total_words: 999 }).eq('id', 'm1-reload');
    });
    await page.reload();
    await openDetail(page, 'm1-reload');
    // POSITIVE CONTROL: the test is named for a metric that survives reload, so assert the mutated
    // VALUE. Without this the test only proved a page rendered — it would have passed identically if
    // the update had been dropped and the fixture reseeded.
    const persisted = await page.evaluate(async () => {
      const sb = (window as unknown as { supabase: MockSb }).supabase;
      const { data } = await sb.from('sessions').select('*').eq('id', 'm1-reload').single();
      return data as { total_words?: number };
    });
    expect(persisted.total_words, 'metric did not survive reload — the DB was reseeded').toBe(999);
    await expect(page.getByTestId('session-next-action-title')).toHaveCount(1);
    // This session never captured a transcript, so absence is correct here — and the pane must say so
    // honestly rather than simply not rendering.
    await expect(page.getByTestId('session-detail-transcript')).toHaveCount(0);
    await expect(page.getByTestId('session-detail-transcript-unavailable')).toHaveCount(1);
  });
});
