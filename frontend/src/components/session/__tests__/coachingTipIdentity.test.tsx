import React from 'react';
import { render, screen, cleanup, waitFor, act } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SavedFocusPointsCoverage } from '@/services/objective/savedFocusPointsCoverage';

/**
 * Sam's MVP item 8 (2026-11-16): "the right coaching tip reopens in Open Mic and Focus".
 *
 * Two saved takes of different products, each with its own tip. Reopening either one, in either order, reads that
 * take's own tip and product, and the live review never shows the Open Mic take's tip on the Focus take that follows it.
 * The fake database answers per session id, so a reader that ignored the id would show the other take's tip.
 *
 * Mutants checked when this was written: dropping the reader's id filter fails test 1. In AISuggestions the guards are
 * layered, so one alone survives; ignoring the session in `currentView` AND dropping the reset effect fails tests 2
 * and 3, and ignoring the session in `currentView` AND dropping the `isCurrentRequest()` check fails test 2.
 */
const OPEN_MIC_ID = 'a1b2c3d4-0000-4000-8000-0000000000a1';
const FOCUS_ID = 'a1b2c3d4-0000-4000-8000-0000000000b2';
const OPEN_MIC_TIP = { version: 'gemini_coaching_v1', what_worked: 'Open Mic: the opening was clear.', what_to_try_next: 'Open Mic tip: pause instead of saying um.' };
const FOCUS_TIP = { version: 'gemini_coaching_focus_v1', what_worked: 'Focus: point one landed.', what_to_try_next: 'Focus tip: name point two before the example.' };
const ROWS: Record<string, Record<string, unknown>> = {
    [OPEN_MIC_ID]: { id: OPEN_MIC_ID, ai_suggestions: OPEN_MIC_TIP, transcript_state: 'available', next_action_signal: null, duration: 60, product: 'open_mic' },
    [FOCUS_ID]: { id: FOCUS_ID, ai_suggestions: FOCUS_TIP, transcript_state: 'available', next_action_signal: null, duration: 40, product: 'focus_points' },
};
const COVERAGE: SavedFocusPointsCoverage = {
    kind: 'coverage', detected: 1, total: 2, brief: { briefId: 'b1', projectId: 'p1', topic: 'Launch' },
    points: [{ label: 'One', status: 'detected', detectedAtSeconds: 3 }, { label: 'Two', status: 'not_detected', detectedAtSeconds: null }],
} as SavedFocusPointsCoverage;

const invoke = vi.fn();
function sessions() {
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (column: string, value: unknown) => { filters[column] = value; return chain; },
        // No id filter → the newest saved take (the Focus one): a reader that drops the id shows the wrong tip.
        maybeSingle: () => Promise.resolve({ data: ROWS[String(filters.id ?? FOCUS_ID)] ?? null, error: null }),
    };
    return chain;
}
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({ from: () => sessions(), functions: { invoke } }),
}));
vi.mock('@/services/objective/savedFocusPointsCoverage', () => ({
    loadSavedFocusPointsCoverage: (id: string) => Promise.resolve(id === FOCUS_ID ? COVERAGE : { kind: 'none' }),
}));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

const { loadSavedSessionReview } = await import('@/services/review/savedSessionReview');
const { default: AISuggestions } = await import('@/components/session/AISuggestions');

beforeEach(() => { invoke.mockReset(); invoke.mockImplementation(() => new Promise(() => { /* never answers */ })); });
afterEach(() => cleanup());

describe('the right coaching tip reopens in Open Mic and Focus (MVP item 8)', () => {
    it('reopening each saved take, in either order, gives that take its own tip and product', async () => {
        for (const id of [OPEN_MIC_ID, FOCUS_ID, OPEN_MIC_ID]) {
            const saved = await loadSavedSessionReview(id);
            const own = id === OPEN_MIC_ID ? OPEN_MIC_TIP : FOCUS_TIP;
            expect(saved.loadedSessionId).toBe(id);
            expect(saved.product).toBe(id === OPEN_MIC_ID ? 'open_mic' : 'focus_points');
            expect(saved.coaching).toEqual({ kind: 'review', review: { whatWorked: own.what_worked, whatToTryNext: own.what_to_try_next } });
        }
        expect(invoke, 'reopening never asks for new coaching').not.toHaveBeenCalled();
    });

    it('a live Open Mic tip, even one that answers late, never shows on the Focus take that follows; the Focus take gets its own', async () => {
        // The coaching service answers per session: each take's own tip, as the app requests it.
        let answerOpenMic: (tip: typeof OPEN_MIC_TIP) => void = () => undefined;
        invoke.mockImplementation((_fn: string, { body }: { body: { sessionId: string } }) => (body.sessionId === OPEN_MIC_ID
            ? new Promise((resolve) => { answerOpenMic = (tip) => resolve({ data: { suggestions: tip }, error: null }); })
            : Promise.resolve({ data: { suggestions: FOCUS_TIP }, error: null })));

        const view = render(<AISuggestions transcript="open mic words" canReview sessionId={OPEN_MIC_ID} product="open_mic" />);
        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

        // Products → Focus Points before the Open Mic tip arrives: a new take whose points are still being saved.
        view.rerender(<AISuggestions transcript="focus words" canReview={false} sessionId={FOCUS_ID} product="focus_points" />);
        await act(async () => { answerOpenMic(OPEN_MIC_TIP); });
        expect(screen.queryByText(OPEN_MIC_TIP.what_to_try_next)).not.toBeInTheDocument();
        expect(screen.queryByText(OPEN_MIC_TIP.what_worked)).not.toBeInTheDocument();

        // The Focus take is saved: it asks for and shows its own tip, never the Open Mic one.
        view.rerender(<AISuggestions transcript="focus words" canReview sessionId={FOCUS_ID} product="focus_points" />);
        expect(await screen.findByText(FOCUS_TIP.what_to_try_next)).toBeInTheDocument();
        expect(screen.queryByText(OPEN_MIC_TIP.what_to_try_next)).not.toBeInTheDocument();
        expect(invoke.mock.calls.map(([, { body }]) => [body.sessionId, body.product])).toEqual([[OPEN_MIC_ID, 'open_mic'], [FOCUS_ID, 'focus_points']]);
    });

    it('an Open Mic take that answers in time shows its own tip, and it is gone once the Focus take opens', async () => {
        invoke.mockImplementation(() => Promise.resolve({ data: { suggestions: OPEN_MIC_TIP }, error: null }));
        const view = render(<AISuggestions transcript="open mic words" canReview sessionId={OPEN_MIC_ID} product="open_mic" />);
        expect(await screen.findByText(OPEN_MIC_TIP.what_to_try_next)).toBeInTheDocument();
        view.rerender(<AISuggestions transcript="focus words" canReview={false} sessionId={FOCUS_ID} product="focus_points" />);
        expect(screen.queryByText(OPEN_MIC_TIP.what_to_try_next)).not.toBeInTheDocument();
        expect(screen.queryByText(OPEN_MIC_TIP.what_worked)).not.toBeInTheDocument();
    });
});
