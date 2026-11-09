/**
 * Work point 2: make the selected STT path reliable (Private v2:base.en). This is the scorer for the frozen
 * real-speech corpus. It scores the SAVED transcript only.
 *
 * The scoring rules are frozen here, BEFORE any run, and versioned in STT_RELIABILITY_SCORING. Changing any
 * rule is a new version. A result records the version it was scored under and never a different one.
 *
 * What it builds on:
 *   - WER and normalization come from werMetric (official Track A normalization, fillers removed), so the
 *     numbers are comparable with the repository's other WER figures.
 *   - Filler-stripped WER cannot show an invented or looped filler, or a lost opening or trailing filler.
 *     So the boundary-word, invented-prefix, loop and silence checks run on Track B tokens (the same official
 *     core, with fillers preserved), separately from WER.
 *   - Pooled WER = Σ(S+D+I) / Σ(reference words), as in benchmarkScore. It is never a mean of per-clip WER.
 *
 * The scorer never edits, trims or rewrites the hypothesis. A transcript is scored exactly as it was saved.
 */
import { wordErrorRate } from './werMetric';
import { normalizeOfficialTrackA, normalizeOfficialTrackB } from './normalization/officialNormalizer';
import { TRACK_NORMALIZATION } from './normalization/tracks';

export const STT_RELIABILITY_SCORING = Object.freeze({
    version: 'stt_reliability_v1',
    /** WER normalization (fillers removed). */
    normalization: TRACK_NORMALIZATION.track_a,
    /** Normalization for Q2–Q6 (fillers preserved). */
    checkNormalization: TRACK_NORMALIZATION.track_b,
    /** Q1: the internal target for controlled fixtures (STT.md §6). It applies to the pooled figure, not to each clip. */
    pooledWerTarget: 0.10,
    loop: Object.freeze({
        /**
         * Tandem repeats of every n-gram size from 1 to 40 tokens are examined. Whisper's typical loop repeats a
         * whole sentence or segment, often longer than 8 words, so a small maxN cannot see it (independent review
         * of the first draft, which used 8). Only TANDEM (back-to-back) repeats count. A phrase repeated with other
         * words between the copies is not a loop under this rule, and the report says so.
         */
        minN: 1,
        maxN: 40,
        /**
         * A repeat counts as a loop only when the hypothesis repeats an n-gram consecutively at least
         * `minExcessRepeats` MORE times than the reference ever repeats that same n-gram consecutively,
         * AND those excess repeats cover at least `minExcessSpanTokens` tokens.
         *
         * So legitimate repeated speech ("no no no"), which the reference also contains, is never flagged.
         * A short doubled phrase ("you know you know": 2 repeats against 1 = excess 1) is never flagged. A
         * single substitution or deletion creates no excess repeat.
         */
        minExcessRepeats: 2,
        minExcessSpanTokens: 6,
    }),
    /** Q5: an invented prefix is at least this many leading hypothesis tokens aligned as insertions before the first reference token. */
    inventedPrefixMinTokens: 2,
});

export type ClipKind = 'speech' | 'silence';

/** A planned clip: identity and audio binding from the frozen manifest. */
export interface PlannedClip {
    id: string;
    kind: ClipKind;
    /** The reference text. It is empty for silence clips, and required for speech clips. */
    reference: string;
    /** Binding to the exact audio that was played: the PCM digest, not the WAV file digest (headers differ between writers). */
    audio: { pcmSha256: string; sampleRateHz: number; sampleCount: number };
}

/**
 * The outcome of one clip's run through the product path. Every outcome is named; a missing outcome is a
 * failure, not a skipped clip.
 */
export type ClipOutcome =
    | { status: 'saved'; transcript: string; playedPcmSha256: string; playedSampleCount: number }
    | { status: 'finalize_failed'; detail?: string }
    | { status: 'save_failed'; detail?: string }
    | { status: 'not_run'; detail?: string };

export type ReliabilityFailure = 'finalize_failed' | 'save_failed' | 'not_run' | 'empty_transcript';
export type InputInvalidReason =
    | 'missing_reference'
    | 'reference_on_silence_clip'
    | 'invalid_audio_binding'
    | 'played_audio_mismatch'
    | 'duplicate_clip_id'
    | 'invalid_clip_kind'
    | 'invalid_outcome'
    | 'unplanned_outcome'
    | 'empty_plan';

