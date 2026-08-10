import { TRUE_FILLER_WORDS, DISCOURSE_MARKER_WORDS } from '../config';
import type { FillerCounts } from './fillerWordUtils';
import type { PracticeSession } from '@/types/session';

/**
 * #1231 filler slice 2 — the DEFAULT filler headline is the TRUE-filler tier (um/uh/ah) plus the user's
 * own custom words. Discourse markers (like/so/actually/…) are tracked and shown, but only counted in the
 * headline when the user opts in (a DB-backed preference). See config's TRUE_FILLER_WORDS / DISCOURSE_MARKER_WORDS.
 *
 * HONESTY / UNIFORMITY (PO decision 2026-08-10 — "re-derive all history uniformly"):
 * The headline is DERIVED from a session's PER-KEY `filler_words` breakdown, NEVER from the stored scalar
 * `total.count` (which encodes the legacy "all 13 words" definition and would make new sessions look
 * dramatically better than old ones — a fake improvement). Every session — recorded before or after this
 * change — is re-tiered the same way from the same per-key data, so the session-over-session comparison is
 * apples-to-apples. Per-key filler counts survive the transcript-retention purge (only `transcript`/
 * `ai_suggestions` are nulled), so this derivation stays available across history.
 *
 * This is a LEAF module: it imports only config + types, so `sessionAnalysis` can consume it without a cycle.
 */

// #1131 correction 4 (mirrored here to keep this a leaf module): a valid filler count is a finite,
// non-negative integer within a sane range. Kept in lockstep with sessionAnalysis.isValidFillerCount.
const MAX_FILLER_COUNT = 999_999_999;
const isValidCount = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_FILLER_COUNT;

const TRUE_FILLER_SET: ReadonlySet<string> = new Set(TRUE_FILLER_WORDS);
const DISCOURSE_SET: ReadonlySet<string> = new Set(DISCOURSE_MARKER_WORDS);

export interface FillerTierBreakdown {
    /** um/uh/ah — non-lexical hesitation sounds. Always in the headline. */
    trueFillers: number;
    /** like/so/actually/… — legitimate in most speech; in the headline only when opted in. */
    discourseMarkers: number;
    /** the user's own custom filler words (any key not among the 13 tracked patterns). Always in the headline. */
    customWords: number;
    /** trueFillers + customWords (+ discourseMarkers when `includeDiscourseMarkers`). The headline number. */
    countedTotal: number;
    /** every valid per-key count summed — the legacy comprehensive total (all tiers), for reference/parity. */
    comprehensiveTotal: number;
}

export interface FillerTierOptions {
    /** Count discourse markers toward the headline too (the user's opt-in preference). Default false. */
    includeDiscourseMarkers?: boolean;
    /**
     * The user's OWN custom filler words. A word the user explicitly chose to track ALWAYS counts in the
     * headline — even if it collides with a built-in discourse marker (e.g. the user adds "basically").
     * The explicit choice overrides the default tier: user words take precedence over the discourse tier.
     */
    userWords?: string[];
}

/**
 * Split a per-key `filler_words` map into tiers. Returns null when there is NO usable evidence — a genuine
 * per-key zero (all tiers 0) returns countedTotal 0 (that IS valid evidence), and a TOTAL-ONLY ZERO snapshot
 * (`{ total: { count: 0 } }`, no per-word entries) also returns 0 because zero total unambiguously means
 * zero of every tier. Only a total-only NONZERO snapshot (or empty `{}`/malformed) returns null: its tiers
 * cannot be honestly split from a lone total, so callers must exclude it rather than fabricate a headline —
 * exactly as the #1131 filler-evidence contract requires.
 */
export const fillerTierBreakdown = (
    fillerWords?: PracticeSession['filler_words'] | FillerCounts | null,
    { includeDiscourseMarkers = false, userWords = [] }: FillerTierOptions = {},
): FillerTierBreakdown | null => {
    // Fail closed on non-plain-objects (arrays/scalars/null carry no per-key map). Mirrors validatedFillerTotal.
    if (!fillerWords || typeof fillerWords !== 'object' || Array.isArray(fillerWords)) return null;

    // Case-insensitive set of the user's explicit words (keys are stored with mixed case, e.g. "Kind Of").
    const userWordSet: ReadonlySet<string> = new Set(userWords.map((w) => w.toLowerCase()));
    const isUserWord = (key: string): boolean => userWordSet.has(key.toLowerCase());

    let trueFillers = 0;
    let discourseMarkers = 0;
    let customWords = 0;
    let comprehensiveTotal = 0;
    let sawValidPerKey = false;

    for (const word in fillerWords) {
        if (word === 'total') continue; // the scalar total encodes the LEGACY definition — never trusted here
        const c = (fillerWords as Record<string, { count?: unknown }>)[word]?.count;
        if (!isValidCount(c)) continue;
        sawValidPerKey = true;
        comprehensiveTotal += c;
        // Precedence: a word the user explicitly tracks always counts (custom tier), even if it also happens
        // to be a built-in discourse marker; then true fillers; then discourse; then any other untracked key
        // is a legacy/removed user word and still counts.
        if (isUserWord(word)) customWords += c;
        else if (TRUE_FILLER_SET.has(word)) trueFillers += c;
        else if (DISCOURSE_SET.has(word)) discourseMarkers += c;
        else customWords += c; // outside the 13 patterns = a custom word (present or historical)
    }

    if (!sawValidPerKey) {
        // No per-key entries. A total-only ZERO is an unambiguous "0 of everything"; anything else can't be tiered.
        const total = (fillerWords as { total?: { count?: unknown } }).total?.count;
        if (isValidCount(total) && total === 0) {
            return { trueFillers: 0, discourseMarkers: 0, customWords: 0, countedTotal: 0, comprehensiveTotal: 0 };
        }
        return null;
    }

    const countedTotal = trueFillers + customWords + (includeDiscourseMarkers ? discourseMarkers : 0);
    return { trueFillers, discourseMarkers, customWords, countedTotal, comprehensiveTotal };
};

/**
 * The DEFAULT headline filler count for a session — the counted tier derived from per-key data. Returns
 * null when there is no valid per-key evidence (so progress/analytics can exclude the row honestly). For a
 * rare total-only snapshot (no per-key breakdown), callers may fall back to the comprehensive total; that
 * fallback is the legacy definition and should be reserved for rows that genuinely lack per-key detail.
 */
export const countedFillerTotal = (
    fillerWords?: PracticeSession['filler_words'] | FillerCounts | null,
    options: FillerTierOptions = {},
): number | null => fillerTierBreakdown(fillerWords, options)?.countedTotal ?? null;
