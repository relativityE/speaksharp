/**
 * AHT-07 durable recovery inventory (Sam, #1811 at 791b3780, RETURN on the cleanup requirement).
 *
 * The ledger keeps idempotency keys in memory only and receipts carry counts, never a key. A write whose server outcome is
 * unknown (in flight, or forwarded with no answer) can still commit after the run's reads; if the process then exits, a report
 * that was never captured has neither an id in the receipt nor a key anywhere. This file is the binding that survives:
 *
 *  - RESTRICTED. One JSON-lines file per run, in a directory outside the repository and outside every uploaded test output
 *    (`RWT_RECOVERY_DIR`, default `~/.speaksharp-rwt-recovery`), directory mode 0700, file mode 0600.
 *  - CONTENT-FREE. The run line holds the run binding (run id, run attempt, test id, owner uid). Each attempt line holds the
 *    ordinal, the ledger action and the idempotency key(s); each settle line the status and whether it was forwarded. Never a
 *    report body, a description, an email, a token or a credential.
 *  - BEFORE FORWARDING. The route writes (and fsyncs) the attempt line right after the ledger records the attempt and BEFORE
 *    any abort, fulfil or fetch. A write that cannot be recorded is aborted, never sent (`recordDurably` returns false).
 *  - KEPT UNTIL SETTLEMENT PLUS ZERO READBACK. The spec retires the file only when `zero residue` is PASS (every write settled,
 *    nothing pending, exact delete, zero reads). Any other verdict keeps it and names the file in the row's evidence.
 *  - RECOVERY WITHOUT BROAD DELETION. `recoverFromInventory` reads the file after the process is gone and locates the run's
 *    reports only by the owner uid and the recorded keys, deletes only those ids (never by key, owner-less sweep or time
 *    window), and reads residue again; a run key owned by another account is never deleted (FAIL).
 * Case-only helper: nothing AHT-01 loads imports it.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Evidence, FeedbackAttempt, RowVerdict } from './feedbackAttemptLedger';
import { type ReportCleanupAdmin, captureRunReports, deleteRunReports, readResidue, zeroResidueVerdict } from './feedbackReportCleanup';

export const RECOVERY_SCHEMA = 'speaksharp.aht07.feedback-recovery.v1';
export const RECOVERY_DIR_ENV = 'RWT_RECOVERY_DIR';
/** A recovery waits this long after the file's last write, so no request of the exited run can still be in flight. */
export const RECOVERY_QUIET_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE = /^[A-Za-z0-9_-]{1,128}$/;

export interface RecoveryBinding { runId: string; runAttempt: string; testId: string; ownerUid: string }

/** The directory: `RWT_RECOVERY_DIR` when set (a persistent location for a production run), else under the home directory. */
export function recoveryDir(env: NodeJS.ProcessEnv = process.env): string {
    const configured = env[RECOVERY_DIR_ENV];
    return configured && configured.trim().length > 0 ? path.resolve(configured) : path.join(os.homedir(), '.speaksharp-rwt-recovery');
}

const part = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || '_';
export function recoveryFileName(b: RecoveryBinding): string {
    return `aht07-${part(b.runId)}-${part(b.runAttempt)}-${part(b.testId)}-${part(b.ownerUid)}.jsonl`;
}

function bindingProblem(b: RecoveryBinding): string | null {
    if (!UUID.test(b.ownerUid)) return 'owner uid is not a uuid';
    for (const [name, value] of [['runId', b.runId], ['runAttempt', b.runAttempt], ['testId', b.testId]] as const) {
        if (!SAFE.test(value)) return `${name} is not a plain identifier`;
    }
    return null;
}

