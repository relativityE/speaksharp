#!/usr/bin/env node
/**
 * READ-ONLY production tester-evidence audit.
 *
 * Reports aggregate, sanitized evidence about the accounts that REMAIN after an owner-reviewed exclusion
 * manifest ("candidate testers") — NOT independently proven "genuine testers". Supabase is the completion
 * source of truth.
 *
 * SAFETY GUARANTEE (accurate): the credential is privileged; this is an APPLICATION-LEVEL constraint, NOT
 * an immutable/permission-level read-only boundary. The audit performs ONLY Auth Admin `listUsers` and
 * PostgREST `select`; a guarded wrapper throws on any insert/update/upsert/delete/rpc; Auth Admin is
 * reached only via a narrow `listUsers` wrapper; and the tests reject known mutation/RPC calls. It NEVER
 * prints emails, credentials, tokens, user ids, session ids, audio, or transcript bodies. ALL external
 * errors are reduced to an allowlist (status/code/name + operation label) — raw messages are never printed.
 *
 * Credential/reachability preflight: the audit's OWN first `listUsers` call is the preflight — it runs
 * before any totals are published and fails closed (sanitized) if the key/URL pairing or Auth Admin is
 * broken. There is no external sign-in preflight.
 *
 * Exclusion model: ONE centrally-managed manifest secret AUDIT_EXCLUDED_EMAILS_JSON — a JSON object with
 * EXACTLY the categories owner_admin/synthetic/checkout/canary/qa, each an array of valid email strings.
 * Every category must be present; blanks/invalid emails fail closed; same-category duplicates dedupe; an
 * address in two different categories FAILS CLOSED (no JSON-order / first-category-wins). Each normalized
 * address is registered with GitHub `::add-mask::` before any Auth Admin/DB op. Addresses are never
 * printed/logged/hashed/uploaded — only per-category counts and the non-secret list version.
 *
 * Completion gate: classification is complete ONLY when the manifest validates AND
 * AUDIT_EXCLUSION_LIST_VERSION is nonempty AND AUDIT_EXCLUSION_LIST_REVIEWED_AT is a valid non-future
 * timestamp AND confirm_exclusion_manifest_complete=true for this dispatch. If any fails: exit non-zero
 * BEFORE Supabase access, publish no totals, write no step summary, upload no artifact.
 *
 * Prior Auth-Admin rejection: an `invalid JWT` error was observed ONCE; exact cause UNPROVEN; no
 * client-option/perPage change is claimed to have fixed it. A successful workflow run is the evidence.
 */
