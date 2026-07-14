// Finalized-analysis filler reconciliation (Track 1) — OBSERVATIONAL SPLIT + EXPLICIT SOURCE SELECTION.
//
// SCOPE AND HONESTY BOUNDARY
// This module works from AGGREGATE per-category counts only. It has NO occurrence identity: it cannot
// tell whether a filler token in the final transcript is the SAME spoken occurrence the live counter
// detected, and it cannot tell which of several ambiguous candidates (semantic "so"/"like") were
// genuine fillers. It therefore does NOT and MUST NOT claim exact speech-time-only detections, proven
// non-duplication, authoritative reconciliation, or exact identification of the genuine occurrences.
// Those require occurrence IDs / timestamps / token spans the pipeline does not produce today.
//
// SOURCE-SELECTION POLICY (per #944: LIVE is canonical)
// The persisted / user-facing total is the CANONICAL LIVE count. The final-transcript regex count is a
// CANDIDATE only. A transcript recount is NEVER promoted above the canonical count — no global max, no
// per-category max, no blind addition, no "take whichever is larger". countFillerWords() /
// parseTranscriptForHighlighting() are word-boundary regex (the "NLP" comment in fillerWordUtils is
// aspirational) and DO match semantic/non-filler uses of ambiguous words, so their output is a
// candidate, never an authority.
//
// HIGHLIGHT POLICY (bounded; never the raw candidates)
// Transcript highlights must NOT be the raw regex candidates. selectFinalizedHighlightTokens() caps
// highlighted tokens per category at the canonical card count: a category with canonical 0 yields ZERO
// finalized highlights, and finalized highlights never exceed the canonical count per category. When
// candidates exceed canonical we keep the first `canonical` occurrences in document order — we do NOT
// claim these are the genuine ones (aggregate counts cannot identify which); we bound the COUNT only.
//
// This module changes NEITHER detection accuracy NOR the persisted total relative to #944 (persisted ==
// canonical live). Its job is disclosure + a bounded highlight budget. Fixing the live counter's
// semantic-"so" overcount is a SEPARATE context-aware-detection change, out of scope here.

import { FillerCounts, countFillerWords } from './fillerWordUtils';
import type { HighlightToken } from './highlightUtils';

const TOTAL_KEY = 'total';

/** Which source produced the persisted count for a category, and why. Persisted is ALWAYS canonical. */
export type FillerSourceReason =
    | 'canonical-only'             // candidate === canonical: nothing omitted, nothing excess
    | 'canonical-exceeds-candidate' // canonical > candidate: some detections absent from the transcript text
    | 'candidate-exceeds-canonical'; // candidate > canonical: transcript matched MORE (likely semantic FPs)

export interface FillerSourceDecision {
    canonical: number;
    candidate: number;
    persisted: number;  // == canonical (policy)
    highlight: number;  // == min(candidate, canonical) (bounded highlight budget)
    reason: FillerSourceReason;
}

export interface FinalizedFillerReconciliation {
    // ---- Observed sources (reported, never silently merged) ----
    /** #944 canonical live/persisted counts — the authoritative source for the total. */
    retainedCanonicalCounts: FillerCounts;
    /** Regex CANDIDATE counts in the final transcript. NOT approved visible highlights — a candidate
     *  set that includes semantic false positives. Never wire this directly to the highlighter. */
    transcriptCandidateCounts: FillerCounts;

    // ---- Inferred differences (count-level only; NOT occurrence identity) ----
    /** Per-category max(0, canonical - candidate): canonical detections not present in the written text.
     *  An INFERRED count difference, NOT proof of which specific tokens are missing. */
    notVisibleCountGap: FillerCounts;
    /** Per-category max(0, candidate - canonical): transcript matched MORE than live — likely semantic
     *  false positives. Reported for transparency; NEVER promoted into the persisted total. */
    transcriptExcessCounts: FillerCounts;

    // ---- Explicit source selection (the policy result) ----
    /** Persisted / user-facing counts = retainedCanonicalCounts (policy: canonical wins, #944). */
    persistedCounts: FillerCounts;
    /** Bounded per-category highlight budget = min(candidate, canonical). Canonical 0 → 0. Never the
     *  raw candidates; the actual token demotion is applied by selectFinalizedHighlightTokens(). */
    finalizedHighlightCounts: FillerCounts;
    /** Per-category decision + reason, so the selection policy is testable per category/mode. */
    selection: Record<string, FillerSourceDecision>;

    // ---- Totals ----
    retainedCanonicalTotal: number;
    transcriptCandidateTotal: number;
    notVisibleGapTotal: number;
    transcriptExcessTotal: number;
    persistedTotal: number;
    finalizedHighlightTotal: number;
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
 * observational split, an explicit per-category source-selection result, and a bounded highlight budget.
 * Pure; never mutates the transcript, never fabricates tokens, never promotes a transcript recount above
 * the canonical count.
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
    // Candidate set: regex matches in the transcript. This is NOT the approved highlight set.
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
    const finalizedHighlightCounts: FillerCounts = {};
    const selection: Record<string, FillerSourceDecision> = {};

