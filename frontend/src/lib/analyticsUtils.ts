import { hasValidPauseEvidence } from '@/utils/metricValidity';
import type { PracticeSession } from '@/types/session';
import {
    calculateAverageSessionLengthMinutes,
    calculateRatePerMinute,
    calculateRoundedMinutes,
    getSessionAnalysisMetrics,
    isValidFillerCount,
} from '@/utils/sessionAnalysis';
import { persistedFillerTotal } from '@/contracts/fillerCounts';

const isRealNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A session carries genuinely-persisted filler evidence when it has a VALID filler count — a valid
 * `total.count` (including a genuine 0 or a total-only snapshot) or at least one valid per-word count.
 * #1131 corrections 2–4: "valid" means a finite non-negative integer, so empty `{}`, malformed `{um:{}}`,
 * and fractional/negative counts are NOT evidence. Mirrors the RPC helper `_ss_valid_filler_total IS NOT NULL`
 * so client and server agree on which rows may contribute the filler metric.
 */
const hasRealFillerData = (s: PracticeSession): boolean => persistedFillerTotal(s.filler_counts) !== null;

/**
 * #1047 U1 (review correction): provenance is METRIC-SPECIFIC, not all-or-nothing. `available` shows every
 * metric; `not_captured` shows none; an `expired`/legacy row contributes a GIVEN metric ONLY when THAT
 * metric's own value is genuinely persisted (`transcriptDerivedMetricShowable`). An `expired` state alone no
 * longer authorizes a reconstructed clarity/filler/accuracy/WPM, and cannot dilute valid history. Total
 * practice TIME is deliberately NOT gated — it still spans every session.
 */
// #1306 metrics-only: provenance is METRIC PRESENCE. A row contributes a metric iff that metric's own value
// is genuinely persisted — the retired transcript_state/not_captured sentinel no longer gates aggregates.
const metricEligible = (_s: PracticeSession, persistedIsReal: boolean): boolean => persistedIsReal;

