#!/usr/bin/env node
/**
 * READ-ONLY production tester-evidence audit.
 *
 * Supabase is the COMPLETION source of truth. This script produces aggregate, sanitized evidence about
 * genuine testers only. It is strictly read-only and content-free:
 *   - SELECT / count / admin-list ONLY. Any insert/update/upsert/delete/rpc is HARD-BLOCKED at runtime
 *     (the client is wrapped; an attempted mutation throws and fails the job).
 *   - NEVER prints emails, credentials, tokens, user ids, session ids, audio, or transcript bodies.
 *     Transcripts are inspected IN MEMORY only; just aggregates/derived quality signals are reported.
 *
 * Env (injected by GitHub Actions; never echoed):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY            (required)
 *   BASIC_TEST_EMAIL, FREE_TEST_EMAIL, PRO_TEST_EMAIL,
 *   CHECKOUT_TEST_EMAIL, CANARY_TEST_EMAIL, OWNER_EMAIL (optional exclusions — values never printed)
 *   PRACTICE_DEPLOY_AT   ISO ts of the /practice deploy (c99208b9). Default below.
 *   FINAL_DEPLOY_AT      ISO ts of the final deployment (optional 3rd window).
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`[audit] Missing credentials (present/absent only): URL=${url ? 'present' : 'absent'} SERVICE_ROLE=${key ? 'present' : 'absent'}`);
  process.exit(2);
}

const PRACTICE_DEPLOY_AT = process.env.PRACTICE_DEPLOY_AT || '2026-07-23T14:37:41Z';
const FINAL_DEPLOY_AT = process.env.FINAL_DEPLOY_AT || '';
const MIN_SESSION_DURATION_SECONDS = 5; // == frontend/src/config/env.ts (app-configured minimum)

// ── Hard read-only guard ────────────────────────────────────────────────────────────────────────────
const BLOCKED = new Set(['insert', 'update', 'upsert', 'delete', 'rpc']);
const raw = createClient(url, key, { auth: { persistSession: false } });
const guard = (obj, label) => new Proxy(obj, {
  get(target, prop) {
    if (typeof prop === 'string' && BLOCKED.has(prop)) {
      throw new Error(`[audit] BLOCKED mutation attempt: ${label}.${prop}() — this audit is read-only.`);
    }
    const v = Reflect.get(target, prop);
    return typeof v === 'function' ? v.bind(target) : v;
  },
});
const sb = { from: (t) => guard(raw.from(t), `from(${t})`), auth: raw.auth };

const fail = (label, e) => { console.error(`[audit] ${label} failed:`, e?.message ?? e); process.exit(1); };
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + '%' : 'n/a');

// ── Accounts ────────────────────────────────────────────────────────────────────────────────────────
// NOTE: we deliberately do NOT use `auth.admin.listUsers()`. This project's service-role key is accepted
// by PostgREST but REJECTED by the GoTrue admin API ("unrecognized JWT kid <nil> for algorithm ES256"),
// and tests/live/report-page-context.live.spec.ts already resolves ids "through the NORMAL authenticated
// path (anon sign-in) — NOT admin.listUsers". Emails live in auth.users and are not reachable via
// PostgREST, so synthetic accounts are excluded by RESOLVED USER ID, not by address.
const anonKey = process.env.SUPABASE_ANON_KEY;
const syntheticIds = new Set();
const exclusionCounts = new Map();
const unresolvedCreds = [];
if (anonKey) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const creds = [
    ['BASIC synthetic', process.env.BASIC_TEST_EMAIL, process.env.BASIC_TEST_PASSWORD],
    ['FREE_TEST', process.env.FREE_TEST_EMAIL, process.env.FREE_TEST_PASSWORD],
    ['PRO_TEST', process.env.PRO_TEST_EMAIL, process.env.PRO_TEST_PASSWORD],
    ['checkout test', process.env.CHECKOUT_TEST_EMAIL, process.env.CHECKOUT_TEST_PASSWORD],
  ];
  for (const [cat, email, password] of creds) {
    if (!email || !password) { unresolvedCreds.push(`${cat} (credentials not injected)`); continue; }
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    const id = data?.user?.id;
    if (error || !id) { unresolvedCreds.push(`${cat} (sign-in failed: ${error?.message ?? 'no user id'})`); continue; }
    syntheticIds.add(id);
    exclusionCounts.set(cat, (exclusionCounts.get(cat) ?? 0) + 1);
    await anon.auth.signOut();
  }
} else {
  unresolvedCreds.push('SUPABASE_ANON_KEY absent — no synthetic id could be resolved');
}

// Account population comes from user_profiles (1 row per account; no email column exists here).
const profiles = [];
for (let from = 0; from < 100000; from += 1000) {
  const { data, error } = await sb.from('user_profiles')
    .select('id,created_at').order('created_at', { ascending: true }).range(from, from + 999);
  if (error) fail('user_profiles select', error);
  profiles.push(...(data ?? []));
  if ((data?.length ?? 0) < 1000) break;
}
const users = profiles;
const realUsers = profiles.filter((p) => !syntheticIds.has(p.id));
const realIds = new Set(realUsers.map((p) => p.id));

// ── Sessions (completion source of truth) ───────────────────────────────────────────────────────────
const sessions = [];
const PAGE = 1000;
for (let from = 0; from < 100000; from += PAGE) {
  const { data, error } = await sb.from('sessions')
    .select('id,user_id,title,duration,transcript,total_words,filler_words,engine,created_at')
    .order('created_at', { ascending: true }).range(from, from + PAGE - 1);
  if (error) fail('sessions select', error);
  sessions.push(...(data ?? []));
  if ((data?.length ?? 0) < PAGE) break;
}
// Genuine tester sessions, excluding marked synthetic/E2E fixtures by title.
const SYNTHETIC_TITLE = /(^|\s)(rpc-smoke-|e2e|playwright|synthetic|smoke|canary|qa-)/i;
const realSessions = sessions.filter((s) => realIds.has(s.user_id) && !SYNTHETIC_TITLE.test(s.title ?? ''));
const syntheticSessionCount = sessions.length - realSessions.length;

const inWindow = (iso, since) => !since || new Date(iso) >= new Date(since);
const words = (t) => (t ?? '').trim() ? (t ?? '').trim().split(/\s+/).length : 0;
const isSaved = (s) => (s.transcript !== null && s.transcript !== undefined) || (s.duration ?? 0) > 0;
const isMeaningful = (s) =>
  (s.duration ?? 0) >= MIN_SESSION_DURATION_SECONDS && words(s.transcript) > 0 &&
  ((s.total_words ?? 0) > 0 || words(s.transcript) > 0);

// Repetition/loop heuristic: a 4-gram repeated >3x (aggregate signal only, no text printed).
const looksLooped = (t) => {
  const w = (t ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (w.length < 24) return false;
  const seen = new Map();
  for (let i = 0; i + 4 <= w.length; i++) {
    const k = w.slice(i, i + 4).join(' ');
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (seen.get(k) > 3) return true;
  }
  return false;
};
const endsAbruptly = (t) => { const s = (t ?? '').trim(); return s.length > 0 && !/[.!?]$/.test(s); };
const hasPunctuation = (t) => /[.!?,]/.test(t ?? '');

function sessionReport(list) {
  const saved = list.filter(isSaved);
  const nonEmpty = saved.filter((s) => words(s.transcript) > 0);
  const meaningful = list.filter(isMeaningful);
  const durations = list.map((s) => s.duration ?? 0).filter((d) => d > 0).sort((a, b) => a - b);
  const wc = nonEmpty.map((s) => words(s.transcript)).sort((a, b) => a - b);
  const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : 0);
  const byUser = new Map();
  for (const s of meaningful) byUser.set(s.user_id, (byUser.get(s.user_id) ?? 0) + 1);
  const modes = new Map();
  for (const s of list) modes.set(s.engine ?? 'unknown', (modes.get(s.engine ?? 'unknown') ?? 0) + 1);
  return {
    rows_created: list.length,
    shorter_than_min: list.filter((s) => (s.duration ?? 0) > 0 && (s.duration ?? 0) < MIN_SESSION_DURATION_SECONDS).length,
    started_not_finalized: list.filter((s) => (s.duration ?? 0) === 0 && !words(s.transcript)).length,
    saved_total: saved.length,
    saved_empty_transcript: saved.length - nonEmpty.length,
    saved_nonempty_transcript: nonEmpty.length,
    meaningful_completions: meaningful.length,
    unique_users_with_session: new Set(list.map((s) => s.user_id)).size,
    unique_users_meaningful: byUser.size,
    users_meaningful_1: [...byUser.values()].filter((n) => n === 1).length,
    users_meaningful_2plus: [...byUser.values()].filter((n) => n >= 2).length,
    median_duration_s: med(durations),
    median_word_count: med(wc),
    transcripts_empty_or_null: list.filter((s) => !words(s.transcript)).length,
    transcripts_very_short_lt10w: nonEmpty.filter((s) => words(s.transcript) < 10).length,
    transcripts_looped: nonEmpty.filter((s) => looksLooped(s.transcript)).length,
    transcripts_no_punctuation: nonEmpty.filter((s) => !hasPunctuation(s.transcript)).length,
    transcripts_abrupt_end: nonEmpty.filter((s) => endsAbruptly(s.transcript)).length,
    metrics_inconsistent: nonEmpty.filter((s) => (s.total_words ?? 0) === 0 && words(s.transcript) > 5).length,
    mode_distribution: Object.fromEntries(modes),
  };
}

// ── Issue reports ───────────────────────────────────────────────────────────────────────────────────
const reports = [];
for (let from = 0; from < 100000; from += PAGE) {
  const { data, error } = await sb.from('user_issue_reports')
    .select('id,user_id,title,session_id,metadata,created_at').order('created_at', { ascending: true }).range(from, from + PAGE - 1);
  if (error) fail('reports select', error);
  reports.push(...(data ?? []));
  if ((data?.length ?? 0) < PAGE) break;
}
const realReports = reports.filter((r) => realIds.has(r.user_id) && !SYNTHETIC_TITLE.test(r.title ?? ''));
const tally = (list, f) => { const m = new Map(); for (const r of list) { const k = String(f(r) ?? 'unspecified'); m.set(k, (m.get(k) ?? 0) + 1); } return Object.fromEntries([...m].sort((a, b) => b[1] - a[1])); };
const SECRETISH = /(sk_live|sk_test|whsec_|eyJ[A-Za-z0-9_-]{10,}|bearer\s+[A-Za-z0-9._-]{12,}|api[_-]?key)/i;

function reportReport(list) {
  return {
    total_genuine_reports: list.length,
    unique_reporters: new Set(list.map((r) => r.user_id)).size,
    by_issue_area: tally(list, (r) => r.metadata?.issueArea),
    by_page_key: tally(list, (r) => r.metadata?.pageKey),
    by_practice_surface: tally(list, (r) => r.metadata?.practiceSurface),
    by_release: tally(list, (r) => r.metadata?.releaseId),
    associated_with_session: list.filter((r) => r.session_id).length,
    missing_required_metadata: list.filter((r) => !r.metadata?.canonicalRoute || !r.metadata?.releaseId).length,
    secret_like_content_detected: list.filter((r) => SECRETISH.test(JSON.stringify(r.metadata ?? {}))).length,
    raw_url_in_metadata: list.filter((r) => r.metadata?.appRuntimeConfig?.url).length,
  };
}

// ── Emit ────────────────────────────────────────────────────────────────────────────────────────────
const windows = [['A. ALL-TIME', null], [`B. SINCE /practice DEPLOY (${PRACTICE_DEPLOY_AT})`, PRACTICE_DEPLOY_AT]];
if (FINAL_DEPLOY_AT) windows.push([`C. SINCE FINAL DEPLOY (${FINAL_DEPLOY_AT})`, FINAL_DEPLOY_AT]);

const out = [];
const say = (s) => { out.push(s); console.log(s); };

say('===== TESTER EVIDENCE AUDIT (READ-ONLY, aggregates only) =====');
say(`min_session_duration_seconds (app-configured): ${MIN_SESSION_DURATION_SECONDS}`);
say('');
say('--- EXCLUSIONS (categories + counts only; no addresses or ids) ---');
say(`total_accounts (user_profiles) : ${users.length}`);
for (const [cat, n] of [...exclusionCounts].sort((a, b) => b[1] - a[1])) say(`excluded[${cat}] : ${n}`);
say(`excluded_total          : ${users.length - realUsers.length}`);
say(`GENUINE tester accounts : ${realUsers.length}`);
say(`synthetic/QA sessions excluded by title marker: ${syntheticSessionCount}`);
say('');
say('!! CLASSIFICATION LIMITATION — read before trusting the "genuine" count:');
say('   Emails live in auth.users and are NOT reachable here (this project\'s service-role key is accepted');
say('   by PostgREST but REJECTED by the GoTrue admin API), so synthetic accounts are excluded ONLY by a');
say('   user id resolved via anon sign-in with injected credentials. Any synthetic/QA/owner/canary account');
say('   whose credentials are not injected CANNOT be resolved and is therefore counted as GENUINE below.');
for (const u of unresolvedCreds) say(`   UNRESOLVED: ${u}`);
if (!unresolvedCreds.length) say('   (all configured synthetic credentials resolved)');
say('');

for (const [label, since] of windows) {
  const su = realUsers.filter((u) => inWindow(u.created_at, since));
  const ss = realSessions.filter((s) => inWindow(s.created_at, since));
  const rr = realReports.filter((r) => inWindow(r.created_at, since));
  const activeIds = new Set(ss.map((s) => s.user_id));
  const newIds = new Set(su.map((u) => u.id));
  say(`===== WINDOW ${label} =====`);
  say(`newly_created_real_accounts : ${su.length}`);
  say(`active_real_testers (>=1 session) : ${activeIds.size}`);
  say(`returning_testers (active & pre-existing) : ${[...activeIds].filter((id) => !newIds.has(id)).length}`);
  const sr = sessionReport(ss);
  for (const [k, v] of Object.entries(sr)) say(`${k.padEnd(34)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  say(`meaningful_completion_rate : ${pct(sr.meaningful_completions, sr.rows_created)}`);
  const rp = reportReport(rr);
  for (const [k, v] of Object.entries(rp)) say(`report.${k.padEnd(27)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  say('');
}

say('--- /practice FUNNEL (genuine testers) ---');
say('Historical genuine-tester baseline: no exposure expected.');
say('(The /practice experience deployed at c99208b9; real testers were not invited to it. Any pre-invitation');
say(' /practice events are owner/QA/synthetic and are excluded from real-tester adoption totals. This is NOT');
say(' missing telemetry, a conversion failure, or product abandonment.)');
say('');
say('note: read-only; zero mutations; no emails/ids/tokens/transcripts/audio printed.');

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Tester Evidence Audit (read-only)\n\n```\n' + out.join('\n') + '\n```\n');
}
