/**
 * Calculate Word Error Rate (WER) between hypothesis and reference.
 * WER = (Substitutions + Deletions + Insertions) / Total Words
 * 
 * Industry Standard: <15% WER for Whisper Tiny
 */
export function calculateWER(hypothesis: string, reference: string): number {
    if (!reference) return hypothesis ? 100 : 0;
    if (!hypothesis) return 100;

    const hypWords = hypothesis.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
    const refWords = reference.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);

    const m = refWords.length;
    const n = hypWords.length;

    if (m === 0) return n > 0 ? 100 : 0;

    // Dynamic programming matrix for edit distance
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    // Initialize
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    // Fill matrix
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (refWords[i - 1] === hypWords[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1]; // Match
            } else {
                dp[i][j] = 1 + Math.min(
                    dp[i - 1][j],     // Deletion
                    dp[i][j - 1],     // Insertion
                    dp[i - 1][j - 1]  // Substitution
                );
            }
        }
    }

    const editDistance = dp[m][n];
    return (editDistance / m) * 100; // Return as percentage
}

export interface WERResult {
    wer: number;
    hypothesis: string;
    reference: string;
    errors: number;
    totalWords: number;
}

export function calculateDetailedWER(hypothesis: string, reference: string): WERResult {
    const hypWords = hypothesis.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
    const refWords = reference.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
    const wer = calculateWER(hypothesis, reference);

    return {
        wer,
        hypothesis,
        reference,
        errors: Math.round((wer / 100) * refWords.length),
        totalWords: refWords.length
    };
}
