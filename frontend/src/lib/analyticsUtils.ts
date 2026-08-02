import { hasValidPauseEvidence } from '@/utils/metricValidity';
import type { PracticeSession } from '@/types/session';
import { calculateWordErrorRate } from './wer';
import {
    calculateAverageSessionLengthMinutes,
    calculateRatePerMinute,
    calculateRoundedMinutes,
    getSessionAnalysisMetrics,
} from '@/utils/sessionAnalysis';
import { resolveTranscriptState, TRANSCRIPT_STATE } from '@/constants/transcriptState';

/**
 * #1047: a session contributes to TRANSCRIPT-DERIVED aggregates (words, filler counts/rates, clarity,
 * accuracy, chart points and any coaching derived from them) only when its server-owned provenance is not
 * `not_captured`. Mirrors the RPC's `transcript_state IS DISTINCT FROM 'not_captured'`: available + expired +
 * legacy contribute; a not_captured row's persisted words/fillers/clarity/accuracy are sentinels, never
 * evidence. Total practice TIME is deliberately NOT gated here — it still spans every session.
 */
const isTranscriptDerivedEligible = (s: PracticeSession): boolean =>
    resolveTranscriptState(s.transcript_state, s.transcript) !== TRANSCRIPT_STATE.NOT_CAPTURED;

/**
 * P1 TECH DEBT: Client-side Aggregation
 * 
 * Current implementation: All aggregation happens in browser
 * - Acceptable for alpha with <100 sessions per user
 * - Monitor performance with console.time() in development
 * 
 * Future optimization (when users have 500+ sessions):
 * - Create Supabase RPC: `get_analytics_summary(user_id, date_range)`
 * - Pre-compute daily/weekly summaries in DB
 * - Only fetch aggregated results, not raw sessions
 * 
 * Migration path:
 * 1. Add RPC function to Supabase
 * 2. Update usePracticeHistory to use RPC when session count > threshold
 * 3. Keep client-side as fallback for small datasets
 */

/**
 * Pause Rhythm tool: the count of meaningful pauses the speaker took in a session — short
 * (transition, 0.5–1.5s) plus extended (>1.5s). Surfaced as a first-class coaching metric
 * (pauses/min) so the analytics toolkit matches the "pace, pauses, fillers, clarity" promise.
 */
export const getSessionPauseCount = (session: PracticeSession): number => {
    const pm = session.pause_metrics;
    if (!pm) return 0;
    return (pm.transitionPauses ?? 0) + (pm.extendedPauses ?? 0);
};

