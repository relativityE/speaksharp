/**
 * #1259 F04 — how much the transcript moved under the user, without recording a word of it.
 *
 * The PO: "The amount of tentative words and sentences in flux as I spoke was distracting." That is a
 * report about MOTION, and motion is the one thing a finished transcript cannot show. By the time any
 * artifact exists the text has settled, so the churn is gone and only the impression remains.
 *
 * The obvious instrumentation is the wrong one. An event per update would produce exactly the
 * per-frame stream the contract forbids — hundreds of events in a 90-second take, and the noise would
 * be the loudest thing in the data. So updates are COUNTED here and reported ONCE, at finalization.
 *
 * What makes this more than a counter is the revision measurement. A provisional word being replaced
 * is normal and expected — that is what provisional means. What the user actually noticed is
 * previously COMMITTED text changing after they had already read it, and how far back that rewrite
 * reached. A long stable prefix that suddenly rewrites twelve words is a different experience from one
 * that corrects its last word, and a raw update count cannot tell them apart.
 *
 * NOT A WORD OF TEXT. Counts, a word-distance, and a duration.
 */
import { safeEmit } from './safeEmit';
import { countWords } from '@/lib/contentDigest';

let provisionalUpdates = 0;
let finalUpdates = 0;
let revisions = 0;
let maxRewrittenPrefixWords = 0;
let firstUpdateAt: number | null = null;
let lastChangeAt: number | null = null;
let previousCommitted = '';

/**
 * How many leading words survived. A rewrite that reaches back N words changed everything after the
 * common prefix, and N is the distance the reader has to re-read.
 */
export function rewrittenPrefixWords(before: string, after: string): number {
    const a = before.trim().split(/\s+/).filter(Boolean);
    const b = after.trim().split(/\s+/).filter(Boolean);
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
    // Only what was ALREADY SHOWN and then changed counts. Appending to the end is not a rewrite —
    // it is the transcript doing its job, and counting it would make every session look unstable.
    return Math.max(0, a.length - common);
}

/** Called on every transcript update. Deliberately cheap: two counters and a prefix walk. */
export function noteTranscriptUpdate(committed: string, partial: string): void {
    const now = Date.now();
    if (firstUpdateAt === null) firstUpdateAt = now;

    if (partial !== '') provisionalUpdates += 1;

    if (committed !== previousCommitted) {
        finalUpdates += 1;
        lastChangeAt = now;
        const rewritten = rewrittenPrefixWords(previousCommitted, committed);
        if (rewritten > 0) {
            revisions += 1;
            if (rewritten > maxRewrittenPrefixWords) maxRewrittenPrefixWords = rewritten;
        }
        previousCommitted = committed;
    }
}

/** Reported ONCE, at finalization. Returns false when there was nothing to report. */
export function emitTranscriptStability(finalCommitted: string, finalPartial: string): boolean {
    if (provisionalUpdates === 0 && finalUpdates === 0) return false;
    safeEmit('transcript_stability', {
        provisional_updates: provisionalUpdates,
        final_updates: finalUpdates,
        // Revisions to text the user had ALREADY READ — not provisional words being replaced, which
        // is what provisional means and is not what anyone complained about.
        revisions: revisions,
        max_rewritten_prefix_words: maxRewrittenPrefixWords,
        ms_to_stable: firstUpdateAt !== null && lastChangeAt !== null
            ? Math.max(0, lastChangeAt - firstUpdateAt)
            : null,
        visible_final_words: countWords(finalCommitted),
        visible_provisional_words: countWords(finalPartial),
    }, 'HIGH');
    return true;
}

/** A new take starts a new measurement. */
export function resetTranscriptStability(): void {
    provisionalUpdates = 0;
    finalUpdates = 0;
    revisions = 0;
    maxRewrittenPrefixWords = 0;
    firstUpdateAt = null;
    lastChangeAt = null;
    previousCommitted = '';
}

export function __resetTranscriptStabilityForTests(): void { resetTranscriptStability(); }
