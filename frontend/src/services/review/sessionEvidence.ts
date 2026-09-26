/**
 * #1258 G20 — the "From this session" line under the saved review.
 *
 * A MEASUREMENT beside the advice, never a claim about why the AI said it (the saved coaching carries no reasons).
 * Built only from what the session saved, and only from the product that recorded it:
 *   - Open Mic: the stored next-action signal, measured at completion (fillers per minute or pace).
 *   - Focus Points: the saved point results (detected times, not-detected points) and the recorded length. The pace
 *     guide is not saved, so no "against your guide" comparison is made (PM 2026-09-25).
 * No line is better than an invented one: an unusable signal or an empty result yields nothing.
 */
import { validateNextActionSignal, type ComparatorCode } from '@/contracts/nextActionSignal';
import type { SavedFocusPoint } from '@/services/objective/savedFocusPointsCoverage';

const COMPARATOR: Partial<Record<ComparatorCode, string>> = {
    above_target: 'above your target',
    below_target: 'below your target',
    within_target: 'within your target',
    above_baseline: 'above your usual',
    below_baseline: 'below your usual',
};

/** Open Mic: the stored measured signal as one sentence, or no line at all. */
export function openMicEvidence(signal: unknown): string[] {
    const checked = validateNextActionSignal(signal);
    if (!checked.ok) return [];
    const { metric, value, comparator } = checked.value;
    const against = COMPARATOR[comparator];
    const tail = against ? `, ${against}.` : '.';
    if (metric === 'filler_rate') return [`${value.toFixed(1)} filler words a minute${tail}`];
    if (metric === 'wpm') return [`${Math.round(value)} words a minute${tail}`];
    return [];
}

function clock(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Focus Points: which points the matcher detected (and when), which it did not, and the recorded length.
 * "Not detected" states what the matcher found — never that the point was not said.
 */
export function focusPointsEvidence(points: readonly SavedFocusPoint[], durationSeconds: number | null): string[] {
    const lines: string[] = [];
    const detected = points.flatMap((p, i) => (p.status === 'detected'
        ? [p.detectedAtSeconds !== null ? `point ${i + 1} at ${clock(p.detectedAtSeconds)}` : `point ${i + 1}`]
        : []));
    const notDetected = points.flatMap((p, i) => (p.status === 'not_detected' ? [`point ${i + 1}`] : []));
    const notChecked = points.flatMap((p, i) => (p.status === 'unavailable' ? [`point ${i + 1}`] : []));
    if (detected.length > 0) lines.push(`Detected: ${detected.join(', ')}.`);
    if (notDetected.length > 0) lines.push(`Not detected: ${notDetected.join(', ')}.`);
    if (notChecked.length > 0) lines.push(`Not checked: ${notChecked.join(', ')}.`);
    if (lines.length > 0 && typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0) {
        lines.push(`Recorded for ${clock(durationSeconds)}.`);
    }
    return lines;
}
