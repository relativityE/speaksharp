#!/usr/bin/env node
/**
 * READ-ONLY production tester-evidence audit.
 *
 * Supabase is the COMPLETION source of truth. Produces aggregate, sanitized evidence about genuine
 * testers only. Strictly read-only and content-free:
 *   - PostgREST access is limited to SELECT via a guarded wrapper (insert/update/upsert/delete/rpc throw).
 *   - Auth Admin is exposed to audit logic ONLY through a narrow `listUsers` wrapper — no createUser,
 *     updateUserById, deleteUser, inviteUserByEmail, generateLink, or MFA/admin mutation is reachable.
 *   - NEVER prints emails, credentials, tokens, user ids, session ids, audio, or transcript bodies.
 *     Transcripts are inspected IN MEMORY only; only aggregates / derived quality signals are emitted.
 *
 * Auth key: this repository provisions SUPABASE_SERVICE_ROLE_KEY (verified across repo/org/environment
 * secret scopes; no SUPABASE_SECRET_KEY exists in any scope available to this workflow). The audit uses
 * SUPABASE_SERVICE_ROLE_KEY directly, mirroring the established Auth-Admin callers
 * (scripts/verify-test-users.mjs, canary-ceiling.mjs, setup-test-users.mjs). Migrating those workflows to
 * a renamed key is out of scope for this audit.
 *
 * Prior Auth-Admin rejection: an `invalid JWT` error was observed ONCE in an earlier run; its exact cause
 * is unproven. This audit now mirrors the established repository Auth-Admin client and FAILS CLOSED (no
 * totals, non-zero exit) if the rejection recurs.
 *
 * Env (injected by GitHub Actions; never echoed):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY             (required)
 *   BASIC_TEST_EMAIL, FREE_TEST_EMAIL, PRO_TEST_EMAIL,
 *   CHECKOUT_TEST_EMAIL, CANARY_TEST_EMAIL, OWNER_EMAIL (optional exclusions — IN-MEMORY classification
 *                                                        only; values never printed)
 *   PRACTICE_DEPLOY_AT, FINAL_DEPLOY_AT                 ISO window boundaries.
 */
