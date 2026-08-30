/**
 * #1304 — atomic per-arm checkpointing for the selection run.
 *
 * WHY THIS EXISTS. The runner wrote its artifact once, at the end. A selection run takes hours, so a
 * crash, an OOM, or an operator stopping the wrong process discarded every completed arm — and the only
 * surviving record was a console log, which is not retained evidence. "Retention is mandatory" is not
 * satisfied by a design that can lose everything on the last step.
 *
 * WHY IDENTITY BINDING. A resumable artifact is dangerous in a way a single-shot one is not: it can
 * silently splice rows measured under DIFFERENT code, a different corpus, a different normalizer or a
 * different policy into one table that reads as a single experiment. A checkpoint is therefore accepted
 * ONLY when every identity below matches exactly. On any mismatch the run starts clean rather than
 * producing a plausible hybrid nobody can later disentangle.
 */

/** Everything that must be identical for two rows to belong in the same experiment. */
export interface RunIdentity {
    /** The product baseline the run characterises. */
    productBaseline: string;
    /** The tree the harness itself executed from. */
    executionSha: string;
    /** The frozen selection policy the artifact will be judged by. */
    policySha: string;
    /** Digest over the frozen corpus (sorted `id\taudioSha256`). */
    corpusDigest: string;
    /** Normalizer identity — a scorer change silently rewrites every WER. */
    normalizerId: string;
    /** Arm registry identity — an added or renamed arm changes what "complete" means. */
    registryDigest: string;
    /** Digest over the pinned model/runtime asset set actually served. */
    assetDigest: string;
    /** The evidence set and class this artifact belongs to. */
    setName: string;
    evidenceClass: string;
}

import { NOT_EXECUTED_REASONS } from './arms/registry';

export interface CheckpointRow { id: string; [k: string]: unknown }

/**
 * Is this row a FINISHED account of its arm?
 *
 * Found the hard way: a run whose asset cache was missing failed every arm in 45 seconds and checkpointed
 * eleven rows carrying no verdict. Resuming from it would have treated all eleven as measured and skipped
 * them for good — a table of silent holes that looks complete. Presence in a checkpoint is not completion.
 *
 * A row is finished when it is deliberately not executed, deliberately skipped, or carries an actual
 * verdict. Anything else is an arm that started and did not finish, and must be measured again.
 */
/**
 * The reliability contract a MEASURED row must satisfy.
 *
 * Named and exported so it is inspectable and testable rather than implied by a comparison buried in a
 * conditional. A run that threw, produced empty output, or lost clips did not measure the arm — it made a
 * partial observation, which must be dispositioned rather than counted.
 */
export const MEASURED_RELIABILITY_CONTRACT = Object.freeze({
    requires: ['decoded === expectedClips', 'threw === 0', 'emptyOutput === 0', 'missing === 0'],
});

/** Every disposition a row may carry INSTEAD of a measurement. Arbitrary strings are refused. */
export const UNSCOREABLE_DISPOSITIONS = Object.freeze([
    'unscoreable_arm', 'incomplete_corpus', 'decode_failures', 'route_not_honored',
    'backend_not_proven', 'asset_reconciliation_failed', 'load_only',
] as const);

/** Admission statuses a registry-skipped row may carry. */
export const ADMISSION_STATUSES = Object.freeze(['pending_harness', 'rejected'] as const);

/** Registered not-executed reasons, as VALUES — an unregistered string can never admit a row. */
export const REGISTERED_NOT_EXECUTED_REASONS: ReadonlySet<string> =
    new Set(Object.values(NOT_EXECUTED_REASONS));

export type RowCompleteness =
    | { complete: true; kind: 'measured' | 'not_executed' | 'admission' | 'unscoreable' }
    | { complete: false; reason: string };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * FAILS CLOSED. The previous version accepted `executed:false` with ANY reason or none, ANY non-empty
 * `skipped` string, and — the worst of the three — a backend-proven verdict whose `expectedClips` and
 * `decodedClips` were ABSENT, via a trailing `return true`. A row could therefore be preserved as
 * complete while recording nothing about what it did.
 *
 * Every acceptance path now needs an EXACT registered reason, or real counts cross-checked against the
 * reliability record. A failed run must carry an explicit unscoreable disposition rather than
 * masquerading as a completed measurement.
 */
