/**
 * #1037 Lane A — versioned quality metrics beyond WER: filler recognition and punctuation/sentence
 * placement. Both are precision/recall/F1 against KNOWN ground truth, versioned so a definition change is
 * a new version. Every rate is `null` when it is unmeasurable (no reference/hypothesis items), NEVER a
 * fabricated 1.0 or 0 — the same honesty rule WER follows.
 */
import { normalizeTranscript } from './werMetric';

export const FILLER_METRIC_VERSION = 'filler_v1';
export const PUNCTUATION_METRIC_VERSION = 'punct_v1';

/** Disfluency lexicon for filler_v1 (normalized tokens). */
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'err', 'erm', 'ah', 'ahh', 'hmm', 'mm', 'mmm']);

export interface PrfResult {
    version: string;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    /** null when there is nothing to be precise about (no predicted items). */
    precision: number | null;
    /** null when the reference has no items of this kind (unmeasurable). */
    recall: number | null;
    /** null when precision or recall is null, or both are 0. */
    f1: number | null;
    referenceCount: number;
    hypothesisCount: number;
}

function countBy(tokens: string[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
}

/** Shared multiset P/R/F1 over labelled items (matched by exact token). */
function prf(version: string, refItems: string[], hypItems: string[]): PrfResult {
    const ref = countBy(refItems);
    const hyp = countBy(hypItems);
    let tp = 0;
    for (const [t, c] of ref) tp += Math.min(c, hyp.get(t) ?? 0);
    const fp = hypItems.length - tp;
    const fn = refItems.length - tp;
    const precision = hypItems.length > 0 ? tp / hypItems.length : null;
    const recall = refItems.length > 0 ? tp / refItems.length : null;
    const f1 = precision !== null && recall !== null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : null;
    return { version, truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1, referenceCount: refItems.length, hypothesisCount: hypItems.length };
}

/** filler_v1 — recognition of disfluencies. Whisper commonly drops fillers, so recall is honestly low. */
export function fillerPrf(referenceGroundTruth: string, hypothesis: string): PrfResult {
    const ref = normalizeTranscript(referenceGroundTruth).filter((t) => FILLERS.has(t));
    const hyp = normalizeTranscript(hypothesis).filter((t) => FILLERS.has(t));
    return prf(FILLER_METRIC_VERSION, ref, hyp);
}

/**
 * punct_v1 — sentence-final punctuation PLACEMENT. A boundary is a `[.?!]` terminator identified by the
 * (normalized) word it follows; P/R/F1 compares the reference boundary multiset to the hypothesis one, so
 * both presence AND position are scored. Non-sentence punctuation (commas) is out of scope for v1.
 */
export function punctuationPlacementPrf(referenceGroundTruth: string, hypothesis: string): PrfResult {
    const boundaries = (text: string): string[] =>
        [...text.toLowerCase().replace(/[‘’ʼ`´]/g, "'").matchAll(/([\p{L}\p{N}'-]+)\s*[.?!]+/gu)]
            .map((m) => m[1].replace(/^['-]+|['-]+$/g, ''))
            .filter((w) => w.length > 0);
    return prf(PUNCTUATION_METRIC_VERSION, boundaries(referenceGroundTruth), boundaries(hypothesis));
}
