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
    /** For a missed point: where the time went ("You spent 38s on point 1 — the time went there"). */
    missedReason: string | null;
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
        return { rows: [], total: 0, coveredCount: 0, nextIndex: null, missedReason: null, coveredQuotes: [] };
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

    const coveredCount = rows.filter((r) => r.covered).length;
    const nextIndex = rows.findIndex((r) => !r.covered);
    const coveredQuotes = rows.map((r) => r.quote).filter((q): q is string => Boolean(q));

    return {
        rows,
        total,
        coveredCount,
        nextIndex: nextIndex === -1 ? null : nextIndex,
        missedReason: deriveMissedReason(rows, elapsedSeconds),
        coveredQuotes,
    };
}

/**
 * "Where did the time go?" — for the missed point, name the covered point that consumed the most time,
 * derived from the gaps between coverage events. Returns null when nothing is missed or nothing is
 * covered (no basis for the sentence). Only the single largest-consumer point is named (spec §3).
 */
function deriveMissedReason(rows: FocusCoverageRow[], elapsedSeconds: number): string | null {
    const missing = rows.some((r) => !r.covered);
    if (!missing) return null;

    const coveredWithTime = rows
        .map((r, i) => ({ i, at: r.coveredAtSec }))
        .filter((x): x is { i: number; at: number } => x.at != null)
        .sort((a, b) => a.at - b.at);
    if (coveredWithTime.length === 0) return null;

    const end = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : coveredWithTime[coveredWithTime.length - 1].at;
    let worst = { pointNumber: coveredWithTime[0].i + 1, seconds: 0 };
    for (let k = 0; k < coveredWithTime.length; k++) {
        const start = coveredWithTime[k].at;
        const next = k + 1 < coveredWithTime.length ? coveredWithTime[k + 1].at : end;
        const spent = Math.max(0, Math.round(next - start));
        if (spent > worst.seconds) worst = { pointNumber: coveredWithTime[k].i + 1, seconds: spent };
    }
    if (worst.seconds <= 0) return null;
    return `Never came up. You spent ${worst.seconds} seconds on point ${worst.pointNumber} — the time went there.`;
}
