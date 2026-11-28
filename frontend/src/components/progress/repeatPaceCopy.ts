import type { ExclusionReason } from '@/services/progress/buildProgressEvaluation';
import { PACE_NORMAL_VARIATION_PERCENT, type RepeatPaceComparison } from '@/services/progress/repeatPaceComparison';

/**
 * Copy for the Open Mic repeat pace line. States measured values, a neutral direction (faster / slower) and why a
 * comparison is not made. Never "improved", never a verdict on the tip, never a reason the pace changed.
 */
const NOT_ELIGIBLE: Record<ExclusionReason, string> = {
    not_completed: 'one of the takes was not completed',
    too_short: 'one of the takes is too short for a reliable comparison',
    too_few_words: 'one of the takes needs more spoken words for a reliable comparison',
    no_transcript: 'no transcript was available for one of the takes',
    no_clarity_evidence: 'the delivery evidence for one of the takes was not available',
    unverified_attribution: 'the recording evidence for one of the takes could not be verified',
    engine_not_comparable: 'the two takes used different recording setups',
    unknown: 'one of the takes did not meet the comparison evidence requirements',
};

const roundWpm = (value: number): string => String(Math.round(value));

/** Null = say nothing about pace (not an Open Mic loop, or the reads were unavailable). */
export function repeatPaceSentence(pace: RepeatPaceComparison, opts: { valuesShownAbove: boolean }): string | null {
    if (pace.status === 'unavailable') return null;
    if (pace.status === 'cant_compare') {
        switch (pace.reason) {
            case 'not_open_mic': return null;
            case 'not_eligible': return `Pace is not compared: ${NOT_ELIGIBLE[pace.exclusionReason ?? 'unknown']}.`;
            case 'different_setup': return 'Pace is not compared: the two takes used different recording setups.';
            case 'no_pace': return 'Pace is not compared: pace was not measured for one of the takes.';
            case 'different_length': return 'Pace is not compared: the two takes are very different lengths.';
        }
    }
    const percent = Math.round(Math.abs(pace.changePercent));
    const values = opts.valuesShownAbove
        ? ''
        : `Pace: ${roundWpm(pace.beforeWpm)} → ${roundWpm(pace.afterWpm)} words per minute (original session → this repeat). `;
    if (pace.band === 'within_normal_variation') {
        return `${values}That is a ${percent}% difference. Changes under ${PACE_NORMAL_VARIATION_PERCENT}% are treated as normal take-to-take variation.`;
    }
    return `${values}The repeat was ${percent}% ${pace.changePercent > 0 ? 'faster' : 'slower'}.`;
}
