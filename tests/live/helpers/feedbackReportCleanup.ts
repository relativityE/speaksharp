/**
 * AHT-07 race-safe report cleanup (plan 2026-11-11 §3, Sam's one-run limit: exact run-owned cleanup, independent residue check).
 *
 * `user_issue_reports.user_id` is ON DELETE SET NULL, so the account deletion RETAINS every report (a product contract the
 * `feedback retention` row proves). These steps then remove exactly the run's reports, in this order, after every owned page
 * has closed (no write can still come from a page; route handlers still in flight are drained first):
 *  1. capture — the owner's rows (`user_id = uid`) UNION the rows under every idempotency key the route saw; ids only;
 *  2. account deletion — unchanged (`finalizeOwnedCleanup`, with the retention proof);
 *  3. re-capture once, right before the delete — the route's keys and the captured keys again (after deletion `user_id` is
 *     null, so the keys are what still finds a report that landed between capture and deletion: the race);
 *  4. delete by id only (service role), requiring the deleted count to equal the captured ids — never by key or time window,
 *     so no other account's report can be touched; a row under a run key owned by ANOTHER account is never deleted (FAIL);
 *  5. `zero residue` — reports by the captured ids and by the keys, sessions, profile and the auth user, all by uid, must read
 *     zero. A survivor FAILs with the surviving report ids (ids only) for manual removal; a delete that could not run HOLDs,
 *     naming the captured ids; never PASS without the reads.
 * Case-only helper: nothing AHT-01 loads imports it.
 */
import { isNotFoundError } from './proofAuthority';
import type { RowSink, RowVerdict, Evidence, FeedbackAttempt } from './feedbackAttemptLedger';

export const ZERO_RESIDUE_ROW = 'zero residue';
const REPORTS = 'user_issue_reports';

type DbError = { code?: string; message?: string } | null;
type Rows = { data: Array<Record<string, unknown>> | null; error: DbError; count?: number | null };
type Filter = { eq(column: string, value: string): PromiseLike<Rows>; in(column: string, values: readonly string[]): PromiseLike<Rows> };
/** The service-role surface these steps use (a structural slice of the supabase-js client; unit tests pass a fake). */
export interface ReportCleanupAdmin {
    from(table: string): {
        select(columns: string, options?: { count: 'exact'; head?: boolean }): Filter;
        delete(options: { count: 'exact' }): { in(column: string, values: readonly string[]): PromiseLike<{ error: DbError; count?: number | null }> };
    };
    auth: { admin: { getUserById(uid: string): PromiseLike<{ data: { user: unknown } | null; error: { status?: number; code?: string; message?: string } | null }> } };
}

export interface ReportRef { id: string; key: string | null; userId: string | null }
/** The run's reports as captured: ids to delete, keys they (and the route) carry, and rows under a run key another account owns. */
export interface CapturedReports { ids: string[]; keys: string[]; foreignIds: string[] }

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const refOf = (row: Record<string, unknown>): ReportRef | null => {
    const id = row.id === undefined || row.id === null ? null : String(row.id);
    return id ? { id, key: str(row.idempotency_key), userId: str(row.user_id) } : null;
};

/**
 * Pure: fold read rows into the capture. A row is the run's when the owner is the run's uid, or when it has no owner (after
 * deletion) and carries a run key. A row under a run key owned by another account is set aside (never deleted) as foreign.
 */
export function mergeCapture(prev: CapturedReports | null, rows: readonly ReportRef[], uid: string, routeKeys: readonly string[]): CapturedReports {
    const ids = [...(prev?.ids ?? [])];
    const foreignIds = [...(prev?.foreignIds ?? [])];
    const keys = new Set<string>([...(prev?.keys ?? []), ...routeKeys]);
    for (const r of rows) {
        const runKey = r.key !== null && keys.has(r.key);
        const ours = r.userId === uid || (r.userId === null && runKey);
        if (ours) {
            if (!ids.includes(r.id)) ids.push(r.id);
            if (r.key) keys.add(r.key);
        } else if (r.userId !== null && runKey && !foreignIds.includes(r.id)) foreignIds.push(r.id);
    }
    return { ids, keys: [...keys], foreignIds };
}

async function readRefs(query: PromiseLike<Rows>): Promise<ReportRef[]> {
    const { data, error } = await query;
    if (error || !Array.isArray(data)) throw new Error(`report capture read failed (fail closed): ${error?.code ?? 'unreadable'}`);
    return data.map(refOf).filter((r): r is ReportRef => r !== null);
}

/** Read the run's reports by owner and by key and fold them into `prev`. Throws (fail closed) on any read error. */
export async function captureRunReports(admin: ReportCleanupAdmin, uid: string, routeKeys: readonly string[], prev: CapturedReports | null): Promise<CapturedReports> {
    const keys = [...new Set([...(prev?.keys ?? []), ...routeKeys])];
    const rows: ReportRef[] = [];
    if (uid) rows.push(...await readRefs(admin.from(REPORTS).select('id,idempotency_key,user_id').eq('user_id', uid)));
    if (keys.length > 0) rows.push(...await readRefs(admin.from(REPORTS).select('id,idempotency_key,user_id').in('idempotency_key', keys)));
    return mergeCapture(prev, rows, uid, keys);
}

