// Finalized-analysis filler DISCLOSURE (Track 1) — OBSERVATIONAL ONLY. No occurrence selection.
//
// SCOPE AND HONESTY BOUNDARY
// This module works from AGGREGATE per-category counts only. It has NO occurrence identity: it cannot
// tell whether a filler token in the final transcript is the SAME spoken occurrence the live counter
// detected, and it cannot tell WHICH of several ambiguous candidates (an early semantic "so" vs. a
// later genuine filler "so") were real. It therefore does NOT select, rank, demote, or highlight
// specific occurrences, and it makes NO claim that aggregate totals can pick the truthful ones.
//
// WHAT IT DOES
//   - Reports both sources: canonical live counts vs. final-transcript regex CANDIDATES.
//   - Reports the inferred per-category differences (gap / excess) — count-level only.
//   - States one explicit selection: the persisted / user-facing total is the CANONICAL LIVE count
//     (#944), ALWAYS. No global max, no per-category max, no blind addition, no "take larger".
//   - Produces one concise, mode-aware status-bar line disclosing the discrepancy.
//
// WHAT IT DOES NOT DO (removed after review)
//   - It does NOT cap, budget, or demote transcript highlights. Transcript highlights remain the
//     existing detected highlights (parseTranscriptForHighlighting); the Filler Words card retains the
//     canonical live/persisted total. Highlights and the card total are allowed to differ — forcing
//     them equal would require selecting truthful occurrences from aggregate counts, which is not
//     possible. There is deliberately no highlight-selection export here.
//
// countFillerWords() is word-boundary REGEX (no NLP / no context classification), so it counts
// semantic/non-filler uses of ambiguous words (so, like, actually, literally, basically). Its output is
// a candidate for disclosure math only — never an authority, never a highlight selector.
//
// This module changes NEITHER detection accuracy NOR the persisted total relative to #944.

import { FillerCounts, countFillerWords } from './fillerWordUtils';

const TOTAL_KEY = 'total';

/** Which source produced the persisted count for a category, and why. Persisted is ALWAYS canonical. */
export type FillerSourceReason =
    | 'canonical-only'              // candidate === canonical: nothing omitted, nothing excess
    | 'canonical-exceeds-candidate' // canonical > candidate: some detections absent from the transcript text
    | 'candidate-exceeds-canonical'; // candidate > canonical: transcript matched MORE (likely semantic FPs)

export interface FillerSourceDecision {
    canonical: number;
    candidate: number;
    persisted: number;  // == canonical (policy). No occurrence-level selection is implied.
    reason: FillerSourceReason;
}

export interface FinalizedFillerReconciliation {
    // ---- Observed sources (reported, never silently merged) ----
    /** #944 canonical live/persisted counts — the authoritative source for the total. */
    retainedCanonicalCounts: FillerCounts;
    /** Regex CANDIDATE counts in the final transcript. Observational input to the disclosure gap only —
     *  NOT approved highlights, NOT a selector. Includes semantic false positives. */
    transcriptCandidateCounts: FillerCounts;

    // ---- Inferred differences (count-level only; NOT occurrence identity) ----
    /** Per-category max(0, canonical - candidate): canonical detections not present in the written text.
     *  An INFERRED count difference, NOT proof of which specific tokens are missing. */
    notVisibleCountGap: FillerCounts;
    /** Per-category max(0, candidate - canonical): transcript matched MORE than live — likely semantic
     *  false positives. Reported for transparency; NEVER promoted, NEVER used to select highlights. */
    transcriptExcessCounts: FillerCounts;

    // ---- Explicit source selection (the policy result) ----
    /** Persisted / user-facing counts = retainedCanonicalCounts (policy: canonical wins, #944). */
    persistedCounts: FillerCounts;
    /** Per-category decision + reason, so the selection policy is testable per category/mode. */
    selection: Record<string, FillerSourceDecision>;

    // ---- Totals ----
    retainedCanonicalTotal: number;
    transcriptCandidateTotal: number;
    notVisibleGapTotal: number;
    transcriptExcessTotal: number;
    persistedTotal: number;
}

const count = (c: FillerCounts | null | undefined, key: string): number => {
    const n = c && c[key] && typeof c[key].count === 'number' ? c[key].count : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
};

const colorFor = (...sources: Array<FillerCounts | null | undefined>) => (key: string): string => {
    for (const s of sources) {
        if (s && s[key] && typeof s[key].color === 'string' && s[key].color) return s[key].color;
    }
    return '';
};

/**
 * Reconcile the canonical live counts (#944 SSOT) with the final-transcript regex candidates into an
 * observational split plus an explicit per-category source-selection result. Pure; never mutates the
 * transcript, never fabricates tokens, never promotes a transcript recount, never selects occurrences.
 *
 * @param finalTranscript      authoritative final transcript text (may be empty)
 * @param liveCanonicalCounts  #944 canonical live counts (may be null/partial — treated as zeros)
 * @param userWords            custom filler words the user tracks — ADDED to detection (passed through to
 *                             countFillerWords, which counts them as fillers). NOT an exclusion list.
 */
