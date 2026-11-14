/**
 * AHT-07 durable recovery inventory (Sam, #1811 RETURNs at 791b3780 and at ff3922e9).
 *
 * The ledger keeps idempotency keys in memory only and receipts carry counts, never a key. A write whose server outcome is
 * unknown can still commit after the run's reads; if the run's executor is then lost, a report that was never captured has
 * neither an id in the receipt nor a key anywhere. This file is the binding that survives:
 *
 *  - A VERIFIED STORE, BEFORE ANY PRODUCTION WRITE. `verifyRecoveryStore` requires `RWT_RECOVERY_DIR` to name a directory that
 *    the store's provisioner marked as surviving runner loss (`.rwt-recovery-store.json`, never created by a test), that only
 *    its owner can read or write (no group/other bits), that is not under the runner's own home, workspace, temp or tool cache
 *    on CI, and that takes an fsynced write. With no verified store the journey HOLDs before the account is created.
 *  - CONTENT-FREE. The run line holds the store id and the run binding (run id, run attempt, test id, owner uid). Attempt lines
 *    hold the ordinal, the ledger action and the idempotency key(s); settle lines the status and whether it was forwarded; the
 *    writer-stopped line the recorded attempt count. Never a report body, a description, an email, a token or a credential.
 *  - BEFORE FORWARDING. The route writes (and fsyncs) the attempt line after the ledger records it and BEFORE any abort, fulfil
 *    or fetch. A write that cannot be recorded, or that arrives after the writer stopped, is aborted, never sent.
 *  - KEPT UNTIL SETTLEMENT PLUS ZERO READBACK. The spec retires the file only when `zero residue` is PASS.
 *  - RECOVERY FAILS CLOSED (ff3922e9 RETURN). Age never clears uncertainty. `recoverFromInventory` acts only on the writer's
 *    own stopped record (no new attempt can be sent, none in flight) and on per-attempt settle records. An attempt with no
 *    settle record, or forwarded with no answer, stays unresolved until its own commit is observed: exactly one run-owned row
 *    under its key, with no other attempt under that key that is unresolved or that stored a row. Anything unresolved HOLDs,
 *    deletes nothing and keeps the file. Otherwise it deletes exactly the run's ids (never by key, owner-less sweep or time
 *    window) and reads residue again; a run key under another account is never deleted (FAIL).
 * Case-only helper: nothing AHT-01 loads imports it.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync, chmodSync } from 'node:fs';
import path from 'node:path';
import type { Evidence, FeedbackAttempt, RowVerdict } from './feedbackAttemptLedger';
import { type ReportCleanupAdmin, captureRunReports, deleteRunReports, readResidue, zeroResidueVerdict } from './feedbackReportCleanup';

export const RECOVERY_SCHEMA = 'speaksharp.aht07.feedback-recovery.v2';
export const RECOVERY_DIR_ENV = 'RWT_RECOVERY_DIR';
export const RECOVERY_STORE_MARKER = '.rwt-recovery-store.json';
export const RECOVERY_STORE_SCHEMA = 'speaksharp.rwt.recovery-store.v1';
/** The receipt step a journey halts at, before any Production write, when no verified store exists. */
export const RECOVERY_STORE_STEP = 'feedback recovery store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE = /^[A-Za-z0-9_-]{1,128}$/;
const REPORTS = 'user_issue_reports';

// ── The store ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface VerifiedStore { dir: string; storeId: string }
export type StoreCheck = { ok: true; store: VerifiedStore } | { ok: false; reason: string };