/**
 * Writes whose server outcome is unknown at cleanup time (Sam, #1811 b319d42b RETURN). `pending`: route handlers still in
 * flight after the last drain (null when no drain result exists). `uncertain`: ordinals of attempts that never settled, or
 * whose forwarding failed (`route.fetch` rejected, so the server may or may not have committed). Any of these means a zero
 * read now does not prove the write never landed: the run is never PASS on it.
 */
export interface WriteUncertainty { pending: number | null; uncertain: number[] }

export function writeUncertainty(attempts: readonly Pick<FeedbackAttempt, 'ordinal' | 'settled' | 'forwarded' | 'action'>[], pendingAfterDrain: number | null): WriteUncertainty {
    const uncertain = attempts
        .filter((a) => !a.settled || (a.forwarded === null && a.action !== 'cap-abort'))
        .map((a) => a.ordinal);
    return { pending: pendingAfterDrain, uncertain };
}

const isCertain = (u: WriteUncertainty): boolean => u.pending === 0 && u.uncertain.length === 0;

export type DeletionOutcome = { ran: true; count: number | null } | { ran: false; reason: 'no_admin' | 'error' | 'not_reached' };

/** Delete exactly the captured ids by id (service role). Nothing to delete is a run with count 0. */
export async function deleteRunReports(admin: ReportCleanupAdmin | null, ids: readonly string[]): Promise<DeletionOutcome> {
    if (ids.length === 0) return { ran: true, count: 0 };
    if (!admin) return { ran: false, reason: 'no_admin' };
    const { error, count } = await admin.from(REPORTS).delete({ count: 'exact' }).in('id', ids);
    if (error) return { ran: false, reason: 'error' };
    return { ran: true, count: typeof count === 'number' && Number.isSafeInteger(count) ? count : null };
}

export interface ResidueRead {
    /** Surviving run report ids, by captured id or by run key (foreign rows excluded); null when a read failed. */
    reportIds: string[] | null;
    sessions: number | null;
    profiles: number | null;
    authUser: 'gone' | 'present' | 'unknown';
}

const countOf = async (query: PromiseLike<Rows>): Promise<number | null> => {
    const { error, count } = await query;
    return error || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 ? null : count;
};

/** The independent residue reads, all by the run's own identifiers. */
export async function readResidue(admin: ReportCleanupAdmin, uid: string, captured: CapturedReports): Promise<ResidueRead> {
    let reportIds: string[] | null = [];
    try {
        const found: ReportRef[] = [];
        if (captured.ids.length > 0) found.push(...await readRefs(admin.from(REPORTS).select('id,idempotency_key,user_id').in('id', captured.ids)));
        if (captured.keys.length > 0) found.push(...await readRefs(admin.from(REPORTS).select('id,idempotency_key,user_id').in('idempotency_key', captured.keys)));
        reportIds = [...new Set(found.map((r) => r.id).filter((id) => !captured.foreignIds.includes(id)))];
    } catch { reportIds = null; }
    const sessions = await countOf(admin.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid)).catch(() => null);
    const profiles = await countOf(admin.from('user_profiles').select('id', { count: 'exact', head: true }).eq('id', uid)).catch(() => null);
    let authUser: ResidueRead['authUser'] = 'unknown';
    try {
        const { data, error } = await admin.auth.admin.getUserById(uid);
        if (error) authUser = isNotFoundError(error) ? 'gone' : 'unknown';
        else authUser = data?.user ? 'present' : 'gone';
    } catch { authUser = 'unknown'; }
    return { reportIds, sessions, profiles, authUser };
}

/**
 * `zero residue`, pure. Order: an uncaptured run HOLDs; a run key owned by another account FAILs; a delete that could not run
 * HOLDs naming the captured ids; an unreadable residue read HOLDs; any survivor FAILs naming the surviving report ids; a deleted
 * count other than the captured ids FAILs; a write whose server outcome is unknown (pending after the drain, or an uncertain
 * commit) HOLDs with the full inventory; an uncounted delete HOLDs; else PASS.
 */