export const calculateOverallStats = (sessionHistory: PracticeSession[]) => {
    // P1 FIX: Early exit for empty data
    if (!sessionHistory || sessionHistory.length === 0) {
        // #1045: no sessions means no evidence. `0` here was indistinguishable from a genuine zero
        // and produced "0%" / "0.0/min" / "0 mins" cards for users who had never recorded.
        return {
            totalSessions: 0,
            totalPracticeTime: 0,
            totalPracticeTimeSeconds: 0,
            averageSessionLength: null,
            averageSessionLengthSeconds: null,
            averageWPM: null,
            avgFillerWordsPerMin: null,
            avgClarity: null,
            avgPausesPerMin: null,
            chartData: []
        };
    }

    const totalSessions = sessionHistory.length;

    // P1 FIX: Single-pass aggregation for efficiency
    let totalDurationSeconds = 0;
    // #1047: transcript-derived rate DENOMINATOR excludes not_captured rows. totalDurationSeconds stays
    // all-session (it feeds only total practice time / average session length); this eligible-only duration
    // feeds WPM and filler rate so a not_captured row's sentinel duration never dilutes or inflates them.
    let eligibleDurationSeconds = 0;
    let totalWords = 0;
    let totalFillerWords = 0;
    let totalClarity = 0;
    let totalPauses = 0;
    // #1045 evidence counters. An unscorable session (below MIN_RELIABLE_SCORING_WORDS) contributes
    // clarityScore 0 by design, and a session with no pause_metrics contributes 0 pauses. Summing
    // those into an average over ALL sessions is what produced "Clear Delivery 0%" on an account
    // whose individual saved sessions had real, non-zero scores. Count contributors separately and
    // average over the sessions that actually carry the evidence.
    let clarityContributors = 0;
    let pauseContributors = 0;

    for (const s of sessionHistory) {
        const duration = s.duration || 0;
        totalDurationSeconds += duration; // all-session (total practice time only)

        // #1047: only provenance-eligible rows contribute transcript-derived words/fillers/clarity and the
        // eligible rate denominator. A not_captured row's persisted numbers are sentinels, not evidence.
        const eligible = isTranscriptDerivedEligible(s);
        const sessionMetrics = getSessionAnalysisMetrics(s);
        if (eligible) {
            eligibleDurationSeconds += duration;
            totalWords += sessionMetrics.wordCount;
            totalFillerWords += sessionMetrics.fillerCount;
        }
        // #1045 finding 1: object truthiness is not evidence — `pause_metrics: {}` is truthy and
        // carries no measurement. Only a structurally complete snapshot contributes. (Pause rhythm is
        // audio-timing evidence, independent of transcript provenance, so it is not gated on not_captured.)
        if (hasValidPauseEvidence(s.pause_metrics)) {
            totalPauses += getSessionPauseCount(s);
            pauseContributors += 1;
        }
        // Single source of truth: aggregate the SAME per-session delivery-clarity used by session
        // detail, PDF, Goals, and the clarity chart. The unrelated STT `accuracy` field is NOT
        // clarity; mixing it made the aggregate card read 0% while individual sessions read nonzero.
        if (eligible && sessionMetrics.isClarityScorable) {
            totalClarity += sessionMetrics.clarityScore;
            clarityContributors += 1;
        }
    }

    // totalPracticeTime: rounded for display (e.g., "1 min")
    const totalPracticeTime = calculateRoundedMinutes(totalDurationSeconds);
    const averageSessionLength = calculateAverageSessionLengthMinutes(totalDurationSeconds, totalSessions);
    // #1045: exact seconds so the display layer can say "<1 min" instead of rounding a real 25-second
    // average down to the flatly false "0 mins".
    const averageSessionLengthSeconds = totalSessions > 0 ? totalDurationSeconds / totalSessions : null;
    // #1047: rate calculations use the provenance-ELIGIBLE speaking time, not all-session duration, so a
    // not_captured row's sentinel seconds never enter the WPM/filler denominator.
    const eligiblePracticeTimeMinutes = eligibleDurationSeconds / 60;

    // Speaking-rate standard: aggregate words over aggregate speaking time.
    // Averaging per-session WPM lets very short sessions distort the result.
    // #1045: pace needs both a denominator (speaking time) and a numerator (words). Wordless takes
    // give neither, and "0 WPM" reads as "you spoke impossibly slowly" rather than "we heard nothing".
    const averageWPM = eligiblePracticeTimeMinutes > 0 && totalWords > 0
        ? Math.round(totalWords / eligiblePracticeTimeMinutes)
        : null;
    // Industry standard: Filler Rate = Total Fillers / Total Speaking Time (precise minutes)
    // A rate with no time denominator is not zero, it is unknown. A genuine zero-filler minute of
    // speech still reports 0.0 — that is real evidence and stays.
    // #1045 correction batch: a filler RATE needs transcribed words, not merely elapsed time. A
    // six-second wordless take has duration > 0, so the old condition reported a confident "0.0/min",
    // which decodes to the POSITIVE label "Low" — i.e. silence was being praised as clean delivery
    // and could become the user's "What worked". A genuine take with words and no fillers still
    // reports 0.0; that is real evidence.
    const avgFillerWordsPerMin = eligibleDurationSeconds > 0 && totalWords > 0
        ? calculateRatePerMinute(totalFillerWords, eligibleDurationSeconds, 1)
        : null;
    const avgClarity = clarityContributors > 0
        ? (totalClarity / clarityContributors).toFixed(1)
        : null;
    // Pause Rhythm: pauses over aggregate speaking time (same rate basis as the filler metric).
    // Pause rhythm requires sessions that actually recorded pause_metrics; without them the count is
    // absent, not zero, and "Sparse" would be a judgment invented from missing data.
    const avgPausesPerMin = pauseContributors > 0 && totalDurationSeconds > 0
        ? calculateRatePerMinute(totalPauses, totalDurationSeconds, 1)
        : null;

    const chartData = sessionHistory.slice(0, 10).map(s => {
        const duration = s.duration || 0;
        const eligible = isTranscriptDerivedEligible(s);
        const sessionMetrics = getSessionAnalysisMetrics(s);
        const totalFillerCount = sessionMetrics.fillerCount;

        return {
            date: new Date(s.created_at).toLocaleDateString(),
            // #1047: a not_captured row's stale filler count must not plot a rate — emit null (omitted
            // point), matching the RPC chart-point gate. Eligible rows keep their genuine derived rate.
            'FW/min': eligible ? calculateRatePerMinute(totalFillerCount, duration, 2) : null,
            // #1091: an unscorable session's `clarityScore` is 0 BY DESIGN — plotting it charted a
            // fabricated zero, the same defect the aggregate above was fixed for. Gate the point on the
            // clarity contributor rule so a session can never be plotted as scorable while being excluded
            // from the average. `null` is an omitted point; Recharts renders it as a gap.
            // #1047: also omit not_captured rows regardless of a stale scorable-looking clarity value.
            clarity: eligible && sessionMetrics.isClarityScorable ? sessionMetrics.clarityScore : null
        };
    }).reverse();

    return {
        totalSessions,
        totalPracticeTime,
        totalPracticeTimeSeconds: totalDurationSeconds,
        averageSessionLength,
        averageSessionLengthSeconds,
        averageWPM,
        avgFillerWordsPerMin,
        avgClarity,
        avgPausesPerMin,
        chartData,
    };
};