export function reconcileFinalizedFillers(
    finalTranscript: string,
    liveCanonicalCounts: FillerCounts | null | undefined,
    userWords: string[] = [],
): FinalizedFillerReconciliation {
    // Candidate set: regex matches in the transcript. Disclosure-math input only — NOT a highlight set.
    const candidate = countFillerWords(typeof finalTranscript === 'string' ? finalTranscript : '', userWords);

    // Category universe = every filler key seen in EITHER source (excluding the synthetic 'total').
    const keys = new Set<string>();
    for (const k of Object.keys(candidate)) if (k !== TOTAL_KEY) keys.add(k);
    for (const k of Object.keys(liveCanonicalCounts || {})) if (k !== TOTAL_KEY) keys.add(k);

    const pickColor = colorFor(liveCanonicalCounts, candidate);
    const retainedCanonicalCounts: FillerCounts = {};
    const transcriptCandidateCounts: FillerCounts = {};
    const notVisibleCountGap: FillerCounts = {};
    const transcriptExcessCounts: FillerCounts = {};
    const persistedCounts: FillerCounts = {};
    const selection: Record<string, FillerSourceDecision> = {};

    let canonicalTotal = 0, candidateTotal = 0, gapTotal = 0, excessTotal = 0;

    for (const key of keys) {
        const canonical = count(liveCanonicalCounts, key);
        const cand = count(candidate, key);
        const gap = Math.max(0, canonical - cand);        // inferred: canonical detections not in the text
        const excess = Math.max(0, cand - canonical);     // transcript matched more (likely semantic FPs)
        const persisted = canonical;                       // POLICY: canonical wins — never promote a recount
        const c = pickColor(key);

        const reason: FillerSourceReason =
            cand === canonical ? 'canonical-only'
                : canonical > cand ? 'canonical-exceeds-candidate'
                    : 'candidate-exceeds-canonical';

        retainedCanonicalCounts[key] = { count: canonical, color: c };
        transcriptCandidateCounts[key] = { count: cand, color: c };
        notVisibleCountGap[key] = { count: gap, color: c };
        transcriptExcessCounts[key] = { count: excess, color: c };
        persistedCounts[key] = { count: persisted, color: c };
        selection[key] = { canonical, candidate: cand, persisted, reason };

        canonicalTotal += canonical;
        candidateTotal += cand;
        gapTotal += gap;
        excessTotal += excess;
    }

    retainedCanonicalCounts[TOTAL_KEY] = { count: canonicalTotal, color: '' };
    transcriptCandidateCounts[TOTAL_KEY] = { count: candidateTotal, color: '' };
    notVisibleCountGap[TOTAL_KEY] = { count: gapTotal, color: '' };
    transcriptExcessCounts[TOTAL_KEY] = { count: excessTotal, color: '' };
    persistedCounts[TOTAL_KEY] = { count: canonicalTotal, color: '' };

    return {
        retainedCanonicalCounts,
        transcriptCandidateCounts,
        notVisibleCountGap,
        transcriptExcessCounts,
        persistedCounts,
        selection,
        retainedCanonicalTotal: canonicalTotal,
        transcriptCandidateTotal: candidateTotal,
        notVisibleGapTotal: gapTotal,
        transcriptExcessTotal: excessTotal,
        persistedTotal: canonicalTotal,
    };
}

/**
 * ONE concise status-bar message for the finalized session. This is the ONLY user-facing copy this
 * module produces — there is deliberately NO card disclosure contract (no primary/secondary lines, no
 * secondary filler panel). The discrepancy acknowledgment lives in the single status bar only.
 *
 * MODE-AWARE: the omission clause is emitted only for mode === 'native'.
 *
 * Copy variants (approved):
 *   - native + notVisibleGap > 0  → "Session saved · {n} filler words detected. The written transcript may omit some."
 *   - count changed, no omission  → "Session saved · Filler words updated to {n}."
 *   - no discrepancy              → "Session saved · Your transcript is ready."
 *
 * NOTE: the ordinary settled copy says the TRANSCRIPT is ready — deliberately not "your final feedback",
 * which would over-claim while the coaching score may still read "Score Soon" / "Confidence: Building".
 */
export function reconciliationStatusCopy(
    r: FinalizedFillerReconciliation,
    opts?: { mode?: string; priorDisplayedTotal?: number },
): string {
    const n = r.persistedTotal;
    const isNative = opts?.mode === 'native';
    if (isNative && r.notVisibleGapTotal > 0) {
        return `Session saved · ${n} filler words detected. The written transcript may omit some.`;
    }
    if (opts && typeof opts.priorDisplayedTotal === 'number' && opts.priorDisplayedTotal !== n) {
        return `Session saved · Filler words updated to ${n}.`;
    }
    return 'Session saved · Your transcript is ready.';
}
