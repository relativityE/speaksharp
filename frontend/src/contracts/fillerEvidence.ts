// #1472 — ONE filler-evidence truth for every surface: the live Session review, the saved/reloaded review, analysis
// copy, PDF, Analytics and client Progress. An empty filler map alone never proves a clean zero (PM 5682359616).
//
// The inputs are the two facts every completed session already carries: the validated filler counts and the word
// count (`filler_counts`, `total_words` — persisted by `complete_session_v2`). No persisted completeness column exists
// or is needed (Browser PM 6101983829 / 6102096434): telemetry's `resolveCompleteness` is `complete` only when at
// least one filler was counted, so the same rule reconstructs it exactly from these two inputs. This module is the
// only place that turns them into what a surface may say. It never recounts a transcript.
import { readPersistedFillerCounts, type PersistedFillerCounts } from './fillerCounts';

/**
 * What a surface may claim about fillers.
 *
 *   observed      — at least one filler was counted. Truthful even when the word count says no speech (a live detector
 *                   snapshot is observed evidence; inconsistent inputs never erase a positive count).
 *   verified_zero — RESERVED. A zero proven complete by affirmative evidence. Nothing produces it today: no evidence
 *                   source can tell a fluent speaker from a recognizer that dropped disfluencies. It is the only kind
 *                   that may say "no filler words" / "clean delivery", so it stays in the type for that future design.
 *   unobservable  — zero fillers over transcribed words. Unverifiable; never a clean result or a scorable zero.
 *   no_speech     — nothing was transcribed. Distinct from unobservable.
 *   unavailable   — no valid filler map, or (for a zero) no valid word count. Withheld; never a zero.
 */
export type FillerEvidence =
    | { kind: 'observed'; total: number; counts: PersistedFillerCounts }
    | { kind: 'verified_zero'; counts: PersistedFillerCounts }
    | { kind: 'unobservable' }
    | { kind: 'no_speech' }
    | { kind: 'unavailable' };

export type FillerEvidenceKind = FillerEvidence['kind'];

/** A word count is authority only as a finite, non-negative integer. */
export function validWordCount(input: unknown): number | null {
    return typeof input === 'number' && Number.isInteger(input) && input >= 0 ? input : null;
}

/**
 * THE RULE, shared by the in-memory review and every persisted surface (a test pins their parity).
 * `available` = the filler map is valid; `total` = its validated sum; `words` = the word count, or null when unknown.
 */
export function fillerEvidenceKind(input: { available: boolean; total: number; words: number | null }): Exclude<FillerEvidenceKind, 'verified_zero'> {
    if (!input.available) return 'unavailable';
    if (input.total > 0) return 'observed';
    const words = validWordCount(input.words);
    if (words === null) return 'unavailable';
    return words === 0 ? 'no_speech' : 'unobservable';
}

/**
 * A saved session's ALL-KEY evidence from its persisted `filler_counts` and `total_words` — for the all-key Analytics
 * average and Progress rate, which only ever report positive counts. A surface that claims a TIER count (the true-filler
 * headline, review, analysis copy, PDF, Progress breakdown) must gate on THAT tier's total with `fillerEvidenceKind`
 * (as `getSessionAnalysisMetrics` does), so a discourse marker excluded from the tier never authorizes a zero claim.
 */
export function persistedFillerEvidence(session: { filler_counts?: unknown; total_words?: unknown }): FillerEvidence {
    const counts = readPersistedFillerCounts(session.filler_counts);
    const total = counts === null ? 0 : Object.values(counts).reduce<number>((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);
    const kind = fillerEvidenceKind({ available: counts !== null, total, words: validWordCount(session.total_words) });
    return kind === 'observed' ? { kind, total, counts: counts as PersistedFillerCounts } : { kind };
}

/**
 * The filler total a metric may use: a number ONLY for observed (or a future verified-zero) evidence. Unobservable,
 * no-speech and unavailable sessions contribute nothing — never a fabricated, flattering 0.
 */
export function measuredFillerTotal(evidence: FillerEvidence): number | null {
    if (evidence.kind === 'observed') return evidence.total;
    if (evidence.kind === 'verified_zero') return 0;
    return null;
}