export interface LoopFinding { n: number; ngram: string; hypothesisRepeats: number; referenceRepeats: number; excessSpanTokens: number }

export interface ClipScore {
    id: string;
    kind: ClipKind;
    /** Whether the clip is eligible for WER. Silence clips never are; they are judged by Q6 alone. */
    werEligible: boolean;
    reliabilityFailure: ReliabilityFailure | null;
    /** Measured WER for a saved speech clip. It is null for a failed or silence clip. */
    wer: number | null;
    referenceWords: number;
    substitutions: number;
    deletions: number;
    insertions: number;
    openingWordKept: boolean | null;
    trailingWordKept: boolean | null;
    loops: LoopFinding[];
    inventedPrefixTokens: number | null;
    /** Q6: for a silence clip, whether the saved transcript has no words. */
    silenceClean: boolean | null;
}

export interface CorpusReport {
    scoringVersion: string;
    normalization: string;
    /** When the input is invalid, there are no numbers at all: an invalid corpus is not a smaller corpus. */
    inputInvalid: { reason: InputInvalidReason; clipId?: string } | null;
    plannedClips: number;
    clips: ClipScore[];
    reliability: { saved: number; failures: Record<ReliabilityFailure, number> };
    /** Strict pooled WER: null unless every planned speech clip was saved and is non-empty. This alone feeds the gate. */
    strictPooledWer: number | null;
    /**
     * DIAGNOSTIC ONLY, never a gate input. Each failed or empty speech clip is counted as 100% deletions. This
     * is not guaranteed to be worse than excluding the clip: when the other clips are above 100% WER (for
     * example, a heavy loop), adding a 100% clip lowers the pooled figure.
     */
    diagnosticFailureInclusiveWer: number | null;
    pooledWerTarget: number;
    /**
     * The quality gate. FAIL when any required clip failed or is empty, when strict pooled WER is not below the
     * target, or when any clip fails Q2–Q6. NOT_EVALUATED only when the input is invalid.
     */
    qualityGate: { status: 'PASS' | 'FAIL' | 'NOT_EVALUATED'; reasons: string[] };
}

type Op = 'match' | 'sub' | 'del' | 'ins';

/** Word alignment with the same costs and tie-breaking as werMetric's edit distance, returned as an op list. */
export function alignTokens(ref: readonly string[], hyp: readonly string[]): Op[] {
    const n = ref.length, m = hyp.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            dp[i][j] = ref[i - 1] === hyp[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    const ops: Op[] = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) { ops.push('match'); i--; j--; }
        else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) { ops.push('sub'); i--; j--; }
        else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { ops.push('del'); i--; }
        else { ops.push('ins'); j--; }
    }
    return ops.reverse();
}

/**
 * The same lowest-cost alignment, but with insertions and deletions pushed toward the END. Among equally cheap
 * alignments, this one has the fewest leading insertions and keeps the opening word whenever any lowest-cost
 * alignment does. Q2 and Q5 use it; Q3 uses alignTokens, which pushes edits toward the START. So each check
 * gets the most favourable lowest-cost alignment for the boundary it judges, and a doubled phrase is never
 * mistaken for an invented prefix.
 */
export function alignTokensPreferringEarlyMatches(ref: readonly string[], hyp: readonly string[]): Op[] {
    return alignTokens([...ref].reverse(), [...hyp].reverse()).reverse();
}

/** The longest run of consecutive copies of each n-gram, keyed by the n-gram text. */
function maxTandemRepeats(tokens: readonly string[], n: number): Map<string, number> {
    const best = new Map<string, number>();
    for (let start = 0; start + n <= tokens.length; start++) {
        const gram = tokens.slice(start, start + n).join(' ');
        let count = 1;
        while (start + (count + 1) * n <= tokens.length
            && tokens.slice(start + count * n, start + (count + 1) * n).join(' ') === gram) count++;
        if (count > (best.get(gram) ?? 0)) best.set(gram, count);
    }
    return best;
}

/** Q4: tandem repeats in the hypothesis beyond what the reference itself contains, per the frozen loop rule. */
export function findRepetitionLoops(referenceTokens: readonly string[], hypothesisTokens: readonly string[]): LoopFinding[] {
    const rule = STT_RELIABILITY_SCORING.loop;
    const findings: LoopFinding[] = [];
    for (let n = rule.minN; n <= rule.maxN; n++) {
        const refRuns = maxTandemRepeats(referenceTokens, n);
        for (const [ngram, hypRepeats] of maxTandemRepeats(hypothesisTokens, n)) {
            const refRepeats = refRuns.get(ngram) ?? 0;
            const excess = hypRepeats - Math.max(refRepeats, 1);
            if (excess >= rule.minExcessRepeats && excess * n >= rule.minExcessSpanTokens) {
                findings.push({ n, ngram, hypothesisRepeats: hypRepeats, referenceRepeats: refRepeats, excessSpanTokens: excess * n });
            }
        }
    }
    return findings;
}