export function zeroResidueVerdict(input: {
    captured: CapturedReports | null; deletion: DeletionOutcome; residue: ResidueRead | null; recaptured: number; uncertainty: WriteUncertainty;
}): RowVerdict {
    const { captured, deletion, residue, uncertainty } = input;
    if (!captured) return { verdict: 'HOLD', detail: 'the run\'s feedback reports could not be captured, so they were not deleted' };
    const base: Evidence = { capturedReports: captured.ids.length, recapturedReports: input.recaptured };
    if (captured.foreignIds.length > 0) {
        return { verdict: 'FAIL', detail: 'a run idempotency key names another account\'s report; it was not deleted', evidence: { ...base, foreignIds: captured.foreignIds.join(',') } };
    }
    if (!deletion.ran) {
        return { verdict: 'HOLD', detail: `the report delete could not run (${deletion.reason}); the captured reports remain for manual removal`, evidence: { ...base, capturedIds: captured.ids.join(',') } };
    }
    if (!residue || residue.reportIds === null || residue.sessions === null || residue.profiles === null || residue.authUser === 'unknown') {
        return { verdict: 'HOLD', detail: 'a residue read did not answer, so zero residue is unproven', evidence: { ...base, capturedIds: captured.ids.join(',') } };
    }
    const survivors: string[] = [];
    if (residue.reportIds.length > 0) survivors.push(`reports=${residue.reportIds.length}`);
    if (residue.sessions > 0) survivors.push(`sessions=${residue.sessions}`);
    if (residue.profiles > 0) survivors.push(`profile=${residue.profiles}`);
    if (residue.authUser === 'present') survivors.push('auth user');
    if (survivors.length > 0) {
        return { verdict: 'FAIL', detail: `run residue survived cleanup: ${survivors.join(', ')}`, evidence: { ...base, survivingReportIds: residue.reportIds.join(',') } };
    }
    // A write whose server outcome is unknown (still in flight, or forwarded with no answer) may commit after these reads:
    // zero now is not zero activity. HOLD, keeping the whole inventory (captured ids and the affected attempts) for a re-read.
    if (!isCertain(uncertainty)) {
        return {
            verdict: 'HOLD',
            detail: `a feedback write's server outcome is unknown (${uncertainty.pending === null ? 'drain not observed' : `${uncertainty.pending} still in flight`}, `
                + `${uncertainty.uncertain.length} uncertain), so zero residue is unproven; re-read the run's keys before removal is declared complete`,
            evidence: {
                ...base, capturedIds: captured.ids.join(','), runKeys: captured.keys.length,
                pending: uncertainty.pending, uncertainAttempts: uncertainty.uncertain.join(','),
            },
        };
    }
    if (deletion.count === null) return { verdict: 'HOLD', detail: 'the report delete returned no count, so it is not shown to be exact', evidence: base };
    if (deletion.count !== captured.ids.length) {
        return { verdict: 'FAIL', detail: `the report delete removed ${deletion.count} of ${captured.ids.length} captured reports`, evidence: { ...base, deleted: deletion.count } };
    }
    return { verdict: 'PASS', detail: 'exactly the captured reports were deleted by id; reports, sessions, profile and auth user read zero', evidence: { ...base, deleted: deletion.count } };
}

/**
 * Steps 3–5 after the account deletion: re-capture by the keys (and the uid, should deletion have failed), delete by id, read
 * residue, and return the `zero residue` verdict. A delete that fails is a delete that could not run (HOLD).
 */
export async function cleanupRunReports(
    admin: ReportCleanupAdmin | null, uid: string, routeKeys: readonly string[], captured: CapturedReports | null, uncertainty: WriteUncertainty,
): Promise<RowVerdict> {
    if (!admin) return zeroResidueVerdict({ captured, deletion: { ran: false, reason: 'no_admin' }, residue: null, recaptured: 0, uncertainty });
    // A failed re-capture still deletes what was captured; the residue reads by key then catch any report it would have found.
    // With no first capture (its read failed), this read is the capture; if it fails too, nothing is deleted (HOLD).
    const final = await captureRunReports(admin, uid, routeKeys, captured).catch(() => captured);
    if (!final) return zeroResidueVerdict({ captured: null, deletion: { ran: false, reason: 'not_reached' }, residue: null, recaptured: 0, uncertainty });
    const recaptured = final.ids.length - (captured?.ids.length ?? 0);
    // A row set aside as foreign is never in `final.ids`, so it is never deleted; the verdict FAILs it.
    let deletion: DeletionOutcome;
    try { deletion = await deleteRunReports(admin, final.ids); } catch { deletion = { ran: false, reason: 'error' }; }
    const residue = deletion.ran ? await readResidue(admin, uid, final) : null;
    return zeroResidueVerdict({ captured: final, deletion, residue, recaptured, uncertainty });
}

/** The row when the cleanup step itself did not complete (timeout or error): HOLD naming whatever was captured. */
export function zeroResidueNotRun(captured: CapturedReports | null): RowVerdict {
    return {
        verdict: 'HOLD', detail: 'the report cleanup did not complete within its bound; the captured reports remain for manual removal',
        evidence: { capturedReports: captured?.ids.length ?? 0, capturedIds: captured?.ids.join(',') ?? '' },
    };
}

export function writeZeroResidueRow(receipt: RowSink, v: RowVerdict): void {
    receipt.row(ZERO_RESIDUE_ROW, v.verdict, v.detail, v.evidence);
}
