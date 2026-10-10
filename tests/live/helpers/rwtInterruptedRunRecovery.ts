/**
 * #1258 B1 (Browser PM 6097765962) — governed recovery for run-owned Production accounts left behind by an INTERRUPTED
 * rehearsal. Every normal journey deletes its account in Playwright teardown; a cancelled job, a lost runner or the 45-minute
 * `gate-3-dast` timeout can skip that teardown and leave the account and its cascaded rows.
 *
 * Detect-and-HOLD by default. Deletion happens only from protected default-branch bytes, with a delete acknowledgement bound
 * to the exact commit this run executes AND separate PO Production authority for that run, and only through the existing
 * fail-closed `cleanupRunOwnedAccount` (auth deletion + every residue readback = 0). Ownership is the FULL synthetic identity
 * the generators mint at the exact run-owned domain, never a prefix alone. Selection refuses anything fresh, non-owned,
 * malformed or ambiguous (judged over the whole listing); the listing is bounded, requires a real users array on every page and
 * fails closed. Idempotent: a second run finds nothing to recover. The report is content-safe — counts and a status only.
 */
import { RUN_OWNED_PREFIX_RE, cleanupRunOwnedAccount } from './runOwnedCleanup';

/** The delete acknowledgement, bound to one exact commit: `RWT-INTERRUPTED-RUN-RECOVERY-DELETE@<40-hex sha>`. */
export const RECOVERY_DELETE_ACK_PREFIX = 'RWT-INTERRUPTED-RUN-RECOVERY-DELETE';
export const recoveryDeleteAck = (sha: string): string => `${RECOVERY_DELETE_ACK_PREFIX}@${sha}`;
/** `gate-3-dast` job timeout plus a safety margin: a younger account may still belong to a live run. */
export const GATE3_JOB_TIMEOUT_MS = 45 * 60_000;
export const SAFETY_MARGIN_MS = 30 * 60_000;
export const MIN_AGE_MS = GATE3_JOB_TIMEOUT_MS + SAFETY_MARGIN_MS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/;
/** The repository's protected default branch, named (rc-gates keeps branch lookups out per #1432). */
export const PROTECTED_DEFAULT_BRANCH = 'main';
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * #1580 P1 4237980478 — the local parts the run-owned generators actually mint (`<ms>` = Date.now(), `<run>` = GITHUB_RUN_ID or
 * `local`): `newDisposableEmail` (rwtJourney.ts) → `rwt-journey-<label>-<ms>-<run>`; private-recording-proof and
 * three-session-retention-proof → `<prefix><ms>-<run>`. A unit test pins every labelled `newDisposableEmail` call to this list.
 */
export const RWT_JOURNEY_LABELS = ['open-mic', 'focus-points'] as const;
const MS = '\\d{13}';
const RUN = '(?:\\d+|local)';
const OWNED_LOCAL_PARTS: ReadonlyArray<readonly [string, RegExp]> = [
    ['rwt-journey-', new RegExp(`^rwt-journey-(?:${RWT_JOURNEY_LABELS.join('|')})-${MS}-${RUN}$`)],
    ['private-proof-', new RegExp(`^private-proof-${MS}-${RUN}$`)],
    ['retention-proof-', new RegExp(`^retention-proof-${MS}-${RUN}$`)],
];

/**
 * The run-owned domain for DELETION: only an explicit, nonempty, valid `LIVE_TEST_EMAIL_DOMAIN` (Browser PM 6100450864, option B).
 * The generators' `example.com` fallback is deliberately NOT imported: without an explicit domain, recovery detects and HOLDs.
 */
export function runOwnedDomain(env: Record<string, string | undefined>): string | null {
    const domain = (env.LIVE_TEST_EMAIL_DOMAIN ?? '').trim().toLowerCase();
    return domain && DOMAIN_RE.test(domain) ? domain : null;
}

/** The generators' fallback domain: full-grammar accounts there are reported as unqualified legacy items, never deleted. */
export const LEGACY_FALLBACK_DOMAIN = 'example.com';

/** The run-owned prefix of an address that is the FULL synthetic identity at exactly `domain`; null otherwise. */
export function ownedPrefixOf(email: string, domain: string): string | null {
    const at = email.lastIndexOf('@');
    if (at <= 0 || email.slice(at + 1) !== domain) return null;
    const local = email.slice(0, at);
    const owned = OWNED_LOCAL_PARTS.find(([, re]) => re.test(local));
    return owned ? owned[0] : null;
}

