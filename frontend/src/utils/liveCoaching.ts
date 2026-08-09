import type { LiveTipData } from '@/components/session/LiveTip';
import type { FillerCounts } from '@/utils/fillerWordUtils';

/**
 * #1222 S12b — deterministic coaching sources for slot D. No AI at runtime for the LIVE tip (it must be
 * instant + stable under the 8s hold); the AFTER verdict reuses the session's saved two-takeaway
 * `ai_suggestions` when present, falling back to an honest deterministic line. Everything here is grounded
 * in the user's actual session signals (the product principle: the takeaways are what matters).
 */

const PACE_IDEAL: [number, number] = [120, 160];

/** The most-used filler this session (excludes the synthetic `total` key); null when there are none. */
function topFiller(fillerData?: FillerCounts | null): { word: string; count: number } | null {
    if (!fillerData || typeof fillerData !== 'object') return null;
    let best: { word: string; count: number } | null = null;
    for (const word in fillerData) {
        if (word === 'total') continue;
        const count = (fillerData as Record<string, { count?: unknown }>)[word]?.count;
        if (typeof count === 'number' && count > 0 && (!best || count > best.count)) best = { word, count };
    }
    return best;
}

export interface LiveTipInputs {
    fillerData?: FillerCounts | null;
    wpm?: number | null;
    elapsedSeconds: number;
}

/**
 * One live tip from the current signals. Prefers the dominant filler (id = that word, so `useHeldTip` swaps
 * when the dominant filler changes); otherwise, when pace is off, a pace tip; otherwise a positive-only
 * "keep going" tip once there's enough speech. Null before there is anything honest to say.
 */
export function liveTipFromMetrics({ fillerData, wpm, elapsedSeconds }: LiveTipInputs): LiveTipData | null {
    if (elapsedSeconds < 8) return null; // nothing trustworthy to say in the first few seconds
    const paceInRange = typeof wpm === 'number' && wpm >= PACE_IDEAL[0] && wpm <= PACE_IDEAL[1];
    const goingRight = paceInRange ? `Pace ${Math.round(wpm as number)} wpm — right in your range.` : undefined;

    const top = topFiller(fillerData);
    if (top && top.count >= 2) {
        return {
            id: `filler:${top.word}`,
            headline: `Pause instead of “${top.word}”.`,
            evidence: `You’ve used it ${top.count} ${top.count === 1 ? 'time' : 'times'} so far — a half-second of silence does more.`,
            goingRight,
        };
    }
    if (typeof wpm === 'number' && wpm > PACE_IDEAL[1]) {
        return { id: 'pace:fast', headline: 'Ease off the pace.', evidence: `You’re at ${Math.round(wpm)} wpm — a touch faster than your clearest range.` };
    }
    if (typeof wpm === 'number' && wpm > 0 && wpm < PACE_IDEAL[0]) {
        return { id: 'pace:slow', headline: 'You can pick it up a little.', evidence: `You’re at ${Math.round(wpm)} wpm — a bit under your clearest range.` };
    }
    if (goingRight) {
        return { id: 'steady', headline: 'Holding steady.', evidence: 'No filler spikes so far — keep going.', goingRight };
    }
    return null;
}

export interface TwoTakeaways {
    what_worked?: string;
    what_to_try_next?: string;
}

/** The after-state verdict: reuse the saved two-takeaways when present; honest deterministic fallback otherwise. */
export function verdictFromSuggestions(ai: TwoTakeaways | null | undefined, fillerData?: FillerCounts | null): { verdictLine: string; fix: string } {
    const top = topFiller(fillerData);
    const verdictLine = ai?.what_worked?.trim() || 'Session saved — nice work.';
    const fix = ai?.what_to_try_next?.trim()
        || (top ? `Pause instead of “${top.word}” — it was your most-used filler.` : 'Keep practicing to build your baseline.');
    return { verdictLine, fix };
}
