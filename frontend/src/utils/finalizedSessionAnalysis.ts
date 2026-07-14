// Finalized-analysis filler reconciliation (Track 1) — OBSERVATIONAL SPLIT + EXPLICIT SOURCE SELECTION.
//
// SCOPE AND HONESTY BOUNDARY
// This module works from AGGREGATE per-category counts only. It has NO occurrence identity: it cannot
// tell whether a filler token visible in the final transcript is the SAME spoken occurrence the live
// counter detected. It therefore does NOT and MUST NOT claim:
//   - "exact speech-time-only detections"
//   - "the same spoken filler is never counted twice"
//   - "authoritative reconciliation" / proof of specific missing tokens
// Those claims require occurrence IDs / timestamps / token spans that the pipeline does not currently
// produce (telemetry retains only a session total; the DB retains a per-session transcript + counts,
// not per-occurrence provenance). The fields below are named to reflect what they actually are:
// observed source counts and an INFERRED count difference — not proven occurrence-level evidence.
//
// SOURCE-SELECTION POLICY (per #944: LIVE is canonical)
// The persisted / user-facing total is the CANONICAL LIVE count. The final-transcript regex count is
// OBSERVATIONAL ONLY — it decides which fillers are visibly highlightable and whether to disclose an
// omission gap. A transcript recount is NEVER promoted above the canonical count. There is no global
// max, no per-category max, no blind addition, and no "take whichever is larger": doing so would
// reintroduce transcript authority (which #944 deliberately removed) and inflate the total with
// semantic false positives. countFillerWords() is regex-based (its "NLP" comment is aspirational; the
// implementation is word-boundary regex) and DOES count semantic/non-filler uses of ambiguous words
// (so, like, actually, literally, basically) — so its output is a CANDIDATE, never an authority.
//
// This module changes NEITHER detection accuracy NOR the persisted total relative to #944 (persisted ==
// canonical live). Its job is disclosure + highlight reconciliation: report both sources, expose the
// inferred gap that drives the status-bar copy, and provide the visible-only counts for highlighting.
// Fixing the live counter's semantic-"so" overcount (the Private 8-vs-10 dogfood gap) is a SEPARATE
// context-aware-detection change; it is explicitly out of scope here.

import { FillerCounts, countFillerWords } from './fillerWordUtils';

const TOTAL_KEY = 'total';

/** Which source produced the persisted count for a category, and why. Persisted is ALWAYS canonical. */
export type FillerSourceReason =
    | 'canonical-only'            // visible === canonical: nothing omitted, nothing excess
    | 'canonical-exceeds-visible' // canonical > visible: some detections absent from the transcript text
    | 'visible-exceeds-canonical'; // visible > canonical: transcript matched MORE (likely semantic FPs)

export interface FillerSourceDecision {
    canonical: number;
    visible: number;
    persisted: number; // == canonical (policy)
    reason: FillerSourceReason;
}

export interface FinalizedFillerReconciliation {
    // ---- Observed sources (reported, never silently merged) ----
    /** #944 canonical live/persisted counts — the authoritative source for the total. */
    retainedCanonicalCounts: FillerCounts;
    /** Regex CANDIDATE counts found in the final transcript (observational; includes semantic FPs). */
    transcriptVisibleCounts: FillerCounts;

    // ---- Inferred differences (count-level only; NOT occurrence identity) ----
    /** Per-category max(0, canonical - visible): canonical detections not present in the written text.
     *  An INFERRED count difference, NOT proof of which specific tokens are missing. */
    notVisibleCountGap: FillerCounts;
    /** Per-category max(0, visible - canonical): transcript matched MORE than live — likely semantic
     *  false positives. Reported for transparency; NEVER promoted into the persisted total. */
    transcriptExcessCounts: FillerCounts;

    // ---- Explicit source selection (the policy result) ----
    /** Persisted / user-facing counts = retainedCanonicalCounts (policy: canonical wins, #944). */
    persistedCounts: FillerCounts;
    /** Per-category decision + reason, so the selection policy is testable per category/mode. */
    selection: Record<string, FillerSourceDecision>;