export interface AuthUserLike { id?: unknown; email?: unknown; created_at?: unknown }
export interface RecoveryCandidate { id: string; email: string; prefix: string }
export interface SelectionCounts {
    scanned: number; nonOwned: number; ownershipUnproven: number; legacyUnqualified: number; runOwned: number; fresh: number; malformed: number; ambiguous: number; eligible: number;
}

/**
 * Pure: which listed accounts are old, well-formed, unambiguous accounts with the full run-owned identity at the explicit
 * `domain`. With no explicit domain (null) nothing is eligible; full-grammar `example.com` rows are counted as legacy.
 */
export function selectInterruptedRunAccounts(users: readonly AuthUserLike[], nowMs: number, domain: string | null, minAgeMs: number = MIN_AGE_MS):
    { eligible: RecoveryCandidate[]; counts: SelectionCounts } {
    const counts: SelectionCounts = { scanned: users.length, nonOwned: 0, ownershipUnproven: 0, legacyUnqualified: 0, runOwned: 0, fresh: 0, malformed: 0, ambiguous: 0, eligible: 0 };
    // CLI PM 6098304364 (1): ambiguity is judged over the COMPLETE listing, before any eligibility filter, so a fresh,
    // malformed or non-owned row sharing an old account's id or email still makes that account ambiguous.
    const keyCount = (values: string[]) => values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>());
    const idCounts = keyCount(users.map((u) => (typeof u.id === 'string' ? u.id.toLowerCase() : '')).filter(Boolean));
    const emailCounts = keyCount(users.map((u) => (typeof u.email === 'string' ? u.email.toLowerCase() : '')).filter(Boolean));
    const eligible: RecoveryCandidate[] = [];
    for (const user of users) {
        const email = typeof user.email === 'string' ? user.email.toLowerCase() : '';
        if (!RUN_OWNED_PREFIX_RE.test(email)) { counts.nonOwned += 1; continue; }
        // #1580 P1 4237980478: a run-owned PREFIX is not ownership. A prefix-only or wrong-domain address HOLDs (never deleted);
        // a full-grammar address at the generators' fallback domain is an unqualified legacy item (reported, never deleted).
        const prefix = domain ? ownedPrefixOf(email, domain) : null;
        if (!prefix) {
            if (ownedPrefixOf(email, LEGACY_FALLBACK_DOMAIN)) counts.legacyUnqualified += 1;
            else counts.ownershipUnproven += 1;
            continue;
        }
        counts.runOwned += 1;
        const id = typeof user.id === 'string' ? user.id : '';
        const created = typeof user.created_at === 'string' ? Date.parse(user.created_at) : Number.NaN;
        if (!UUID_RE.test(id) || !Number.isFinite(created) || created > nowMs) { counts.malformed += 1; continue; }
        if (nowMs - created < minAgeMs) { counts.fresh += 1; continue; }
        // The same id or email anywhere else in the listing is ambiguous: refuse rather than guess.
        if ((idCounts.get(id.toLowerCase()) ?? 0) > 1 || (emailCounts.get(email) ?? 0) > 1) { counts.ambiguous += 1; continue; }
        eligible.push({ id, email, prefix });
    }
    counts.eligible = eligible.length;
    return { eligible, counts };
}

/**
 * #1580 P1 4237980480 — pure authority check, run BEFORE any credential is used. Recovery runs only from the repository's
 * default branch, with checkout HEAD equal to the dispatched commit. A delete acknowledgement must name that exact commit;
 * a recovery acknowledgement bound to anything else (or to nothing) is refused rather than downgraded.
 */
export function recoveryAuthority(p: { ref: string; sha: string; head: string; defaultBranch: string; ack: string }):
    { ok: true; deleteAuthorized: boolean } | { ok: false; reason: string } {
    if (!p.defaultBranch) return { ok: false, reason: 'default_branch_unknown' };
    if (p.ref !== `refs/heads/${p.defaultBranch}`) return { ok: false, reason: 'not_default_branch' };
    if (!SHA_RE.test(p.sha)) return { ok: false, reason: 'dispatch_sha_invalid' };
    if (p.head !== p.sha) return { ok: false, reason: 'checkout_head_is_not_dispatch_sha' };
    if (p.ack.startsWith(RECOVERY_DELETE_ACK_PREFIX) && p.ack !== recoveryDeleteAck(p.sha)) {
        return { ok: false, reason: 'delete_ack_not_bound_to_this_sha' };
    }
    return { ok: true, deleteAuthorized: p.ack === recoveryDeleteAck(p.sha) };
}

