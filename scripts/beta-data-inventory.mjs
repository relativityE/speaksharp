/* eslint-env node */
// Authoritative, SANITIZED beta-data inventory (incident + ongoing operational monitoring).
//
// Reads the persisted product data (Supabase auth.users, public.sessions, public.user_issue_reports)
// with the service role and emits ONLY sanitized aggregates: counts, one-way-hashed account
// identifiers, session/report IDs (opaque row ids — not PII), timestamps, metrics, booleans, and a
// transcript character count + short hash. It NEVER prints report/transcript/audio prose, email,
// name, or the service-role secret. This is the authoritative source of truth for saved sessions and
// feedback — independent of PostHog / any client analytics.
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY. Optional: INVENTORY_BOUNDARY.

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOUNDARY = process.env.INVENTORY_BOUNDARY || '2026-07-18T17:43:56Z';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('BETA_INVENTORY_NOT_RUNNABLE: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

// Short, stable one-way alias for an account UUID (never reversible to the UUID/email).
const alias = (id) => (id ? 'acct_' + createHash('sha256').update(String(id)).digest('hex').slice(0, 10) : null);
const shortHash = (s) => createHash('sha256').update(String(s ?? '')).digest('hex').slice(0, 12);
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function firstTranscriptKey(row) {
  return ['transcript', 'transcript_text', 'final_transcript', 'transcript_final'].find((k) => k in row) || null;
}

async function inventory() {
  const out = { boundary: BOUNDARY, generated_at: new Date().toISOString() };

  // ---- A. Accounts (auth.users) ----
  const accounts = [];
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('listUsers failed: ' + error.message);
    for (const u of data.users) accounts.push({ id: u.id, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at });
    if (data.users.length < 1000) break;
    page += 1;
  }
  const testerAccounts = accounts.filter(
    (a) => (a.created_at && a.created_at >= BOUNDARY) || (a.last_sign_in_at && a.last_sign_in_at >= BOUNDARY),
  );

  // ---- B. Sessions ----
  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('*')
    .gte('created_at', BOUNDARY)
    .order('created_at', { ascending: true });
  if (sErr) throw new Error('sessions query failed: ' + sErr.message);
  const tKey = sessions.length ? firstTranscriptKey(sessions[0]) : null;
  // Canonical transcription identity is `engine` (native→Browser, private→Private, cloud→Cloud) —
  // NOT the legacy/null `sessions.mode` column.
  const classifyEngine = (engine) => {
    const e = String(engine ?? '').toLowerCase();
    if (e === 'native') return 'Browser';
    if (e === 'private') return 'Private';
    if (e === 'cloud') return 'Cloud';
    return 'Unclassified';
  };
  const sessionRows = sessions.map((r) => {
    const transcript = tKey ? r[tKey] : null;
    return {
      session_id: r.id,
      account: alias(r.user_id),
      created_at: r.created_at,
      engine: r.engine ?? null,
      engine_class: classifyEngine(r.engine),
      engine_version: r.engine_version ?? null,
      model_name: r.model_name ?? null,
      device_type: r.device_type ?? null,
      legacy_mode: r.mode ?? null,
      duration: r.duration ?? r.duration_seconds ?? null,
      wpm: r.wpm ?? null,
      clarity_score: r.clarity_score ?? null,
      transcript_nonempty: nonEmpty(transcript),
      transcript_chars: typeof transcript === 'string' ? transcript.length : 0,
      transcript_sha12: nonEmpty(transcript) ? shortHash(transcript) : null,
      status: r.status ?? r.finalization_status ?? r.persistence_status ?? null,
    };
  });

  // Seed heuristic (pre-provenance-marker): rows that share a transcript hash across >=3 sessions
  // AND are short (<=100 chars) are batch-seeded QA fixtures, not real tester recordings.
  const shaCounts = {};
  for (const s of sessionRows) if (s.transcript_sha12) shaCounts[s.transcript_sha12] = (shaCounts[s.transcript_sha12] || 0) + 1;
  for (const s of sessionRows) {
    s.seed_like = !!(s.transcript_sha12 && shaCounts[s.transcript_sha12] >= 3 && s.transcript_chars <= 100);
  }

  // ---- C. Issue reports ----
  const { data: reports, error: rErr } = await supabase
    .from('user_issue_reports')
    .select('id,user_id,session_id,created_at,category,severity,page_url,title,description,include_transcript,include_audio')
    .gte('created_at', BOUNDARY)
    .order('created_at', { ascending: true });
  if (rErr) throw new Error('reports query failed: ' + rErr.message);
  const reportRows = reports.map((r) => {
    let route = r.page_url ?? null;
    try { route = r.page_url ? new URL(r.page_url).pathname : null; } catch { /* keep raw path */ }
    return {
      report_id: r.id,
      account: alias(r.user_id),
      account_is_null: r.user_id == null,
      session_id: r.session_id ?? null,
      created_at: r.created_at,
      category: r.category,
      severity: r.severity,
      route,
      title_nonempty: nonEmpty(r.title),
      description_nonempty: nonEmpty(r.description),
      include_transcript: !!r.include_transcript,
      include_audio: !!r.include_audio,
    };
  });

  // ---- D. Relationships ----
  const sessionIds = new Set(sessionRows.map((s) => s.session_id));
  const accountsWithSessions = new Set(sessionRows.map((s) => s.account).filter(Boolean));
  const accountsWithReports = new Set(reportRows.map((r) => r.account).filter(Boolean));
  const reportsWithSession = reportRows.filter((r) => r.session_id);
  const reportsSessionResolvable = reportsWithSession.filter((r) => sessionIds.has(r.session_id));
  const reportsNullAccount = reportRows.filter((r) => r.account_is_null);
  const reportsMissingSession = reportRows.filter((r) => !r.session_id);

  out.accounts = {
    total_accounts_all_time: accounts.length,
    tester_accounts_since_boundary: testerAccounts.length,
    rows: testerAccounts.map((a) => ({ account: alias(a.id), created_at: a.created_at, last_sign_in_at: a.last_sign_in_at })),
  };
  out.sessions = { count: sessionRows.length, transcript_column: tKey, rows: sessionRows };
  out.reports = { count: reportRows.length, rows: reportRows };
  out.relationships = {
    accounts_with_sessions: accountsWithSessions.size,
    accounts_with_reports: accountsWithReports.size,
    reports_with_session_id: reportsWithSession.length,
    reports_session_id_resolvable_to_a_session: reportsSessionResolvable.length,
    reports_null_account: reportsNullAccount.length,
    reports_missing_session_id: reportsMissingSession.length,
  };
  const real = sessionRows.filter((s) => !s.seed_like);
  const distinctRealAccounts = new Set(real.map((s) => s.account).filter(Boolean));
  out.verdict = {
    tester_accounts_active_since_boundary: testerAccounts.length,
    distinct_accounts_with_real_sessions: distinctRealAccounts.size,
    total_sessions: sessionRows.length,
    seed_like_sessions: sessionRows.filter((s) => s.seed_like).length,
    real_sessions: real.length,
    // engine-based classification over REAL sessions only
    browser_sessions: real.filter((s) => s.engine_class === 'Browser').length,
    private_sessions: real.filter((s) => s.engine_class === 'Private').length,
    cloud_sessions: real.filter((s) => s.engine_class === 'Cloud').length,
    unclassified_engine_sessions: real.filter((s) => s.engine_class === 'Unclassified').length,
    issue_reports_found: reportRows.length,
    caveat: 'Inventory covers rows that REACHED the database. Attempted saves that never persisted cannot be counted here without an independent attempt/outbox signal.',
  };

  console.log('BETA_DATA_INVENTORY_JSON_BEGIN');
  console.log(JSON.stringify(out, null, 2));
  console.log('BETA_DATA_INVENTORY_JSON_END');
}

inventory().catch((e) => {
  // Never print raw content on error — only the error class/message shape.
  console.error('BETA_INVENTORY_ERROR:', e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200));
  process.exit(1);
});
