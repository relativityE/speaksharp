/**
 * #1047 conversion repair — the SINGLE source of truth for Private-sample duration copy.
 *
 * Every user-facing sample duration (the trial nudge AND the recording-status cap line) is derived
 * here from the server-reported `private_sample_limit_seconds` / `private_sample_seconds_remaining`.
 * It is deliberately conservative and never overstates time:
 *   - a WHOLE-MINUTE allotment yields an exact "N-minute" claim; a non-whole allotment makes NO
 *     numeric claim (better silent than mis-rounded);
 *   - remaining time FLOORS (never ceils), and collapses to "less than a minute" under 60s — so
 *     61s reads "about 1 minute", never "2 minutes".
 */

/** Exact whole minutes for an allotment, or null when it is zero / not a whole number of minutes. */
export function sampleWholeMinutes(limitSeconds: number): number | null {
    return Number.isFinite(limitSeconds) && limitSeconds > 0 && limitSeconds % 60 === 0
        ? limitSeconds / 60
        : null;
}

/** Fresh-sample nudge title. Exact whole-minute → "N-minute Private trial available"; else no number. */
export function formatTrialAllotmentTitle(limitSeconds: number): string {
    const m = sampleWholeMinutes(limitSeconds);
    return m ? `${m}-minute Private trial available` : 'Private trial available';
}

/**
 * Partial-sample nudge title. Floors conservatively; under a minute collapses. FAILS CLOSED: a
 * non-finite or non-positive remaining is NOT a truthful "less than a minute" — it returns `null` so
 * the caller shows no offer at all (there is genuinely no time to offer).
 */
export function formatTrialRemainingTitle(remainingSeconds: number): string | null {
    if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return null;
    if (remainingSeconds < 60) return 'Continue with Private — less than a minute remaining';
    const m = Math.floor(remainingSeconds / 60);
    return `Continue with Private — about ${m} ${m === 1 ? 'minute' : 'minutes'} remaining`;
}

/** The recording-status operational cap line — server-derived from the SAME allotment as the nudge. */
export function formatSampleCapLine(limitSeconds: number): string {
    const m = sampleWholeMinutes(limitSeconds);
    if (!m) return 'Private practice window. We’ll stop and save when the window ends.';
    return `Private practice window: up to ${m} ${m === 1 ? 'minute' : 'minutes'}. We’ll stop and save when the window ends.`;
}
