/**
 * AHT-07 / AHT-08 recovery executor (recovery-store proposal 2026-11-12, §7 item 1): the first caller of `recoverFromInventory`.
 * It runs in a SECOND executor, after the writing runner may have been lost, against the same verified recovery store.
 *
 * DETECT AND REPORT BY DEFAULT. It verifies the store (`verifyRecoveryStore`), lists the store's inventory files (only names
 * matching `RECOVERY_FILE_PATTERN`; the provisioning marker and write probes are ignored), and reads each one locally: no
 * database read, no credential. Deletion happens only from protected `main` bytes, on the first workflow attempt, with checkout
 * HEAD equal to the dispatched commit AND a delete acknowledgement bound to that exact 40-hex commit
 * (`feedbackRecoveryDeleteAck(sha)`), mirroring interrupted-run recovery's `recoveryDeleteAck`. Then it calls
 * `recoverFromInventory` once per file; that function alone decides what may be deleted (writer-stopped record over every
 * attempt, every outcome known or its commit observed, delete by id with an exact count, zero-residue reads, retire on PASS).
 *
 * FAILS CLOSED. An unverified store, a listing error, an unreadable or unsafe entry (not a regular file, or a name that does not
 * bind to its own run line), or an inventory from another store is a HOLD; nothing is deleted for it. A FAIL from recovery stops
 * the run (no further file is touched). CONTENT-FREE: the report is counts and statuses only, never an id, key, uid, email or
 * file name.
 *
 * KNOWN LIMIT (both cases): a runner killed before it wrote its writer-stopped record cannot be recovered. Its file is reported
 * as `noStopRecord`, recovery HOLDs and deletes nothing, and the report stays until its owner settles it by hand. No timeout,
 * file age or silence stands in for the stopped record.
 * Case-only helper: nothing AHT-01 loads imports it.
 */
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ReportCleanupAdmin } from './feedbackReportCleanup';
import {
    type RecoveryCase, type VerifiedStore, readRecoveryInventory, recoverFromInventory, recoveryFileName, verifyRecoveryStore,
} from './feedbackRecoveryInventory';
import { PROTECTED_DEFAULT_BRANCH } from './rwtInterruptedRunRecovery';

/** The delete acknowledgement, bound to one exact commit: `RWT-FEEDBACK-RECOVERY-DELETE@<40-hex sha>`. */
export const FEEDBACK_RECOVERY_DELETE_ACK_PREFIX = 'RWT-FEEDBACK-RECOVERY-DELETE';
export const feedbackRecoveryDeleteAck = (sha: string): string => `${FEEDBACK_RECOVERY_DELETE_ACK_PREFIX}@${sha}`;
/** The executor deletes only from this branch's bytes. */
export const FEEDBACK_RECOVERY_BRANCH = PROTECTED_DEFAULT_BRANCH;
/** An inventory file's name: a case prefix, then the plain-identifier binding parts `recoveryFileName` writes. */
export const RECOVERY_FILE_PATTERN = /^(aht07|aht08)-[A-Za-z0-9_-]{1,512}\.jsonl$/;

const SHA_RE = /^[0-9a-f]{40}$/;

export interface ExecutorGit { ref: string; sha: string; head: string; attempt: string }

/**
 * Pure authority check, run BEFORE any credential is used. Protected `main` only, first workflow attempt only (a re-run reuses
 * the original SHA, so a SHA-bound ack would replay), checkout HEAD equal to the dispatched commit, and a delete ack (if any)
 * bound to that exact commit; an ack bound to anything else is refused rather than downgraded to detection.
 */
export function feedbackRecoveryAuthority(p: ExecutorGit & { ack: string }): { ok: true; deleteAuthorized: boolean } | { ok: false; reason: string } {
    if (p.attempt !== '1') return { ok: false, reason: 'workflow_rerun_attempt_refused' };
    if (p.ref !== `refs/heads/${FEEDBACK_RECOVERY_BRANCH}`) return { ok: false, reason: 'not_protected_main' };
    if (!SHA_RE.test(p.sha)) return { ok: false, reason: 'dispatch_sha_invalid' };
    if (p.head !== p.sha) return { ok: false, reason: 'checkout_head_is_not_dispatch_sha' };
    if (p.ack.startsWith(FEEDBACK_RECOVERY_DELETE_ACK_PREFIX) && p.ack !== feedbackRecoveryDeleteAck(p.sha)) {
        return { ok: false, reason: 'delete_ack_not_bound_to_this_sha' };
    }
    return { ok: true, deleteAuthorized: p.ack === feedbackRecoveryDeleteAck(p.sha) };
}

/** The store's inventory files, by name only. Throws (fail closed) when the directory cannot be listed. */
export function listRecoveryFiles(store: VerifiedStore): { files: string[]; ignored: number } {
    const names = readdirSync(store.dir);
    const files = names.filter((n) => RECOVERY_FILE_PATTERN.test(n)).sort();
    return { files, ignored: names.length - files.length };
}

export type FileState = 'ready' | 'noStopRecord' | 'otherStore' | 'malformed' | 'unreadable' | 'unsafe';