export interface AdminLike {
    auth: { admin: { listUsers: (o: { page: number; perPage: number }) => Promise<{ data: { users?: AuthUserLike[] } | null; error: { code?: string } | null }> } };
}

/** Bounded, fail-closed listing. `complete=false` when the page cap was reached with a full page (more may exist). */
export async function listAuthUsersBounded(admin: AdminLike, perPage = 200, maxPages = 50): Promise<{ users: AuthUserLike[]; complete: boolean }> {
    const users: AuthUserLike[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) throw new Error(`recovery listUsers failed (fail closed): ${error.code ?? 'unknown'}`);
        // CLI PM 6098304364 (2): only a real users array is a page. A null / missing / non-array payload, or a non-object
        // row, is a malformed response, never an empty (complete) page, so it can neither end the listing nor reach cleanup.
        const batch: unknown = data?.users;
        if (!Array.isArray(batch) || batch.some((u) => typeof u !== 'object' || u === null || Array.isArray(u))) {
            throw new Error('recovery listUsers returned a malformed page (fail closed)');
        }
        users.push(...(batch as AuthUserLike[]));
        if (batch.length < perPage) return { users, complete: true };
    }
    return { users, complete: false };
}

export type RecoveryStatus = 'HOLD_NO_DOMAIN' | 'HOLD_NO_ACK' | 'HOLD_INCOMPLETE_LISTING' | 'NOTHING_TO_RECOVER' | 'RECOVERED' | 'FAILED';
export interface RecoveryReport extends SelectionCounts { status: RecoveryStatus; deleted: number; minAgeMinutes: number }

type Cleanup = typeof cleanupRunOwnedAccount;

/**
 * Detect, then (only with the acknowledgement bound to `sha`) recover. Stops at the first cleanup failure (fail closed) and
 * reports how many were proven deleted before it. Never prints an id or email. The caller runs `recoveryAuthority` first.
 */
export async function recoverInterruptedRuns(params: {
    admin: AdminLike; nowMs: number; ack: string; sha: string; domain: string | null;
    cleanup?: Cleanup; minAgeMs?: number; perPage?: number; maxPages?: number;
}): Promise<RecoveryReport> {
    const minAgeMs = params.minAgeMs ?? MIN_AGE_MS;
    const report = (status: RecoveryStatus, counts: SelectionCounts, deleted = 0): RecoveryReport =>
        ({ status, deleted, minAgeMinutes: Math.round(minAgeMs / 60_000), ...counts });
    // No explicit domain still DETECTS and reports (legacy items included); it can never delete.
    const domain = params.domain && DOMAIN_RE.test(params.domain) ? params.domain : null;
    const { users, complete } = await listAuthUsersBounded(params.admin, params.perPage, params.maxPages);
    const { eligible, counts } = selectInterruptedRunAccounts(users, params.nowMs, domain, minAgeMs);
    if (!complete) return report('HOLD_INCOMPLETE_LISTING', counts);
    if (!domain) return report('HOLD_NO_DOMAIN', counts);
    if (eligible.length === 0) return report('NOTHING_TO_RECOVER', counts);
    if (!SHA_RE.test(params.sha) || params.ack !== recoveryDeleteAck(params.sha)) return report('HOLD_NO_ACK', counts);
    const cleanup = params.cleanup ?? cleanupRunOwnedAccount;
    let deleted = 0;
    for (const account of eligible) {
        try {
            await cleanup({ admin: params.admin as never, capturedUid: account.id, createdEmail: account.email, runOwnedPrefix: account.prefix });
        } catch {
            return report('FAILED', counts, deleted);
        }
        deleted += 1;
    }
    return report('RECOVERED', counts, deleted);
}

/** The one content-safe line a run prints. */
export function recoveryReportLine(r: RecoveryReport): string {
    return `RWT_INTERRUPTED_RUN_RECOVERY status=${r.status} scanned=${r.scanned} run_owned=${r.runOwned} `
        + `ownership_unproven=${r.ownershipUnproven} legacy_unqualified=${r.legacyUnqualified} eligible=${r.eligible} fresh=${r.fresh} malformed=${r.malformed} `
        + `ambiguous=${r.ambiguous} deleted=${r.deleted} min_age_min=${r.minAgeMinutes}`;
}
