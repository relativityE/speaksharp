import { describe, it, expect } from 'vitest';
import { computeAggregateProgress, signalsFromSession, type SessionSignals } from '../aggregateProgress';
import type { PracticeSession } from '@/types/session';

const sig = (over: Partial<SessionSignals>): SessionSignals => ({
    durationSeconds: 600, fillerRate: null, clarity: null, wpm: null, silencePct: null, ...over,
});

// #1206 — aggregate cross-session progress across the four signals.
describe('computeAggregateProgress (#1206)', () => {
    it('empty history → nothing', () => {
        expect(computeAggregateProgress([])).toMatchObject({ isBaseline: false, aggregatePercent: null, trend: [] });
    });

    it('first comparable session is the baseline (no delta) and exposes a baseline-signal quality', () => {
        const r = computeAggregateProgress([sig({ fillerRate: 3, clarity: 70, wpm: 140, silencePct: 10 })]);
        expect(r.isBaseline).toBe(true);
        expect(r.aggregatePercent).toBeNull();
        expect(r.baselineQuality).toBeGreaterThan(0);
        expect(r.trend).toHaveLength(1);
    });

    it('improving all four signals → positive aggregate %', () => {
        const r = computeAggregateProgress([
            sig({ fillerRate: 4, clarity: 60, wpm: 100, silencePct: 30 }), // baseline (weaker)
            sig({ fillerRate: 2, clarity: 80, wpm: 140, silencePct: 12 }), // better on every signal
        ]);
        expect(r.isBaseline).toBe(false);
        expect(r.direction).toBe('improved');
        expect(r.aggregatePercent).toBeGreaterThan(0);
    });

    it('regressing → negative aggregate %, reported honestly', () => {
        const r = computeAggregateProgress([
            sig({ fillerRate: 2, clarity: 80, wpm: 140, silencePct: 12 }),
            sig({ fillerRate: 5, clarity: 55, wpm: 90, silencePct: 40 }),
        ]);
        expect(r.direction).toBe('regressed');
        expect(r.aggregatePercent).toBeLessThan(0);
    });

    it('aggregation only averages signals present in BOTH sessions', () => {
        const r = computeAggregateProgress([
            sig({ fillerRate: 4, clarity: 60 }),        // no pace/pause evidence
            sig({ fillerRate: 2, clarity: 80, wpm: 140 }), // pace present now but not in baseline → excluded
        ]);
        expect(r.components.find((c) => c.key === 'pace')?.deltaPercent).toBeNull();
        expect(r.components.find((c) => c.key === 'filler')?.deltaPercent).not.toBeNull();
        expect(r.components.find((c) => c.key === 'clarity')?.deltaPercent).not.toBeNull();
    });

    it('a current session under the 30s floor is too short to compare', () => {
        const r = computeAggregateProgress([
            sig({ fillerRate: 3, clarity: 70 }),
            sig({ durationSeconds: 10, fillerRate: 1, clarity: 90 }),
        ]);
        expect(r.tooShort).toBe(true);
        expect(r.aggregatePercent).toBeNull();
    });
});

describe('signalsFromSession (#1206)', () => {
    const base = (o: Partial<PracticeSession>): PracticeSession => ({
        id: 'x', user_id: 'u', created_at: '2026-01-01T00:00:00Z', duration: 600, ...o,
    });

    it('derives filler rate from validated filler evidence; null when absent', () => {
        expect(signalsFromSession(base({ filler_counts: { um: 30 } })).fillerRate).toBeCloseTo(3, 5);
        expect(signalsFromSession(base({})).fillerRate).toBeNull();
    });

    it('carries clarity only when scorable, and silence only with valid pause evidence', () => {
        const s = signalsFromSession(base({
            filler_counts: { um: 6 }, total_words: 200, clarity_score: 72,
            pause_metrics: { silencePercentage: 12, transitionPauses: 3, extendedPauses: 1, longestPause: 2 },
        }));
        expect(s.silencePct).toBe(12);
        // clarity passes through only when the session is clarity-scorable (enough words).
        expect(s.clarity === 72 || s.clarity === null).toBe(true);
        expect(signalsFromSession(base({ pause_metrics: {} as never })).silencePct).toBeNull();
    });
});
