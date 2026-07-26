import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * Read-only diagnostic (NO deletion, NO mutation): the failed attribution-proof run 30214660225 started
 * a recording before failing, so the controller may have created a placeholder session on the reusable
 * Pro account. This lists candidate orphan rows via the service-role API, scoped to the Pro owner, that
 * run's narrow UTC window, and Cloud engine only — content-free fields (sanitized id, created_at, status,
 * attribution_status, engine). It NEVER deletes anything and asserts nothing about the count.
 */
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRO_EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
const PRO_PASSWORD = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;
const WINDOW_START = '2026-07-26T18:23:00Z';
const WINDOW_END = '2026-07-26T18:29:00Z';

test('read-only: candidate orphan Pro cloud sessions from failed run 30214660225 (no deletion)', async () => {
  test.skip(!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !PRO_EMAIL || !PRO_PASSWORD,
    'Requires SUPABASE_URL/ANON/SERVICE_ROLE + PRO_TEST_EMAIL/PASSWORD.');
  const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signin, error: sErr } = await anon.auth.signInWithPassword({ email: PRO_EMAIL!, password: PRO_PASSWORD! });
  expect(sErr, 'Pro sign-in must succeed').toBeFalsy();
  const proUserId = signin.user!.id;
  const admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: rows, error } = await admin
    .from('sessions')
    .select('id, created_at, status, attribution_status, engine')
    .eq('user_id', proUserId)
    .eq('engine', 'cloud')
    .gte('created_at', WINDOW_START)
    .lte('created_at', WINDOW_END)
    .order('created_at', { ascending: true });
  expect(error, 'service-role read must succeed').toBeFalsy();
  const candidates = (rows ?? []).map((r) => ({
    id: `${String(r.id).slice(0, 8)}…${String(r.id).slice(-4)}`,
    created_at: r.created_at, status: r.status, attribution_status: r.attribution_status, engine: r.engine,
  }));
  console.log(`ORPHAN_AUDIT_30214660225 ${JSON.stringify({ window: [WINDOW_START, WINDOW_END], candidateCount: candidates.length, candidates })}`);
});
