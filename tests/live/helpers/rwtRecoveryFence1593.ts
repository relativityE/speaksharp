/**
 * #1593 case10: a displaced, permanently fenced take is recoverable, not an authorized recorder.
 * Pure, content-free adjudication; no reads, cleanup or caller integration. The receiving caller must
 * capture complete account-scoped reads at A (first recording), B (successor recording) and C (saved).
 * This relies on the reviewed #1476 immutable-fence trigger, not merely absence of a current lease.
 * It proves these bound observations only: not continuous worker drain or deployed migration identity.
 */
export type RecoveryRead<T> = { state: 'observed'; value: T } | { state: 'unavailable' };
export type RecoveryRows<T> = { state: 'observed'; complete: boolean; value: readonly T[] } | { state: 'unavailable' };
export type RecoveryRowIdentity = { id: string; user_id: string };
export type RecoverySession = RecoveryRowIdentity & {
    status: string | null; lease_id: string | null;
    recording_fenced_at: string | null; recording_fenced_reason: string | null;
    lease_released_at: string | null;
};
export type RecoveryAuthority = { user_id: string; lease_id: string; state: string };
export type RecoveryBaseline = { runId: string; ownerId: string; rows: RecoveryRows<RecoveryRowIdentity> };
export type RecoverySnapshot = {
    runId: string; ownerId: string; rows: RecoveryRows<RecoverySession>;
    authority: RecoveryRead<RecoveryAuthority | null>;
};
export type RecoveryRecording = {
    sessionId: string | null; leaseId: string | null;
    recordingObserved: RecoveryRead<boolean>; snapshot: RecoverySnapshot;
};
export type RecoveryFenceEvidence = {
    runId: string; ownerId: string;
    beforeFirst: RecoveryBaseline; beforeSuccessor: RecoveryBaseline;
    first: RecoveryRecording; successor: RecoveryRecording;
    afterSave: RecoverySnapshot; savedSessionId: RecoveryRead<string | null>;
};
export type RecoveryFenceVerdict = { status: 'PASS' | 'FAIL' | 'HOLD'; detail: string };

class EvidenceDisposition extends Error {
    constructor(readonly verdict: RecoveryFenceVerdict) { super(verdict.detail); }
}
const stop = (status: 'FAIL' | 'HOLD', detail: string): never => { throw new EvidenceDisposition({ status, detail }); };
const identified = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const timestamp = (v: unknown): v is string => identified(v) && Number.isFinite(Date.parse(v));

function bound(snapshot: RecoveryBaseline | RecoverySnapshot, evidence: RecoveryFenceEvidence): void {
    if (!snapshot || !identified(snapshot.runId) || !identified(snapshot.ownerId)) stop('HOLD', 'missing snapshot binding');
    if (snapshot.runId !== evidence.runId || snapshot.ownerId !== evidence.ownerId) stop('FAIL', 'snapshot run/owner mismatch');
}

function rows<T extends RecoveryRowIdentity>(read: RecoveryRows<T>, owner: string): readonly T[] {
    if (read?.state !== 'observed' || read.complete !== true || !Array.isArray(read.value)) stop('HOLD', 'rows unavailable or incomplete');
    const seen = new Set<string>();
    for (const row of read.value) {
        if (!row || !identified(row.id) || !identified(row.user_id)) stop('HOLD', 'unreadable row identity');
        if (row.user_id !== owner) stop('FAIL', 'row owner mismatch');
        if (seen.has(row.id)) stop('FAIL', 'duplicate row identity');
        seen.add(row.id);
    }
    return read.value;
}

function sessionRows(snapshot: RecoverySnapshot, owner: string): readonly RecoverySession[] {
    const result = rows(snapshot.rows, owner);
    for (const row of result) {
        for (const field of ['status', 'lease_id', 'recording_fenced_at', 'recording_fenced_reason', 'lease_released_at'] as const) {
            if (row[field] !== null && !identified(row[field])) stop('HOLD', 'required session field unselected or unreadable');
        }
        if (row.status === null) stop('HOLD', 'session status unreadable');
    }
    return result;
}

function authority(snapshot: RecoverySnapshot, owner: string): RecoveryAuthority | null {
    const read = snapshot.authority;
    if (read?.state !== 'observed' || read.value === undefined) stop('HOLD', 'authority read unavailable');
    if (read.value === null) return null;
    const value = read.value;
    if (!identified(value.user_id) || !identified(value.lease_id) || !identified(value.state)) stop('HOLD', 'authority identity unreadable');
    if (value.user_id !== owner) stop('FAIL', 'authority owner mismatch');
    return value;
}

function exactRow(rows: readonly RecoverySession[], id: string): RecoverySession {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) stop('FAIL', 'bound session row missing');
    return row;
}

function recording(capture: RecoveryRecording, snapshotRows: readonly RecoverySession[], owner: string): RecoverySession {
    if (!capture || !identified(capture.sessionId) || !identified(capture.leaseId)) stop('HOLD', 'recording binding unavailable');
    if (capture.recordingObserved?.state !== 'observed') stop('HOLD', 'recording observation unavailable');
    if (capture.recordingObserved.value !== true) stop('FAIL', 'bound take was not observed recording');
    const row = exactRow(snapshotRows, capture.sessionId);
    if (row.status !== 'active' || row.lease_id !== capture.leaseId) stop('FAIL', 'recording row/status/lease mismatch');
    if (row.recording_fenced_at !== null || row.recording_fenced_reason !== null) stop('FAIL', 'recording take is fenced');
    const current = authority(capture.snapshot, owner);
    if (!current || current.lease_id !== capture.leaseId || current.state !== 'recording') stop('FAIL', 'recording authority mismatch');
    return row;
}

