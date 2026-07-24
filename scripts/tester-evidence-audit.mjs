#!/usr/bin/env node
/**
 * READ-ONLY production tester-evidence audit.
 *
 * Supabase is the COMPLETION source of truth. Produces aggregate, sanitized evidence about genuine
 * testers only.
 *
 * SAFETY GUARANTEE (stated accurately): the credential is privileged; this is an APPLICATION-LEVEL
 * constraint, NOT an immutable or permission-level read-only boundary. Concretely, the audit performs
 * ONLY Auth Admin `listUsers` and PostgREST `select` operations; a guarded wrapper throws on any
 * insert/update/upsert/delete/rpc, Auth Admin is reached only via a narrow `listUsers` wrapper, and the
 * accompanying tests reject known mutation/RPC calls. It NEVER prints emails, credentials, tokens, user
 * ids, session ids, audio, or transcript bodies — transcripts are inspected in memory and only aggregates
 * / derived quality signals are emitted. ALL external errors are reduced to an allowlist (status/code/name
 * + operation label); raw error messages are never printed.
 *
 * Auth key: this workflow uses the repository's established SUPABASE_SERVICE_ROLE_KEY (a GitHub Actions
 * SECRET), and SUPABASE_URL (a GitHub Actions VARIABLE). See product_release/ENV_INVENTORY.md for the
 * dated name/scope inventory — never values.
 *
 * Exclusion model: non-testers are defined by ONE centrally-managed manifest secret,
 * AUDIT_EXCLUDED_EMAILS_JSON (a JSON object of categorized arrays: owner_admin, synthetic, checkout,
 * canary, qa). It is REQUIRED and parsed in memory only; missing/malformed/empty/unknown-category/
 * non-array configuration FAILS CLOSED (non-zero exit, no totals, no summary, no artifact). Addresses are
 * never printed, logged, hashed, or uploaded — only per-category counts and the non-secret
 * AUDIT_EXCLUSION_LIST_VERSION. Narrow code patterns remain only for unmistakable reserved/automation
 * domains. The audit no longer consumes the individual OWNER_EMAIL/BASIC/FREE/PRO/CHECKOUT email secrets.
 *
 * Prior Auth-Admin rejection: an `invalid JWT` signature error was observed ONCE; its exact cause is
 * UNPROVEN. No client-option or perPage change is claimed to have fixed it. The audit mirrors the
 * established Auth-Admin client and FAILS CLOSED if it recurs; a successful workflow run is the evidence.
 */
