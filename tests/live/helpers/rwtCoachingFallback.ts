/**
 * J3 (Elon, Sam, 2026-11-21) — observation `coaching_fallback_shown`: when THIS take's coaching ends in failure (the request
 * settled and no review pair rendered), the review card shows its fallback. Read only, never pressed: pressing Try again would
 * be another provider request.
 *
 * Scoped inside `[data-testid="ai-suggestions-card"]`, PASS only when all five hold:
 *  1. `ai-suggestions-still-coming` is visible;
 *  2. `ai-suggestions-headline` is visible and is not "Your review is on its way.";
 *  3. `ai-suggestions-retry` is visible, enabled, and reads exactly "Try again";
 *  4. `ai-suggestions-pair` count is 0;
 *  5. `ai-suggestions-disclosure` is visible.
 *
 * It is its own row. It never changes the coaching row (`Focus coaching rendered`): a shown fallback is not coaching, and the
 * coaching verdict stays FAIL. A missing fallback is FAIL here too, so it is visible in the receipt. When coaching succeeds the
 * row is NOT RUN, which a receipt records by writing no row. A request still unsettled at the coaching bound is HOLD: the
 * failure ending was never reached, so nothing about its fallback is judged. Evidence is booleans and counts only.
 */
import type { Locator } from '@playwright/test';

export const COACHING_FALLBACK_ROW = 'Focus coaching fallback shown';
export const COACHING_FALLBACK_OBSERVATION = 'coaching_fallback_shown';
/** The in-flight headline. A failure that still shows it has not shown its fallback. */
export const IN_FLIGHT_HEADLINE = 'Your review is on its way.';
export const RETRY_LABEL = 'Try again';
const READ_MS = 5_000;

/** Each read: a fact, or null when the read itself failed (unreadable is never absence). */
export interface CoachingFallbackObservation {
    stillComingVisible: boolean | null;
    headlineVisible: boolean | null;
    /** True when the headline reads the in-flight line; null when it could not be read. */
    headlineInFlight: boolean | null;
    retryVisible: boolean | null;
    retryEnabled: boolean | null;
    retryLabelExact: boolean | null;
    pairCount: number | null;
    disclosureVisible: boolean | null;
}

/** The narrow part of a Playwright Locator the reader uses, so it can be read in a unit test over a real rendered card. */
export interface CardLocator {
    getByTestId(id: string): Pick<Locator, 'count' | 'first'>;
}

const bounded = <T>(p: Promise<T>): Promise<T | null> => Promise.race([
    p.then((v) => v, () => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_MS)),
]);

/**
 * Reads the card's fallback without pressing anything. Absent nodes read as not visible (a fact); a read that throws or
 * passes its bound reads null.
 */
export async function readCoachingFallback(card: CardLocator): Promise<CoachingFallbackObservation> {
    const visible = async (id: string): Promise<boolean | null> => {
        const nodes = card.getByTestId(id);
        const n = await bounded(nodes.count());
        if (n === null) return null;
        return n === 0 ? false : bounded(nodes.first().isVisible());
    };
    const text = async (id: string): Promise<string | null> => bounded(card.getByTestId(id).first().innerText({ timeout: READ_MS }));
    const stillComingVisible = await visible('ai-suggestions-still-coming');
    const headlineVisible = await visible('ai-suggestions-headline');
    const headline = headlineVisible ? await text('ai-suggestions-headline') : null;
    const retryVisible = await visible('ai-suggestions-retry');
    const retryEnabled = retryVisible ? await bounded(card.getByTestId('ai-suggestions-retry').first().isEnabled({ timeout: READ_MS })) : retryVisible;
    const label = retryVisible ? await text('ai-suggestions-retry') : null;
    const pairCount = await bounded(card.getByTestId('ai-suggestions-pair').count());
    const disclosureVisible = await visible('ai-suggestions-disclosure');
    return {
        stillComingVisible,
        headlineVisible,
        headlineInFlight: headline === null ? null : headline.trim() === IN_FLIGHT_HEADLINE,
        retryVisible,
        retryEnabled,
        retryLabelExact: label === null ? (retryVisible === false ? false : null) : label.trim() === RETRY_LABEL,
        pairCount,
        disclosureVisible,
    };
}

export interface CoachingFallbackVerdict {
    verdict: 'PASS' | 'FAIL' | 'HOLD';
    detail: string;
    /** The checks that failed, by name (empty on PASS and on HOLD). */
    missing: string[];
}

/** The five checks, from one observation. Any unreadable check is HOLD; otherwise any failed check is FAIL. */
export function coachingFallbackVerdict(o: CoachingFallbackObservation): CoachingFallbackVerdict {
    const checks: Array<[string, boolean | null]> = [
        ['the still-coming band is visible', o.stillComingVisible],
        ['the headline is visible', o.headlineVisible],
        ['the headline is not the in-flight line', o.headlineInFlight === null ? null : !o.headlineInFlight],
        ['Try again is visible', o.retryVisible],
        ['Try again is enabled', o.retryEnabled],
        ['Try again reads exactly "Try again"', o.retryLabelExact],
        ['no review pair is rendered', o.pairCount === null ? null : o.pairCount === 0],
        ['the coaching disclosure is visible', o.disclosureVisible],
    ];
    const missing = checks.filter(([, ok]) => ok === false).map(([name]) => name);
    if (missing.length > 0) return { verdict: 'FAIL', detail: `coaching failed and its fallback is missing: ${missing.join('; ')}`, missing };
    const unread = checks.filter(([, ok]) => ok === null).map(([name]) => name);
    if (unread.length > 0) return { verdict: 'HOLD', detail: `the fallback could not be read: ${unread.join('; ')}`, missing: [] };
    return { verdict: 'PASS', detail: 'coaching failed and the card showed its message, an enabled Try again and the disclosure, with no review pair', missing: [] };
}

type FallbackEvidence = Record<string, boolean | number | string | null>;
export interface FallbackRowSink { row(step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: FallbackEvidence): void }

/**
 * Writes the row for this take, or nothing when coaching succeeded. `settled`: the card reached a terminal review state
 * within the coaching bound. `rendered`: the coaching row saw both phrases. Returns what it recorded.
 */
export async function coachingFallbackRow(
    receipt: FallbackRowSink, card: CardLocator, take: { settled: boolean; rendered: boolean; reviewState: string | null },
    read: (c: CardLocator) => Promise<CoachingFallbackObservation> = readCoachingFallback,
): Promise<'NOT RUN' | 'PASS' | 'FAIL' | 'HOLD'> {
    if (take.rendered) return 'NOT RUN';
    const base: FallbackEvidence = { observationId: COACHING_FALLBACK_OBSERVATION, reviewState: take.reviewState };
    if (!take.settled) {
        receipt.row(COACHING_FALLBACK_ROW, 'HOLD', 'the coaching request had not settled at the coaching bound, so no failure ending was reached to judge',
            { ...base, settled: false });
        return 'HOLD';
    }
    const o = await read(card);
    // A settled request that rendered a review pair did not end in failure: the coaching row judges it, not this one.
    if (o.pairCount !== null && o.pairCount > 0) return 'NOT RUN';
    const v = coachingFallbackVerdict(o);
    receipt.row(COACHING_FALLBACK_ROW, v.verdict, v.detail, { ...base, settled: true, ...o, missingChecks: v.missing.length });
    return v.verdict;
}
