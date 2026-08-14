#!/usr/bin/env node
/**
 * #1087 Phase 1/2 — PER-ACCOUNT tester cohort audit (READ-ONLY).
 *
 * Why this exists: `tester-evidence-audit.mjs` reports COHORT AGGREGATES only, so it cannot answer
 * "which humans tried SpeakSharp, what did they do, and did they report anything" — including testers
 * with ZERO activity and ZERO reports. It also treats every non-excluded account as a candidate tester,
 * which massively over-counts: the test suite mints accounts on @example.com, @test.com and
 * reserved test domains (several with per-run timestamps), so automated accounts were being reported as testers.
 *
 * This script adds ONLY what is missing:
 *   - pattern-based classification (automated / internal / human) so the human cohort is trustworthy
 *   - a per-account rollup for human accounts, including zero-activity ones
 *
 * PRIVACY (hard rules):
 *   - NEVER prints an email address, raw user id, JWT, transcript, audio detail or report body.
 *   - Each account is identified ONLY by a stable pseudonym: t_<10 hex> = HMAC-SHA256(key=salt,
 *     msg=user_id) via node:crypto createHmac — stable within a run so rows can be discussed, never
 *     reversible to identity without the salt and the restricted mapping.
 *   - The restricted identity mapping (pseudonym -> email) is written to a SEPARATE file that is only
 *     uploaded as the restricted, short-retention Product Owner artifact.
 *
 * READ-ONLY: Auth Admin listUsers + PostgREST selects. No insert/update/delete/RPC. No production
 * mutation of any kind.
 */
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SANITIZED_OUT = process.env.COHORT_SANITIZED_FILE || 'cohort-sanitized.json';
const RESTRICTED_OUT = process.env.COHORT_RESTRICTED_FILE || 'cohort-restricted.json';
/** Invitation cutoff (UTC). Source: product_release/SOFT_RELEASE_TESTER_INSTRUCTIONS.md finalized #993/#994. */
const INVITE_CUTOFF = process.env.INVITE_CUTOFF || '2026-07-18T00:00:00Z';
/** A session shorter than this is "short/junk" — it cannot support a precise delivery judgement. */
const SHORT_SESSION_SECONDS = Number(process.env.SHORT_SESSION_SECONDS || 20);

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[cohort] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. FAILING CLOSED.');
    process.exit(1);
}

/** Stable, non-reversible pseudonym for an account. Never derived from the email. */
const PSEUDO_SALT = process.env.COHORT_PSEUDONYM_SALT || '';
if (!PSEUDO_SALT) { console.error('[cohort] COHORT_PSEUDONYM_SALT required (secret-salted pseudonyms). FAILING CLOSED.'); process.exit(1); }
// Real HMAC-SHA256 keyed by the salt — not a salt||id concatenation fed to a plain hash. Keyed HMAC
// is the correct construction for a non-reversible, salt-bound pseudonym.
const pseudo = (userId) => 't_' + createHmac('sha256', PSEUDO_SALT).update(String(userId)).digest('hex').slice(0, 10);

/**
 * Automated accounts created by the test suite / CI. These are NOT testers and must never appear in
 * the human cohort. Derived from the actual generators in tests/ and scripts/.
 */
const AUTOMATED_DOMAINS = [/@example\.com$/i, /@test\.com$/i];
const AUTOMATED_LOCAL_PREFIXES = [
    /^first-time-tester-/i, /^stt-corpus-/i, /^private-sample-telemetry-/i, // historical residue cleanup only
    /^private-decode-ab-/i,
    /^private-longform/i, /^tester-b-/i, /^account-mutex/i, /^ux-[a-z]+-/i, /^soak-test/i,
    /^canary/i, /^visual-/i, /^manual-pro-cloud-/i, /^free-user$/i, /^pro-user$/i,
];
/** Internal humans (owner/dev/QA). Supplied via the reviewed exclusion manifest, addresses never printed. */
function parseInternal() {
    const raw = process.env.AUDIT_EXCLUDED_EMAILS_JSON;
    if (!raw) return new Set();
    // FAIL CLOSED on a malformed manifest. Silently returning an empty set (the old behaviour) would
    // treat every internal owner/dev/QA account as NON-excluded, misclassifying them as human-likely
    // testers — the exact over-count this manifest exists to prevent. A manifest that was supplied but
    // cannot be parsed is an operator error, not "no exclusions": abort rather than emit a wrong cohort.
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        console.error(`[cohort] AUDIT_EXCLUDED_EMAILS_JSON is set but not valid JSON. FAILING CLOSED. (${e.message})`);
        process.exit(1);
    }
    const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? Object.values(parsed).flat() : null);
    if (!Array.isArray(list)) {
        console.error('[cohort] AUDIT_EXCLUDED_EMAILS_JSON parsed but is not an array or object of arrays. FAILING CLOSED.');
        process.exit(1);
    }
    return new Set(list.filter((x) => typeof x === 'string').map((s) => s.trim().toLowerCase()));
}