export function classifyRow(row: CheckpointRow, expectedReason?: string): RowCompleteness {
    if (row.executed === false) {
        const reason = row.reason;
        if (typeof reason !== 'string' || reason === '') {
            return { complete: false, reason: 'not-executed row carries no reason' };
        }
        if (!REGISTERED_NOT_EXECUTED_REASONS.has(reason)) {
            return { complete: false, reason: `not-executed reason '${reason}' is not registered` };
        }
        // It must be the reason registered FOR THIS ARM, not merely a valid string from the registry.
        if (expectedReason !== undefined && reason !== expectedReason) {
            return { complete: false, reason: `not-executed reason '${reason}' != registered '${expectedReason}'` };
        }
        return { complete: true, kind: 'not_executed' };
    }

    if (row.skipped !== undefined) {
        if (typeof row.skipped !== 'string' || !(ADMISSION_STATUSES as readonly string[]).includes(row.skipped)) {
            return { complete: false, reason: `admission status '${String(row.skipped)}' is not registered` };
        }
        if (typeof row.reason !== 'string' || row.reason === '') {
            return { complete: false, reason: 'admission row carries no reason' };
        }
        return { complete: true, kind: 'admission' };
    }

    if (row.disposition !== undefined) {
        if (!(UNSCOREABLE_DISPOSITIONS as readonly string[]).includes(row.disposition as string)) {
            return { complete: false, reason: `disposition '${String(row.disposition)}' is not registered` };
        }
        return { complete: true, kind: 'unscoreable' };
    }

    if (row.verdict == null) return { complete: false, reason: 'started and produced no verdict' };
    if (row.backendProven !== true) return { complete: false, reason: 'backend claim not proven' };
    if (!num(row.expectedClips)) return { complete: false, reason: 'expectedClips missing' };
    if (!num(row.decodedClips)) return { complete: false, reason: 'decodedClips missing' };

    // The counts must AGREE with the reliability record, which is the only place that knows what
    // actually succeeded. `decodedClips` was previously the number of clips OFFERED to the runner.
    const rel = row.reliability as Record<string, unknown> | undefined;
    if (!rel) return { complete: false, reason: 'reliability record missing' };
    for (const k of ['decoded', 'expectedClips', 'threw', 'emptyOutput', 'missing']) {
        if (!num(rel[k])) return { complete: false, reason: `reliability.${k} missing` };
    }
    if (rel.decoded !== row.decodedClips || rel.expectedClips !== row.expectedClips) {
        return { complete: false, reason: 'row counts disagree with the reliability record' };
    }
    if (row.decodedClips !== row.expectedClips) {
        return { complete: false, reason: `decoded ${row.decodedClips}/${row.expectedClips}` };
    }
    if (rel.threw !== 0 || rel.emptyOutput !== 0 || rel.missing !== 0) {
        return {
            complete: false,
            reason: `reliability contract unmet (threw=${rel.threw} empty=${rel.emptyOutput} missing=${rel.missing})`,
        };
    }
    return { complete: true, kind: 'measured' };
}

export function isCompleteRow(row: CheckpointRow, expectedReason?: string): boolean {
    return classifyRow(row, expectedReason).complete;
}

export interface Checkpoint {
    /** Present on `.partial.json` only. Its absence is what makes an artifact final. */
    partial: true;
    identity: RunIdentity;
    rows: CheckpointRow[];
}

export type ResumeDecision =
    | { kind: 'resume'; rows: CheckpointRow[]; completed: string[] }
    | { kind: 'start-clean'; reason: string };

const IDENTITY_KEYS: (keyof RunIdentity)[] = [
    'productBaseline', 'executionSha', 'policySha', 'corpusDigest',
    'normalizerId', 'registryDigest', 'assetDigest', 'setName', 'evidenceClass',
];

