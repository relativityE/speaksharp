/**
 * #1046 Focus Points — view-side coverage derivation.
 *
 * The session-overhaul view watches the growing transcript and needs, at every render, a per-point
 * coverage read for slot C (the count), slot D (the ticking checklist), the transcript coverage
 * highlights, and the after-state evidence. This wraps the SAME local, deterministic keyword matcher the
 * stop-seam uses (`computeObjectiveCoverage` → `mapTalkingPointCoverage`), so nothing leaves the device
 * (Private-only) and the live read agrees with the finalized one.
 *
 * Two view-only concerns live here, not in the service:
 *  - **Timestamps are position-approximated.** The view has the transcript text + elapsed seconds but no
 *    real per-segment timing, so a covering span's second is estimated from its word position across the
 *    elapsed window ("Covered at 0:21"). The persisted RPC evidence is a separate, authoritative path.
 *  - **Covered never un-ticks.** The matcher is effectively monotonic as text grows, but a caller can
 *    pass `latched` (indices already covered this session) to make that a hard guarantee — a tick, once
 *    lit, stays lit even if a later recompute would drop it (spec §6).
 */
import { computeObjectiveCoverage, type TranscriptSegment } from '@/services/objective/objectiveCoverage';
import type { CoverageStatus } from '@/services/rehearsal/outcomeScorecard';
import { emitCoverageEvaluation } from '@/services/telemetry/coverageTelemetry';
import { markCompletionStage } from '@/services/telemetry/completionStages';
import { COVERED_RATIO, PARTIAL_RATIO, extractKeywords } from '@/services/rehearsal/outcomeScorecard';
import { countWords } from '@/lib/contentDigest';

export interface FocusCoverageRow {
    label: string;
    status: CoverageStatus;
    covered: boolean;
    /** Approximate second the covering span landed (position-derived); null when not covered. */
    coveredAtSec: number | null;
    /** The transcript phrase that covered the point; null when not covered. */
    quote: string | null;
}

export interface FocusCoverage {
    rows: FocusCoverageRow[];
    total: number;
    coveredCount: number;
    /** First not-yet-covered point index — the during-state "Still to cover"; null when all covered. */
    nextIndex: number | null;
    /** Covering phrases, in transcript order, for the coverage highlights in slot B. */
    coveredQuotes: string[];
}

/**
 * Split the transcript into sentence-ish segments and assign each an approximate start second from its
 * word position across the elapsed window. Deterministic; empty for empty text.
 */
export function segmentTranscript(text: string, elapsedSeconds: number): TranscriptSegment[] {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return [];
    // Split on sentence terminators but keep the words; fall back to the whole text as one segment.
    const parts = trimmed.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const totalWords = Math.max(1, trimmed.split(/\s+/).length);
    const elapsed = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
    let wordsBefore = 0;
    return parts.map((sentence) => {
        const startSec = Math.round((wordsBefore / totalWords) * elapsed);
        wordsBefore += Math.max(1, sentence.split(/\s+/).length);
        return { text: sentence, startSec };
    });
}

/**
 * Mark the transcript tokens that fall inside a covering phrase, so slot B can highlight coverage (purple
 * during / green after) instead of fillers. Matching is word-normalized and punctuation-tolerant; each
 * quote marks the FIRST contiguous run of tokens it matches. Unmatched quotes simply mark nothing — a
 * missed highlight is fine, a wrong one is not. `filler` is cleared so orange never competes with coverage.
 */
export function markCoveredTokens<T extends { text: string; filler?: boolean }>(
    tokens: T[],
    quotes: string[],
): (T & { covered?: boolean })[] {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']+/g, '');
    const out = tokens.map((t) => ({ ...t, covered: false, filler: false }));
    const nonEmpty = out.map((t, i) => ({ w: norm(t.text), i })).filter((x) => x.w);

    for (const quote of quotes) {
        const qWords = quote.split(/\s+/).map(norm).filter(Boolean);
        if (qWords.length === 0) continue;
        for (let start = 0; start + qWords.length <= nonEmpty.length; start++) {
            let match = true;
            for (let k = 0; k < qWords.length; k++) {
                if (nonEmpty[start + k].w !== qWords[k]) { match = false; break; }
            }
            if (match) {
                const from = nonEmpty[start].i;
                const to = nonEmpty[start + qWords.length - 1].i;
                for (let j = from; j <= to; j++) out[j].covered = true;
                break;
            }
        }
    }
    return out;
}

/**
 * Derive the full Focus Points coverage read for the view. `latched` indices are forced covered so a tick
 * never regresses across renders.
 */
export function deriveFocusCoverage(
    points: string[],
    transcript: string,
    elapsedSeconds: number,
    latched?: Set<number>,
): FocusCoverage {
    const cleanPoints = (points ?? []).filter((p) => (p ?? '').trim() !== '');
    const total = cleanPoints.length;
    if (total === 0) {
        return { rows: [], total: 0, coveredCount: 0, nextIndex: null, coveredQuotes: [] };
    }

    const segments = segmentTranscript(transcript, elapsedSeconds);
    const briefPoints = cleanPoints.map((label, i) => ({ id: `fp-${i}`, label }));
    const { coverage } = computeObjectiveCoverage(briefPoints, segments, elapsedSeconds);

    const rows: FocusCoverageRow[] = coverage.map((c, i) => {
        const latchedCovered = latched?.has(i) ?? false;
        const covered = c.status === 'covered' || latchedCovered;
        return {
            label: cleanPoints[i],
            status: covered ? 'covered' : c.status,
            covered,
            coveredAtSec: covered ? (c.evidence?.timestampSec ?? null) : null,
            quote: covered ? (c.evidence?.quote ?? null) : null,
        };
    });

    // #1259 F06/F14/F18 — emitted HERE, where the ratio, the thresholds and the keyword count are all
    // in scope. Downstream only the verdict survives, and the verdict is precisely what is disputed.
    emitCoverageEvaluation({
        pointsSupplied: (points ?? []).length,
        pointsEvaluated: total,
        coveredThreshold: COVERED_RATIO,
        partialThreshold: PARTIAL_RATIO,
        transcriptWordCount: countWords(transcript),
        observations: coverage.map((c, i) => ({
            position: i,
            matchRatio: typeof c.matchRatio === 'number' ? c.matchRatio : 0,
            // Zero keywords means this point could never match anything the user said.
            keywordCount: extractKeywords(briefPoints[i].label).length,
            verdict: rows[i].status,
            latched: latched?.has(i) ?? false,
        })),
    });

    // #1259 F16 — coverage has a verdict. Only meaningful in the completion chain; during a live
    // session the evaluator runs continuously and the mark is taken once, by markCompletionStage.
    markCompletionStage('evaluation_complete');

    const coveredCount = rows.filter((r) => r.covered).length;
    const nextIndex = rows.findIndex((r) => !r.covered);
    const coveredQuotes = rows.map((r) => r.quote).filter((q): q is string => Boolean(q));

    return {
        rows,
        total,
        coveredCount,
        nextIndex: nextIndex === -1 ? null : nextIndex,
        coveredQuotes,
    };
}
// #1046 reviewer truthfulness: the former deriveMissedReason ("you spent Ns on point X — the time went
// there") was removed. The local keyword engine measures keyword evidence + timestamps, NOT causal time
// allocation, so that sentence overclaimed. An undetected point now simply reads "Not detected" with an
// action for the retry (see FocusPointsRail).