/**
 * Classification is EVIDENCE-BASED, never an assertion of invitation. 'human-likely' means "does not
 * match any known automation or internal pattern" — it does NOT mean the account was invited. The
 * confirmed invited roster is unavailable to this audit and must never be inferred from account
 * existence.
 */
function classify(email, internalSet) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return 'unknown';
    if (internalSet.has(e)) return 'internal';
    const local = e.split('@')[0] ?? '';
    if (AUTOMATED_DOMAINS.some((re) => re.test(e))) return 'automation';
    if (AUTOMATED_LOCAL_PREFIXES.some((re) => re.test(local))) return 'automation';
    return 'human-likely';
}

/**
 * Pause-sensor field evidence (COUNTS ONLY — no values ever leave this function).
 *
 * The question this answers: is the pause sensor actually producing valid persisted data in the
 * field, or are we shipping a dead sensor? `pause_metrics: {}` is the reason this cannot be a simple
 * present/absent count — an empty object is TRUTHY, so it sails through any `if (session.pause_metrics)`
 * guard and then contributes a 0 to every pause aggregate. Object truthiness is not measurement.
 *
 * Structural validity mirrors `hasValidPauseEvidence` (frontend/src/utils/metricValidity.ts, #1045):
 * all four evidence fields present and finite. A structurally valid all-zero snapshot is a MEASURED
 * zero and is kept in its own bucket — "no long pauses" is a real finding, and it must stay
 * distinguishable from "no measurement".
 */
const PAUSE_EVIDENCE_FIELDS = ['silencePercentage', 'transitionPauses', 'extendedPauses', 'longestPause'];

function classifyPauseSnapshot(snapshot) {
    if (snapshot === null || snapshot === undefined) return 'missing';
    if (typeof snapshot !== 'object' || Array.isArray(snapshot)) return 'malformed';
    if (Object.keys(snapshot).length === 0) return 'empty_object';
    const allFinite = PAUSE_EVIDENCE_FIELDS.every((f) => typeof snapshot[f] === 'number' && Number.isFinite(snapshot[f]));
    if (!allFinite) return 'malformed';
    return PAUSE_EVIDENCE_FIELDS.every((f) => snapshot[f] === 0) ? 'valid_measured_zero' : 'valid_nonzero';
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Paginate a PostgREST table to exhaustion; returns rows + a completion watermark. */
async function pageAll(table, cols) {
    const PAGE = 1000;
    const rows = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from(table).select(cols)
            .order('created_at', { ascending: true }).range(from, from + PAGE - 1);
        if (error) { console.error(`[cohort] ${table} select failed (sanitized): ${error.code ?? 'n/a'}`); process.exit(1); }
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
    }
    return rows;
}

// ── Accounts (Auth Admin listUsers, paginated to exhaustion) ────────────────────────────────────
const users = [];
for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 100 });
    if (error) { console.error(`[cohort] listUsers failed (sanitized): ${error.status ?? 'n/a'}`); process.exit(1); }
    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < 100) break;
}

const internalSet = parseInternal();
const sessions = await pageAll('sessions', 'id,user_id,duration,total_words,engine,created_at,title,pause_metrics');
const reports = await pageAll('user_issue_reports', 'id,user_id,title,metadata,created_at');

