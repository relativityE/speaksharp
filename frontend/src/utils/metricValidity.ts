/**
 * #1045 — evidence validity for displayed metrics.
 *
 * A number on screen is a claim about the user's speaking. When the evidence behind it is missing,
 * contradictory or non-finite, showing `0`, a bare `%`, a bare `/min`, or a judgment label ("Needs
 * focus", "Sparse") is not a neutral default — it is a false statement about their practice, and it
 * is indistinguishable from a genuine zero. This module is the single place that decides whether a
 * metric may be rendered at all.
 *
 * Deliberately NOT in scope here: any threshold for what makes a session eligible for Progress. That
 * belongs to the Progress formula work; this module only refuses to present numbers we cannot stand
 * behind today.
 */

/** The single user-facing string for "we do not have the evidence to show this yet". */
export const NOT_ENOUGH_DATA = 'Not enough data';

/**
 * A metric may be displayed only when it is a real, finite number. `null`/`undefined` mean the
 * aggregate refused to compute (no valid contributing sessions); `NaN`/`Infinity` mean a division by
 * a zero or missing denominator escaped upstream.
 */
export const isValidMetric = (value: number | string | null | undefined): value is number | string => {
    if (value === null || value === undefined) return false;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n);
};

/**
 * Duration in minutes, honestly.
 *
 * `Math.round` turned every sub-30-second average into "0 mins", which reads as "you have practised
 * for no time at all" to someone who has genuinely recorded. A real but short duration is reported as
 * `<1 min`; only a true zero (or missing evidence) is allowed to say zero / show nothing.
 */
export const formatDurationMinutes = (seconds: number | null | undefined): string => {
    if (!isValidMetric(seconds)) return NOT_ENOUGH_DATA;
    const s = Number(seconds);
    if (s <= 0) return '0 mins';
    const minutes = s / 60;
    if (minutes < 1) return '<1 min';
    const rounded = Math.round(minutes);
    return `${rounded} ${rounded === 1 ? 'min' : 'mins'}`;
};

/**
 * What a stat card should actually paint. When evidence is missing the unit is dropped with the
 * number — a lone `%` or `/min` next to "Not enough data" is the same false precision in smaller type.
 */
export interface DisplayableMetric {
    text: string;
    unit?: string;
    hasEvidence: boolean;
}

export const toDisplayableMetric = (
    value: number | string | null | undefined,
    unit?: string,
): DisplayableMetric => {
    if (!isValidMetric(value)) return { text: NOT_ENOUGH_DATA, hasEvidence: false };
    return { text: String(value), unit, hasEvidence: true };
};

/**
 * #1045 finding 1 — pause evidence must be validated STRUCTURALLY, never by object truthiness.
 *
 * `pause_metrics: {}` is a truthy object carrying no measurement. Treating its presence as evidence
 * let an empty snapshot contribute a 0 to the pause aggregate, which is the same false claim as the
 * missing-data case it was meant to fix. A snapshot counts as evidence only when every measurement
 * field is present and finite.
 *
 * A structurally valid measured ZERO is real evidence and must be kept — "you took no long pauses"
 * is a finding. What is rejected is the absence of measurement, not the value zero.
 */
export const PAUSE_EVIDENCE_FIELDS = [
    'silencePercentage',
    'transitionPauses',
    'extendedPauses',
    'longestPause',
] as const;

export const hasValidPauseEvidence = (snapshot: unknown): boolean => {
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
    const record = snapshot as Record<string, unknown>;
    return PAUSE_EVIDENCE_FIELDS.every((field) => {
        const value = record[field];
        return typeof value === 'number' && Number.isFinite(value);
    });
};
