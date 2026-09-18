/**
 * #1222 — small pure formatters for the session-page states. Kept out of the component files so ESLint's
 * react-refresh/only-export-components rule stays satisfied (components export only components).
 */

/** Recorder/scrubber timer, e.g. 72 → "01:12". */
export function formatTimer(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Live transcript header meta, e.g. `184 words · 2.6 fillers/min`. */
export function formatLiveMeta(words: number, fillersPerMin: number): string {
    return `${words} words · ${fillersPerMin.toFixed(1)} fillers/min`;
}

/**
 * S-10 — words per minute for a run in progress, or `null` when there is not yet enough of a run to state
 * a rate truthfully.
 *
 * A rate over a couple of seconds is arithmetic, not a measurement: three words in two seconds is 90 wpm
 * and means nothing. Below the floor the rail omits pace entirely rather than showing a number the user has
 * not earned (G4) — and never an em-dash, which beside a live count reads as a failed measurement.
 */
export const MIN_LIVE_PACE_SECONDS = 15;

export function liveWordsPerMinute(words: number, elapsedSeconds: number): number | null {
    if (!Number.isFinite(words) || !Number.isFinite(elapsedSeconds)) return null;
    if (elapsedSeconds < MIN_LIVE_PACE_SECONDS || words <= 0) return null;
    return (words / elapsedSeconds) * 60;
}