    // ---- Totals ----
    retainedCanonicalTotal: number;
    transcriptVisibleTotal: number;
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
 * Reconcile the canonical live counts (#944 SSOT) with the final-transcript regex counts into an
 * observational split plus an explicit, per-category source-selection result. Pure; never mutates the
 * transcript, never fabricates tokens, never promotes a transcript recount above the canonical count.
 *
 * @param finalTranscript      authoritative final transcript text (may be empty)
 * @param liveCanonicalCounts  #944 canonical live counts (may be null/partial — treated as zeros)
 * @param userWords            custom words to EXCLUDE from filler detection (passed to countFillerWords)
 */
export function reconcileFinalizedFillers(
    finalTranscript: string,
    liveCanonicalCounts: FillerCounts | null | undefined,
    userWords: string[] = [],
): FinalizedFillerReconciliation {
    // Observational candidate: exactly what the highlighter can render from the displayed transcript.
    const visible = countFillerWords(typeof finalTranscript === 'string' ? finalTranscript : '', userWords);

    // Category universe = every filler key seen in EITHER source (excluding the synthetic 'total').
    const keys = new Set<string>();
    for (const k of Object.keys(visible)) if (k !== TOTAL_KEY) keys.add(k);
    for (const k of Object.keys(liveCanonicalCounts || {})) if (k !== TOTAL_KEY) keys.add(k);

    const pickColor = colorFor(liveCanonicalCounts, visible);
    const retainedCanonicalCounts: FillerCounts = {};
    const transcriptVisibleCounts: FillerCounts = {};
    const notVisibleCountGap: FillerCounts = {};
    const transcriptExcessCounts: FillerCounts = {};
    const persistedCounts: FillerCounts = {};
    const selection: Record<string, FillerSourceDecision> = {};

    let canonicalTotal = 0, visibleTotal = 0, gapTotal = 0, excessTotal = 0;

    for (const key of keys) {
        const canonical = count(liveCanonicalCounts, key);
        const vis = count(visible, key);
        const gap = Math.max(0, canonical - vis);      // inferred: canonical detections not in the text
        const excess = Math.max(0, vis - canonical);   // transcript matched more (likely semantic FPs)
        const persisted = canonical;                    // POLICY: canonical wins — never promote a recount
        const c = pickColor(key);

        const reason: FillerSourceReason =
            vis === canonical ? 'canonical-only'
                : canonical > vis ? 'canonical-exceeds-visible'
                    : 'visible-exceeds-canonical';

        retainedCanonicalCounts[key] = { count: canonical, color: c };
        transcriptVisibleCounts[key] = { count: vis, color: c };
        notVisibleCountGap[key] = { count: gap, color: c };
        transcriptExcessCounts[key] = { count: excess, color: c };
        persistedCounts[key] = { count: persisted, color: c };
        selection[key] = { canonical, visible: vis, persisted, reason };

        canonicalTotal += canonical;
        visibleTotal += vis;
        gapTotal += gap;
        excessTotal += excess;
    }

    retainedCanonicalCounts[TOTAL_KEY] = { count: canonicalTotal, color: '' };
    transcriptVisibleCounts[TOTAL_KEY] = { count: visibleTotal, color: '' };
    notVisibleCountGap[TOTAL_KEY] = { count: gapTotal, color: '' };
    transcriptExcessCounts[TOTAL_KEY] = { count: excessTotal, color: '' };
    persistedCounts[TOTAL_KEY] = { count: canonicalTotal, color: '' };

    return {
        retainedCanonicalCounts,
        transcriptVisibleCounts,
        notVisibleCountGap,
        transcriptExcessCounts,
        persistedCounts,
        selection,
        retainedCanonicalTotal: canonicalTotal,
        transcriptVisibleTotal: visibleTotal,
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
 * Copy variants (approved):
 *   - notVisibleGap > 0            → "Session saved · {n} filler words detected. Browser may omit some from the transcript."
 *   - count changed, no omission   → "Session saved · Filler words updated to {n}."
 *   - no discrepancy               → "Session saved · Your final feedback is ready."
 */
export function reconciliationStatusCopy(
    r: FinalizedFillerReconciliation,
    opts?: { priorDisplayedTotal?: number },
): string {
    const n = r.persistedTotal;
    if (r.notVisibleGapTotal > 0) {
        return `Session saved · ${n} filler words detected. Browser may omit some from the transcript.`;
    }
    if (opts && typeof opts.priorDisplayedTotal === 'number' && opts.priorDisplayedTotal !== n) {
        return `Session saved · Filler words updated to ${n}.`;
    }
    return 'Session saved · Your final feedback is ready.';
}