import { createClient as defaultCreateClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

const MIN_SESSION_DURATION_SECONDS = 5; // == frontend/src/config/env.ts (app-configured minimum)
// Public, non-secret canary address (hardcoded in .github/workflows/canary.yml + tests/unit/canaryProvision.test.js).
const CANARY_CONST = 'canary@speaksharp.app';
const SYNTHETIC_TITLE = /(^|\s)(rpc-smoke-|e2e|playwright|synthetic|smoke|canary|qa-)/i;
const SECRETISH = /(sk_live|sk_test|whsec_|eyJ[A-Za-z0-9_-]{10,}|bearer\s+[A-Za-z0-9._-]{12,}|api[_-]?key)/i;
const PAGE = 1000;

/**
 * @returns {Promise<{ code: number, report: string|null }>} report is non-null ONLY on success (code 0).
 * On any failure the report is null so a failed run can never publish a successful-looking artifact.
 */
export async function runAudit({ createClient = defaultCreateClient, env = process.env, errlog = () => {} } = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY; // exact configured key name; no ambiguous fallback.
  if (!url || !key) {
    errlog(`[audit] Missing credentials (present/absent only): URL=${url ? 'present' : 'absent'} SERVICE_ROLE_KEY=${key ? 'present' : 'absent'}`);
    return { code: 2, report: null };
  }

  const PRACTICE_DEPLOY_AT = env.PRACTICE_DEPLOY_AT || '2026-07-23T14:37:41Z';
  const FINAL_DEPLOY_AT = env.FINAL_DEPLOY_AT || '';

  // ── Clients ─────────────────────────────────────────────────────────────────────────────────────
  const clientOpts = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

  // Auth Admin exposed ONLY as listUsers — no mutating admin method is handed to audit logic.
  const authClient = createClient(url, key, clientOpts);
  const authAdmin = { listUsers: (opts) => authClient.auth.admin.listUsers(opts) };

  // PostgREST read-only guard: any mutating verb throws.
  const BLOCKED = new Set(['insert', 'update', 'upsert', 'delete', 'rpc']);
  const pgClient = createClient(url, key, clientOpts);
  const guard = (obj, label) => new Proxy(obj, {
    get(target, prop) {
      if (typeof prop === 'string' && BLOCKED.has(prop)) {
        throw new Error(`[audit] BLOCKED mutation attempt: ${label}.${prop}() — this audit is read-only.`);
      }
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const sb = { from: (t) => guard(pgClient.from(t), `from(${t})`) };

  // ── Exclusions: IN-MEMORY email classification (addresses never printed) ─────────────────────────
  const freeEmail = env.FREE_TEST_EMAIL || env.BASIC_TEST_EMAIL; // established fallback (rc-gates/setup-test-users)
  const configured = [
    ['BASIC synthetic', env.BASIC_TEST_EMAIL], ['FREE_TEST', freeEmail], ['PRO_TEST', env.PRO_TEST_EMAIL],
    ['checkout test', env.CHECKOUT_TEST_EMAIL], ['canary', env.CANARY_TEST_EMAIL || CANARY_CONST],
    ['owner/admin', env.OWNER_EMAIL],
  ];
  // First category wins per address (so FREE resolving to BASIC does not double-count or reclassify).
  const EXCLUDE_EXACT = new Map();
  for (const [cat, v] of configured) {
    const e = (v || '').trim().toLowerCase();
    if (e && !EXCLUDE_EXACT.has(e)) EXCLUDE_EXACT.set(e, cat);
  }
  const freeAliasesBasic = !!(env.BASIC_TEST_EMAIL && (!env.FREE_TEST_EMAIL || env.FREE_TEST_EMAIL === env.BASIC_TEST_EMAIL));
  const EXCLUDE_PATTERNS = [
    [/\+(e2e|qa|test|canary|smoke|auto)[^@]*@/i, 'plus-tagged QA/E2E fixture'],
    [/@example\.(com|org)$/i, 'example.com fixture'],
    [/^(e2e|qa|test|canary|smoke|playwright|soak)[._-]/i, 'QA-prefixed fixture'],
    [/\.(test|invalid)$/i, 'reserved test TLD'],
  ];
  const classify = (email) => {
    const e = (email || '').trim().toLowerCase();
    if (!e) return 'missing-email';
    if (EXCLUDE_EXACT.has(e)) return EXCLUDE_EXACT.get(e);
    for (const [re, label] of EXCLUDE_PATTERNS) if (re.test(e)) return label;
    return null; // genuine tester
  };
  // owner/admin stays explicitly incomplete unless an address is configured.
  const unconfiguredExclusions = [
    ['owner/admin', env.OWNER_EMAIL],
    ['PRO_TEST', env.PRO_TEST_EMAIL], ['checkout test', env.CHECKOUT_TEST_EMAIL],
  ].filter(([, v]) => !v).map(([cat]) => cat);

  // ── Accounts (Auth Admin inventory — established server-side model; paginated at perPage 100) ────
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await authAdmin.listUsers({ page, perPage: 100 });
    if (error) {
      errlog(`[audit] Auth Admin user inventory failed (sanitized): status=${error.status ?? 'n/a'} name=${error.name ?? 'n/a'}`);
      errlog('[audit] Confirm SUPABASE_URL (variable) and SUPABASE_SERVICE_ROLE_KEY belong to the SAME Supabase project.');
      errlog('[audit] FAILING CLOSED: no fallback to synthetic-account sign-ins; no tester totals published.');
      return { code: 1, report: null };
    }
    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < 100) break;
  }

  const exclusionCounts = new Map();
  const realUsers = [];
  for (const u of users) {
    const cat = classify(u.email);
    if (cat) exclusionCounts.set(cat, (exclusionCounts.get(cat) ?? 0) + 1);
    else realUsers.push(u);
  }
  const realIds = new Set(realUsers.map((u) => u.id));

  // ── Sessions (completion source of truth) ───────────────────────────────────────────────────────
  const sessions = [];
  for (let from = 0; from < 200000; from += PAGE) {
    const { data, error } = await sb.from('sessions')
      .select('id,user_id,title,duration,transcript,total_words,filler_words,engine,created_at')
      .order('created_at', { ascending: true }).range(from, from + PAGE - 1);
    if (error) { errlog(`[audit] sessions select failed: ${error.message ?? error}`); return { code: 1, report: null }; }
    sessions.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  const realSessions = sessions.filter((s) => realIds.has(s.user_id) && !SYNTHETIC_TITLE.test(s.title ?? ''));
  const syntheticSessionCount = sessions.length - realSessions.length;

  // ── Issue reports ────────────────────────────────────────────────────────────────────────────────
  const reports = [];
  for (let from = 0; from < 200000; from += PAGE) {
    const { data, error } = await sb.from('user_issue_reports')
      .select('id,user_id,title,session_id,metadata,created_at').order('created_at', { ascending: true }).range(from, from + PAGE - 1);
    if (error) { errlog(`[audit] reports select failed: ${error.message ?? error}`); return { code: 1, report: null }; }
    reports.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  const realReports = reports.filter((r) => realIds.has(r.user_id) && !SYNTHETIC_TITLE.test(r.title ?? ''));

  // ── Derivations (aggregate only) ─────────────────────────────────────────────────────────────────
  const inWindow = (iso, since) => !since || new Date(iso) >= new Date(since);
  const words = (t) => ((t ?? '').trim() ? (t ?? '').trim().split(/\s+/).length : 0);
  const isSaved = (s) => (s.transcript !== null && s.transcript !== undefined) || (s.duration ?? 0) > 0;
  const isMeaningful = (s) => (s.duration ?? 0) >= MIN_SESSION_DURATION_SECONDS && words(s.transcript) > 0;
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
  const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + '%' : 'n/a');

  const sessionReport = (list) => {
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
  };
  const tally = (list, f) => { const m = new Map(); for (const r of list) { const k = String(f(r) ?? 'unspecified'); m.set(k, (m.get(k) ?? 0) + 1); } return Object.fromEntries([...m].sort((a, b) => b[1] - a[1])); };
  const reportReport = (list) => ({
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
  });

  // ── Emit (aggregates only) ───────────────────────────────────────────────────────────────────────
  const out = [];
  const say = (s) => out.push(s);
  say('===== TESTER EVIDENCE AUDIT (READ-ONLY, aggregates only) =====');
  say(`auth_key_env_var_used  : SUPABASE_SERVICE_ROLE_KEY (name only; value never read, printed, or transformed)`);
  say(`min_session_duration_seconds (app-configured): ${MIN_SESSION_DURATION_SECONDS}`);
  say('');
  say('--- EXCLUSIONS (categories + counts only; no addresses or ids) ---');
  say(`total_auth_accounts_scanned : ${users.length}`);
  for (const [cat, n] of [...exclusionCounts].sort((a, b) => b[1] - a[1])) say(`excluded[${cat}] : ${n}`);
  say(`excluded_total          : ${users.length - realUsers.length}`);
  say(`GENUINE tester accounts : ${realUsers.length}`);
  say(`synthetic/QA sessions excluded by title marker: ${syntheticSessionCount}`);
  if (freeAliasesBasic) say('note: FREE_TEST resolves to the BASIC address (shared account) — counted once under BASIC synthetic.');
  say('');
  if (unconfiguredExclusions.length) {
    say('!! CLASSIFICATION COMPLETENESS — read before trusting the "genuine" count:');
    say('   Exclusion is by exact email match (in memory) + QA-fixture patterns + the hardcoded canary const.');
    say('   These categories have NO address configured, so such an account would be counted as GENUINE:');
    for (const c of unconfiguredExclusions) say(`   UNCONFIGURED: ${c}`);
    say('   Treat the genuine-tester total as an UPPER BOUND until these are configured.');
  } else {
    say('classification_completeness: all exclusion categories configured.');
  }
  say('');

  const windows = [['A. ALL-TIME', null], [`B. SINCE /practice DEPLOY (${PRACTICE_DEPLOY_AT})`, PRACTICE_DEPLOY_AT]];
  if (FINAL_DEPLOY_AT) windows.push([`C. SINCE FINAL DEPLOY (${FINAL_DEPLOY_AT})`, FINAL_DEPLOY_AT]);
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
  say(' missing telemetry, a conversion failure, or product abandonment. No historical /practice conversion is computed.)');
  say('');
  say('note: read-only; zero mutations; no emails/ids/tokens/transcripts/audio printed.');
  return { code: 0, report: out.join('\n') };
}

// ── CLI runner (only when invoked directly) ──────────────────────────────────────────────────────────
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const { code, report } = await runAudit({ errlog: (m) => process.stderr.write(String(m) + '\n') });
  if (report != null) {
    process.stdout.write(report + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Tester Evidence Audit (read-only)\n\n```\n' + report + '\n```\n');
    }
  }
  process.exit(code);
}