/** Append one line and fsync it before returning; throws on any failure (the caller decides fail-closed). */
function appendDurably(file: string, line: Record<string, unknown>): void {
    const fd = openSync(file, 'a', 0o600);
    try {
        writeSync(fd, `${JSON.stringify(line)}\n`);
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
}

export class FeedbackRecoveryInventory {
    /** Attempts that could not be recorded (each was aborted, never sent). */
    failures = 0;
    private retired = false;

    private constructor(readonly file: string) {}

    /** Create the restricted directory and the file with its run line. Throws when the binding or the write fails. */
    static open(binding: RecoveryBinding, dir: string = recoveryDir()): FeedbackRecoveryInventory {
        const problem = bindingProblem(binding);
        if (problem) throw new Error(`recovery inventory not opened: ${problem}`);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        chmodSync(dir, 0o700);
        const file = path.join(dir, recoveryFileName(binding));
        appendDurably(file, { schema: RECOVERY_SCHEMA, type: 'run', ...binding, createdAt: new Date().toISOString() });
        chmodSync(file, 0o600);
        return new FeedbackRecoveryInventory(file);
    }

    /** The attempt line, durable before returning. Throws on failure. */
    recordAttempt(a: Pick<FeedbackAttempt, 'ordinal' | 'action' | 'keys'>): void {
        if (this.retired) throw new Error('recovery inventory already retired');
        appendDurably(this.file, { type: 'attempt', ordinal: a.ordinal, action: a.action, keys: a.keys.filter((k) => UUID.test(k)), at: new Date().toISOString() });
    }

    /** The settle line, best effort (the attempt line already binds the key; this only narrows what is unknown). */
    recordSettle(a: Pick<FeedbackAttempt, 'ordinal' | 'status' | 'forwarded'>): void {
        if (this.retired) return;
        try { appendDurably(this.file, { type: 'settle', ordinal: a.ordinal, status: a.status, forwarded: a.forwarded, at: new Date().toISOString() }); } catch { /* best effort */ }
    }

    /** Remove the file. Only after `zero residue` PASS (settlement plus zero readback). */
    retire(): boolean {
        try { rmSync(this.file, { force: true }); this.retired = true; return true; } catch { return false; }
    }
}

/** Record the attempt before anything can leave the browser. False: it was not recorded, so the route must not send it. */
export function recordDurably(inventory: FeedbackRecoveryInventory | null, attempt: Pick<FeedbackAttempt, 'ordinal' | 'action' | 'keys'>): boolean {
    if (!inventory) return false;
    try { inventory.recordAttempt(attempt); return true; } catch { inventory.failures += 1; return false; }
}

/**
 * The row the run writes, and the file's fate: retired only on PASS; any other verdict keeps the file and names it (by file
 * name, never a key) in the evidence. A PASS whose file could not be removed stays PASS and says the file remains.
 */
export function settleRecoveryInventory(verdict: RowVerdict, inventory: FeedbackRecoveryInventory | null): RowVerdict {
    if (!inventory) return verdict;
    const name = path.basename(inventory.file);
    const failures = inventory.failures;
    if (verdict.verdict === 'PASS') {
        const removed = inventory.retire();
        return { ...verdict, evidence: { ...verdict.evidence, recoveryInventory: removed ? 'retired' : `kept:${name}`, recoveryWriteFailures: failures } };
    }
    return { ...verdict, evidence: { ...verdict.evidence, recoveryInventory: `kept:${name}`, recoveryDirEnv: RECOVERY_DIR_ENV, recoveryWriteFailures: failures } };
}

export interface RecoveryRecord {
    binding: RecoveryBinding;
    /** Every distinct key the run recorded before forwarding. */
    keys: string[];
    attempts: number;
    settled: number;
    /** Lines that did not parse or did not fit the schema (never acted on). */
    malformed: number;
}

/** Read the file back (a later process). Null when it is missing, or its first line is not this schema's run line. */
export function readRecoveryInventory(file: string): RecoveryRecord | null {
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { return null; }
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    let head: Record<string, unknown>;
    try { head = JSON.parse(lines[0] ?? '') as Record<string, unknown>; } catch { return null; }
    if (head?.schema !== RECOVERY_SCHEMA || head.type !== 'run') return null;
    const binding: RecoveryBinding = { runId: String(head.runId), runAttempt: String(head.runAttempt), testId: String(head.testId), ownerUid: String(head.ownerUid) };
    if (bindingProblem(binding)) return null;
    const keys = new Set<string>();
    let attempts = 0;
    let settled = 0;
    let malformed = 0;
    for (const raw of lines.slice(1)) {
        let line: Record<string, unknown>;
        try { line = JSON.parse(raw) as Record<string, unknown>; } catch { malformed += 1; continue; }
        if (line.type === 'attempt' && Array.isArray(line.keys) && line.keys.every((k) => typeof k === 'string' && UUID.test(k))) {
            attempts += 1;
            for (const k of line.keys as string[]) keys.add(k);
        } else if (line.type === 'settle' && typeof line.ordinal === 'number') settled += 1;
        else malformed += 1;
    }
    return { binding, keys: [...keys], attempts, settled, malformed };
}

/**
 * Recovery after the run's process is gone: locate the run's reports by owner uid and the recorded keys only, delete exactly
 * those ids, read residue, and judge it as `zero residue`. Too soon after the last write, an unreadable file, a malformed line
 * or a capture that cannot read HOLDs and deletes nothing. The file is retired only on PASS.
 */
export async function recoverFromInventory(admin: ReportCleanupAdmin, file: string, now: number = Date.now()): Promise<{ verdict: RowVerdict; retired: boolean }> {
    const name = path.basename(file);
    const hold = (detail: string, evidence: Evidence = {}): { verdict: RowVerdict; retired: boolean } => ({
        verdict: { verdict: 'HOLD', detail, evidence: { recoveryInventory: `kept:${name}`, ...evidence } }, retired: false,
    });
    const record = readRecoveryInventory(file);
    if (!record) return hold('the recovery inventory is missing or not this schema, so nothing was located or deleted');
    if (record.malformed > 0) return hold('the recovery inventory has a malformed line, so nothing was deleted', { malformed: record.malformed });
    let lastWrite: number;
    try { lastWrite = statSync(file).mtimeMs; } catch { return hold('the recovery inventory could not be read again'); }
    if (now - lastWrite < RECOVERY_QUIET_MS) return hold('the run wrote its recovery inventory too recently to rule out a request still in flight');
    let captured;
    try { captured = await captureRunReports(admin, record.binding.ownerUid, record.keys, null); } catch {
        return hold('the recovery capture could not read, so nothing was deleted', { runKeys: record.keys.length });
    }
    let deletion: Awaited<ReturnType<typeof deleteRunReports>>;
    try { deletion = await deleteRunReports(admin, captured.ids); } catch { deletion = { ran: false, reason: 'error' }; }
    const residue = deletion.ran ? await readResidue(admin, record.binding.ownerUid, captured) : null;
    // The run's process is gone and the quiet window has passed: no write of it can still be in flight.
    const verdict = zeroResidueVerdict({ captured, deletion, residue, recaptured: 0, uncertainty: { pending: 0, uncertain: [] } });
    const evidence = { ...verdict.evidence, runKeys: record.keys.length, recordedAttempts: record.attempts, recordedSettles: record.settled };
    if (verdict.verdict !== 'PASS') return { verdict: { ...verdict, evidence: { ...evidence, recoveryInventory: `kept:${name}` } }, retired: false };
    let retired = false;
    try { rmSync(file, { force: true }); retired = true; } catch { retired = false; }
    return { verdict: { ...verdict, evidence: { ...evidence, recoveryInventory: retired ? 'retired' : `kept:${name}` } }, retired };
}