const within = (child: string, parent: string): boolean => {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The executor's own areas, lost with the runner (CI only): home, workspace, temp and tool cache. */
export function ephemeralRoots(env: NodeJS.ProcessEnv): string[] {
    if (env.GITHUB_ACTIONS !== 'true' && env.CI !== 'true') return [];
    return [env.HOME, env.RUNNER_TEMP, env.RUNNER_WORKSPACE, env.GITHUB_WORKSPACE, env.RUNNER_TOOL_CACHE]
        .filter((p): p is string => typeof p === 'string' && p.length > 0);
}

/**
 * A store is verified only when every check holds; the first failing check is the reason. Never creates the directory or the
 * marker (provisioning a store that survives runner loss is the store owner's act, not the test's).
 */
export function verifyRecoveryStore(env: NodeJS.ProcessEnv = process.env): StoreCheck {
    const configured = env[RECOVERY_DIR_ENV];
    if (!configured || configured.trim().length === 0) return { ok: false, reason: `${RECOVERY_DIR_ENV} is not set` };
    if (!path.isAbsolute(configured)) return { ok: false, reason: `${RECOVERY_DIR_ENV} is not an absolute path` };
    const dir = path.resolve(configured);
    if (ephemeralRoots(env).some((root) => within(dir, root))) return { ok: false, reason: 'the store is inside the runner\'s own home, workspace, temp or tool cache' };
    let mode: number;
    try {
        const st = statSync(dir);
        if (!st.isDirectory()) return { ok: false, reason: 'the store is not a directory' };
        mode = st.mode;
    } catch { return { ok: false, reason: 'the store directory does not exist' }; }
    if ((mode & 0o077) !== 0) return { ok: false, reason: 'the store is readable or writable by group or others' };
    let marker: Record<string, unknown>;
    try { marker = JSON.parse(readFileSync(path.join(dir, RECOVERY_STORE_MARKER), 'utf8')) as Record<string, unknown>; } catch {
        return { ok: false, reason: 'the store has no provisioning marker' };
    }
    if (marker?.schema !== RECOVERY_STORE_SCHEMA || marker.survivesRunnerLoss !== true || typeof marker.storeId !== 'string' || !SAFE.test(marker.storeId)) {
        return { ok: false, reason: 'the store\'s marker does not declare a store that survives runner loss' };
    }
    const probe = path.join(dir, `.probe-${process.pid}-${Date.now()}`);
    try {
        appendDurably(probe, { probe: true });
        const back = readFileSync(probe, 'utf8');
        rmSync(probe, { force: true });
        if (!back.includes('"probe":true')) return { ok: false, reason: 'the store did not read back a durable write' };
    } catch {
        try { rmSync(probe, { force: true }); } catch { /* nothing to remove */ }
        return { ok: false, reason: 'the store did not take a durable write' };
    }
    return { ok: true, store: { dir, storeId: marker.storeId } };
}

// ── The writer ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface RecoveryBinding { runId: string; runAttempt: string; testId: string; ownerUid: string }

const part = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || '_';
/** The case that owns an inventory file: AHT-07 (default) or AHT-08 (no-session), so one store holds both without collision. */
export type RecoveryCase = 'aht07' | 'aht08';
export function recoveryFileName(b: RecoveryBinding, caseTag: RecoveryCase = 'aht07'): string {
    return `${caseTag}-${part(b.runId)}-${part(b.runAttempt)}-${part(b.testId)}-${part(b.ownerUid)}.jsonl`;
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
    /** Attempt lines on disk. */
    recorded = 0;
    private stopped = false;
    private retired = false;

    private constructor(readonly file: string) {}

    /** The file and its run line, in a verified store only. Throws when the binding or the write fails. */
    static open(binding: RecoveryBinding, store: VerifiedStore, caseTag: RecoveryCase = 'aht07'): FeedbackRecoveryInventory {
        const problem = bindingProblem(binding);
        if (problem) throw new Error(`recovery inventory not opened: ${problem}`);
        mkdirSync(store.dir, { recursive: true, mode: 0o700 });
        const file = path.join(store.dir, recoveryFileName(binding, caseTag));
        appendDurably(file, { schema: RECOVERY_SCHEMA, type: 'run', storeId: store.storeId, ...binding, createdAt: new Date().toISOString() });
        chmodSync(file, 0o600);
        return new FeedbackRecoveryInventory(file);
    }

    get isStopped(): boolean { return this.stopped; }

    /** The attempt line, durable before returning. Throws on failure, and after the writer stopped (nothing new is sent). */
    recordAttempt(a: Pick<FeedbackAttempt, 'ordinal' | 'action' | 'keys'>): void {
        if (this.stopped || this.retired) throw new Error('recovery inventory is closed to new attempts');
        appendDurably(this.file, { type: 'attempt', ordinal: a.ordinal, action: a.action, keys: a.keys.filter((k) => UUID.test(k)), at: new Date().toISOString() });
        this.recorded += 1;
    }

    /** The settle line, best effort: a missing one leaves the attempt unresolved (never resolved by age). */
    recordSettle(a: Pick<FeedbackAttempt, 'ordinal' | 'status' | 'forwarded'>): void {
        if (this.retired) return;
        try { appendDurably(this.file, { type: 'settle', ordinal: a.ordinal, status: a.status, forwarded: a.forwarded, at: new Date().toISOString() }); } catch { /* unresolved */ }
    }

    /** Close the route's door: from here every new write is aborted before it is sent (the route cannot record it). */
    stop(): void { this.stopped = true; }

    /**
     * The writer's own stopped record, written only after `stop()` and a drain that found no handler in flight. Its attempt count
     * binds it to every attempt line before it. Best effort: without it, recovery HOLDs.
     */
    recordWriterStopped(pendingAfterDrain: number | null): boolean {
        if (!this.stopped || this.retired || pendingAfterDrain !== 0) return false;
        try { appendDurably(this.file, { type: 'writer-stopped', attempts: this.recorded, pending: 0, at: new Date().toISOString() }); return true; } catch { return false; }
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

// ── Reading it back, in a later executor ────────────────────────────────────────────────────────────────────────────────
export interface RecordedAttempt { ordinal: number; action: string; keys: string[] }
export interface RecordedSettle { status: number | null; forwarded: boolean | null }
export interface RecoveryRecord {
    storeId: string;
    binding: RecoveryBinding;
    attempts: RecordedAttempt[];
    settles: Map<number, RecordedSettle>;
    /** The writer's own stopped record (attempt count at stop), or null when it never wrote one. */
    writerStopped: { attempts: number } | null;
    /** Lines that did not parse or did not fit the schema (never acted on). */
    malformed: number;
}

/** Read the file back. Null when it is missing, or its first line is not this schema's run line. */
export function readRecoveryInventory(file: string): RecoveryRecord | null {
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { return null; }
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    let head: Record<string, unknown>;
    try { head = JSON.parse(lines[0] ?? '') as Record<string, unknown>; } catch { return null; }
    if (head?.schema !== RECOVERY_SCHEMA || head.type !== 'run' || typeof head.storeId !== 'string') return null;
    const binding: RecoveryBinding = { runId: String(head.runId), runAttempt: String(head.runAttempt), testId: String(head.testId), ownerUid: String(head.ownerUid) };
    if (bindingProblem(binding)) return null;
    const attempts: RecordedAttempt[] = [];
    const settles = new Map<number, RecordedSettle>();
    let writerStopped: { attempts: number } | null = null;
    let malformed = 0;
    for (const raw of lines.slice(1)) {
        let line: Record<string, unknown>;
        try { line = JSON.parse(raw) as Record<string, unknown>; } catch { malformed += 1; continue; }
        if (writerStopped) { malformed += 1; continue; } // nothing may follow the writer's stopped record
        if (line.type === 'attempt' && typeof line.ordinal === 'number' && typeof line.action === 'string'
            && Array.isArray(line.keys) && line.keys.every((k) => typeof k === 'string' && UUID.test(k))) {
            attempts.push({ ordinal: line.ordinal, action: line.action, keys: line.keys as string[] });
        } else if (line.type === 'settle' && typeof line.ordinal === 'number'
            && (line.status === null || typeof line.status === 'number') && (line.forwarded === null || typeof line.forwarded === 'boolean')) {
            settles.set(line.ordinal, { status: line.status as number | null, forwarded: line.forwarded as boolean | null });
        } else if (line.type === 'writer-stopped' && typeof line.attempts === 'number' && line.pending === 0) {
            writerStopped = { attempts: line.attempts };
        } else malformed += 1;
    }
    return { storeId: head.storeId, binding, attempts, settles, writerStopped, malformed };
}

/** Never sent (aborted or answered by the route), or answered by the server: its outcome is known. */
const settledKnown = (s: RecordedSettle | undefined): boolean => !!s && (s.forwarded === false || (s.forwarded === true && typeof s.status === 'number'));
const storedRow = (s: RecordedSettle | undefined): boolean => !!s && s.forwarded === true && (s.status === 200 || s.status === 201);

/**
 * Pure. The ordinals whose server outcome is still unknown. An attempt with no settle record, or forwarded with no answer, is
 * resolved only by observing its own commit: exactly one run-owned row under its single key, and no other attempt under that
 * key that is unresolved or that stored a row (either could be the row's writer, or still commit after a delete).
 */
export function unresolvedAttempts(record: Pick<RecoveryRecord, 'attempts' | 'settles'>, rowsByKey: ReadonlyMap<string, number>): number[] {
    const unknown = record.attempts.filter((a) => !settledKnown(record.settles.get(a.ordinal)));
    return unknown.filter((a) => {
        if (a.keys.length !== 1) return true;
        const key = a.keys[0];
        if (rowsByKey.get(key) !== 1) return true;
        const sameKey = record.attempts.filter((b) => b.ordinal !== a.ordinal && b.keys.includes(key));
        return sameKey.some((b) => !settledKnown(record.settles.get(b.ordinal)) || storedRow(record.settles.get(b.ordinal)));
    }).map((a) => a.ordinal);
}

/**
 * Recovery in a later executor, from a verified store: HOLD (nothing deleted, file kept) unless the inventory belongs to this
 * store, has no malformed line, carries the writer's stopped record over every attempt line, and every attempt's outcome is
 * known or its commit observed. Then locate the run's reports by owner uid and recorded keys only, delete exactly those ids,
 * read residue, and judge it as `zero residue`. The file is retired only on PASS. Age is never evidence.
 */
export async function recoverFromInventory(admin: ReportCleanupAdmin, store: VerifiedStore, fileName: string): Promise<{ verdict: RowVerdict; retired: boolean }> {
    const name = path.basename(fileName);
    const file = path.join(store.dir, name);
    const hold = (detail: string, evidence: Evidence = {}): { verdict: RowVerdict; retired: boolean } => ({
        verdict: { verdict: 'HOLD', detail, evidence: { recoveryInventory: `kept:${name}`, ...evidence } }, retired: false,
    });
    const record = readRecoveryInventory(file);
    if (!record) return hold('the recovery inventory is missing or not this schema, so nothing was located or deleted');
    if (record.storeId !== store.storeId) return hold('the recovery inventory belongs to another store, so nothing was deleted');
    if (record.malformed > 0) return hold('the recovery inventory has a malformed line, so nothing was deleted', { malformed: record.malformed });
    const evidenceBase: Evidence = { recordedAttempts: record.attempts.length, recordedSettles: record.settles.size };
    if (!record.writerStopped || record.writerStopped.attempts !== record.attempts.length) {
        return hold('the writer\'s stopped record is absent, so a write may still be sent or in flight; nothing was deleted',
            { ...evidenceBase, writerStopped: record.writerStopped !== null });
    }
    const keys = [...new Set(record.attempts.flatMap((a) => a.keys))];
    const uid = record.binding.ownerUid;
    let rowsByKey: Map<string, number>;
    try {
        const { data, error } = keys.length === 0 ? { data: [], error: null } : await admin.from(REPORTS).select('id,idempotency_key,user_id').in('idempotency_key', keys);
        if (error || !Array.isArray(data)) throw new Error('unreadable');
        rowsByKey = new Map();
        for (const row of data) {
            const key = typeof row.idempotency_key === 'string' ? row.idempotency_key : null;
            const owner = typeof row.user_id === 'string' ? row.user_id : null;
            if (key && (owner === null || owner === uid)) rowsByKey.set(key, (rowsByKey.get(key) ?? 0) + 1);
        }
    } catch { return hold('the recovery read by key could not run, so nothing was deleted', evidenceBase); }
    const unresolved = unresolvedAttempts(record, rowsByKey);
    if (unresolved.length > 0) {
        return hold('a recorded write\'s server outcome is still unknown (no answer and no observed commit), so nothing was deleted',
            { ...evidenceBase, unresolvedAttempts: unresolved.join(','), runKeys: keys.length });
    }
    let captured;
    try { captured = await captureRunReports(admin, uid, keys, null); } catch {
        return hold('the recovery capture could not read, so nothing was deleted', { ...evidenceBase, runKeys: keys.length });
    }
    let deletion: Awaited<ReturnType<typeof deleteRunReports>>;
    try { deletion = await deleteRunReports(admin, captured.ids); } catch { deletion = { ran: false, reason: 'error' }; }
    const residue = deletion.ran ? await readResidue(admin, uid, captured) : null;
    // Writer stopped and every outcome known or observed: no write of the run can still commit.
    const verdict = zeroResidueVerdict({ captured, deletion, residue, recaptured: 0, uncertainty: { pending: 0, uncertain: [] } });
    const evidence = { ...verdict.evidence, ...evidenceBase, runKeys: keys.length };
    if (verdict.verdict !== 'PASS') return { verdict: { ...verdict, evidence: { ...evidence, recoveryInventory: `kept:${name}` } }, retired: false };
    let retired = false;
    try { rmSync(file, { force: true }); retired = true; } catch { retired = false; }
    return { verdict: { ...verdict, evidence: { ...evidence, recoveryInventory: retired ? 'retired' : `kept:${name}` } }, retired };
}
