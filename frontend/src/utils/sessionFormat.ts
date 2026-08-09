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
