import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SavedFocusPointsCoverage } from '@/services/objective/savedFocusPointsCoverage';

/**
 * #1258 G20 — the saved review reader. The product follows the SESSION (saved Focus Points results or not), the
 * evidence comes from that product only, and nothing ever asks for a new review.
 */
type Result = { data: unknown; error: unknown };
let row: Result = { data: null, error: null };
/** Answers to successive `sessions` reads BEFORE `row` (models the pre-migration missing-column retry). */
let sessionsQueue: Result[] = [];
/** `objective_source_recording` — the durable "this was a Focus take" row, read only for legacy (unmarked) sessions. */
let source: Result = { data: null, error: null };
let focus: SavedFocusPointsCoverage = { kind: 'none' };
const calls: Array<{ op: string; args: unknown[] }> = [];

function builder(table: string) {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq']) chain[op] = (...args: unknown[]) => { calls.push({ op, args }); return chain; };
    chain.maybeSingle = () => {
        const r = table === 'objective_source_recording' ? source : (sessionsQueue.length ? sessionsQueue.shift()! : row);
        return (r as { throws?: boolean }).throws ? Promise.reject(new Error('network')) : Promise.resolve(r);
    };
    return chain;
}
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        from: (table: string) => { calls.push({ op: 'from', args: [table] }); return builder(table); },
        functions: { invoke: (name: string) => { calls.push({ op: 'invoke', args: [name] }); return Promise.resolve({ data: null, error: null }); } },
    }),
}));
vi.mock('@/services/objective/savedFocusPointsCoverage', () => ({ loadSavedFocusPointsCoverage: () => Promise.resolve(focus) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

const { loadSavedSessionReview, FOCUS_RESULTS_NOT_SAVED } = await import('../savedSessionReview');

const PAIR = { version: 'gemini_coaching_v1', what_worked: 'Risk-first opening clarified it.', what_to_try_next: 'Pause instead of filling the gap.' };
const SIGNAL = { reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 6.2, comparator: 'above_target', templateVersion: 'rec_v1' };

beforeEach(() => { calls.length = 0; focus = { kind: 'none' }; sessionsQueue = []; source = { data: null, error: null }; });
const tablesRead = () => calls.filter((c) => c.op === 'from').map((c) => c.args[0]);

describe('loadSavedSessionReview', () => {
    it('Open Mic (durable marker): the saved pair, and evidence from the stored measured signal', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60, product: 'open_mic' }, error: null };
        const r = await loadSavedSessionReview('s1');
        expect(r.product).toBe('open_mic');
        expect(r.coaching).toEqual({ kind: 'review', review: { whatWorked: PAIR.what_worked, whatToTryNext: PAIR.what_to_try_next } });
        expect(r.evidence).toEqual(['6.2 filler words a minute, above your target.']);
        expect(calls.slice(0, 3)).toEqual([
            { op: 'from', args: ['sessions'] },
            { op: 'select', args: ['ai_suggestions, transcript_state, next_action_signal, duration, product'] },
            { op: 'eq', args: ['id', 's1'] },
        ]);
        expect(tablesRead(), 'a marked session needs no legacy source read').not.toContain('objective_source_recording');
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

    // #1577 Codex P2 4236239714: readiness for a coaching retry mirrors the function's rule (points AND >= 1 evidence row).
    it.each([[2, true], [0, false]] as const)('CASUALTY (Codex 4236239714): %s saved evidence rows → focusEvidenceSaved %s', async (rows, saved) => {
        row = { data: { ai_suggestions: null, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60, product: 'focus_points' }, error: null };
        focus = {
            kind: 'coverage', detected: 0, total: 1, evidenceRows: rows,
            points: [{ label: 'One', status: 'unavailable', detectedAtSeconds: null }],
            brief: { briefId: 'b1', projectId: 'p1', topic: 'T' },
        };
        const r = await loadSavedSessionReview('s1');
        expect([r.product, r.focusEvidenceSaved]).toEqual(['focus_points', saved]);
    });

    // #1535 Codex P2 r4112111974 — the product is never inferred from an ABSENCE of Focus rows.
    it('CASUALTY: marked focus_points with NO saved results is Focus Points (results not saved) — never Open Mic, no brief', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60, product: 'focus_points' }, error: null };
        const r = await loadSavedSessionReview('s1');
        expect(r).toMatchObject({ product: 'focus_points', evidence: [FOCUS_RESULTS_NOT_SAVED], focusBrief: null, focusPoints: [] });
        expect(r.evidence.join(' ')).not.toMatch(/filler/);
    });

    it('CASUALTY (legacy, no marker): a durable source-recording row makes it Focus Points (results not saved)', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60, product: null }, error: null };
        source = { data: { session_id: 's1' }, error: null };
        const r = await loadSavedSessionReview('s1');
        expect(r).toMatchObject({ product: 'focus_points', evidence: [FOCUS_RESULTS_NOT_SAVED], focusBrief: null });
    });

    it('CASUALTY (legacy, no marker, no Focus row): UNKNOWN — never guessed as Open Mic, no evidence', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60, product: null }, error: null };
        const r = await loadSavedSessionReview('s1');
        expect(r).toMatchObject({ product: 'unknown', evidence: [], focusBrief: null });
    });

    it('a failed source-recording read is UNKNOWN (no evidence), never Open Mic', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60 }, error: null };
        source = { data: null, error: { code: '42501' } };
        expect(await loadSavedSessionReview('s1')).toMatchObject({ product: 'unknown', evidence: [] });
    });

    it('before the marker migration is applied (column missing): reads the row without it and treats it as legacy', async () => {
        sessionsQueue = [{ data: null, error: { code: '42703', message: 'column sessions.product does not exist' } }];
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60 }, error: null };
        const r = await loadSavedSessionReview('s1');
        expect(r.coaching).toEqual({ kind: 'review', review: { whatWorked: PAIR.what_worked, whatToTryNext: PAIR.what_to_try_next } });
        expect(r.product).toBe('unknown');
        expect(calls.filter((c) => c.op === 'select' && c.args[0] !== 'session_id').map((c) => c.args[0])).toEqual([
            'ai_suggestions, transcript_state, next_action_signal, duration, product',
            'ai_suggestions, transcript_state, next_action_signal, duration',
        ]);
    });

    it('a failed Focus Points read shows no evidence rather than the wrong product’s', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60 }, error: null };
        focus = { kind: 'error' };
        const r = await loadSavedSessionReview('s1');
        expect(r.product).toBe('unknown');
        expect(r.evidence).toEqual([]);
    });

    // PM RETURN 5849471237 — the stored marker is the product identity; a failed Focus results read never erases it.
    it('CASUALTY: marked focus_points + a failed Focus results read stays Focus Points (read failed, no point set) — never unknown/Open Mic', async () => {
        // #1538: a Focus take's coaching is Focus-provenance (focus_v1); a generic v1 pair would be `unverified`.
        row = { data: { ai_suggestions: { ...PAIR, version: 'gemini_coaching_focus_v1' }, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60, product: 'focus_points' }, error: null };
        focus = { kind: 'error' };
        const r = await loadSavedSessionReview('s1');
        expect(r).toEqual({
            coaching: { kind: 'review', review: { whatWorked: PAIR.what_worked, whatToTryNext: PAIR.what_to_try_next } },
            product: 'focus_points', evidence: [], focusBrief: null, focusPoints: [], focusReadFailed: true,
        });
        expect(tablesRead(), 'a marked session needs no legacy source read').not.toContain('objective_source_recording');
    });

    // #1535 Codex P2 r4116626850: the saved results render, but the point set could not be read — retry, never setup.
    it.each([['focus_points'], [null]] as const)('CASUALTY: a failed BRIEF read (%s marker) keeps the saved results visible but is a retryable read failure', async (product) => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 204, product }, error: null };
        focus = {
            kind: 'coverage', detected: 1, total: 2, briefReadFailed: true, brief: null,
            points: [{ label: 'One', status: 'detected', detectedAtSeconds: 21 }, { label: 'Two', status: 'not_detected', detectedAtSeconds: null }],
        };
        const r = await loadSavedSessionReview('s1');
        expect(r).toMatchObject({ product: 'focus_points', focusBrief: null, focusReadFailed: true });
        expect(r.evidence).toEqual(['Detected: point 1 at 0:21.', 'Not detected: point 2.', 'Recorded for 3:24.']);
    });

    it('CONTROL: a genuinely absent brief (no read failure) is NOT a read failure — practice opens Focus setup as before', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 204, product: 'focus_points' }, error: null };
        focus = { kind: 'coverage', detected: 1, total: 1, brief: null, points: [{ label: 'One', status: 'detected', detectedAtSeconds: 21 }] };
        const r = await loadSavedSessionReview('s1');
        expect(r).toMatchObject({ product: 'focus_points', focusBrief: null });
        expect(r.focusReadFailed).toBeUndefined();
    });

    it('CASUALTY: marked open_mic + a failed Focus results read stays Open Mic with its own evidence', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60, product: 'open_mic' }, error: null };
        focus = { kind: 'error' };
        const r = await loadSavedSessionReview('s1');
        expect(r).toMatchObject({ product: 'open_mic', evidence: ['6.2 filler words a minute, above your target.'], focusBrief: null });
        expect(r.focusReadFailed).toBeUndefined();
    });

    it('CASUALTY: legacy NULL + a failed Focus results read stays UNKNOWN (never Focus, never Open Mic)', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60, product: null }, error: null };
        focus = { kind: 'error' };
        source = { data: { session_id: 's1' }, error: null };
        const r = await loadSavedSessionReview('s1');
        expect(r).toMatchObject({ product: 'unknown', evidence: [], focusBrief: null });
        expect(r.focusReadFailed).toBeUndefined();
    });

    // #1535 Codex P2 r4116859975: a FAILED review read is not a legacy session — it is a retryable read failure.
    it('CASUALTY: a failed or empty session read is a retryable REVIEW read failure (never a product choice)', async () => {
        row = { data: null, error: { code: '503' } };
        expect(await loadSavedSessionReview('s1')).toMatchObject({ coaching: { kind: 'error' }, product: 'unknown', reviewReadFailed: true });
        row = { data: null, error: null };
        expect(await loadSavedSessionReview('s1')).toMatchObject({ product: 'unknown', reviewReadFailed: true });
        row = { data: null, error: null, throws: true } as Result;
        expect(await loadSavedSessionReview('s1')).toMatchObject({ product: 'unknown', reviewReadFailed: true });
    });

    it('CONTROL: a readable legacy (unmarked) session is unknown WITHOUT a read failure', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60, product: null }, error: null };
        const r = await loadSavedSessionReview('s1');
        expect(r.product).toBe('unknown');
        expect(r.reviewReadFailed).toBeUndefined();
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

    // #1538 (Codex P1 r4117321439, PM 5860714332): a Focus take's stored generic v1 pair is NOT Focus-aware coaching.
    const COVERAGE = {
        kind: 'coverage' as const, detected: 1, total: 2, brief: { briefId: 'b1', projectId: 'p1', topic: 'T' },
        points: [{ label: 'One', status: 'detected' as const, detectedAtSeconds: 21 }, { label: 'Two', status: 'not_detected' as const, detectedAtSeconds: null }],
    };
    it('CASUALTY: a Focus take holding an old generic v1 pair shows it as UNVERIFIED, never as a Focus review (evidence kept)', async () => {
        for (const product of ['focus_points', null] as const) {
            row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 204, product }, error: null };
            focus = COVERAGE;
            const r = await loadSavedSessionReview('s1');
            expect(r.product).toBe('focus_points');
            expect(r.coaching).toEqual({ kind: 'unverified' });
            expect(r.evidence.length).toBeGreaterThan(0);
        }
    });

    it('CONTROL: a Focus take holding a focus_v1 pair shows the review unchanged', async () => {
        row = { data: { ai_suggestions: { ...PAIR, version: 'gemini_coaching_focus_v1' }, transcript_state: 'available', next_action_signal: SIGNAL, duration: 204, product: 'focus_points' }, error: null };
        focus = COVERAGE;
        expect((await loadSavedSessionReview('s1')).coaching).toEqual({ kind: 'review', review: { whatWorked: PAIR.what_worked, whatToTryNext: PAIR.what_to_try_next } });
    });

    it('CONTROL: an Open Mic take holding a v1 pair shows the review unchanged', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 60, product: 'open_mic' }, error: null };
        expect((await loadSavedSessionReview('s1')).coaching).toEqual({ kind: 'review', review: { whatWorked: PAIR.what_worked, whatToTryNext: PAIR.what_to_try_next } });
    });

    it('CONTROL: reloading the unverified state generates nothing (read-only)', async () => {
        row = { data: { ai_suggestions: PAIR, transcript_state: 'available', next_action_signal: SIGNAL, duration: 204, product: 'focus_points' }, error: null };
        focus = COVERAGE;
        await loadSavedSessionReview('s1');
        await loadSavedSessionReview('s1');
        expect(calls.filter((c) => c.op === 'invoke')).toEqual([]);
    });

    it('NEVER generates a review: no function is invoked, whatever the row holds', async () => {
        for (const data of [{ ai_suggestions: PAIR }, { ai_suggestions: null }, { ai_suggestions: null, transcript_state: 'expired' }]) {
            row = { data, error: null };
            await loadSavedSessionReview('s1');
        }
        expect(calls.filter((c) => c.op === 'invoke')).toEqual([]);
    });
});
