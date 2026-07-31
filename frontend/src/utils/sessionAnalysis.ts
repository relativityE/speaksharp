import type { PracticeSession } from '@/types/session';
import { countFillerWords, type FillerCounts } from './fillerWordUtils';

export interface CoreSessionMetrics {
    wordCount: number;
    wpm: number;
    wpmLabel: string;
    wpmExplanation: string;
    fillerCount: number;
    fillerData: FillerCounts;
    fillerExplanation: string;
    clarityScore: number;
    clarityLabel: string;
    clarityExplanation: string;
    isClarityScorable: boolean;
    errorCount: number;
}

interface CoreSessionMetricsInput {
    transcript: string;
    durationSeconds: number;
    fillerData?: FillerCounts | PracticeSession['filler_words'] | null;
    userWords?: string[];
}

const ERROR_TAG_REGEX = /\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\]/gi;

export const ANALYTICS_THRESHOLDS = {
    MIN_RELIABLE_SCORING_WORDS: 3,
    TARGET_WPM_MIN: 130,
    TARGET_WPM_MAX: 150,
    FAST_WPM: 170,
    VERY_SLOW_WPM: 90,
    FILLER_CLARITY_PENALTY_PER_PERCENT: 1.5,
    ERROR_MARKER_CLARITY_PENALTY: 3,
    FAST_PACE_MAX_CLARITY_PENALTY: 20,
    SLOW_PACE_MAX_CLARITY_PENALTY: 15,
    NOTICEABLE_FILLER_RATE_PERCENT: 5,
    HIGH_FILLER_RATE_PERCENT: 12,
} as const;

const MIN_RELIABLE_SCORING_WORDS = ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS;

