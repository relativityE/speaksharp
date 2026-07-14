// Finalized-analysis filler split (Track 1, disclosure-only).
//
// Produces the visible / speech-time-only / total distinction the finalized Filler Words card,
// the transcript highlights, Analytics/detail, and the PDF all consume from ONE object — so the
// settled Session page never mixes live/draft evidence with final/persisted evidence.
//
// Definitions (word-preserving — this NEVER alters the transcript):
//   transcriptVisibleCounts[cat] = count of that filler token actually PRESENT in finalTranscript
//                                  (so highlight-count-by-category is reproducible from the text)
//   speechTimeOnlyCounts[cat]    = max(0, liveCanonical[cat] - visible[cat])
//                                  (detected while speaking but ABSENT from the final transcript —
//                                   e.g. Native/Web Speech strips um/uh from its written text)
//   finalTotalCounts[cat]        = visible[cat] + speechTimeOnly[cat] = max(liveCanonical[cat], visible[cat])
//
// This guarantees: (a) every visible highlight is counted (finalTotal >= visible), (b) speech-only =
// live-only detections, (c) finalTotal = visible + speechOnly, all per category. It does NOT change
// filler DETECTION (context-aware accuracy for false positives like conjunction "so" is a separate PR);
// it only makes the counts honest and internally consistent.

import { FillerCounts, countFillerWords } from './fillerWordUtils';

const TOTAL_KEY = 'total';

export interface FinalizedFillerCounts {
    /** Fillers whose exact token is present + highlightable in the final transcript. */
    transcriptVisibleCounts: FillerCounts;
    /** Fillers detected during speech but absent from the final transcript text. */
    speechTimeOnlyCounts: FillerCounts;
    /** Canonical total shown on the card = visible + speech-time-only, per category. */
    finalTotalCounts: FillerCounts;
    transcriptVisibleTotal: number;
    speechTimeOnlyTotal: number;
    finalTotal: number;
}

const count = (c: FillerCounts | null | undefined, key: string): number =>
    (c && c[key] && typeof c[key].count === 'number') ? c[key].count : 0;

const color = (...sources: Array<FillerCounts | null | undefined>): ((key: string) => string) =>
    (key: string) => {
        for (const s of sources) {
            if (s && s[key] && typeof s[key].color === 'string' && s[key].color) return s[key].color;
        }
        return '';
    };

/**
 * Compute the finalized visible / speech-time-only / total split from the authoritative final
 * transcript and the canonical live filler counts (#944 live-SSOT). Pure; no transcript mutation.
 */
export function computeFinalizedFillerAnalysis(
    finalTranscript: string,
    liveFillerCounts: FillerCounts | null | undefined,
    userWords: string[] = [],
): FinalizedFillerCounts {
    // Visible = what is actually in the final transcript text (this is exactly what the highlighter
    // will render, so highlight-count-by-category is reproducible from the displayed transcript).
    const visible = countFillerWords(finalTranscript || '', userWords);

    // Category universe: every filler key seen in either source (excluding the synthetic 'total').
    const keys = new Set<string>();
    for (const k of Object.keys(visible)) if (k !== TOTAL_KEY) keys.add(k);
    for (const k of Object.keys(liveFillerCounts || {})) if (k !== TOTAL_KEY) keys.add(k);

    const pickColor = color(liveFillerCounts, visible);
    const transcriptVisibleCounts: FillerCounts = {};
    const speechTimeOnlyCounts: FillerCounts = {};
    const finalTotalCounts: FillerCounts = {};
    let visibleTotal = 0, speechOnlyTotal = 0, finalTotal = 0;

    for (const key of keys) {
        const vis = count(visible, key);
        const live = count(liveFillerCounts, key);
        const speechOnly = Math.max(0, live - vis);
        const final = vis + speechOnly; // = max(live, vis)
        const c = pickColor(key);
        transcriptVisibleCounts[key] = { count: vis, color: c };
        speechTimeOnlyCounts[key] = { count: speechOnly, color: c };
        finalTotalCounts[key] = { count: final, color: c };
        visibleTotal += vis;
        speechOnlyTotal += speechOnly;
        finalTotal += final;
    }

    transcriptVisibleCounts[TOTAL_KEY] = { count: visibleTotal, color: '' };
    speechTimeOnlyCounts[TOTAL_KEY] = { count: speechOnlyTotal, color: '' };
    finalTotalCounts[TOTAL_KEY] = { count: finalTotal, color: '' };

    return {
        transcriptVisibleCounts,
        speechTimeOnlyCounts,
        finalTotalCounts,
        transcriptVisibleTotal: visibleTotal,
        speechTimeOnlyTotal: speechOnlyTotal,
        finalTotal,
    };
}

/**
 * Card disclosure line for a finalized analysis. When speech-time-only detections exist (typical for
 * Native/Web Speech, which omits um/uh from its written transcript), the card must distinguish the
 * two groups rather than implying every counted filler is visibly highlighted.
 */
export function fillerDisclosure(f: FinalizedFillerCounts): { primary: string; secondary?: string } {
    if (f.speechTimeOnlyTotal > 0) {
        return {
            primary: `${f.transcriptVisibleTotal} shown in transcript · ${f.speechTimeOnlyTotal} additional filler words detected while speaking.`,
            secondary: 'Browser transcription may omit some filler words from the written transcript.',
        };
    }
    return { primary: `${f.finalTotal} filler ${f.finalTotal === 1 ? 'word' : 'words'} in this session.` };
}
