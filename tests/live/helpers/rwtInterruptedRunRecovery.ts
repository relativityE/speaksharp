/**
 * #1258 B1 (Browser PM 6097765962) — governed recovery for run-owned Production accounts left behind by an INTERRUPTED
 * rehearsal. Every normal journey deletes its account in Playwright teardown; a cancelled job, a lost runner or the 45-minute
 * `gate-3-dast` timeout can skip that teardown and leave the account and its cascaded rows.
 *
 * Detect-and-HOLD by default. Deletion happens only with the exact dispatch acknowledgement AND separate PO Production
 * authority for that run, and only through the existing fail-closed `cleanupRunOwnedAccount` (auth deletion + every residue
 * readback = 0). Selection refuses anything fresh, non-owned, malformed or ambiguous; the listing is bounded and fails closed.
 * Idempotent: a second run finds nothing to recover. The report is content-safe — counts and a status, never an id or email.
 */
import { RUN_OWNED_PREFIX_RE, cleanupRunOwnedAccount } from './runOwnedCleanup';

/** The exact acknowledgement a dispatch must carry before any account is deleted. */
export const RECOVERY_DELETE_ACK = 'RWT-INTERRUPTED-RUN-RECOVERY-DELETE';
/** `gate-3-dast` job timeout plus a safety margin: a younger account may still belong to a live run. */
export const GATE3_JOB_TIMEOUT_MS = 45 * 60_000;
export const SAFETY_MARGIN_MS = 30 * 60_000;
export const MIN_AGE_MS = GATE3_JOB_TIMEOUT_MS + SAFETY_MARGIN_MS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthUserLike { id?: unknown; email?: unknown; created_at?: unknown }
export interface RecoveryCandidate { id: string; email: string; prefix: string }
export interface SelectionCounts { scanned: number; nonOwned: number; runOwned: number; fresh: number; malformed: number; ambiguous: number; eligible: number }

/** Pure: which listed accounts are old, well-formed, unambiguous run-owned accounts. */
export function selectInterruptedRunAccounts(users: readonly AuthUserLike[], nowMs: number, minAgeMs: number = MIN_AGE_MS):
    { eligible: RecoveryCandidate[]; counts: SelectionCounts } {
    const counts: SelectionCounts = { scanned: users.length, nonOwned: 0, runOwned: 0, fresh: 0, malformed: 0, ambiguous: 0, eligible: 0 };
    const owned: RecoveryCandidate[] = [];
    for (const user of users) {
        const email = typeof user.email === 'string' ? user.email.toLowerCase() : '';
        const match = RUN_OWNED_PREFIX_RE.exec(email);
        if (!match) { counts.nonOwned += 1; continue; }
        counts.runOwned += 1;
        const id = typeof user.id === 'string' ? user.id : '';
        const created = typeof user.created_at === 'string' ? Date.parse(user.created_at) : Number.NaN;
        if (!UUID_RE.test(id) || !EMAIL_RE.test(email) || !Number.isFinite(created) || created > nowMs) { counts.malformed += 1; continue; }
        if (nowMs - created < minAgeMs) { counts.fresh += 1; continue; }
        owned.push({ id, email, prefix: match[1] });
    }
    // The same id or email twice in one listing is ambiguous: refuse every copy rather than guess.
    const seen = (key: (c: RecoveryCandidate) => string) => owned.reduce((m, c) => m.set(key(c), (m.get(key(c)) ?? 0) + 1), new Map<string, number>());
    const ids = seen((c) => c.id);
    const emails = seen((c) => c.email);
    const eligible = owned.filter((c) => {
        const dup = (ids.get(c.id) ?? 0) > 1 || (emails.get(c.email) ?? 0) > 1;
        if (dup) counts.ambiguous += 1;
        return !dup;
    });
    counts.eligible = eligible.length;
    return { eligible, counts };
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
        const batch = data?.users ?? [];
        users.push(...batch);
        if (batch.length < perPage) return { users, complete: true };
    }
    return { users, complete: false };
}

export type RecoveryStatus = 'HOLD_NO_ACK' | 'HOLD_INCOMPLETE_LISTING' | 'NOTHING_TO_RECOVER' | 'RECOVERED' | 'FAILED';
export interface RecoveryReport extends SelectionCounts { status: RecoveryStatus; deleted: number; minAgeMinutes: number }

type Cleanup = typeof cleanupRunOwnedAccount;

/**
 * Detect, then (only with the exact ack) recover. Stops at the first cleanup failure (fail closed) and reports how many were
 * proven deleted before it. Never prints an id or email.
 */
export async function recoverInterruptedRuns(params: {
    admin: AdminLike; nowMs: number; ack: string; cleanup?: Cleanup; minAgeMs?: number; perPage?: number; maxPages?: number;
}): Promise<RecoveryReport> {
    const minAgeMs = params.minAgeMs ?? MIN_AGE_MS;
    const { users, complete } = await listAuthUsersBounded(params.admin, params.perPage, params.maxPages);
    const { eligible, counts } = selectInterruptedRunAccounts(users, params.nowMs, minAgeMs);
    const report = (status: RecoveryStatus, deleted = 0): RecoveryReport => ({ status, deleted, minAgeMinutes: Math.round(minAgeMs / 60_000), ...counts });
    if (!complete) return report('HOLD_INCOMPLETE_LISTING');
    if (eligible.length === 0) return report('NOTHING_TO_RECOVER');
    if (params.ack !== RECOVERY_DELETE_ACK) return report('HOLD_NO_ACK');
    const cleanup = params.cleanup ?? cleanupRunOwnedAccount;
    let deleted = 0;
    for (const account of eligible) {
        try {
            await cleanup({ admin: params.admin as never, capturedUid: account.id, createdEmail: account.email, runOwnedPrefix: account.prefix });
        } catch {
            return report('FAILED', deleted);
        }
        deleted += 1;
    }
    return report('RECOVERED', deleted);
}

/** The one content-safe line a run prints. */
export function recoveryReportLine(r: RecoveryReport): string {
    return `RWT_INTERRUPTED_RUN_RECOVERY status=${r.status} scanned=${r.scanned} run_owned=${r.runOwned} eligible=${r.eligible} `
        + `fresh=${r.fresh} malformed=${r.malformed} ambiguous=${r.ambiguous} deleted=${r.deleted} min_age_min=${r.minAgeMinutes}`;
}