import { createClient as defaultCreateClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
// ONE strict shared manifest parser used by BOTH audits (evidence + cohort). Re-exported for existing tests.
import { parseExclusionManifest } from './lib/auditManifest.mjs';
export { parseExclusionManifest };

const MIN_SESSION_DURATION_SECONDS = 5; // == frontend/src/config/env.ts (contract-tested for no drift)
const SYNTHETIC_TITLE = /(^|\s)(rpc-smoke-|e2e|playwright|synthetic|smoke|canary|qa-)/i;
const SECRETISH = /(sk_live|sk_test|whsec_|eyJ[A-Za-z0-9_-]{10,}|bearer\s+[A-Za-z0-9._-]{12,}|api[_-]?key)/i;
const PAGE = 1000;
// Narrow, unmistakable automation/reserved patterns only. Operational accounts live in the manifest.
const CODE_PATTERNS = [
  [/@example\.(com|org)$/i, 'reserved example domain'],
  [/^(e2e|playwright)[._-]/i, 'explicit E2E fixture'],
  [/\.(test|invalid)$/i, 'reserved test TLD'],
];

/** Allowlisted error shape — never the raw message (which can carry emails/tokens/URLs/UUIDs/fragments). */
const errShape = (op, e) =>
  `[audit] ${op} failed (sanitized): status=${e?.status ?? 'n/a'} code=${e?.code ?? 'n/a'} name=${e?.name ?? 'n/a'}`;

/**
 * @param {object} deps
 * @param {(addr:string)=>void} [deps.emitMask] register a normalized address with GitHub's add-mask.
 * @param {number} [deps.now] epoch ms for the non-future check (injectable for tests).
 * @returns {Promise<{ code: number, report: string|null }>} report is non-null ONLY on success.
 */
export async function runAudit({ createClient = defaultCreateClient, env = process.env, errlog = () => {}, emitMask = () => {}, now = Date.now() } = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    errlog(`[audit] Missing credentials (present/absent only): SUPABASE_URL=${url ? 'present' : 'absent'} SUPABASE_SERVICE_ROLE_KEY=${key ? 'present' : 'absent'}`);
    return { code: 2, report: null };
  }

  // ── Completion gate (ALL must pass BEFORE any Supabase access; else fail closed, no output) ───────
  const manifest = parseExclusionManifest(env.AUDIT_EXCLUDED_EMAILS_JSON);
  if (!manifest.ok) { errlog(`[audit] exclusion manifest invalid — FAILING CLOSED (no totals/summary/artifact): ${manifest.error}`); return { code: 1, report: null }; }
  const listVersion = (env.AUDIT_EXCLUSION_LIST_VERSION || '').trim();
  if (!listVersion) { errlog('[audit] AUDIT_EXCLUSION_LIST_VERSION is empty — FAILING CLOSED.'); return { code: 1, report: null }; }
  const reviewedRaw = (env.AUDIT_EXCLUSION_LIST_REVIEWED_AT || '').trim();
  const reviewedMs = reviewedRaw ? Date.parse(reviewedRaw) : NaN;
  if (Number.isNaN(reviewedMs)) { errlog('[audit] AUDIT_EXCLUSION_LIST_REVIEWED_AT is missing or not a valid timestamp — FAILING CLOSED.'); return { code: 1, report: null }; }
  if (reviewedMs > now) { errlog('[audit] AUDIT_EXCLUSION_LIST_REVIEWED_AT is in the future — FAILING CLOSED.'); return { code: 1, report: null }; }
  const confirmed = String(env.CONFIRM_EXCLUSION_MANIFEST_COMPLETE || '').trim().toLowerCase() === 'true';
  if (!confirmed) { errlog('[audit] confirm_exclusion_manifest_complete is not true — FAILING CLOSED (operator must attest manifest completeness for this window).'); return { code: 1, report: null }; }

  // Defense-in-depth masking BEFORE any Auth Admin / DB operation.
  for (const addr of manifest.byEmail.keys()) emitMask(addr);

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
    return null; // candidate tester
  };

  // ── Accounts (Auth Admin listUsers is the credential/reachability preflight) ─────────────────────
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await authAdmin.listUsers({ page, perPage: 100 });
    if (error) {
      errlog(errShape('Auth Admin listUsers (preflight)', error));
      errlog('[audit] Confirm SUPABASE_URL (variable) and SUPABASE_SERVICE_ROLE_KEY (secret) belong to the SAME project.');
      errlog('[audit] FAILING CLOSED: no sign-in fallback; no tester totals published.');
      return { code: 1, report: null };
    }
    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < 100) break;
  }
  const exclusionCounts = new Map();
  const candidateTesterUsers = [];
  for (const u of users) {
    const cat = classify(u.email);
    if (cat) exclusionCounts.set(cat, (exclusionCounts.get(cat) ?? 0) + 1);
    else candidateTesterUsers.push(u);
  }
  const candidateTesterIds = new Set(candidateTesterUsers.map((u) => u.id));

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
  const reports = await pageAll('user_issue_reports', 'id,user_id,title,session_id,severity,metadata,created_at', 'reports select');
  if (reports === null) return { code: 1, report: null };

  const candidateTesterSessions = sessions.filter((s) => candidateTesterIds.has(s.user_id) && !SYNTHETIC_TITLE.test(s.title ?? ''));
  const syntheticSessionCount = sessions.length - candidateTesterSessions.length;
  const candidateTesterReports = reports.filter((r) => candidateTesterIds.has(r.user_id) && !SYNTHETIC_TITLE.test(r.title ?? ''));

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
  /**
   * #1408s — ISSUES AND COMMENTS ARE DIFFERENT MESSAGES.
   *
   * Share Feedback asks the user whether their message is an Issue or a Comment and stores the answer as
   * `metadata.feedback_kind`. Operational triage ignored it and counted every row as a defect report, so
   * the promised routing was false: praise, questions and suggestions arrived ranked beside real defects,
   * inflating the apparent defect count and burying the actual ones.
   *
   * A row with no kind is LEGACY -- submitted before the field existed -- and is reported as `unknown`
   * rather than guessed into either bucket. Guessing would recreate the same lie in a quieter form.
   */
  /**
   * #1408 RETURN — A MISSING KIND IS NOT ALWAYS UNKNOWN.
   *
   * Before Share Feedback existed the product exposed an Issue-only journey, so every row from that era
   * IS an issue. Classifying them all as `unknown` removed genuine historical defects from issue totals
   * and from severity triage — the same inflation this work fixes, running in the other direction.
   *
   * The boundary is the Share Feedback deployment moment, supplied explicitly. It is never guessed and
   * never hard-coded: an invented timestamp would silently reclassify real rows, and being wrong in
   * either direction is worse than refusing. When a missing-kind row exists and no boundary is
   * configured, classification FAILS rather than picking a side.
   */
  const boundaryRaw = env.SHARE_FEEDBACK_DEPLOYED_AT ?? null;
  const boundaryMs = boundaryRaw ? Date.parse(boundaryRaw) : NaN;
  const boundaryUsable = Number.isFinite(boundaryMs);

  const kindOf = (r) => {
    const k = r.metadata?.feedback_kind;
    // An explicit answer always wins: a row that says what it is is never reclassified by its date.
    if (k === 'issue' || k === 'comment') return k;
    if (!boundaryUsable) return 'unclassifiable';
    const created = Date.parse(r.created_at ?? '');
    if (!Number.isFinite(created)) return 'unknown';
    return created < boundaryMs ? 'legacy_issue' : 'unknown';
  };
  /** Everything that counts as a defect report: explicit Issues plus pre-boundary legacy rows. */
  const isIssueLike = (r) => { const k = kindOf(r); return k === 'issue' || k === 'legacy_issue'; };
  const reportReport = (list) => ({
    candidate_tester_reports: list.length,
    // The defect-bearing subset. Severity ranking applies to THIS, never to the whole list.
    // Issues INCLUDING pre-boundary legacy rows, which came from an Issue-only journey.
    issues: list.filter(isIssueLike).length,
    issues_explicit: list.filter((r) => kindOf(r) === 'issue').length,
    issues_legacy: list.filter((r) => kindOf(r) === 'legacy_issue').length,
    comments: list.filter((r) => kindOf(r) === 'comment').length,
    // Post-boundary and missing: an instrumentation defect, never guessed into a bucket.
    unknown_kind: list.filter((r) => kindOf(r) === 'unknown').length,
    // No boundary configured while missing-kind rows exist: we decline to classify rather than pick.
    unclassifiable_no_boundary: list.filter((r) => kindOf(r) === 'unclassifiable').length,
    share_feedback_boundary_configured: boundaryUsable,
    by_feedback_kind: tally(list, kindOf),
    // Severity is meaningful only for defect reports. Ranking a compliment by "impact" is how a Comment
    // came to be presented as a defect in the first place.
    issue_severity: tally(list.filter(isIssueLike), (r) => r.severity ?? r.metadata?.severity),
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
  const PRACTICE_DEPLOY_AT = env.PRACTICE_DEPLOY_AT || '2026-07-23T14:37:41Z';
  const FINAL_DEPLOY_AT = env.FINAL_DEPLOY_AT || '';
  const out = [];
  const say = (s) => out.push(s);
  say('===== TESTER EVIDENCE AUDIT (READ-ONLY, aggregates only) =====');
  say('auth_key: SUPABASE_SERVICE_ROLE_KEY (secret) — value consumed only by the Supabase client; never printed, logged, transformed, or included in the report.');
  say(`exclusion_list_version : ${listVersion}`);
  say(`exclusion_list_reviewed_at : ${reviewedRaw}`);
  say(`min_session_duration_seconds (app-configured): ${MIN_SESSION_DURATION_SECONDS}`);
  say('');
  say('--- EXCLUSIONS (category NAMES + counts only; no addresses or ids) ---');
  say(`total_auth_accounts_scanned : ${users.length}`);
  for (const [cat, n] of [...exclusionCounts].sort((a, b) => b[1] - a[1])) say(`excluded[${cat}] : ${n}`);
  say(`excluded_total          : ${users.length - candidateTesterUsers.length}`);
  say('classification_complete : true'); // gated above: manifest valid + version + non-future reviewed_at + confirmed
  say(`candidate_tester_accounts : ${candidateTesterUsers.length}`);
  say(`synthetic/QA sessions excluded by title marker: ${syntheticSessionCount}`);
  say('');

  const windows = [['A. ALL-TIME', null], [`B. SINCE /practice DEPLOY (${PRACTICE_DEPLOY_AT})`, PRACTICE_DEPLOY_AT]];
  if (FINAL_DEPLOY_AT) windows.push([`C. SINCE FINAL DEPLOY (${FINAL_DEPLOY_AT})`, FINAL_DEPLOY_AT]);
  for (const [label, since] of windows) {
    const su = candidateTesterUsers.filter((u) => inWindow(u.created_at, since));
    const ss = candidateTesterSessions.filter((s) => inWindow(s.created_at, since));
    const rr = candidateTesterReports.filter((r) => inWindow(r.created_at, since));
    const activeIds = new Set(ss.map((s) => s.user_id));
    const newIds = new Set(su.map((u) => u.id));
    say(`===== WINDOW ${label} =====`);
    say(`newly_created_candidate_accounts : ${su.length}`);
    say(`active_candidate_testers (>=1 session) : ${activeIds.size}`);
    say(`returning_candidate_testers (active & pre-existing) : ${[...activeIds].filter((id) => !newIds.has(id)).length}`);
    const sr = sessionReport(ss);
    for (const [k, v] of Object.entries(sr)) say(`${k.padEnd(34)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    say(`meaningful_completion_rate : ${pct(sr.meaningful_completions, sr.rows_created)}`);
    const rp = reportReport(rr);
    for (const [k, v] of Object.entries(rp)) say(`report.${k.padEnd(27)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    say('');
  }

  say('--- /practice FUNNEL (candidate testers) ---');
  say('Historical candidate-tester baseline: no exposure expected.');
  say('(The /practice experience deployed at c99208b9; candidate testers were not invited to it. Any');
  say(' pre-invitation /practice events are owner/QA/synthetic and are excluded. This is NOT missing');
  say(' telemetry, a conversion failure, or product abandonment. No historical /practice conversion is computed.)');
  say('');
  say('--- CONCLUSION ---');
  say('These aggregates represent accounts REMAINING after the owner-reviewed exclusion manifest');
  say(`(version ${listVersion}, reviewed ${reviewedRaw}, operator-confirmed complete) — NOT independently`);
  say('proven "genuine testers". Completeness is only as good as the manifest\'s maintenance.');
  say('');
  say('note: read-only; only Auth Admin listUsers + PostgREST select were performed; no emails/ids/tokens/transcripts/audio printed.');
  return { code: 0, report: out.join('\n') };
}

// ── CLI runner (only when invoked directly) ──────────────────────────────────────────────────────────
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  // add-mask MUST reach the live Actions log (not a redirected file), so the workflow does NOT redirect
  // stdout; the report is written to AUDIT_REPORT_FILE for the artifact. The report contains no addresses.
  const emitMask = (a) => process.stdout.write(`::add-mask::${a}\n`);
  const { code, report } = await runAudit({ emitMask, errlog: (m) => process.stderr.write(String(m) + '\n') });
  if (report != null) {
    process.stdout.write(report + '\n');
    const { writeFileSync, appendFileSync } = await import('node:fs');
    if (process.env.AUDIT_REPORT_FILE) writeFileSync(process.env.AUDIT_REPORT_FILE, report + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Tester Evidence Audit (read-only)\n\n```\n' + report + '\n```\n');
  }
  process.exit(code);
}