// ── Roll up per account ─────────────────────────────────────────────────────────────────────────
const byUser = new Map();
for (const u of users) {
    byUser.set(u.id, {
        pseudonym: pseudo(u.id),
        // email is retained ONLY to populate the restricted PO artifact below; it is NEVER written to
        // the sanitized artifact or printed to the console.
        email: u.email ?? null,
        cohort: classify(u.email, internalSet),
        created_at: u.created_at ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
        invited_window: (u.created_at ?? '') >= INVITE_CUTOFF,
        sessions: 0, saved_with_words: 0, short_sessions: 0,
        modes: {}, first_activity: null, latest_activity: null,
        total_seconds: 0, reports: 0, report_titles: [],
    });
}
for (const s of sessions) {
    const a = byUser.get(s.user_id); if (!a) continue;
    a.sessions++;
    const dur = Number(s.duration ?? 0);
    a.total_seconds += Number.isFinite(dur) ? dur : 0;
    if (dur > 0 && dur < SHORT_SESSION_SECONDS) a.short_sessions++;
    if (Number(s.total_words ?? 0) > 0) a.saved_with_words++;
    const mode = String(s.engine ?? 'unknown');
    a.modes[mode] = (a.modes[mode] ?? 0) + 1;
    if (!a.first_activity || s.created_at < a.first_activity) a.first_activity = s.created_at;
    if (!a.latest_activity || s.created_at > a.latest_activity) a.latest_activity = s.created_at;
}
for (const r of reports) {
    const a = byUser.get(r.user_id); if (!a) continue;
    a.reports++;
    a.report_titles.push(String(r.title ?? '(untitled)'));
    if (!a.latest_activity || r.created_at > a.latest_activity) a.latest_activity = r.created_at;
}

// ── Pause-sensor field evidence: five mutually exclusive buckets, COUNTS ONLY ───────────────────
const pauseEvidence = { missing: 0, empty_object: 0, valid_measured_zero: 0, valid_nonzero: 0, malformed: 0 };
for (const s of sessions) pauseEvidence[classifyPauseSnapshot(s.pause_metrics)]++;

const all = [...byUser.values()];
const humans = all.filter((a) => a.cohort === 'human-likely');
const counts = all.reduce((m, a) => ({ ...m, [a.cohort]: (m[a.cohort] ?? 0) + 1 }), {});

// ── Sanitized engineering artifact (pseudonyms only) ────────────────────────────────────────────
const sanitized = {
    generated_at: new Date().toISOString(),
    invite_cutoff_utc: INVITE_CUTOFF,
    invite_cutoff_source: 'product_release/SOFT_RELEASE_TESTER_INSTRUCTIONS.md (finalized #993/#994)',
    totals: {
        auth_accounts: all.length,
        by_cohort: counts,
        user_issue_reports_rows: reports.length,
        sessions_rows: sessions.length,
    },
    // Aggregate, non-identifying. Buckets are mutually exclusive and sum to sessions_rows.
    pause_evidence_by_session: {
        ...pauseEvidence,
        total: sessions.length,
        definition: 'structurally valid = ' + PAUSE_EVIDENCE_FIELDS.join(', ')
            + ' all present and finite numbers (mirrors hasValidPauseEvidence, #1045).',
    },
    human_cohort: humans
        .sort((a, b) => String(b.latest_activity ?? '').localeCompare(String(a.latest_activity ?? '')))
        .map((a) => ({
            pseudonym: a.pseudonym,
            account_created: a.created_at,
            created_after_invite_cutoff: a.invited_window,
            last_sign_in: a.last_sign_in_at,
            activated: a.sessions > 0 || a.reports > 0,
            sessions: a.sessions,
            sessions_with_words: a.saved_with_words,
            short_sessions_under_20s: a.short_sessions,
            total_minutes: Number((a.total_seconds / 60).toFixed(1)),
            modes: a.modes,
            first_activity: a.first_activity,
            latest_activity: a.latest_activity,
            reports: a.reports,
        })),
    // EVERY report row, classified by the submitting account's cohort. NO title here: a report title
    // is user-authored free text and can carry a name, email or other identity, so it belongs only in
    // the restricted PO artifact (see `restricted.mapping[].report_titles`). The sanitized artifact
    // carries only the non-identifying shape: pseudonym, cohort, timestamp, release, and surface enum.
    reports_by_cohort: reports.map((r) => {
        const a = byUser.get(r.user_id);
        return {
            pseudonym: a ? a.pseudonym : '(orphan)',
            cohort: a ? a.cohort : 'unknown',
            created_at: r.created_at,
            release: (r.metadata && (r.metadata.release || r.metadata.appRelease)) ?? null,
            surface: (r.metadata && (r.metadata.pageKey || r.metadata.surface || r.metadata.route)) ?? null,
        };
    }).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))),
    confirmed_invited_roster: 'UNAVAILABLE — invitation is NOT inferable from account existence. '
        + 'human-likely is an evidence-based classification, not a confirmed invited tester.',
    zero_activity_humans: humans.filter((a) => a.sessions === 0 && a.reports === 0).map((a) => a.pseudonym),
    notes: [
        'Cohort classification is pattern-based: automated = @example.com/@test.com or a known spec-generated local-part.',
        'Latest observed app RELEASE per tester is NOT available from Supabase alone; it requires PostHog/report metadata (Phase 2).',
        'No email, raw user id or report body appears in this artifact.',
        'PAUSE EVIDENCE: counts only — no pause values are read out of this audit. A nonzero count '
        + 'does NOT prove that any particular measured zero is valid: field counts cannot tell a genuinely '
        + 'pause-free take apart from a dead sensor that emits a zero-valued object. Proving that requires a '
        + 'controlled detector->persistence test driving the detector with KNOWN silence gaps, owned by '
        + '#1087 Phase 2 (not part of this read-only audit tooling).',
        'DATA MODEL: audio is NEVER stored. Transcripts ARE durably stored on the session row and are not '
        + 'cleared on a TTL — but they are deliberately NOT selected by this audit, because reading transcript '
        + 'text would place user-authored content in the artifact. Filler-word counts are retained per session '
        + 'and are the durable session-over-session signal, which is why this audit rolls up '
        + 'sessions/words/duration rather than transcript content.',
    ],
};

