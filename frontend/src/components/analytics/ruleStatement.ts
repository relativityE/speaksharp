/** #1258 D5 (Rev 2 §5.5 + C9) — the rule card's one data statement, per driver. The pause count is every meaningful pause (transition + extended), never "long" (C9). */
import { ANALYTICS_THRESHOLDS } from '@/utils/sessionAnalysis';

export interface RuleSignals {
    /** `getNarrativeSummary(...).driver` for the window; null = every signal on target. */
    driver: string | null;
    wpm: number | null;
    fillersPerSession: number | null;
    clarity: number | null;
    pausesPerMin: number | null;
}

const MIN = ANALYTICS_THRESHOLDS.TARGET_WPM_MIN;
const MAX = ANALYTICS_THRESHOLDS.TARGET_WPM_MAX;

/** The sentence and chip for a driver, or null when the window can't support a true statement. */
export function ruleStatement({ driver, wpm, fillersPerSession, clarity, pausesPerMin }: RuleSignals):
    { sentence: string; metric: string | null } | null {
    switch (driver) {
        case null:
            // `getTryThisNext` returns driver null BOTH when every signal is on target AND when none was measurable
            // (CLI PM 6048239789). The sentence names pace, fillers and clarity, so it is said only when all three were
            // measured in the window; otherwise there is no true statement and the card is withheld.
            if (wpm === null || fillersPerSession === null || clarity === null) return null;
            return { sentence: 'Pace, fillers and clarity are all on target.', metric: null };
        case 'pace': {
            if (wpm === null) return null;
            const n = Math.round(wpm);
            if (n < MIN) return { sentence: `Your pace averaged ${n} words a minute, under the ${MIN}–${MAX} target.`, metric: 'pace' };
            if (n > MAX) return { sentence: `Your pace averaged ${n} words a minute, over the ${MIN}–${MAX} target.`, metric: 'pace' };
            return null;
        }
        case 'filler words':
            return fillersPerSession === null ? null
                : { sentence: `You averaged ${fillersPerSession.toFixed(1)} filler words per session.`, metric: 'fillers' };
        case 'clear delivery':
            return clarity === null ? null : { sentence: `Your clear delivery averaged ${Math.round(clarity)}%.`, metric: 'clear delivery' };
        case 'pause rhythm':
            return pausesPerMin === null ? null : { sentence: `You averaged ${pausesPerMin.toFixed(1)} pauses a minute.`, metric: 'pauses' };
        default:
            return null;
    }
}
