/**
 * #1304 — WHICH words a model inserted, not merely how many.
 *
 * The artifact reported an insertion COUNT and nothing else, so a question like "does Moonshine
 * manufacture fillers?" could not be answered from evidence — only guessed at from a total. Moonshine
 * streaming medium showed 212 insertions against 113 for v2 on the same 600 clips; that is a real signal
 * and it was unreadable.
 *
 * IMPORTANT, and the reason this is diagnostic rather than qualification: the frozen corpus is scored
 * under TRACK A, whose normalizer REMOVES `um`, `uh`, `hmm`, `mm`, `mhm`, `mmm`. A Track-A insertion
 * count therefore cannot tell you whether a model invents common fillers — they are deleted from both
 * sides before scoring. Track B keeps them, which is why the inserted-token profile is computed over
 * Track-B text. #1324's consented human corpus remains the authority for filler behaviour; this only
 * makes the corpus evidence legible.
 */

/** Fillers Track A strips and Track B keeps — the tokens whose manufacture would matter to the product. */
export const FILLER_LIKE_TOKENS: readonly string[] = ['um', 'uh', 'hmm', 'mm', 'mhm', 'mmm', 'er', 'ah'];
const FILLER_SET = new Set(FILLER_LIKE_TOKENS);

export interface EditAlignment {
    substitutions: number;
    deletions: number;
    insertions: number;
    /** Tokens present in the hypothesis with no reference counterpart, in order. */
    insertedTokens: string[];
    /** Reference tokens with no hypothesis counterpart, in order. */
    deletedTokens: string[];
}

/**
 * Levenshtein alignment with backtrace.
 *
 * A WER implementation only needs the counts; recovering WHICH tokens were inserted needs the path, so
 * the table is retained and walked back. Ties resolve substitution → deletion → insertion, which is the
 * conventional order and keeps the result deterministic for a digest.
 */
export function alignTokens(reference: readonly string[], hypothesis: readonly string[]): EditAlignment {
    const R = reference.length, H = hypothesis.length;
    const d: number[][] = Array.from({ length: R + 1 }, () => new Array<number>(H + 1).fill(0));
    for (let i = 0; i <= R; i++) d[i][0] = i;
    for (let j = 0; j <= H; j++) d[0][j] = j;
    for (let i = 1; i <= R; i++) {
        for (let j = 1; j <= H; j++) {
            const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j - 1] + cost, d[i - 1][j] + 1, d[i][j - 1] + 1);
        }
    }
    let i = R, j = H;
    let substitutions = 0, deletions = 0, insertions = 0;
    const insertedTokens: string[] = [], deletedTokens: string[] = [];
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0) {
            const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
            if (d[i][j] === d[i - 1][j - 1] + cost) {
                if (cost === 1) substitutions++;
                i--; j--; continue;
            }
        }
        if (i > 0 && d[i][j] === d[i - 1][j] + 1) { deletions++; deletedTokens.push(reference[i - 1]); i--; continue; }
        insertions++; insertedTokens.push(hypothesis[j - 1]); j--;
    }
    insertedTokens.reverse(); deletedTokens.reverse();
    return { substitutions, deletions, insertions, insertedTokens, deletedTokens };
}

export interface InsertionProfile {
    totalInsertions: number;
    /** Every inserted token with its count, most frequent first. */
    tokenFrequency: Array<{ token: string; count: number }>;
    /** The subset that are filler-like — the ones a speaking-practice product must not invent. */
    fillerLikeInsertions: Array<{ token: string; count: number }>;
    fillerLikeTotal: number;
    /** Utterances where a filler-like token was inserted, for follow-up. Bounded. */
    fillerLikeUtterances: string[];
}

/** Aggregate inserted tokens across utterances. Track-B text in, diagnostic profile out. */
export function buildInsertionProfile(
    utterances: ReadonlyArray<{ id: string; reference: readonly string[]; hypothesis: readonly string[] }>,
): InsertionProfile {
    const freq = new Map<string, number>();
    const fillerUtterances: string[] = [];
    let total = 0;
    for (const u of utterances) {
        const { insertedTokens } = alignTokens(u.reference, u.hypothesis);
        total += insertedTokens.length;
        let sawFiller = false;
        for (const t of insertedTokens) {
            freq.set(t, (freq.get(t) ?? 0) + 1);
            if (FILLER_SET.has(t)) sawFiller = true;
        }
        if (sawFiller && fillerUtterances.length < 50) fillerUtterances.push(u.id);
    }
    const sorted = [...freq.entries()]
        .map(([token, count]) => ({ token, count }))
        .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token));
    const fillerLike = sorted.filter((e) => FILLER_SET.has(e.token));
    return {
        totalInsertions: total,
        tokenFrequency: sorted.slice(0, 100),
        fillerLikeInsertions: fillerLike,
        fillerLikeTotal: fillerLike.reduce((n, e) => n + e.count, 0),
        fillerLikeUtterances: fillerUtterances,
    };
}
