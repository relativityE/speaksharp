/**
 * #1037 Lane A — versioned transcript normalization + word error rate.
 *
 * WER is only meaningful against a KNOWN ground truth and a proven route (the schema enforces the route;
 * this enforces the ground truth). The normalization is VERSIONED: any change is a new
 * `normalizationVersion`, so a normalization tweak can never silently move a "comparable" ranking. WER of
 * an empty reference is `null` (unmeasurable), NEVER 0 — a fabricated perfect score is the exact failure
 * this program exists to prevent.
 */

import { normalizeEnglish } from './englishNormalizer';

/** Bump on ANY change to normalization. Rows carry it in comparability_inputs.normalizationVersion. */
export const NORMALIZATION_VERSION = 'norm_v1';

/**
 * #1304 — `norm_v2` folds surface-form differences (contractions, British/American spelling, spelled-out
 * numbers, percent, decimal currency) that made a SEMANTICALLY PERFECT transcript score non-zero under
 * v1: measured 8.3% / 25% / 33.3% / 50% / 71.4% on the five classes, against 0% for a byte-identical
 * pair. Every comparison built on v1 numbers was partly measuring orthography.
 *
 * v1 is RETAINED, not replaced: rows already pinned to it must stay reproducible. The version used is
 * recorded on every result, so a default change shows up in the data rather than silently moving a
 * ranking.
 */
export const NORMALIZATION_VERSION_V2 = 'norm_v2';

export type NormalizationVersion = typeof NORMALIZATION_VERSION | typeof NORMALIZATION_VERSION_V2;

/**
 * norm_v1: lowercase; drop surrounding punctuation but keep intra-word apostrophes/hyphens; collapse
 * whitespace; tokenize on whitespace. Error markers like `[inaudible]` are preserved as tokens so a
 * recognizer that emits them is scored honestly, not silently cleaned.
 */
export function normalizeTranscript(text: string): string[] {
    if (typeof text !== 'string') return [];
    return text
        .toLowerCase()
        // Fold typographic apostrophes/backticks to ASCII first, so a curly-quoted "don't" in curated
        // ground truth is not split into "don" + "t".
        .replace(/[‘’ʼ`´]/g, "'")
        .replace(/[^\p{L}\p{N}\s'\-[\]_]/gu, ' ') // keep letters/digits/apostrophe/hyphen and […] markers
        .split(/\s+/)
        .map((t) => t.replace(/^['-]+|['-]+$/g, '')) // trim leading/trailing apostrophes-hyphens
        .filter((t) => t.length > 0);
}

export interface WerResult {
    /** null when the reference has no words — unmeasurable, never 0. */
    wer: number | null;
    referenceWords: number;
    substitutions: number;
    deletions: number;
    insertions: number;
    normalizationVersion: string;
}

/** Word-level Levenshtein (edit distance) with S/D/I breakdown. */
function editOps(ref: string[], hyp: string[]): { sub: number; del: number; ins: number } {
    const n = ref.length;
    const m = hyp.length;
    // dp[i][j] = edit distance ref[..i], hyp[..j]; backtrack for S/D/I counts.
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (ref[i - 1] === hyp[j - 1]) dp[i][j] = dp[i - 1][j - 1];
            else dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    let i = n, j = m, sub = 0, del = 0, ins = 0;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) { i--; j--; }
        else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) { sub++; i--; j--; }
        else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { del++; i--; }
        else { ins++; j--; }
    }
    return { sub, del, ins };
}

/**
 * @param referenceGroundTruth the KNOWN fixture transcript (never a recognizer output).
 * @param hypothesis           the recognizer's transcript.
 */
export function wordErrorRate(
    referenceGroundTruth: string,
    hypothesis: string,
    options: { normalization?: NormalizationVersion } = {},
): WerResult {
    // Defaults to v2 — the version that does not charge a perfect transcript for spelling a number
    // differently. Pass 'norm_v1' explicitly to reproduce a row that was pinned under it.
    const version = options.normalization ?? NORMALIZATION_VERSION_V2;
    const normalize = version === NORMALIZATION_VERSION_V2 ? normalizeEnglish : normalizeTranscript;
    const ref = normalize(referenceGroundTruth);
    const hyp = normalize(hypothesis);
    if (ref.length === 0) {
        return { wer: null, referenceWords: 0, substitutions: 0, deletions: 0, insertions: 0, normalizationVersion: version };
    }
    const { sub, del, ins } = editOps(ref, hyp);
    return {
        wer: (sub + del + ins) / ref.length,
        referenceWords: ref.length,
        substitutions: sub,
        deletions: del,
        insertions: ins,
        normalizationVersion: version,
    };
}