const OUTCOME_STATUSES = new Set(['saved', 'finalize_failed', 'save_failed', 'not_run']);

/** An outcome the runner produced must be one of the four named shapes. Anything else is invalid input, never a score. */
function validOutcome(outcome: unknown): boolean {
    if (!outcome || typeof outcome !== 'object') return false;
    const o = outcome as Record<string, unknown>;
    if (typeof o.status !== 'string' || !OUTCOME_STATUSES.has(o.status)) return false;
    if (o.status !== 'saved') return true;
    return typeof o.transcript === 'string' && typeof o.playedPcmSha256 === 'string' && Number.isSafeInteger(o.playedSampleCount);
}

function validBinding(audio: PlannedClip['audio'] | undefined): boolean {
    return !!audio && /^[0-9a-f]{64}$/.test(audio.pcmSha256) && audio.sampleRateHz === 16_000
        && Number.isSafeInteger(audio.sampleCount) && audio.sampleCount > 0;
}

function scoreClip(clip: PlannedClip, outcome: ClipOutcome | undefined): ClipScore {
    const refTokens = normalizeOfficialTrackA(clip.reference);
    const refCheckTokens = normalizeOfficialTrackB(clip.reference);
    const base: ClipScore = {
        id: clip.id, kind: clip.kind, werEligible: clip.kind === 'speech', reliabilityFailure: null, wer: null,
        referenceWords: clip.kind === 'speech' ? refTokens.length : 0, substitutions: 0, deletions: 0, insertions: 0,
        openingWordKept: null, trailingWordKept: null, loops: [], inventedPrefixTokens: null, silenceClean: null,
    };
    if (!outcome || outcome.status !== 'saved') {
        return { ...base, reliabilityFailure: outcome ? outcome.status : 'not_run' };
    }
    const hypCheckTokens = normalizeOfficialTrackB(outcome.transcript);
    if (clip.kind === 'silence') return { ...base, silenceClean: hypCheckTokens.length === 0, loops: findRepetitionLoops([], hypCheckTokens) };
    // Empty means no tokens at all after Track B normalization. A filler-only transcript ("um uh") is not empty:
    // it is scored, as 100% deletions on Track A, and it fails the gate through WER and the boundary checks.
    if (hypCheckTokens.length === 0) return { ...base, reliabilityFailure: 'empty_transcript' };
    const row = wordErrorRate(clip.reference, outcome.transcript, { track: 'track_a' });
    const early = alignTokensPreferringEarlyMatches(refCheckTokens, hypCheckTokens);
    const late = alignTokens(refCheckTokens, hypCheckTokens);
    const earlyRefOps = early.filter(op => op !== 'ins');
    const lateRefOps = late.filter(op => op !== 'ins');
    const leadingInsertions = early.findIndex(op => op !== 'ins');
    return {
        ...base,
        wer: row.wer,
        referenceWords: row.referenceWords,
        substitutions: row.substitutions,
        deletions: row.deletions,
        insertions: row.insertions,
        openingWordKept: earlyRefOps[0] === 'match',
        trailingWordKept: lateRefOps[lateRefOps.length - 1] === 'match',
        loops: findRepetitionLoops(refCheckTokens, hypCheckTokens),
        inventedPrefixTokens: leadingInsertions === -1 ? hypCheckTokens.length : leadingInsertions,
    };
}

/**
 * Score a whole planned corpus. Every planned clip appears in the report. Its outcome may be absent, in
 * which case it is reported as 'not_run' and counted as a failure.
 */