export const countTranscriptWords = (transcript: string): number =>
    transcript.match(/\b[\p{L}\p{N}][\p{L}\p{N}'-]*\b/gu)?.length ?? 0;

/** Count inaudible/blank/noise error markers in a transcript — the clarity error-penalty input. */
export const countErrorMarkers = (transcript: string): number =>
    (transcript.match(ERROR_TAG_REGEX) || []).length;

export const sumFillerCounts = (fillerWords?: PracticeSession['filler_words'] | FillerCounts | null): number => {
    if (!fillerWords) return 0;

    let sum = 0;
    for (const word in fillerWords) {
        if (word === 'total') continue;
        sum += fillerWords[word]?.count || 0;
    }
    return sum;
};

export const getFillerTotal = (fillerWords?: PracticeSession['filler_words'] | FillerCounts | null): number => {
    const persistedTotal = fillerWords?.total?.count;
    return typeof persistedTotal === 'number' ? persistedTotal : sumFillerCounts(fillerWords);
};

/**
 * #SSOT: is this a USABLE canonical filler-counts object? A valid ZERO count is usable (must stay zero);
 * only null / non-object / empty {} / malformed (no numeric total and no numeric entry) is NOT usable —
 * that is the ONLY case where a transcript-recount fallback is allowed. Never falls back merely because a
 * recount would be larger.
 */
export const isUsableFillerCounts = (
    fillerWords?: PracticeSession['filler_words'] | FillerCounts | null,
): boolean => {
    if (!fillerWords || typeof fillerWords !== 'object') return false;
    const total = (fillerWords as { total?: { count?: unknown } }).total?.count;
    if (typeof total === 'number' && Number.isFinite(total)) return true;
    // No numeric total: usable only if it carries at least one entry with a finite numeric count.
    return Object.values(fillerWords as Record<string, { count?: unknown }>).some(
        (v) => !!v && typeof v === 'object' && Number.isFinite((v as { count?: unknown }).count as number),
    );
};

/**
 * #SSOT: normalize an accepted canonical filler-counts object so it ALWAYS exposes a numeric `total.count`.
 * `isUsableFillerCounts` accepts a detail-only object (e.g. `{ um: { count: 1 } }`), but downstream readers
 * (controller ANALYSIS_COMPLETE) read `fillerWords.total.count` directly. Normalizing here guarantees a
 * `total` so those reads never crash. If a numeric total already exists it is returned unchanged (identity
 * preserved); otherwise `total.count` = sum of the non-total entries.
 */
export const normalizeFillerCounts = (fillerWords: FillerCounts): FillerCounts => {
    const existingTotal = fillerWords?.total?.count;
    if (typeof existingTotal === 'number' && Number.isFinite(existingTotal)) return fillerWords;
    return { ...fillerWords, total: { count: sumFillerCounts(fillerWords), color: fillerWords?.total?.color ?? '' } };
};

export const calculateWpm = (wordCount: number, durationSeconds: number): number =>
    durationSeconds > 0 ? Math.round((wordCount / durationSeconds) * 60) : 0;

export const calculateRatePerMinute = (count: number, durationSeconds: number, precision = 1): string => {
    if (durationSeconds <= 0) return Number(0).toFixed(precision);
    return (count / (durationSeconds / 60)).toFixed(precision);
};

export const calculateRoundedMinutes = (durationSeconds: number): number =>
    Math.round(Math.max(0, durationSeconds) / 60);

export const calculateAverageSessionLengthMinutes = (totalDurationSeconds: number, totalSessions: number): number =>
    totalSessions > 0 ? Math.round((totalDurationSeconds / 60) / totalSessions) : 0;

export const getWpmLabel = (wpm: number): string =>
    wpm <= 0
        ? 'Not Measured'
        : wpm >= ANALYTICS_THRESHOLDS.TARGET_WPM_MIN && wpm <= ANALYTICS_THRESHOLDS.TARGET_WPM_MAX
        ? 'Optimal Range'
        : wpm > ANALYTICS_THRESHOLDS.TARGET_WPM_MAX
            ? 'Too Fast'
            : 'Too Slow';

export const getWpmExplanation = (wpm: number, wordCount: number): string => {
    if (wordCount <= 0 || wpm <= 0) return 'Waiting for enough transcribed speech to measure pace.';
    if (wpm >= ANALYTICS_THRESHOLDS.TARGET_WPM_MIN && wpm <= ANALYTICS_THRESHOLDS.TARGET_WPM_MAX) {
        return 'Your pace is in the target range for easy listening. Keep using short pauses after important points.';
    }
    if (wpm > ANALYTICS_THRESHOLDS.FAST_WPM) {
        return 'Your pace is likely hard to follow. Slow down at sentence endings so each idea has room to land.';
    }
    if (wpm > ANALYTICS_THRESHOLDS.TARGET_WPM_MAX) {
        return 'Your pace is slightly fast. Add a beat between key ideas instead of rushing through transitions.';
    }
    if (wpm >= ANALYTICS_THRESHOLDS.VERY_SLOW_WPM) {
        return 'Your pace is a little relaxed. Keep the pauses, but add slightly more energy through familiar sections.';
    }
    return 'Your pace is very slow for most listeners. Practice the same answer again with fewer long gaps.';
};

export const calculateClarityScore = ({
    wordCount,
    fillerCount,
    errorCount,
    wpm,
}: {
    wordCount: number;
    fillerCount: number;
    errorCount: number;
    wpm: number;
}): number => Math.round(computeClarityRaw({ wordCount, fillerCount, errorCount, wpm }));

/**
 * #1045 — the UNROUNDED clear-delivery value, clamped to [0,100].
 *
 * `calculateClarityScore` rounds to an integer and that integer is what every existing surface displays
 * and what `sessions.clarity_score` persists. This function preserves the sub-point evidence that the
 * rounded score discards; whether such a difference is SHOWN as movement is the meaningful-movement
 * product policy, not a property of the number (a calculable difference is not automatically meaningful
 * user progress). The pre-round math lives here and `calculateClarityScore` is now exactly
 * `Math.round(computeClarityRaw(...))` — display is byte-identical, proven by equivalence tests.
 *
 * Historical rows keep their rounded values and are NEVER rewritten; raw evidence is future-only, from
 * the first eligible session after activation (`PROGRESS_AND_NEXT_ACTION.md` §5).
 */
export const computeClarityRaw = ({
    wordCount,
    fillerCount,
    errorCount,
    wpm,
}: {
    wordCount: number;
    fillerCount: number;
    errorCount: number;
    wpm: number;
}): number => {
    if (wordCount <= 0) return 0;

    const fillerPercentage = (fillerCount / wordCount) * 100;
    const pacePenalty =
        wpm > ANALYTICS_THRESHOLDS.FAST_WPM
            ? Math.min(ANALYTICS_THRESHOLDS.FAST_PACE_MAX_CLARITY_PENALTY, (wpm - ANALYTICS_THRESHOLDS.FAST_WPM) / 3)
            : wpm > 0 && wpm < ANALYTICS_THRESHOLDS.VERY_SLOW_WPM
                ? Math.min(ANALYTICS_THRESHOLDS.SLOW_PACE_MAX_CLARITY_PENALTY, (ANALYTICS_THRESHOLDS.VERY_SLOW_WPM - wpm) / 3)
                : 0;

    return Math.max(0, Math.min(100,
        100
        - (fillerPercentage * ANALYTICS_THRESHOLDS.FILLER_CLARITY_PENALTY_PER_PERCENT)
        - (errorCount * ANALYTICS_THRESHOLDS.ERROR_MARKER_CLARITY_PENALTY)
        - pacePenalty
    ));
};

export const getClarityLabel = (clarityScore: number): string =>
    clarityScore >= 90
        ? 'Excellent clarity!'
        : clarityScore >= 80
            ? 'Great clarity'
            : clarityScore >= 60
                ? 'Good clarity'
                : 'Keep practicing';

// #894: filler counts are DERIVED FROM THE TRANSCRIPT. Speech-to-text engines can omit a spoken filler
// upstream (it never reaches the transcript), so a "detected" count is a lower bound, not an exact tally.
// This concise disclosure is appended to every explanation that presents a filler count — filler AND the
// filler-dependent clarity branches — so the metric reads honestly everywhere it appears.
// (Engine-recall accuracy is out of scope here; this is truthful labeling, not a recall fix.)
export const FILLER_TRANSCRIPT_DISCLOSURE = 'Some spoken fillers may not appear in the transcript.';

export const getClarityExplanation = ({
    wordCount,
    fillerCount,
    errorCount,
    wpm,
}: {
    wordCount: number;
    fillerCount: number;
    errorCount: number;
    wpm: number;
}): string => {
    if (wordCount <= 0) {
        return 'No transcript was captured, so clarity cannot be scored yet.';
    }
    if (wordCount < MIN_RELIABLE_SCORING_WORDS) {
        return 'There is too little captured speech to score clarity reliably.';
    }
    if (errorCount > 0) {
        return 'Some speech was unclear enough to be marked as inaudible. Move closer to the mic or reduce background noise before judging delivery.';
    }
    if (fillerCount > 0) {
        return `${fillerCount} filler ${fillerCount === 1 ? 'word is' : 'words are'} pulling attention away from the message. Replace the next one with a brief pause. ${FILLER_TRANSCRIPT_DISCLOSURE}`;
    }
    if (wordCount < 12) {
        return 'This sample is short; treat the score as a rough signal until more speech is captured.';
    }
    if (wpm > ANALYTICS_THRESHOLDS.FAST_WPM) {
        return 'Fast pacing is lowering the score because listeners may miss transitions between ideas.';
    }
    if (wpm > 0 && wpm < ANALYTICS_THRESHOLDS.VERY_SLOW_WPM) {
        return 'Slow pacing is lowering the score because long gaps can make the delivery feel fragmented.';
    }
    return `No filler words or transcript errors were detected. Focus the next run on pacing and emphasis. ${FILLER_TRANSCRIPT_DISCLOSURE}`;
};

export const getFillerExplanation = (fillerCount: number, wordCount: number): string => {
    if (wordCount <= 0) return 'No transcript was captured, so filler words cannot be verified yet.';
    if (wordCount < MIN_RELIABLE_SCORING_WORDS) return 'There is too little captured speech to verify filler words reliably.';
    if (fillerCount === 0) return `No filler words were detected. Keep using silence as your reset instead of filling the space. ${FILLER_TRANSCRIPT_DISCLOSURE}`;
    const rate = (fillerCount / Math.max(1, wordCount)) * 100;
    if (rate >= ANALYTICS_THRESHOLDS.HIGH_FILLER_RATE_PERCENT) {
        return `${fillerCount} filler ${fillerCount === 1 ? 'word' : 'words'} detected, about ${rate.toFixed(1)}% of captured words. This is likely noticeable; pause before restarting a thought. ${FILLER_TRANSCRIPT_DISCLOSURE}`;
    }
    if (rate >= ANALYTICS_THRESHOLDS.NOTICEABLE_FILLER_RATE_PERCENT) {
        return `${fillerCount} filler ${fillerCount === 1 ? 'word' : 'words'} detected, about ${rate.toFixed(1)}% of captured words. Pick one repeat filler to replace with silence next time. ${FILLER_TRANSCRIPT_DISCLOSURE}`;
    }
    return `${fillerCount} filler ${fillerCount === 1 ? 'word' : 'words'} detected, about ${rate.toFixed(1)}% of captured words. Light usage; watch for repeats during transitions. ${FILLER_TRANSCRIPT_DISCLOSURE}`;
};

export const calculateCoreSessionMetrics = ({
    transcript,
    durationSeconds,
    fillerData,
    userWords = [],
}: CoreSessionMetricsInput): CoreSessionMetrics => {
    const normalizedFillerData = fillerData as FillerCounts | null | undefined;
    const hasSuppliedFillerData = normalizedFillerData && Object.keys(normalizedFillerData).length > 0;
    // #SSOT: normalize so the returned fillerData ALWAYS exposes total.count — a supplied detail-only
    // canonical object (e.g. `{ um: { count: 1 } }`) would otherwise crash the controller's direct
    // `fillerWords.total.count` read at ANALYSIS_COMPLETE.
    const derivedFillerData = normalizeFillerCounts(
        (hasSuppliedFillerData ? normalizedFillerData : countFillerWords(transcript, userWords)) as FillerCounts,
    );
    const wordCount = countTranscriptWords(transcript);
    const wpm = calculateWpm(wordCount, durationSeconds);
    const fillerCount = getFillerTotal(derivedFillerData);
    const errorCount = (transcript.match(ERROR_TAG_REGEX) || []).length;
    const isClarityScorable = wordCount >= MIN_RELIABLE_SCORING_WORDS;
    const clarityScore = isClarityScorable ? calculateClarityScore({ wordCount, fillerCount, errorCount, wpm }) : 0;

    return {
        wordCount,
        wpm,
        wpmLabel: getWpmLabel(wpm),
        wpmExplanation: getWpmExplanation(wpm, wordCount),
        fillerCount,
        fillerData: derivedFillerData,
        fillerExplanation: getFillerExplanation(fillerCount, wordCount),
        clarityScore,
        clarityLabel: isClarityScorable ? getClarityLabel(clarityScore) : 'Not enough reliable speech to score',
        clarityExplanation: getClarityExplanation({ wordCount, fillerCount, errorCount, wpm }),
        isClarityScorable,
        errorCount,
    };
};

const getCustomWordList = (customWords: PracticeSession['custom_words']): string[] => {
    if (!customWords) return [];
    if (Array.isArray(customWords)) {
        return customWords
            .map((item) => typeof item === 'string' ? item : '')
            .filter(Boolean);
    }
    return Object.keys(customWords);
};

export const getSessionAnalysisMetrics = (session: PracticeSession): CoreSessionMetrics => {
    // #SSOT: persisted canonical (live) filler data is authoritative. Recount the transcript ONLY when the
    // persisted filler data is missing/malformed — NEVER merely because a recount is larger. A valid
    // persisted zero stays zero (previous behavior wrongly took max(persisted, recount) and inflated it).
    const customWordsList = getCustomWordList(session.custom_words);
    const fillerData = isUsableFillerCounts(session.filler_words)
        ? session.filler_words
        : countFillerWords(session.transcript || '', customWordsList);
    const metrics = calculateCoreSessionMetrics({
        transcript: session.transcript || '',
        durationSeconds: session.duration || 0,
        fillerData,
    });
    const wordCount = Math.max(metrics.wordCount, session.total_words ?? 0);
    const wpm = session.wpm ?? calculateWpm(wordCount, session.duration || 0);
    const clarityScore = session.clarity_score ?? calculateClarityScore({
        wordCount,
        fillerCount: metrics.fillerCount,
        errorCount: metrics.errorCount,
        wpm,
    });

    return {
        ...metrics,
        wordCount,
        wpm,
        wpmLabel: getWpmLabel(wpm),
        wpmExplanation: getWpmExplanation(wpm, wordCount),
        clarityScore,
        clarityLabel: wordCount >= MIN_RELIABLE_SCORING_WORDS ? getClarityLabel(clarityScore) : 'Not enough reliable speech to score',
        clarityExplanation: getClarityExplanation({
            wordCount,
            fillerCount: metrics.fillerCount,
            errorCount: metrics.errorCount,
            wpm,
        }),
        fillerExplanation: getFillerExplanation(metrics.fillerCount, wordCount),
        isClarityScorable: wordCount >= MIN_RELIABLE_SCORING_WORDS,
    };
};