function onlyNew(before: readonly RecoveryRowIdentity[], after: readonly RecoveryRowIdentity[], expected: string): void {
    const known = new Set(before.map((row) => row.id));
    const created = after.filter((row) => !known.has(row.id));
    if (created.length !== 1 || created[0].id !== expected) stop('FAIL', 'new take identity/count mismatch or reused session');
}

/** A fenced active exception is limited to this run's abandoned row, observed unchanged at B and C. */
export function recoveryFence1593Verdict(evidence: RecoveryFenceEvidence): RecoveryFenceVerdict {
    try {
        if (!evidence || !identified(evidence.runId) || !identified(evidence.ownerId)) stop('HOLD', 'run/owner binding unavailable');
        for (const snapshot of [evidence.beforeFirst, evidence.beforeSuccessor, evidence.first?.snapshot,
            evidence.successor?.snapshot, evidence.afterSave]) bound(snapshot, evidence);
        const beforeFirst = rows(evidence.beforeFirst.rows, evidence.ownerId);
        const beforeSuccessor = rows(evidence.beforeSuccessor.rows, evidence.ownerId);
        const atA = sessionRows(evidence.first.snapshot, evidence.ownerId);
        const atB = sessionRows(evidence.successor.snapshot, evidence.ownerId);
        const atC = sessionRows(evidence.afterSave, evidence.ownerId);
        const first = recording(evidence.first, atA, evidence.ownerId);
        const next = recording(evidence.successor, atB, evidence.ownerId);
        if (first.id === next.id || first.lease_id === next.lease_id || beforeFirst.some(row => row.id === next.id)) {
            stop('FAIL', 'successor reused abandoned/baseline identity or lease');
        }
        onlyNew(beforeFirst, atA, first.id);
        onlyNew(beforeFirst, beforeSuccessor, first.id);
        onlyNew(beforeSuccessor, atB, next.id);
        onlyNew(beforeSuccessor, atC, next.id);
        if (atA.some((row) => row.status === 'active' && row.id !== first.id)
            || atB.some((row) => row.status === 'active' && row.id !== first.id && row.id !== next.id)) {
            stop('FAIL', 'unknown active row during recording');
        }
        if (evidence.savedSessionId?.state !== 'observed') stop('HOLD', 'saved page binding unavailable');
        if (evidence.savedSessionId.value !== next.id) stop('FAIL', 'saved page binding mismatch');
        const saved = exactRow(atC, next.id);
        if (saved.status !== 'completed' || saved.lease_id !== next.lease_id) stop('FAIL', 'successor completion/lease mismatch');
        if (saved.recording_fenced_at !== null || saved.recording_fenced_reason !== null) stop('FAIL', 'successor was displaced before save');
        if (authority(evidence.afterSave, evidence.ownerId) !== null) stop('FAIL', 'recording authority remains after save');
        const oldAtB = exactRow(atB, first.id);
        const oldAtC = exactRow(atC, first.id);
        if (oldAtB.lease_id !== first.lease_id || oldAtC.lease_id !== first.lease_id) stop('FAIL', 'abandoned lease binding changed');
        // Current authority at B belongs to next, at C it is successfully observed absent. Neither alone
        // proves the old row cannot resume: a remaining active row also requires the permanent displaced fence.
        if (oldAtB.status === 'active' || oldAtC.status === 'active' || oldAtB.recording_fenced_at !== null
            || oldAtC.recording_fenced_at !== null || oldAtB.recording_fenced_reason !== null || oldAtC.recording_fenced_reason !== null) {
            if (!timestamp(oldAtB.recording_fenced_at) || oldAtB.recording_fenced_reason !== 'displaced'
                || oldAtC.recording_fenced_at !== oldAtB.recording_fenced_at
                || oldAtC.recording_fenced_reason !== 'displaced') stop('FAIL', 'active abandoned row lacks unchanged permanent displaced fence');
        }
        if (!['active', 'completed', 'failed'].includes(oldAtB.status ?? '')
            || !['active', 'completed', 'failed'].includes(oldAtC.status ?? '')
            || (oldAtB.status !== 'active' && oldAtC.status === 'active')
            || (oldAtB.status === 'failed' && oldAtC.status !== 'failed')) stop('FAIL', 'abandoned status unknown or reopened');
        if (atC.some((row) => row.status === 'active' && row.id !== first.id)) stop('FAIL', 'unproven active row after save');
        // release_recording_lease stamps active rows only: complete→release may correctly leave a NULL stamp.
        return { status: 'PASS', detail: 'bound successor saved once; old take closed or permanently displaced and excluded from observed authority; continuous drain/live closure not asserted' };
    } catch (error) {
        if (error instanceof EvidenceDisposition) return error.verdict;
        throw error;
    }
}