export function scoreReliabilityCorpus(plan: readonly PlannedClip[], outcomes: Readonly<Record<string, ClipOutcome>>): CorpusReport {
    const empty = (reason: InputInvalidReason, clipId?: string): CorpusReport => ({
        scoringVersion: STT_RELIABILITY_SCORING.version, normalization: STT_RELIABILITY_SCORING.normalization,
        inputInvalid: { reason, ...(clipId ? { clipId } : {}) }, plannedClips: plan.length, clips: [],
        reliability: { saved: 0, failures: { finalize_failed: 0, save_failed: 0, not_run: 0, empty_transcript: 0 } },
        strictPooledWer: null, diagnosticFailureInclusiveWer: null, pooledWerTarget: STT_RELIABILITY_SCORING.pooledWerTarget,
        qualityGate: { status: 'NOT_EVALUATED', reasons: [`input_invalid:${reason}`] },
    });
    if (plan.length === 0) return empty('empty_plan');
    const ids = new Set<string>();
    for (const clip of plan) {
        if (ids.has(clip.id)) return empty('duplicate_clip_id', clip.id);
        ids.add(clip.id);
        if (clip.kind !== 'speech' && clip.kind !== 'silence') return empty('invalid_clip_kind', clip.id);
        if (!validBinding(clip.audio)) return empty('invalid_audio_binding', clip.id);
        const words = normalizeOfficialTrackA(clip.reference ?? '').length;
        if (clip.kind === 'speech' && words === 0) return empty('missing_reference', clip.id);
        if (clip.kind === 'silence' && words > 0) return empty('reference_on_silence_clip', clip.id);
        const outcome = outcomes[clip.id];
        if (outcome !== undefined && !validOutcome(outcome)) return empty('invalid_outcome', clip.id);
        if (outcome?.status === 'saved'
            && (outcome.playedPcmSha256 !== clip.audio.pcmSha256 || outcome.playedSampleCount !== clip.audio.sampleCount)) {
            return empty('played_audio_mismatch', clip.id);
        }
    }
    const unplanned = Object.keys(outcomes).find(id => !ids.has(id));
    if (unplanned) return empty('unplanned_outcome', unplanned);

    const clips = plan.map(clip => scoreClip(clip, outcomes[clip.id]));
    const failures: Record<ReliabilityFailure, number> = { finalize_failed: 0, save_failed: 0, not_run: 0, empty_transcript: 0 };
    for (const c of clips) if (c.reliabilityFailure) failures[c.reliabilityFailure]++;
    const speech = clips.filter(c => c.werEligible);
    const refWords = speech.reduce((sum, c) => sum + c.referenceWords, 0);
    const scoredErrors = speech.reduce((sum, c) => sum + (c.reliabilityFailure ? 0 : c.substitutions + c.deletions + c.insertions), 0);
    const failedWords = speech.reduce((sum, c) => sum + (c.reliabilityFailure ? c.referenceWords : 0), 0);
    const allSpeechScored = speech.length > 0 && speech.every(c => !c.reliabilityFailure);
    const strictPooledWer = allSpeechScored && refWords > 0 ? scoredErrors / refWords : null;
    const diagnosticFailureInclusiveWer = refWords > 0 ? (scoredErrors + failedWords) / refWords : null;
    const reasons: string[] = [];
    for (const c of clips) {
        if (c.reliabilityFailure) reasons.push(`${c.id}:${c.reliabilityFailure}`);
        if (c.openingWordKept === false) reasons.push(`${c.id}:opening_word_lost`);
        if (c.trailingWordKept === false) reasons.push(`${c.id}:trailing_word_lost`);
        if (c.loops.length > 0) reasons.push(`${c.id}:repetition_loop`);
        if ((c.inventedPrefixTokens ?? 0) >= STT_RELIABILITY_SCORING.inventedPrefixMinTokens) reasons.push(`${c.id}:invented_prefix`);
        if (c.silenceClean === false) reasons.push(`${c.id}:text_on_silence`);
    }
    if (speech.length === 0) reasons.push('no_speech_clips');
    if (strictPooledWer === null) reasons.push('strict_pooled_wer_unavailable');
    else if (!(strictPooledWer < STT_RELIABILITY_SCORING.pooledWerTarget)) reasons.push('pooled_wer_not_below_target');
    return {
        scoringVersion: STT_RELIABILITY_SCORING.version,
        normalization: STT_RELIABILITY_SCORING.normalization,
        inputInvalid: null,
        plannedClips: plan.length,
        clips,
        reliability: { saved: clips.filter(c => !c.reliabilityFailure).length, failures },
        strictPooledWer,
        diagnosticFailureInclusiveWer,
        pooledWerTarget: STT_RELIABILITY_SCORING.pooledWerTarget,
        qualityGate: { status: reasons.length === 0 ? 'PASS' : 'FAIL', reasons },
    };
}
