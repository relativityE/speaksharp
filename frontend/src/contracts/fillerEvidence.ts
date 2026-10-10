// #1472 — ONE filler-evidence truth for every surface (Session result, delivery strip, Analytics, PDF, Progress,
// saved semantics, telemetry). PM decision 5682359616: an empty map alone never proves a clean zero.
//
// The persisted inputs are the strict flat `filler_counts` map (#1306) and the closed `filler_completeness` state
// (`complete | unobservable | no_speech`, NULL for legacy rows and older clients). This module is the only place that
// turns them into what a surface may say. It never recounts a transcript and never infers completeness.
import { readPersistedFillerCounts, type PersistedFillerCounts } from './fillerCounts';

export const FILLER_COMPLETENESS_STATES = ['complete', 'unobservable', 'no_speech'] as const;
export type FillerCompletenessState = (typeof FILLER_COMPLETENESS_STATES)[number];

/**
 * What a surface may claim about fillers.
 *
 *   observed      — at least one filler was counted. The count is truthful even when the final transcript later
 *                   omitted the token (a live detector snapshot is observed evidence, not a guess).
 *   verified_zero — zero fillers AND the completeness authority says the measurement was complete. The ONLY state
 *                   that may render "no filler words" / "clean delivery" or count as a scorable zero.
 *   unobservable  — zero fillers without an affirmative complete state (including NULL/unknown completeness). The
 *                   zero cannot be told apart from a recognizer that dropped disfluencies.
 *   no_speech     — nothing was transcribed. Distinct from unobservable.
 *   unavailable   — no valid filler map at all (absent, or rejected by the strict reader).
 */
export type FillerEvidence =
    | { kind: 'observed'; total: number; counts: PersistedFillerCounts }
    | { kind: 'verified_zero'; counts: PersistedFillerCounts }
    | { kind: 'unobservable' }
    | { kind: 'no_speech' }
    | { kind: 'unavailable' };

/** Closed-state reader: anything outside the three states (including null/undefined) is `null`. */
export function readFillerCompleteness(input: unknown): FillerCompletenessState | null {
    return typeof input === 'string' && (FILLER_COMPLETENESS_STATES as readonly string[]).includes(input)
        ? (input as FillerCompletenessState)
        : null;
}

export function resolveFillerEvidence(fillerCounts: unknown, completeness: unknown): FillerEvidence {
    const state = readFillerCompleteness(completeness);
    if (state === 'no_speech') return { kind: 'no_speech' };
    const counts = readPersistedFillerCounts(fillerCounts);
    if (counts === null) return { kind: 'unavailable' };
    const total = Object.values(counts).reduce((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);
    if (total > 0) return { kind: 'observed', total, counts };
    return state === 'complete' ? { kind: 'verified_zero', counts } : { kind: 'unobservable' };
}

export type FillerEvidenceKind = FillerEvidence['kind'];

/**
 * The same rule for an IN-MEMORY review snapshot (the just-finished take), which has a validated total and an
 * availability flag rather than a persisted map. Kept here so the Session result and every persisted surface can
 * never diverge on what a zero means.
 */
export function evidenceKindFromSnapshot(
    snapshot: { available: boolean; total: number },
    completeness: unknown,
): FillerEvidenceKind {
    const state = readFillerCompleteness(completeness);
    if (state === 'no_speech') return 'no_speech';
    if (!snapshot.available) return 'unavailable';
    if (snapshot.total > 0) return 'observed';
    return state === 'complete' ? 'verified_zero' : 'unobservable';
}

/** A persisted session's evidence. `filler_completeness` may be absent on rows read before the column existed. */
export function sessionFillerEvidence(session: { filler_counts?: unknown; filler_completeness?: unknown }): FillerEvidence {
    return resolveFillerEvidence(session.filler_counts, session.filler_completeness);
}

/**
 * The filler total a metric may use: a number ONLY for observed or verified-zero evidence. Unobservable, no-speech
 * and unavailable sessions contribute nothing — never a fabricated 0.
 */
export function measuredFillerTotal(evidence: FillerEvidence): number | null {
    if (evidence.kind === 'observed') return evidence.total;
    if (evidence.kind === 'verified_zero') return 0;
    return null;
}