import { createClient as defaultCreateClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

const MIN_SESSION_DURATION_SECONDS = 5; // == frontend/src/config/env.ts (contract-tested for no drift)
const SYNTHETIC_TITLE = /(^|\s)(rpc-smoke-|e2e|playwright|synthetic|smoke|canary|qa-)/i;
const SECRETISH = /(sk_live|sk_test|whsec_|eyJ[A-Za-z0-9_-]{10,}|bearer\s+[A-Za-z0-9._-]{12,}|api[_-]?key)/i;
const PAGE = 1000;
const MANIFEST_CATEGORIES = ['owner_admin', 'synthetic', 'checkout', 'canary', 'qa'];
// Narrow, unmistakable automation/reserved patterns ONLY. Operational accounts live in the manifest.
const CODE_PATTERNS = [
  [/@example\.(com|org)$/i, 'reserved example domain'],
  [/^(e2e|playwright)[._-]/i, 'explicit E2E fixture'],
  [/\.(test|invalid)$/i, 'reserved test TLD'],
];

/** Allowlisted error shape — never the raw message (which can carry emails/tokens/URLs/UUIDs/fragments). */
const errShape = (op, e) =>
  `[audit] ${op} failed (sanitized): status=${e?.status ?? 'n/a'} code=${e?.code ?? 'n/a'} name=${e?.name ?? 'n/a'}`;

/**
 * Parse + validate the exclusion manifest. Category NAMES may appear in errors (not secret); addresses
 * never do. @returns {{ ok: true, byEmail: Map<string,string> } | { ok: false, error: string }}
 */
export function parseExclusionManifest(raw) {
  if (!raw || !raw.trim()) return { ok: false, error: 'AUDIT_EXCLUDED_EMAILS_JSON is absent/empty' };
  let obj;
  try { obj = JSON.parse(raw); } catch { return { ok: false, error: 'AUDIT_EXCLUDED_EMAILS_JSON is not valid JSON' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'manifest must be a JSON object of categorized arrays' };
  const keys = Object.keys(obj);
  if (keys.length === 0) return { ok: false, error: 'manifest object is empty' };
  const unknown = keys.filter((k) => !MANIFEST_CATEGORIES.includes(k));
  if (unknown.length) return { ok: false, error: `manifest has unknown category name(s): ${unknown.join(', ')}` };
  const byEmail = new Map(); // first-category-wins dedupe
  for (const cat of keys) {
    const arr = obj[cat];
    if (!Array.isArray(arr)) return { ok: false, error: `category '${cat}' must be an array` };
    for (const entry of arr) {
      if (typeof entry !== 'string') return { ok: false, error: `category '${cat}' contains a non-string entry` };
      const norm = entry.trim().toLowerCase();
      if (norm && !byEmail.has(norm)) byEmail.set(norm, cat);
    }
  }
  if (byEmail.size === 0) return { ok: false, error: 'manifest contains no addresses' };
  return { ok: true, byEmail };
}

/** @returns {Promise<{ code: number, report: string|null }>} report is non-null ONLY on success. */
export async function runAudit({ createClient = defaultCreateClient, env = process.env, errlog = () => {} } = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    errlog(`[audit] Missing credentials (present/absent only): SUPABASE_URL=${url ? 'present' : 'absent'} SUPABASE_SERVICE_ROLE_KEY=${key ? 'present' : 'absent'}`);
    return { code: 2, report: null };
  }

  // Manifest is REQUIRED: validate BEFORE constructing any client or touching data (fail closed).
  const manifest = parseExclusionManifest(env.AUDIT_EXCLUDED_EMAILS_JSON);
  if (!manifest.ok) {
    errlog(`[audit] Exclusion manifest invalid — FAILING CLOSED (no totals, no artifact): ${manifest.error}`);
    return { code: 1, report: null };
  }
  const listVersion = (env.AUDIT_EXCLUSION_LIST_VERSION || 'unset').trim();
  const PRACTICE_DEPLOY_AT = env.PRACTICE_DEPLOY_AT || '2026-07-23T14:37:41Z';
  const FINAL_DEPLOY_AT = env.FINAL_DEPLOY_AT || '';

  // ── Clients ─────────────────────────────────────────────────────────────────────────────────────
  const clientOpts = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
  const authClient = createClient(url, key, clientOpts);
  const authAdmin = { listUsers: (opts) => authClient.auth.admin.listUsers(opts) }; // narrow: listUsers only
  const BLOCKED = new Set(['insert', 'update', 'upsert', 'delete', 'rpc']);
  const pgClient = createClient(url, key, clientOpts);
  const guard = (obj, label) => new Proxy(obj, {
    get(target, prop) {
      if (typeof prop === 'string' && BLOCKED.has(prop)) throw new Error(`[audit] BLOCKED mutation attempt: ${label}.${prop}() — read-only.`);
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const sb = { from: (t) => guard(pgClient.from(t), `from(${t})`) };

  const classify = (email) => {
    const e = (email || '').trim().toLowerCase();
    if (!e) return 'missing-email';
    if (manifest.byEmail.has(e)) return manifest.byEmail.get(e);
    for (const [re, label] of CODE_PATTERNS) if (re.test(e)) return label;
    return null; // candidate genuine tester
  };

  // ── Accounts (Auth Admin listUsers; paginated at perPage 100) ────────────────────────────────────
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await authAdmin.listUsers({ page, perPage: 100 });
    if (error) {
      errlog(errShape('Auth Admin listUsers', error));
      errlog('[audit] Confirm SUPABASE_URL (variable) and SUPABASE_SERVICE_ROLE_KEY (secret) belong to the SAME project.');
      errlog('[audit] FAILING CLOSED: no sign-in fallback; no tester totals published.');
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

  // ── Sessions + reports (read-only select; sanitized errors) ──────────────────────────────────────
  const pageAll = async (table, cols, op) => {
    const rows = [];
    for (let from = 0; from < 200000; from += PAGE) {
      const { data, error } = await sb.from(table).select(cols).order('created_at', { ascending: true }).range(from, from + PAGE - 1);
      if (error) { errlog(errShape(op, error)); return null; }
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < PAGE) break;
    }
    return rows;
  };
  const sessions = await pageAll('sessions', 'id,user_id,title,duration,transcript,total_words,filler_words,engine,created_at', 'sessions select');
  if (sessions === null) return { code: 1, report: null };
  const reports = await pageAll('user_issue_reports', 'id,user_id,title,session_id,metadata,created_at', 'reports select');
  if (reports === null) return { code: 1, report: null };

  const realSessions = sessions.filter((s) => realIds.has(s.user_id) && !SYNTHETIC_TITLE.test(s.title ?? ''));
  const syntheticSessionCount = sessions.length - realSessions.length;
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
    for (let i = 0; i + 4 <= w.length; i++) { const k = w.slice(i, i + 4).join(' '); seen.set(k, (seen.get(k) ?? 0) + 1); if (seen.get(k) > 3) return true; }
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

  // ── Emit (aggregates + category NAMES/counts + version only) ─────────────────────────────────────
  const out = [];
  const say = (s) => out.push(s);
  say('===== TESTER EVIDENCE AUDIT (READ-ONLY, aggregates only) =====');
  say('auth_key: SUPABASE_SERVICE_ROLE_KEY (secret) — value consumed only by the Supabase client; never printed, logged, transformed, or included in the report.');
  say(`exclusion_list_version : ${listVersion}`);
  say(`min_session_duration_seconds (app-configured): ${MIN_SESSION_DURATION_SECONDS}`);
  say('');
  say('--- EXCLUSIONS (category NAMES + counts only; no addresses or ids) ---');
  say(`total_auth_accounts_scanned : ${users.length}`);
  for (const [cat, n] of [...exclusionCounts].sort((a, b) => b[1] - a[1])) say(`excluded[${cat}] : ${n}`);
  say(`excluded_total          : ${users.length - realUsers.length}`);
  // The manifest is required + validated (we fail closed otherwise), so classification is complete here.
  say('classification_complete : true');
  say(`genuine_tester_accounts : ${realUsers.length}`);
  say(`synthetic/QA sessions excluded by title marker: ${syntheticSessionCount}`);
  say('note: completeness reflects exclusion_list_version above; an exclusion manifest is only as complete as its maintenance.');
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
  say('--- FINAL TESTER-COMPLETION CONCLUSION ---');
  say('classification_complete=true — a tester-completion conclusion may be drawn from the aggregates above,');
  say('subject to the maintenance of exclusion_list_version.');
  say('');
  say('note: read-only; only Auth Admin listUsers + PostgREST select were performed; no emails/ids/tokens/transcripts/audio printed.');
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
