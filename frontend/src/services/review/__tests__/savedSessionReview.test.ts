import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SavedFocusPointsCoverage } from '@/services/objective/savedFocusPointsCoverage';

/**
 * #1258 G20 — the saved review reader. The product follows the SESSION (saved Focus Points results or not), the
 * evidence comes from that product only, and nothing ever asks for a new review.
 */
type Result = { data: unknown; error: unknown };
let row: Result = { data: null, error: null };
let focus: SavedFocusPointsCoverage = { kind: 'none' };
const calls: Array<{ op: string; args: unknown[] }> = [];

function builder() {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq']) chain[op] = (...args: unknown[]) => { calls.push({ op, args }); return chain; };
    chain.maybeSingle = () => Promise.resolve(row);
    return chain;
}
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        from: (table: string) => { calls.push({ op: 'from', args: [table] }); return builder(); },
        functions: { invoke: (name: string) => { calls.push({ op: 'invoke', args: [name] }); return Promise.resolve({ data: null, error: null }); } },
    }),
}));
vi.mock('@/services/objective/savedFocusPointsCoverage', () => ({ loadSavedFocusPointsCoverage: () => Promise.resolve(focus) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

const { loadSavedSessionReview } = await import('../savedSessionReview');

const PAIR = { version: 'gemini_coaching_v1', what_worked: 'Risk-first opening clarified it.', what_to_try_next: 'Pause instead of filling the gap.' };
const SIGNAL = { reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 6.2, comparator: 'above_target', templateVersion: 'rec_v1' };

beforeEach(() => { calls.length = 0; focus = { kind: 'none' }; });

describe('loadSavedSessionReview', () => {
    it('Open Mic: the saved pair, and evidence from the stored measured signal', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60 }, error: null };
        const r = await loadSavedSessionReview('s1');
        expect(r.product).toBe('open_mic');
        expect(r.coaching).toEqual({ kind: 'review', review: { whatWorked: PAIR.what_worked, whatToTryNext: PAIR.what_to_try_next } });
        expect(r.evidence).toEqual(['6.2 filler words a minute, above your target.']);
        expect(calls.slice(0, 3)).toEqual([
            { op: 'from', args: ['sessions'] },
            { op: 'select', args: ['ai_suggestions, transcript_state, next_action_signal, duration'] },
            { op: 'eq', args: ['id', 's1'] },
        ]);
    });

    it('Focus Points: evidence from the saved point results — never the Open Mic filler signal', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 204 }, error: null };
        focus = {
            kind: 'coverage', detected: 1, total: 2,
            points: [{ label: 'One', status: 'detected', detectedAtSeconds: 21 }, { label: 'Two', status: 'not_detected', detectedAtSeconds: null }],
            brief: { briefId: 'b1', projectId: 'p1', topic: 'T' },
        };
        const r = await loadSavedSessionReview('s1');
        expect(r.product).toBe('focus_points');
        expect(r.evidence).toEqual(['Detected: point 1 at 0:21.', 'Not detected: point 2.', 'Recorded for 3:24.']);
        expect(r.evidence.join(' ')).not.toMatch(/filler/);
        expect(r.focusBrief).toEqual({ briefId: 'b1', projectId: 'p1', topic: 'T' });
        expect(r.focusPoints).toEqual(['One', 'Two']);
    });

    it('a failed Focus Points read shows no evidence rather than the wrong product’s', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60 }, error: null };
        focus = { kind: 'error' };
        const r = await loadSavedSessionReview('s1');
        expect(r.product).toBe('unknown');
        expect(r.evidence).toEqual([]);
    });

    it('states: expired with the transcript, none saved, invalid stored value, failed read', async () => {
        row = { data: { ai_suggestions: null, transcript_state: 'expired' }, error: null };
        expect((await loadSavedSessionReview('s1')).coaching).toEqual({ kind: 'expired' });
        row = { data: { ai_suggestions: null, transcript_state: 'available' }, error: null };
        expect((await loadSavedSessionReview('s1')).coaching).toEqual({ kind: 'none' });
        row = { data: { ai_suggestions: { what_worked: 'half' }, transcript_state: 'available' }, error: null };
        expect((await loadSavedSessionReview('s1')).coaching).toEqual({ kind: 'error' });
        row = { data: null, error: { code: '42501' } };
        expect((await loadSavedSessionReview('s1')).coaching).toEqual({ kind: 'error' });
    });

    it('NEVER generates a review: no function is invoked, whatever the row holds', async () => {
        for (const data of [{ ai_suggestions: PAIR }, { ai_suggestions: null }, { ai_suggestions: null, transcript_state: 'expired' }]) {
            row = { data, error: null };
            await loadSavedSessionReview('s1');
        }
        expect(calls.filter((c) => c.op === 'invoke')).toEqual([]);
    });
});
