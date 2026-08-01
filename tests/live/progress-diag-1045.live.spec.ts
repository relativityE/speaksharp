/**
 * #1045 diagnostic (read-only): dump the persisted Progress rows for session1 from the last journey run,
 * plus the session's own metrics, to classify why the Progress panel did not render (eval missing vs
 * ineligible vs recommendation missing vs a load-time/cache timing issue). Service-role read only.
 */
import { test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SID = process.env.DIAG_SESSION_ID ?? 'ea5e48cb-f1b3-4dce-83d8-3be507223a77';
const FREE_EMAIL = process.env.FREE_TEST_EMAIL ?? process.env.BASIC_TEST_EMAIL ?? '';

test('#1045 diag: dump progress rows for session1 @live', async () => {
  test.setTimeout(60_000);
  test.skip(!SUPABASE_URL || !SERVICE_ROLE, 'service-role required');
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  // resolve uid
  let uid: string | null = null;
  for (let page = 1; page <= 25 && !uid; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = (data?.users ?? []) as Array<{ id: string; email?: string | null }>;
    const hit = users.find((u) => (u.email ?? '').toLowerCase() === FREE_EMAIL.toLowerCase());
    if (hit) uid = hit.id;
    if (users.length < 200) break;
  }

  const { data: sess } = await admin.from('sessions')
    .select('id, created_at, status, attribution_status, engine, engine_version, model_name, duration, transcript')
    .eq('id', SID).maybeSingle();
  const s = sess as Record<string, unknown> | null;
  const transcript = typeof s?.transcript === 'string' ? s.transcript : '';
  console.log(`[diag] session=${JSON.stringify({
    id: s?.id, status: s?.status, attribution_status: s?.attribution_status, engine: s?.engine,
    engine_version: s?.engine_version, model_name: s?.model_name, duration: s?.duration,
    transcript_len: transcript.length, word_count: transcript.trim() ? transcript.trim().split(/\s+/).length : 0,
  })}`);

  const { data: evalRow, error: evalErr } = await admin.from('session_progress_evaluations')
    .select('*').eq('session_id', SID).maybeSingle();
  console.log(`[diag] evaluation=${JSON.stringify(evalRow ?? null)} err=${evalErr?.message ?? 'none'}`);

  const { data: rec } = await admin.from('progress_recommendations')
    .select('*').eq('source_session_id', SID).maybeSingle();
  console.log(`[diag] recommendation=${JSON.stringify(rec ?? null)}`);

  // Recent evals for this uid (to see cohort keys + eligibility across the account's history).
  if (uid) {
    const { data: recent } = await admin.from('session_progress_evaluations')
      .select('session_id, eligible, clarity_raw, word_count, cohort_key, exclusion_reasons, formula_version')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(5);
    console.log(`[diag] recent_evals=${JSON.stringify(recent ?? [])}`);
  }
});