export const calculateFillerWordTrends = (allSessions: PracticeSession[]) => {
    const trendData: { [key: string]: { current: number; previous: number } } = {};
    // #1047: exclude not_captured rows before windowing so their stale filler counts never occupy a trend
    // slot. Windows are recency slices of the ELIGIBLE history, matching the RPC filler-trend gate.
    const sessionHistory = allSessions.filter(isTranscriptDerivedEligible);
    if (sessionHistory.length > 0) {
        // Use a 5-session rolling window, but normalize by speaking time so
        // short sessions do not distort filler trends.
        const getRatesForWindow = (window: PracticeSession[]): { [key: string]: number } => {
            if (window.length === 0) return {};
            const counts: { [key: string]: number } = {};
            const totalMinutes = window.reduce((sum, s) => sum + ((s.duration || 0) / 60), 0);
            if (totalMinutes <= 0) return {};
            window.forEach(s => {
                Object.entries(getSessionAnalysisMetrics(s).fillerData || {}).forEach(([word, data]) => {
                    if (word !== 'total') {
                        counts[word] = (counts[word] || 0) + data.count;
                    }
                });
            });
            const rates: { [key: string]: number } = {};
            Object.keys(counts).forEach(k => {
                rates[k] = Number((counts[k] / totalMinutes).toFixed(2));
            });
            return rates;
        };

        const currentWindow = sessionHistory.slice(0, 5);
        const previousWindow = sessionHistory.slice(5, 10);

        const currentRates = getRatesForWindow(currentWindow);
        const previousRates = getRatesForWindow(previousWindow);

        const allKeys = new Set([
            ...Object.keys(currentRates),
            ...Object.keys(previousRates)
        ]);

        allKeys.forEach(key => {
            trendData[key] = {
                current: currentRates[key] || 0,
                previous: previousRates[key] || 0
            };
        });
    }
    return trendData;
};

export const calculateTopFillerWords = (sessionHistory: PracticeSession[]) => {
    // #1047: a not_captured row's persisted filler map is a sentinel — never count it toward top fillers.
    const counts = sessionHistory.filter(isTranscriptDerivedEligible).reduce((acc, s) => {
        const fillers = getSessionAnalysisMetrics(s).fillerData || {};
        for (const [word, data] of Object.entries(fillers)) {
            if (word !== 'total' && data.count > 0) {
                acc[word] = (acc[word] || 0) + data.count;
            }
        }
        return acc;
    }, {} as Record<string, number>);

    return Object.entries(counts)
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count);
};

export const calculateAccuracyData = (sessionHistory: PracticeSession[]) => {
    return sessionHistory
        // #1047: exclude not_captured rows — their retained accuracy/transcript is a sentinel, not evidence.
        .filter(s => isTranscriptDerivedEligible(s) && s.ground_truth && s.transcript && s.engine)
        .map(s => {
            const wer = calculateWordErrorRate(s.ground_truth!, s.transcript!);
            return {
                date: new Date(s.created_at).toLocaleDateString(),
                accuracy: Math.max(0, Math.round((1 - wer) * 100)),
                engine: s.engine!,
            };
        })
        .reverse();
};