/** First mismatching identity field, or null when every field is identical. */
export function identityMismatch(a: RunIdentity, b: RunIdentity): string | null {
    for (const k of IDENTITY_KEYS) {
        if (a[k] !== b[k]) return `${k}: ${String(a[k])} != ${String(b[k])}`;
    }
    return null;
}

/**
 * Decide whether an existing checkpoint may be resumed.
 *
 * Deliberately conservative: anything unexpected starts clean. Re-measuring an arm costs time; splicing
 * incomparable rows costs the credibility of the whole artifact, and the damage is invisible.
 */
export function planResume(existing: unknown, current: RunIdentity): ResumeDecision {
    if (existing == null) return { kind: 'start-clean', reason: 'no checkpoint' };

    const cp = existing as Partial<Checkpoint>;
    // A FINAL artifact must never be extended — it is immutable evidence, not a work buffer.
    if (cp.partial !== true) return { kind: 'start-clean', reason: 'not a partial checkpoint' };
    if (!cp.identity || typeof cp.identity !== 'object') {
        return { kind: 'start-clean', reason: 'checkpoint carries no identity' };
    }
    if (!Array.isArray(cp.rows)) return { kind: 'start-clean', reason: 'checkpoint carries no rows' };

    const mismatch = identityMismatch(cp.identity as RunIdentity, current);
    if (mismatch) return { kind: 'start-clean', reason: `identity mismatch — ${mismatch}` };

    const seen = new Set<string>();
    for (const row of cp.rows) {
        if (!row || typeof row.id !== 'string' || !row.id) {
            return { kind: 'start-clean', reason: 'checkpoint row without an id' };
        }
        // A duplicate arm means two measurements of one cell are already present, and nothing here can
        // say which is authoritative.
        if (seen.has(row.id)) return { kind: 'start-clean', reason: `duplicate arm in checkpoint: ${row.id}` };
        seen.add(row.id);
    }
    // UNFINISHED rows are dropped, not resumed. Keeping them would let an arm that started and failed
    // masquerade as measured for the rest of the run's life.
    const finished = cp.rows.filter((r) => isCompleteRow(r, NOT_EXECUTED_REASONS[r.id]));
    return { kind: 'resume', rows: finished, completed: finished.map(r => r.id) };
}

export type CompletenessVerdict =
    | { ok: true }
    | { ok: false; reason: 'missing_arms' | 'duplicate_arms' | 'unexpected_arms' | 'unfinished_arms'; detail: string };

/**
 * A checkpoint may only become the final artifact when EVERY required row is accounted for — the arms
 * that were measured and the arms that were deliberately not. A named non-executed reason is a row; an
 * absent row is a hole, and a hole in a selection table reads as "not applicable" rather than "unknown".
 */
export function validateCompleteness(rows: CheckpointRow[], required: string[]): CompletenessVerdict {
    // An UNFINISHED row is not an account of its arm. Counting it would let a failed arm satisfy
    // completeness and become a silent hole in the final table.
    // The ARM'S OWN registered reason, exactly as planResume passes it. Calling isCompleteRow(row) alone
    // accepted any registered reason on any arm, so a row could be promoted to the FINAL artifact carrying
    // another arm's reason — the one place where being wrong is permanent.
    const unfinished = rows.filter(r => !isCompleteRow(r, NOT_EXECUTED_REASONS[r.id])).map(r => r.id).sort();
    if (unfinished.length) {
        return { ok: false, reason: 'unfinished_arms', detail: unfinished.join(', ') };
    }
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const r of rows) {
        if (seen.has(r.id)) dupes.push(r.id);
        seen.add(r.id);
    }
    if (dupes.length) {
        return { ok: false, reason: 'duplicate_arms', detail: [...new Set(dupes)].sort().join(', ') };
    }
    const missing = required.filter(id => !seen.has(id)).sort();
    if (missing.length) return { ok: false, reason: 'missing_arms', detail: missing.join(', ') };

    const req = new Set(required);
    const unexpected = [...seen].filter(id => !req.has(id)).sort();
    if (unexpected.length) return { ok: false, reason: 'unexpected_arms', detail: unexpected.join(', ') };

    return { ok: true };
}