/** Local, read-only classification of one listed file: may recovery act on it, and if not, why. */
export function classifyRecoveryFile(store: VerifiedStore, name: string): { state: FileState; recoveryCase: RecoveryCase | null } {
    const file = path.join(store.dir, name);
    try {
        const st = lstatSync(file);
        if (!st.isFile()) return { state: 'unsafe', recoveryCase: null };
    } catch { return { state: 'unreadable', recoveryCase: null }; }
    const record = readRecoveryInventory(file);
    if (!record) return { state: 'unreadable', recoveryCase: null };
    // The name must be the one the writer gave this run line (case and binding), or the file was moved or renamed.
    if (recoveryFileName(record.binding, record.recoveryCase) !== name) return { state: 'unsafe', recoveryCase: record.recoveryCase };
    if (record.storeId !== store.storeId) return { state: 'otherStore', recoveryCase: record.recoveryCase };
    if (record.malformed > 0) return { state: 'malformed', recoveryCase: record.recoveryCase };
    if (!record.writerStopped || record.writerStopped.attempts !== record.attempts.length) return { state: 'noStopRecord', recoveryCase: record.recoveryCase };
    return { state: 'ready', recoveryCase: record.recoveryCase };
}

export type ExecutorStatus =
    | 'HOLD_AUTHORITY' | 'HOLD_NO_STORE' | 'HOLD_LISTING_FAILED' | 'NOTHING_TO_RECOVER' | 'DETECTED_HOLD_NO_ACK'
    | 'HOLD_NO_ADMIN' | 'RECOVERED' | 'RECOVERED_WITH_HOLDS' | 'FAILED';

export interface ExecutorReport {
    status: ExecutorStatus;
    files: number; ignored: number; aht07: number; aht08: number;
    ready: number; noStopRecord: number; otherStore: number; malformed: number; unreadable: number; unsafe: number;
    /** With the ack only: recoverFromInventory verdicts, reports deleted and inventories retired. */
    passed: number; held: number; failed: number; deleted: number; retired: number;
}

const emptyReport = (status: ExecutorStatus): ExecutorReport => ({
    status, files: 0, ignored: 0, aht07: 0, aht08: 0, ready: 0, noStopRecord: 0, otherStore: 0, malformed: 0, unreadable: 0, unsafe: 0,
    passed: 0, held: 0, failed: 0, deleted: 0, retired: 0,
});

/**
 * Detect, then (only with authority and the ack bound to `git.sha`) recover. `admin` is needed only to delete; detection never
 * reads the database. Never throws for a store, listing or file problem: those are HOLD statuses.
 */
export async function runFeedbackRecovery(params: {
    env: NodeJS.ProcessEnv; git: ExecutorGit; ack: string; admin: ReportCleanupAdmin | null;
    /** Injected by unit controls only (a listing that fails, a recovery that throws). */
    recover?: typeof recoverFromInventory;
    list?: typeof listRecoveryFiles;
}): Promise<ExecutorReport> {
    const authority = feedbackRecoveryAuthority({ ...params.git, ack: params.ack });
    if (!authority.ok) return emptyReport('HOLD_AUTHORITY');
    const check = verifyRecoveryStore(params.env);
    if (!check.ok) return emptyReport('HOLD_NO_STORE');
    const store = check.store;
    let listing: { files: string[]; ignored: number };
    try { listing = (params.list ?? listRecoveryFiles)(store); } catch { return emptyReport('HOLD_LISTING_FAILED'); }
    const report = emptyReport('NOTHING_TO_RECOVER');
    report.files = listing.files.length;
    report.ignored = listing.ignored;
    const ready: string[] = [];
    for (const name of listing.files) {
        const { state, recoveryCase } = classifyRecoveryFile(store, name);
        if (recoveryCase) report[recoveryCase] += 1;
        report[state] += 1;
        if (state === 'ready') ready.push(name);
    }
    if (listing.files.length === 0) return report;
    // Without the SHA-bound ack (or protected-main authority) this is detection only: counts, nothing deleted.
    if (!authority.deleteAuthorized || !SHA_RE.test(params.git.sha) || params.ack !== feedbackRecoveryDeleteAck(params.git.sha)) {
        return { ...report, status: 'DETECTED_HOLD_NO_ACK' };
    }
    if (!params.admin) return { ...report, status: 'HOLD_NO_ADMIN' };
    const recover = params.recover ?? recoverFromInventory;
    // Every file not ready is a HOLD already counted; recovery is attempted only where the writer's own record allows it.
    report.held = listing.files.length - ready.length;
    for (const name of ready) {
        let outcome: Awaited<ReturnType<typeof recoverFromInventory>>;
        try { outcome = await recover(params.admin, store, name); } catch { report.failed += 1; return { ...report, status: 'FAILED' }; }
        const deleted = outcome.verdict.evidence?.deleted;
        if (outcome.verdict.verdict === 'PASS') {
            report.passed += 1;
            if (typeof deleted === 'number') report.deleted += deleted;
        } else if (outcome.verdict.verdict === 'HOLD') report.held += 1;
        else { report.failed += 1; return { ...report, status: 'FAILED' }; }
        if (outcome.retired) report.retired += 1;
    }
    return { ...report, status: report.held > 0 ? 'RECOVERED_WITH_HOLDS' : 'RECOVERED' };
}

/** The one content-safe line a run prints. */
export function feedbackRecoveryReportLine(r: ExecutorReport): string {
    return `RWT_FEEDBACK_RECOVERY status=${r.status} files=${r.files} ignored=${r.ignored} aht07=${r.aht07} aht08=${r.aht08} `
        + `ready=${r.ready} no_stop_record=${r.noStopRecord} other_store=${r.otherStore} malformed=${r.malformed} unreadable=${r.unreadable} `
        + `unsafe=${r.unsafe} passed=${r.passed} held=${r.held} failed=${r.failed} deleted=${r.deleted} retired=${r.retired}`;
}
