/**
 * #1045 PR-B — deterministic Progress evaluation builder.
 *
 * Turns one persisted, completed session into the versioned evaluation record defined by
 * `product_release/PROGRESS_AND_NEXT_ACTION.md` §4 and §8. Pure and side-effect free: it performs no
 * I/O, invokes no transcription engine, and makes no provider call — persistence is the caller's job.
 *
 * The two ordered gates from §4 are kept genuinely separate:
 *   1. METRIC VALIDITY decides whether a measurement EXISTS (structural; a real measured zero is valid);
 *   2. SESSION ELIGIBILITY decides whether it may INFLUENCE Progress.
 * Conflating them is what would let a four-second accidental take move a trend.
 *
 * Every ineligible session still yields a record, carrying deterministic exclusion reasons, so that
 * "why was this session not counted?" is answerable from the record alone rather than recomputed later
 * from mutable state.
 */
import { computeClarityRaw } from '@/utils/sessionAnalysis';

/** Bumped whenever the calculation changes. A new version is a NEW record, never an edit. */
export const PROGRESS_FORMULA_VERSION = 'clarity_v1';

/** §4 session-eligibility thresholds. Deliberately far stricter than metric computability. */
export const PROGRESS_ELIGIBILITY = {
    MIN_DURATION_SECONDS: 30,
    MIN_WORD_COUNT: 75,
} as const;

/** Closed set — an unknowable reason is recorded as `unknown`, never guessed. */
export type ExclusionReason =
    | 'not_completed'
    | 'too_short'
    | 'too_few_words'
    | 'no_transcript'
    | 'no_filler_evidence'
    | 'no_clarity_evidence'
    | 'unverified_attribution'
    | 'incomplete_engine_identity'
    | 'unknown';

/** Complete engine identity = all three present AND non-blank. NULL or empty/whitespace is incomplete. */
function hasCompleteEngineIdentity(e: SessionEvidence): boolean {
    const present = (v: string | null): boolean => typeof v === 'string' && v.trim().length > 0;
    return present(e.engine) && present(e.engineVersion) && present(e.modelName);
}

export interface SessionEvidence {
    sessionId: string;
    userId: string;
    status: string | null;
    durationSeconds: number | null;
    wordCount: number | null;
    /** Whether a usable transcript exists — the fact, not the transcript. */
    hasTranscript: boolean;
    fillerCount: number | null;
    errorMarkerCount: number | null;
    wpm: number | null;
    engine: string | null;
    engineVersion: string | null;
    modelName: string | null;
    attributionStatus: string | null;
}

export interface ProgressEvaluation {
    sessionId: string;
    userId: string;
    formulaVersion: string;
    snapshotOrigin: 'at_save';
    durationSeconds: number;
    wordCount: number;
    clarityEvidenceAvailable: boolean;
    engine: string | null;
    engineVersion: string | null;
    modelName: string | null;
    attributionStatus: string | null;
    eligible: boolean;
    exclusionReasons: ExclusionReason[];
    // eligible-only
    clarityRaw: number | null;
    fillerCount: number | null;
    errorMarkerCount: number | null;
    wpm: number | null;
    cohortKey: string | null;
}

/**
 * §4 comparable cohort — exact engine × engine version × model name × formula version. `model_name` is
 * included because `engine_version` is not proven to identify the producing model, so version alone
 * could silently mix two models into one "comparable" series.
 */
export function progressCohortKey(e: Pick<SessionEvidence, 'engine' | 'engineVersion' | 'modelName'>): string {
    return [e.engine ?? '', e.engineVersion ?? '', e.modelName ?? '', PROGRESS_FORMULA_VERSION].join('|');
}

/** Gate 1 — does a clear-delivery measurement structurally EXIST? A measured zero is valid. */
function hasClarityEvidence(e: SessionEvidence): boolean {
    return e.hasTranscript
        && typeof e.wordCount === 'number' && e.wordCount > 0
        && typeof e.fillerCount === 'number' && e.fillerCount >= 0
        && typeof e.errorMarkerCount === 'number' && e.errorMarkerCount >= 0
        && typeof e.wpm === 'number' && Number.isFinite(e.wpm);
}