    let canonicalTotal = 0, candidateTotal = 0, gapTotal = 0, excessTotal = 0, highlightTotal = 0;

    for (const key of keys) {
        const canonical = count(liveCanonicalCounts, key);
        const cand = count(candidate, key);
        const gap = Math.max(0, canonical - cand);        // inferred: canonical detections not in the text
        const excess = Math.max(0, cand - canonical);     // transcript matched more (likely semantic FPs)
        const persisted = canonical;                       // POLICY: canonical wins — never promote a recount
        const highlight = Math.min(cand, canonical);       // bounded highlight budget (0 when canonical 0)
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
        finalizedHighlightCounts[key] = { count: highlight, color: c };
        selection[key] = { canonical, candidate: cand, persisted, highlight, reason };

        canonicalTotal += canonical;
        candidateTotal += cand;
        gapTotal += gap;
        excessTotal += excess;
        highlightTotal += highlight;
    }

    retainedCanonicalCounts[TOTAL_KEY] = { count: canonicalTotal, color: '' };
    transcriptCandidateCounts[TOTAL_KEY] = { count: candidateTotal, color: '' };
    notVisibleCountGap[TOTAL_KEY] = { count: gapTotal, color: '' };
    transcriptExcessCounts[TOTAL_KEY] = { count: excessTotal, color: '' };
    persistedCounts[TOTAL_KEY] = { count: canonicalTotal, color: '' };
    finalizedHighlightCounts[TOTAL_KEY] = { count: highlightTotal, color: '' };

    return {
        retainedCanonicalCounts,
        transcriptCandidateCounts,
        notVisibleCountGap,
        transcriptExcessCounts,
        persistedCounts,
        finalizedHighlightCounts,
        selection,
        retainedCanonicalTotal: canonicalTotal,
        transcriptCandidateTotal: candidateTotal,
        notVisibleGapTotal: gapTotal,
        transcriptExcessTotal: excessTotal,
        persistedTotal: canonicalTotal,
        finalizedHighlightTotal: highlightTotal,
    };
}

/**
 * Bound a highlight-token stream (from parseTranscriptForHighlighting) to the canonical card counts.
 * This is the safe highlight-selection policy — the raw candidate tokens must NEVER be rendered
 * directly. Per category, at most `canonical` filler tokens survive (in document order); the rest are
 * demoted to plain text. A category with canonical 0 (or absent from canonical) yields zero highlights.
 *
 * LIMITATION: keeping the first `canonical` occurrences does NOT prove they are the genuine fillers —
 * aggregate counts cannot identify which ambiguous occurrences were real. This bounds the COUNT so the
 * transcript never shows more (or different-category) highlights than the card claims; it does not
 * resolve occurrence identity.
 */
export function selectFinalizedHighlightTokens(
    tokens: HighlightToken[],
    canonicalCounts: FillerCounts | null | undefined,
): HighlightToken[] {
    const budget = new Map<string, number>();
    for (const [k, v] of Object.entries(canonicalCounts || {})) {
        if (k === TOTAL_KEY) continue;
        const n = v && typeof v.count === 'number' && v.count > 0 ? v.count : 0;
        budget.set(k.toLowerCase(), n);
    }
    return (tokens || []).map((t) => {
        if (!t || t.type !== 'filler') return t;
        const key = t.transcript.toLowerCase().trim();
        const remaining = budget.get(key);
        if (remaining && remaining > 0) {
            budget.set(key, remaining - 1);
            return t; // keep within the canonical budget
        }
        // canonical 0, absent category, or over budget → demote to plain text (drop the highlight).
        return { ...t, type: 'text' as const, color: undefined };
    });
}

/**
 * ONE concise status-bar message for the finalized session. This is the ONLY user-facing copy this
 * module produces — there is deliberately NO card disclosure contract (no primary/secondary lines, no
 * secondary filler panel). The discrepancy acknowledgment lives in the single status bar only.
 *
 * MODE-AWARE: "Browser may omit some from the transcript" describes Web Speech (Native) behaviour and is
 * emitted ONLY for mode === 'native'. Private (and any non-native mode) never receives Browser-specific
 * copy, even when an omission gap exists.
 *
 * Copy variants (approved):
 *   - native + notVisibleGap > 0  → "Session saved · {n} filler words detected. Browser may omit some from the transcript."
 *   - count changed, no omission  → "Session saved · Filler words updated to {n}."
 *   - no discrepancy              → "Session saved · Your final feedback is ready."
 */
export function reconciliationStatusCopy(
    r: FinalizedFillerReconciliation,
    opts?: { mode?: string; priorDisplayedTotal?: number },
): string {
    const n = r.persistedTotal;
    const isNative = opts?.mode === 'native';
    if (isNative && r.notVisibleGapTotal > 0) {
        return `Session saved · ${n} filler words detected. Browser may omit some from the transcript.`;
    }
    if (opts && typeof opts.priorDisplayedTotal === 'number' && opts.priorDisplayedTotal !== n) {
        return `Session saved · Filler words updated to ${n}.`;
    }
    return 'Session saved · Your final feedback is ready.';
}