// ── Restricted PO artifact (identity mapping + report titles) ───────────────────────────────────
const restricted = {
    generated_at: new Date().toISOString(),
    warning: 'RESTRICTED — contains identity mapping. Short retention. Product Owner review only.',
    mapping: all.filter((a) => a.cohort === 'human-likely' || a.reports > 0)
        // The restricted artifact is the ONE place an actual identity appears — that is its purpose:
        // the PO cannot follow up with a tester from a pseudonym alone. Short retention, PO-only.
        .map((a) => ({ pseudonym: a.pseudonym, email: a.email, cohort: a.cohort, reports: a.reports, report_titles: a.report_titles })),
};

fs.writeFileSync(SANITIZED_OUT, JSON.stringify(sanitized, null, 2));
fs.writeFileSync(RESTRICTED_OUT, JSON.stringify(restricted, null, 2));

// ── Console: counts only ────────────────────────────────────────────────────────────────────────
console.log('===== #1087 cohort audit (READ-ONLY, counts only) =====');
console.log(`invite_cutoff_utc        : ${INVITE_CUTOFF}`);
console.log(`auth_accounts_total      : ${all.length}`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`cohort[${k}] : ${v}`);
console.log(`sessions_rows            : ${sessions.length}`);
console.log(`user_issue_reports_rows  : ${reports.length}`);
for (const [k, v] of Object.entries(pauseEvidence)) console.log(`pause_evidence[${k}] : ${v}`);
console.log(`human_likely_accounts    : ${humans.length}  (NOT 'confirmed invited testers')`);
console.log(`human_activated          : ${humans.filter((a) => a.sessions > 0 || a.reports > 0).length}`);
console.log(`human_zero_activity      : ${sanitized.zero_activity_humans.length}`);
console.log(`human_reporters          : ${humans.filter((a) => a.reports > 0).length}`);
console.log(`human_created_since_invite: ${humans.filter((a) => a.invited_window).length}`);
console.log(`sanitized artifact       : ${SANITIZED_OUT}`);
console.log(`restricted artifact      : ${RESTRICTED_OUT} (identity mapping — restricted upload only)`);
console.log('confirmed_invited_roster : UNAVAILABLE (never inferred from account existence)');
console.log('note: read-only; listUsers + PostgREST select only; no emails/ids/transcripts/bodies printed.');
