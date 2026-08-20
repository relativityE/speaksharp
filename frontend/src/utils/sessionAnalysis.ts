import type { PracticeSession } from '@/types/session';
import { countFillerWords, type FillerCounts } from './fillerWordUtils';
import { countedFillerTotal, countedFillerMap } from './fillerTiers';
import { readPersistedFillerCounts } from '@/contracts/fillerCounts';

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

/**
 * #1306 READ-path metrics. Identical to CoreSessionMetrics EXCEPT the filler headline is NULLABLE: `null` means
 * the filler metric is UNAVAILABLE (not measured, or invalid/malformed persisted data — never collapsed into a
 * flattering 0). A number (0 for a measured `{}`) means measured. Consumers must render `null` as N/A, and 0 as
 * "no fillers detected". The live path (CoreSessionMetrics) always carries a real number.
 */
export type SessionReadMetrics = Omit<CoreSessionMetrics, 'fillerCount'> & { fillerCount: number | null };

interface CoreSessionMetricsInput {
    transcript: string;
    durationSeconds: number;
    fillerData?: FillerCounts | Record<string, number> | null;
    userWords?: string[];
    // #1231 slice 2: count discourse markers toward the headline too (the user's opt-in preference).
    // Default false — the headline is true fillers (um/uh/ah) + the user's own words.
    includeDiscourseMarkers?: boolean;
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

// #1131 correction 4: a valid filler count is a finite, NON-NEGATIVE INTEGER within a sane range. A
// fractional (2.5), negative (-1), non-finite, or absurdly out-of-range count is malformed data — it must
// never inflate/deflate a metric nor (on the RPC) crash an integer cast. 9 digits keeps it inside int range.
const MAX_FILLER_COUNT = 999_999_999;
export const isValidFillerCount = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_FILLER_COUNT;

// #1306: read one filler entry's count from EITHER the stored flat shape (a number) or the live nested
// `{ count }` shape, so the filler helpers work on both a persisted session and an in-flight recording.
const fillerEntryCount = (raw: unknown): unknown =>
    typeof raw === 'number' ? raw : (raw && typeof raw === 'object' ? (raw as { count?: unknown }).count : undefined);

/**
 * #1131 corrections 3 + 4: the AUTHORITATIVE total filler count for a session, honoring a total-only snapshot.
 * A valid `total.count` wins (including a genuine 0, and a `{ total: { count: N } }` with no per-word breakdown).
 * Otherwise sum the per-word entries that carry a VALID count. Returns null when there is no valid filler
 * evidence at all (empty `{}`, malformed `{um:{}}`, fractional/negative-only), so callers can exclude the row
 * rather than fabricate a flattering 0. Mirrors the RPC helper `_ss_valid_filler_total`.
 */
export const validatedFillerTotal = (
    fillerWords?: Record<string, number> | FillerCounts | null,
): number | null => {
    // #1131 round-4 (#3): fail closed on non-plain-objects. `typeof [] === 'object'`, so an ARRAY would
    // otherwise be iterated by index and treated as a filler map; a scalar/null carries no counts either.
    // #1306 zero-vs-missing (three cases): NULL / non-object → null (NOT measured, excluded). EMPTY `{}` → 0
    // (a genuine MEASURED zero — must count, never excluded). A NON-EMPTY object with no valid count (malformed
    // — e.g. `{um:'x'}` or an invalid total-only snapshot) → null (fail closed, never a flattering 0). A valid
    // total or valid per-key counts → their number.
    if (fillerWords == null || typeof fillerWords !== 'object' || Array.isArray(fillerWords)) return null;
    if (Object.keys(fillerWords).length === 0) return 0; // {} = measured zero
    const total = (fillerWords as { total?: { count?: unknown } }).total?.count;
    if (isValidFillerCount(total)) return total; // total-authoritative (legacy nested snapshot)
    let sum = 0;
    let sawValid = false;
    for (const word in fillerWords) {
        if (word === 'total') continue;
        const c = fillerEntryCount((fillerWords as Record<string, unknown>)[word]);
        if (isValidFillerCount(c)) { sum += c; sawValid = true; }
    }
    return sawValid ? sum : null; // non-empty but no valid count = malformed → excluded
};

export const sumFillerCounts = (fillerWords?: Record<string, number> | FillerCounts | null): number => {
    if (!fillerWords) return 0;

    let sum = 0;
    for (const word in fillerWords) {
        if (word === 'total') continue;
        const c = fillerEntryCount((fillerWords as Record<string, unknown>)[word]);
        if (isValidFillerCount(c)) sum += c; // #1131 correction 4: ignore malformed/fractional/negative counts
    }
    return sum;
};

export interface ReviewFillerSnapshot {
    /** false = unavailable (SQL NULL): render NO numeric filler claim and no chips. */
    available: boolean;
    /** The one validated chip map the review renders from (null when unavailable). `{}` = measured zero. */
    counts: FillerCounts | null;
    /** The displayed total, DERIVED from `counts` (sum of the chip keys) so it can never disagree with the chips. */
    total: number;
}

/**
 * #1314 C3 — select ONE whole filler snapshot by precedence and derive the displayed total from the SAME
 * map the chips render from, so the sentence total and the per-word chips can never contradict.
 *
 * Precedence (never mix fields from separate sources): in the terminal review the live map is zeroed by the
 * useFillerWords sync, so the FINALIZED snapshot is authoritative; otherwise the live map. `null`/`undefined`
 * is UNAVAILABLE (no numeric claim); `{}`/all-zero is a MEASURED ZERO (renders 0, no chips). No truthy `||`
 * fallback is used, so a valid measured zero is never replaced by another source.
 */
export const selectReviewFillerSnapshot = (args: {
    inAfter: boolean;
    finalizedFillerData?: FillerCounts | null;
    liveFillerData?: FillerCounts | null;
    // #1314 C3 (PM ruling): preserve true fillers; EXCLUDE discourse markers from the chips AND the total.
    // Default false (true-filler tier); user words outside the 13 patterns always count.
    includeDiscourseMarkers?: boolean;
    userWords?: string[];
}): ReviewFillerSnapshot => {
    const selected = args.inAfter ? args.finalizedFillerData : args.liveFillerData;
    if (selected === null || selected === undefined) return { available: false, counts: null, total: 0 };
    // ONE validated chip map = the counting tier (true fillers + user words; discourse excluded unless
    // opted in). Chips render from it and the total is its sum, so they can never disagree.
    const counts = countedFillerMap(selected, {
        includeDiscourseMarkers: args.includeDiscourseMarkers ?? false,
        userWords: args.userWords ?? [],
    }) ?? ({} as FillerCounts);
    return { available: true, counts, total: sumFillerCounts(counts) };
};

export const getFillerTotal = (fillerWords?: Record<string, number> | FillerCounts | null): number =>
    // #1131 corrections 3 + 4: total-authoritative + validated; 0 when there is no valid evidence.
    validatedFillerTotal(fillerWords) ?? 0;

/**
 * #SSOT: is this a USABLE canonical filler-counts object? A valid ZERO count is usable (must stay zero);
 * null / non-object / empty {} / malformed is NOT usable — the ONLY case where a transcript-recount fallback
 * is allowed. #1131 review (#31): "usable" is now EXACTLY "has a VALID filler count" (validatedFillerTotal
 * !== null). Previously it accepted any finite number, so a snapshot whose only signal was an invalid total
 * such as `{ total: { count: 2.5 } }` or `{ total: { count: -1 } }` was deemed usable and then coerced to a
 * confident zero by getFillerTotal. Aligning the predicate keeps malformed evidence UNAVAILABLE, never a 0.
 */
export const isUsableFillerCounts = (
    fillerWords?: Record<string, number> | FillerCounts | null,
): boolean => validatedFillerTotal(fillerWords) !== null;

/**
 * #SSOT / #1306: normalize a filler map to a CONSISTENT nested `{ word: { count } }` shape with a numeric
 * `total.count`, accepting EITHER the stored flat shape (`{ um: 3 }`) or the live nested shape
 * (`{ um: { count: 3 } }`). Downstream readers (dashboard chips, top-filler list, controller ANALYSIS_COMPLETE)
 * read `entry.count`, so emitting nested uniformly means a stored flat `filler_counts` renders identically to a
 * live snapshot. Only valid non-negative-integer counts survive; `total.count` is their sum.
 */
export const normalizeFillerCounts = (fillerWords: FillerCounts | Record<string, number>): FillerCounts => {
    const out: FillerCounts = {};
    let total = 0;
    let sawPerKey = false;
    for (const key in fillerWords) {
        if (key === 'total') continue;
        const c = fillerEntryCount((fillerWords as Record<string, unknown>)[key]);
        if (isValidFillerCount(c)) {
            const color = (fillerWords as Record<string, { color?: string }>)[key]?.color ?? '';
            out[key] = { count: c, color };
            total += c;
            sawPerKey = true;
        }
    }
    // When NO per-key entries exist, preserve a valid legacy total-only snapshot (`{ total: { count: N } }`)
    // rather than fabricating a zero. The live path (fillerDivergence, controller ANALYSIS_COMPLETE) can emit a
    // total-only snapshot, and its comprehensive total must survive normalization. (A persisted flat `{}` has no
    // total key, so this correctly stays 0 = measured zero.)
    if (!sawPerKey) {
        const existingTotal = (fillerWords as { total?: { count?: unknown } })?.total?.count;
        if (isValidFillerCount(existingTotal)) total = existingTotal;
    }
    out.total = { count: total, color: (fillerWords as { total?: { color?: string } })?.total?.color ?? '' };
    return out;
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
    transcriptAvailable = true,
}: {
    wordCount: number;
    // #1306 P1-4: `null` = filler evidence UNAVAILABLE. The clarity copy must NOT reconstruct a favorable
    // "no filler words were detected" statement from absent filler data.
    fillerCount: number | null;
    errorCount: number;
    wpm: number;
    // #1306 P1-4: the saved-review reader has NO transcript. When false, the copy must never claim "no transcript
    // errors were detected" (there is no transcript to inspect) or imply the transcript was examined.
    transcriptAvailable?: boolean;
}): string => {
    if (wordCount <= 0) {
        return 'No transcript was captured, so clarity cannot be scored yet.';
    }
    if (wordCount < MIN_RELIABLE_SCORING_WORDS) {
        return 'There is too little captured speech to score clarity reliably.';
    }
    if (transcriptAvailable && errorCount > 0) {
        return 'Some speech was unclear enough to be marked as inaudible. Move closer to the mic or reduce background noise before judging delivery.';
    }
    if (fillerCount !== null && fillerCount > 0) {
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
    // #1306 P1-4: filler evidence is UNAVAILABLE — do not assert "no filler words were detected". Speak only to
    // the evidence we have (pacing) and stay neutral about fillers.
    if (fillerCount === null) {
        return 'Filler-word data wasn’t available for this session, so focus the next run on pacing and emphasis.';
    }
    // #1306 P1-4: measured-zero fillers. Only claim "no transcript errors" when a transcript was actually
    // inspected (live) — the saved-review reader has none, so it must not fabricate that clause.
    return transcriptAvailable
        ? `No filler words or transcript errors were detected. Focus the next run on pacing and emphasis. ${FILLER_TRANSCRIPT_DISCLOSURE}`
        : 'No filler words were counted for this session. Focus the next run on pacing and emphasis.';
};

export const getFillerExplanation = (fillerCount: number | null, wordCount: number): string => {
    // #1306 P1-4: UNAVAILABLE (null) filler data must read as N/A — NEVER as a measured "no filler words".
    // A measured empty map (`{}`) arrives here as 0 and keeps the genuine measured-zero copy below.
    if (fillerCount === null) return 'Filler-word data wasn’t available for this session.';
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
    includeDiscourseMarkers = false,
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
    // #1231 slice 2: the headline is the TRUE-filler tier (um/uh/ah + user words, + discourse when opted in),
    // DERIVED from per-key data uniformly across all history. The `?? getFillerTotal` fallback covers the
    // rare total-only snapshot with no per-key breakdown (legacy comprehensive total) so the number is never
    // blank; every real per-key session is re-tiered. `fillerData` is UNCHANGED (full per-key breakdown for
    // the display), so the per-word chips still show every tracked word.
    const fillerCount = countedFillerTotal(derivedFillerData, { includeDiscourseMarkers, userWords }) ?? getFillerTotal(derivedFillerData);
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

export const getSessionAnalysisMetrics = (
    session: PracticeSession,
    // #1231 slice 2: the reader's discourse-marker preference. Default false so any util/test caller gets
    // the true-filler headline; component callers pass the user's DB-backed pref.
    { includeDiscourseMarkers = false }: { includeDiscourseMarkers?: boolean } = {},
): SessionReadMetrics => {
    // #1306 metrics-only: read STORED metrics — there is NO transcript to recount and no per-session custom
    // words. The persisted filler map is RUNTIME-VALIDATED here (strict reader): approved keys only, `{}` = a
    // measured zero, and any unknown/prose key / nested / bad number fails closed to `null` (excluded).
    const fillerData = readPersistedFillerCounts(session.filler_counts);
    const metrics = calculateCoreSessionMetrics({
        transcript: '',
        durationSeconds: session.duration || 0,
        fillerData,
        userWords: [],
        includeDiscourseMarkers,
    });
    // #1306 + #1231: the per-session filler HEADLINE is the TRUE-filler tier (um/uh/ah + user words; discourse
    // markers such as "like"/"so" appear in the per-word breakdown but are NOT counted in the headline), and it
    // is NULLABLE: null = UNAVAILABLE (absent/invalid filler_counts), 0 = a measured `{}` (or discourse-only),
    // N = measured true fillers. This is DISTINCT from the aggregate avgFillerWordsPerMin, which sums all
    // approved keys. Never collapse unavailable/invalid into 0 (that would fabricate "zero fillers").
    const fillerHeadline = fillerData === null ? null : metrics.fillerCount;
    const wordCount = Math.max(metrics.wordCount, session.total_words ?? 0);
    const wpm = session.wpm ?? calculateWpm(wordCount, session.duration || 0);
    // #1131 (preserved): the PERSISTED clarity score is authoritative when present — an expired session
    // (transcript nulled) can no longer be recomputed, so its stored clarity must survive. Only recompute
    // when there is no stored score. Note (#1231): the filler HEADLINE is re-tiered to true fillers, which
    // feeds the recompute branch for new/unscored sessions; clarity is NOT the session-over-session Progress
    // metric (that is the filler RATE, re-tiered uniformly by the server-authoritative Progress read model
    // in loadSessionProgress), so a stored-vs-recomputed clarity mix does not manufacture a progress trend.
    // clarity_v1 remains provisional.
    // #1306 P1-4: NEVER reconstruct a clarity score from absent evidence. A saved session's clarity is the
    // STORED value only; when there is no stored score it is UNAVAILABLE (N/A) — the reader has no transcript to
    // recompute from, so fabricating one would be a false performance claim. (The live scoring path in
    // calculateCoreSessionMetrics still computes clarity from a real transcript at record time.)
    const clarityAvailable = typeof session.clarity_score === 'number';
    const clarityScore = clarityAvailable ? (session.clarity_score as number) : 0; // placeholder; never shown when unavailable (display + isClarityScorable gate on availability)

    return {
        ...metrics,
        // #1306: nullable filler headline — UNAVAILABLE (null) is never shown as 0. A measured `{}` is 0.
        fillerCount: fillerHeadline,
        wordCount,
        wpm,
        wpmLabel: getWpmLabel(wpm),
        wpmExplanation: getWpmExplanation(wpm, wordCount),
        clarityScore,
        clarityLabel: !clarityAvailable
            ? 'Not scored'
            : (wordCount >= MIN_RELIABLE_SCORING_WORDS ? getClarityLabel(clarityScore) : 'Not enough reliable speech to score'),
        // #1306 P1-4: when clarity was not scored, the explanation is neutral N/A — never a performance claim.
        // When it IS scored, pass the NULLABLE filler headline + transcriptAvailable:false so the copy never
        // reconstructs "no filler words were detected" from absent filler evidence nor claims transcript-error
        // absence (the reader has no transcript). A measured `{}` arrives as 0 and keeps genuine measured-zero copy.
        clarityExplanation: clarityAvailable
            ? getClarityExplanation({
                wordCount,
                fillerCount: fillerHeadline,
                errorCount: metrics.errorCount,
                wpm,
                transcriptAvailable: false,
            })
            : 'Clarity wasn’t scored for this session.',
        fillerExplanation: getFillerExplanation(fillerHeadline, wordCount),
        isClarityScorable: clarityAvailable && wordCount >= MIN_RELIABLE_SCORING_WORDS,
    };
};