// #1131 review correction 2: a metric is eligible only when BOTH its provenance is showable AND its own
// value is GENUINELY persisted. `transcriptDerivedMetricShowable(available, …)` answers provenance only and
// returns true regardless of the value, so each per-metric helper must AND the value in explicitly. Without
// this, an `available` row with a missing/malformed metric (e.g. filler_words `{}` or `{um:{}}`) would be
// counted as a contributor with a value of 0 — a flattering zero from absent data — and the client would
// disagree with the RPC (which gates on the persisted value). The value predicate is metric-specific:
// WPM needs a real positive word count; filler needs a real numeric count on some key (hasRealFillerData).
const wpmMetricEligible = (s: PracticeSession): boolean => {
    const hasWords = isRealNumber(s.total_words) && (s.total_words ?? 0) > 0;
    return metricEligible(s, hasWords) && hasWords;
};
const fillerMetricEligible = (s: PracticeSession): boolean => {
    const hasFiller = hasRealFillerData(s);
    return metricEligible(s, hasFiller) && hasFiller;
};
// #1306: the per-session STT-accuracy series is RETIRED (accuracy has no customer ground truth and is
// benchmark-only). `calculateAccuracyData` now returns an empty series; no accuracy eligibility gate remains.

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
    // #1047: transcript-derived rate DENOMINATORS are METRIC-SPECIFIC. totalDurationSeconds stays all-session
    // (it feeds only total practice time / average session length). Each rate uses the duration of the rows
    // that actually carry ITS persisted metric, so an expired row with duration but no persisted words can no
    // longer deflate WPM, and a row without persisted fillers cannot dilute the filler rate.
    let wpmDurationSeconds = 0;
    let fillerDurationSeconds = 0;
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

        // #1047 U1: METRIC-SPECIFIC provenance. Each transcript-derived metric contributes (and its rate
        // denominator counts this row's duration) ONLY when THAT metric's value is genuinely persisted for
        // this row's state. A not_captured row contributes nothing; an expired row contributes a metric only
        // if that specific measurement was persisted.
        const sessionMetrics = getSessionAnalysisMetrics(s);
        if (wpmMetricEligible(s)) {
            wpmDurationSeconds += duration;
            totalWords += sessionMetrics.wordCount;
        }
        if (fillerMetricEligible(s)) {
            fillerDurationSeconds += duration;
            // #1131 correction 3: the filler NUMERATOR is the validated, total-authoritative count (honors a
            // total-only snapshot); a row is only eligible when this is a real value, so it is never null here.
            totalFillerWords += persistedFillerTotal(s.filler_counts) ?? 0;
        }
        // #1045 finding 1: object truthiness is not evidence — `pause_metrics: {}` is truthy and
        // carries no measurement. Only a structurally complete snapshot contributes. (Pause rhythm is
        // audio-timing evidence, independent of transcript provenance, so it is not gated on transcript state.)
        if (hasValidPauseEvidence(s.pause_metrics)) {
            totalPauses += getSessionPauseCount(s);
            pauseContributors += 1;
        }
        // #1131 correction 1: clarity contributes only when it is scorable AND its provenance is showable for a
        // GENUINELY PERSISTED clarity_score. The showability flag is `isRealNumber(s.clarity_score)`, so an
        // EXPIRED/legacy row (transcript removed) contributes clarity ONLY when a real clarity_score survived —
        // it is never reconstructed from retained words. An `available` row may still recompute from its live
        // transcript (documented client advantage over the RPC). getSessionAnalysisMetrics already prefers the
        // persisted clarity_score, so an eligible expired row uses the persisted value, not a reconstruction.
        if (metricEligible(s, isRealNumber(s.clarity_score)) && sessionMetrics.isClarityScorable) {
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
    // #1047 U1: each rate uses ITS metric-eligible speaking time (metric-specific provenance), so a row that
    // did not persist words/fillers never enters that rate's denominator.
    const wpmPracticeTimeMinutes = wpmDurationSeconds / 60;

    // Speaking-rate standard: aggregate words over aggregate speaking time.
    // Averaging per-session WPM lets very short sessions distort the result.
    // #1045: pace needs both a denominator (speaking time) and a numerator (words). Wordless takes
    // give neither, and "0 WPM" reads as "you spoke impossibly slowly" rather than "we heard nothing".
    const averageWPM = wpmPracticeTimeMinutes > 0 && totalWords > 0
        ? Math.round(totalWords / wpmPracticeTimeMinutes)
        : null;
    // Industry standard: Filler Rate = Total Fillers / Total Speaking Time (precise minutes)
    // A rate with no time denominator is not zero, it is unknown. A genuine zero-filler minute of
    // speech still reports 0.0 — that is real evidence and stays.
    // #1045 correction batch: a filler RATE needs transcribed words, not merely elapsed time. A
    // six-second wordless take has duration > 0, so the old condition reported a confident "0.0/min",
    // which decodes to the POSITIVE label "Low" — i.e. silence was being praised as clean delivery
    // and could become the user's "What worked". A genuine take with words and no fillers still
    // reports 0.0; that is real evidence.
    // #1131 review correction 1: the filler RATE must NOT depend on word-count / WPM evidence. Its denominator
    // is the FILLER-metric-eligible speaking time (fillerDurationSeconds), which already includes only rows
    // that carry genuine persisted filler data (hasRealFillerData) — a wordless/silent take contributes no
    // such evidence and is excluded upstream, so it can no longer be praised as a flattering 0.0. Coupling the
    // filler rate to totalWords (the WPM aggregate) let a take with genuine fillers but unpersisted words go
    // dark, and made two independent metrics share one denominator condition.
    const avgFillerWordsPerMin = fillerDurationSeconds > 0
        ? calculateRatePerMinute(totalFillerWords, fillerDurationSeconds, 1)
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
        const sessionMetrics = getSessionAnalysisMetrics(s);
        // #1131 correction 3: the plotted filler count is the validated, total-authoritative value.
        const totalFillerCount = persistedFillerTotal(s.filler_counts) ?? 0;

        return {
            date: new Date(s.created_at).toLocaleDateString(),
            // #1047 U1: metric-specific — plot a filler rate only when THIS row's filler evidence is persisted
            // (available; or expired/legacy with real filler data). Otherwise null (omitted point).
            'FW/min': fillerMetricEligible(s) ? calculateRatePerMinute(totalFillerCount, duration, 2) : null,
            // #1091 + #1047 U1 + #1131 correction 1: plot clarity only when it is scorable AND a genuinely
            // persisted clarity_score is showable for this provenance (expired → never reconstructed).
            // `null` is an omitted point (Recharts renders a gap); never a fabricated zero.
            clarity: (metricEligible(s, isRealNumber(s.clarity_score)) && sessionMetrics.isClarityScorable) ? sessionMetrics.clarityScore : null
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
    const sessionHistory = allSessions.filter(fillerMetricEligible);
    // #1047 U1: a "trend" is a comparison over time — it needs at least TWO eligible filler measurements.
    // A single eligible take (or one plus a wall of not_captured rows) cannot establish direction, so we
    // report NO trend rather than a phantom "improving/worsening" derived from one point. Mirrors the RPC
    // filler-trend gate (>= 2 eligible rows).
    if (sessionHistory.length >= 2) {
        // Use a 5-session rolling window, but normalize by speaking time so
        // short sessions do not distort filler trends.
        const getRatesForWindow = (window: PracticeSession[]): { [key: string]: number } => {
            if (window.length === 0) return {};
            const counts: { [key: string]: number } = {};
            const totalMinutes = window.reduce((sum, s) => sum + ((s.duration || 0) / 60), 0);
            if (totalMinutes <= 0) return {};
            window.forEach(s => {
                Object.entries(getSessionAnalysisMetrics(s).fillerData || {}).forEach(([word, data]) => {
                    // #1131 correction 4: only count per-word entries with a VALID non-negative integer count.
                    if (word !== 'total' && isValidFillerCount(data?.count)) {
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

        // #1131 correction 2: split the most-recent (up to 10) eligible measurements into TWO NONEMPTY time
        // windows. The old fixed 0–5 / 5–10 split left the "previous" window empty for a 2–5 measurement
        // history, so a real current rate was compared against an INVENTED zero baseline (a fabricated
        // "improvement/worsening"). Splitting at floor(k/2) keeps both windows nonempty for every k >= 2 and
        // preserves the 5/5 split at k = 10. The RPC filler-trend applies the identical split.
        const windowed = sessionHistory.slice(0, 10);
        const k = windowed.length; // >= 2, guaranteed by the gate above
        const previousCount = Math.floor(k / 2); // >= 1 for k >= 2
        const currentCount = k - previousCount;  // >= previousCount >= 1
        const currentWindow = windowed.slice(0, currentCount);
        const previousWindow = windowed.slice(currentCount);

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
    const counts = sessionHistory.filter(fillerMetricEligible).reduce((acc, s) => {
        const fillers = getSessionAnalysisMetrics(s).fillerData || {};
        for (const [word, data] of Object.entries(fillers)) {
            // #1131 correction 4: only a VALID non-negative integer count contributes to the top-filler list.
            if (word !== 'total' && isValidFillerCount(data?.count) && data.count > 0) {
                acc[word] = (acc[word] || 0) + data.count;
            }
        }
        return acc;
    }, {} as Record<string, number>);

    return Object.entries(counts)
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count);
};

// #1306: `calculateAccuracyData` is REMOVED (not stubbed). Per-session STT accuracy requires ground truth +
// transcript, which the metrics-only policy never persists — accuracy is benchmark-only (#1304), never a
// customer row or UI field. No customer-facing accuracy series exists.
