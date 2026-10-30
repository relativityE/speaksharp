/**
 * #1258 (R5, PM 6134474736; PO 2026-10-12: the guide reads "1 min") — the Focus Points pace guide in SEMANTIC seconds.
 *
 * The setup form shows minutes per point in half-minute steps (`ObjectiveSetupForm`: "1 min", "1.5 min", 0.5–3) and
 * persists seconds. The journey parsed it as an m:ss clock, so "1 min" read as null and runs 38304068207 / 38308997906
 * failed `pace guide` on the shipped default. The guide is compared as seconds; m:ss stays the parser for the measured
 * clocks (coverage average, timings), which really are clocks.
 */
export const PACE_GUIDE_DEFAULT_SECONDS = 60;

/** "1 min" → 60, "0.5 min" → 30, "1.5 min" → 90. Anything that is not a minutes value is null — never a guess. */
export function parsePaceGuideSeconds(text: string | null | undefined): number | null {
    const match = /^\s*(\d+(?:\.\d+)?)\s*min\s*$/i.exec(text ?? '');
    if (!match) return null;
    const seconds = Math.round(Number(match[1]) * 60);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