/**
 * Builds the evaluation record. Always returns one — an ineligible session is recorded with its
 * reasons, never dropped.
 */
export function buildProgressEvaluation(
    e: SessionEvidence,
    opts: { snapshotOrigin?: 'at_save' } = {},
): ProgressEvaluation {
    const reasons: ExclusionReason[] = [];

    if (e.status !== 'completed') reasons.push('not_completed');

    const duration = typeof e.durationSeconds === 'number' && Number.isFinite(e.durationSeconds)
        ? e.durationSeconds : 0;
    const words = typeof e.wordCount === 'number' && Number.isFinite(e.wordCount) ? e.wordCount : 0;

    if (duration < PROGRESS_ELIGIBILITY.MIN_DURATION_SECONDS) reasons.push('too_short');
    if (words < PROGRESS_ELIGIBILITY.MIN_WORD_COUNT) reasons.push('too_few_words');
    if (!e.hasTranscript) reasons.push('no_transcript');

    // Missing filler evidence must NEVER be imputed to zero — a null count is ABSENT evidence, so the
    // session is excluded (a measured zero, `fillerCount === 0`, is valid evidence and passes).
    if (e.fillerCount === null || e.fillerCount === undefined) reasons.push('no_filler_evidence');

    const clarityAvailable = hasClarityEvidence(e);
    if (!clarityAvailable) reasons.push('no_clarity_evidence');

    // Engine-specific evidence is admissible only when #1033 attribution was durably verified.
    if (e.attributionStatus !== 'verified') reasons.push('unverified_attribution');

    // A comparable cohort requires a COMPLETE, non-blank engine identity (engine × version × model).
    // Blank/partial identity would silently collapse distinct engines into one "comparable" series.
    if (!hasCompleteEngineIdentity(e)) reasons.push('incomplete_engine_identity');

    const eligible = reasons.length === 0;

    return {
        sessionId: e.sessionId,
        userId: e.userId,
        formulaVersion: PROGRESS_FORMULA_VERSION,
        snapshotOrigin: opts.snapshotOrigin ?? 'at_save',
        durationSeconds: duration,
        wordCount: words,
        clarityEvidenceAvailable: clarityAvailable,
        engine: e.engine,
        engineVersion: e.engineVersion,
        modelName: e.modelName,
        attributionStatus: e.attributionStatus,
        eligible,
        // Deduplicated and ordered so the same session always yields the same record — determinism is
        // what makes two evaluations comparable and an exclusion auditable.
        exclusionReasons: [...new Set(reasons)].sort(),
        clarityRaw: eligible
            ? computeClarityRaw({
                wordCount: words,
                fillerCount: e.fillerCount as number,
                errorCount: e.errorMarkerCount as number,
                wpm: e.wpm as number,
            })
            : null,
        fillerCount: eligible ? e.fillerCount : null,
        errorMarkerCount: eligible ? e.errorMarkerCount : null,
        wpm: eligible ? e.wpm : null,
        cohortKey: eligible ? progressCohortKey(e) : null,
    };
}

/**
 * §5 baseline + previous-comparable resolution, within ONE cohort.
 *
 * Baseline is the FIRST ELIGIBLE session in the cohort (future-only: pre-activation sessions are never
 * retro-fitted, because no evaluation record exists for them). Returns nulls when there is no prior
 * eligible session — the caller must then show "Baseline established", never a fabricated zero.
 */
export function resolveComparisonRefs(
    current: ProgressEvaluation,
    priorEligibleSameCohortOldestFirst: ProgressEvaluation[],
): { baselineSessionId: string | null; previousComparableSessionId: string | null } {
    if (!current.eligible) return { baselineSessionId: null, previousComparableSessionId: null };

    const prior = priorEligibleSameCohortOldestFirst.filter(
        p => p.eligible && p.cohortKey === current.cohortKey && p.sessionId !== current.sessionId,
    );
    if (prior.length === 0) return { baselineSessionId: null, previousComparableSessionId: null };

    return {
        baselineSessionId: prior[0].sessionId,
        previousComparableSessionId: prior[prior.length - 1].sessionId,
    };
}
