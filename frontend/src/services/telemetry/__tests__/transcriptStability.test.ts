import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import {
    noteTranscriptUpdate, emitTranscriptStability, rewrittenPrefixWords,
    __resetTranscriptStabilityForTests,
} from '../transcriptStability';
import { useSessionStore } from '@/stores/useSessionStore';
import { projectEventProps } from '../../telemetryAllowlist';
import { beginJourney, __resetJourneyIdentityForTests } from '../journeyIdentity';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const rows = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => c[0] === 'transcript_stability').map((c) => c[1] as Record<string, unknown>);
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

beforeEach(() => {
    vi.clearAllMocks();
    __resetTranscriptStabilityForTests();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});
afterEach(() => vi.useRealTimers());

describe('F04 — churn is motion, and only a summary of it may travel', () => {
    it('APPENDING is not a revision — a growing transcript is doing its job', () => {
        // Counting appends as instability would make every session look churny and the signal useless.
        expect(rewrittenPrefixWords('the quarterly numbers', 'the quarterly numbers moved up')).toBe(0);
        expect(rewrittenPrefixWords('', 'first words')).toBe(0);
    });

    it('measures how far back a rewrite reached — the distance the reader must re-read', () => {
        // Four words were already on screen and three of them changed.
        expect(rewrittenPrefixWords('one two three four', 'one nine eight seven')).toBe(3);
        expect(rewrittenPrefixWords('one two three four', 'nine')).toBe(4);
    });

    it('separates provisional updates from committed ones', () => {
        noteTranscriptUpdate('', 'so');
        noteTranscriptUpdate('', 'so basic');
        noteTranscriptUpdate('so basically', '');
        emitTranscriptStability('so basically', '');
        drain();
        const r = rows()[0];
        expect(r.provisional_updates).toBe(2);
        expect(r.final_updates).toBe(1);
        // A provisional word being replaced is what provisional MEANS; it is not what was complained of.
        expect(r.revisions).toBe(0);
    });

    it('THE FINDING: committed text changing after the user has read it', () => {
        noteTranscriptUpdate('the cache works well', '');
        noteTranscriptUpdate('the cash works well', '');     // the real mis-transcription, rewritten
        emitTranscriptStability('the cash works well', '');
        drain();
        const r = rows()[0];
        expect(r.revisions).toBe(1);
        expect(r.max_rewritten_prefix_words).toBe(3);
    });

    it('keeps the WORST rewrite, not the last one', () => {
        noteTranscriptUpdate('a b c d e', '');
        noteTranscriptUpdate('a z y x w', '');   // 4 words rewritten
        noteTranscriptUpdate('a z y x q', '');   // 1 word rewritten
        emitTranscriptStability('a z y x q', '');
        drain();
        // A single deep rewrite is the distracting event; averaging or overwriting would hide it.
        expect(rows()[0].max_rewritten_prefix_words).toBe(4);
        expect(rows()[0].revisions).toBe(2);
    });

    it('reports ONE row per take, not one per update', () => {
        for (let i = 0; i < 200; i += 1) noteTranscriptUpdate(`w${i}`, 'p');
        emitTranscriptStability('w199', '');
        drain();
        // 200 updates, one event. An event per update is the per-frame stream the contract forbids.
        expect(rows()).toHaveLength(1);
        expect(rows()[0].final_updates).toBe(200);
    });

    it('emits nothing when there was no take', () => {
        expect(emitTranscriptStability('', '')).toBe(false);
        drain();
        expect(rows()).toHaveLength(0);
    });

    it('measures time to stability from first update to last CHANGE', () => {
        vi.useFakeTimers();
        noteTranscriptUpdate('one', '');
        vi.advanceTimersByTime(5_000);
        noteTranscriptUpdate('one two', '');
        vi.advanceTimersByTime(9_000);
        noteTranscriptUpdate('one two', 'still interim');   // no committed change
        emitTranscriptStability('one two', '');
        drain();
        // The clock stops when the committed text stops moving, not when updates stop arriving.
        expect(rows()[0].ms_to_stable).toBe(5_000);
    });

    it('carries no transcript text', () => {
        noteTranscriptUpdate('so basically the quarterly numbers moved', '');
        emitTranscriptStability('so basically the quarterly numbers moved', 'and uh');
        drain();
        const serialized = JSON.stringify(rows()[0]);
        for (const word of ['basically', 'quarterly', 'numbers', 'moved', 'uh']) {
            expect(serialized).not.toContain(word);
        }
    });

    it('PRODUCER: the real store counts updates and reports at finalization', () => {
        useSessionStore.setState({ isTranscriptFinalizing: false, transcript: { transcript: '', partial: '' } });
        useSessionStore.getState().updateTranscript('the cache works', '');
        useSessionStore.getState().updateTranscript('the cash works', '');
        useSessionStore.getState().setTranscriptFinalizing(true);
        useSessionStore.getState().setTranscriptFinalizing(false);
        drain();
        // The emitter's own tests pass whether or not the store calls it.
        expect(rows()).toHaveLength(1);
        expect(rows()[0].revisions).toBeGreaterThan(0);
    });

    it('every field survives the schema', () => {
        const { props, dropped } = projectEventProps('transcript_stability', {
            provisional_updates: 200, final_updates: 40, revisions: 3,
            max_rewritten_prefix_words: 12, ms_to_stable: 5_000,
            visible_final_words: 88, visible_provisional_words: 0,
        });
        expect(dropped).toEqual([]);
        expect(Object.keys(props)).toHaveLength(7);
    });
});
