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
export function isCompleteRow(row: CheckpointRow): boolean {
    if (row.executed === false) return true;          // preserved with a named not-executed reason
    if (typeof row.skipped === 'string' && row.skipped) return true; // registry admission (rejected/pending)
    if (row.verdict == null) return false;             // started and produced nothing

    /**
     * A VERDICT OBJECT IS NOT A MEASUREMENT. A run whose corpus audio was absent produced a verdict for
     * every arm with `decoded 0/600` and `route_not_honored`, and the artifact was written as if
     * complete. The verdict existed; the evidence did not.
     *
     * So a measured row counts as finished only when the backend was actually proven and every expected
     * clip decoded. Anything less is an arm to re-measure, not a row to keep.
     */
    if (row.backendProven !== true) return false;
    const expected = row.expectedClips;
    const decoded = row.decodedClips;
    if (typeof expected === 'number' && typeof decoded === 'number') return decoded === expected;
    return true;
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
    const finished = cp.rows.filter(isCompleteRow);
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
    const unfinished = rows.filter(r => !isCompleteRow(r)).map(r => r.id).sort();
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
