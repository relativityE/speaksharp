/**
 * #1816 C6 WRONG TAKE ON REOPEN, page level (L3). The Edge-level C6 check (`reopenWrongTake1816.test.ts`) proves the
 * coaching function replays each take's own saved pair. This is the page: reopening a saved take from History renders
 * `SavedPracticeLoopReview` through the REAL `loadSavedSessionReview`, and must show THAT take's saved pair, name that take
 * as the one it was read from, and never call the coaching function.
 *
 * The Supabase double keeps three saved takes and answers a `sessions` read only for the exact id the loader filtered on.
 * The injected fault is a cross-wired store that ignores the id (what the loader would see if its `.eq('id', …)` filter
 * were dropped) and returns the newest saved take; the check must FAIL on it, on the pair and on the identity.
 * All rows and pairs are SYNTHETIC CONTROLS, not model output.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { SavedFocusPointsCoverage } from '@/services/objective/savedFocusPointsCoverage';

const X = '10000000-0000-4000-8000-00000000000a'; // Open Mic (om-01 fixture text)
const Y = '10000000-0000-4000-8000-00000000000b'; // Open Mic (om-03 fixture text)
const F = '10000000-0000-4000-8000-00000000000f'; // Focus (fp-02 fixture text), saved last

const PAIR = {
    [X]: { version: 'gemini_coaching_v1', what_worked: 'Leading with the onboarding checklist result made the update clear.', what_to_try_next: 'Name the verification delay before asking for setup help.' },
    [Y]: { version: 'gemini_coaching_v1', what_worked: 'Opening with renters arguing over the electric bill hooked attention.', what_to_try_next: 'Slow down when you share the pilot results on late payments.' },
    [F]: { version: 'gemini_coaching_focus_v1', what_worked: 'Explaining that glass now goes in the blue bin was clear.', what_to_try_next: 'Add one sentence on why the plant now sorts the glass.' },
} as const;
type TakeId = keyof typeof PAIR;
const row = (id: TakeId, product: 'open_mic' | 'focus_points') => ({
    id, ai_suggestions: PAIR[id], transcript_state: 'available', next_action_signal: null, duration: 60, product,
});
/** Saved in this order: X, Y, then F (the newest). */
const ROWS = [row(X, 'open_mic'), row(Y, 'open_mic'), row(F, 'focus_points')];
const F_COVERAGE: SavedFocusPointsCoverage = {
    kind: 'coverage', detected: 2, total: 3, evidenceRows: 3, brief: { briefId: 'brief-f', projectId: 'proj-f', topic: 'Recycling change' },
    points: [
        { label: 'What changes', status: 'detected', detectedAtSeconds: 3 },
        { label: 'Why it changes', status: 'not_detected', detectedAtSeconds: null },
        { label: 'What to do with old crates', status: 'detected', detectedAtSeconds: 15 },
    ],
};

const store = { crossWired: false, sessionReads: [] as Array<Record<string, unknown>> };
const invoke = vi.fn(() => Promise.reject(new Error('no coaching call on a reopen')));
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        functions: { invoke },
        from: (table: string) => ({
            select: () => {
                const filters: Record<string, unknown> = {};
                const query = {
                    eq: (column: string, value: unknown) => { filters[column] = value; return query; },
                    maybeSingle: () => {
                        if (table !== 'sessions') return Promise.resolve({ data: null, error: null });
                        store.sessionReads.push({ ...filters });
                        const found = store.crossWired ? ROWS[ROWS.length - 1] : ROWS.find((r) => r.id === filters.id);
                        return Promise.resolve({ data: found ?? null, error: null });
                    },
                };
                return query;
            },
        }),
    }),
}));
vi.mock('@/services/objective/savedFocusPointsCoverage', () => ({
    loadSavedFocusPointsCoverage: (id: string) => Promise.resolve(
        (store.crossWired ? ROWS[ROWS.length - 1]?.id : id) === F ? F_COVERAGE : { kind: 'none' },
    ),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock('@/hooks/useLinkedRepeat', () => ({
    useLinkedRepeat: () => ({
        userId: 'owner-1', signedOutByUser: false, recommendationId: null, linkState: 'direct', view: undefined,
        query: { refetch: vi.fn(), isFetching: false, isPending: false, isError: false },
        accept: vi.fn(), accepting: false, actionError: null, retryBlocked: false,
    }),
}));
vi.mock('@/services/reviewSurfaceTelemetry', () => ({
    trackSavedReviewRevisited: vi.fn(), trackSavedReviewPracticeSelected: vi.fn(),
    trackSavedReviewPracticeAction: vi.fn(), trackSavedReviewPracticeState: vi.fn(),
}));
vi.mock('@/stores/useSessionStore', () => ({ useSessionStore: { getState: () => ({ setActiveObjectiveBrief: vi.fn() }) } }));

const { SavedPracticeLoopReview } = await import('../SavedPracticeLoopReview');

beforeEach(() => { store.crossWired = false; store.sessionReads = []; invoke.mockClear(); cleanup(); });

type Verdict = 'PASS' | 'FAIL';
/** The C6 page check: the reopened take's card shows its OWN saved pair, names that take, and calls no coaching. */
function ownPairOnPage(id: TakeId): { verdict: Verdict; why: string[] } {
    const why: string[] = [];
    const card = screen.getByTestId('saved-review');
    if (card.getAttribute('data-review-state') !== 'review') why.push(`no saved pair shown (${card.getAttribute('data-review-state')})`);
    const worked = screen.queryByTestId('review-what-went-well')?.textContent ?? null;
    const next = screen.queryByTestId('review-try-next')?.textContent ?? null;
    if (worked !== PAIR[id].what_worked || next !== PAIR[id].what_to_try_next) why.push('another take\'s coaching was shown');
    if (card.getAttribute('data-session-id') !== id) why.push('the card does not name the reopened take');
    if (invoke.mock.calls.length !== 0) why.push('the coaching function was called on a reopen');
    return { verdict: why.length ? 'FAIL' : 'PASS', why };
}
const settle = () => waitFor(() => expect(screen.getByTestId('saved-review').getAttribute('data-review-state')).not.toBe('loading'));
const log = (entry: Record<string, unknown>) => console.log(`#1816_BOT_CHECK ${JSON.stringify(entry)}`);

describe('#1816 C6 page level: reopening a saved take shows that take\'s own coaching', () => {
    it('X, Y, F, then X again on the same page: each card shows its own saved pair, names its take, and calls no coaching', async () => {
        const { rerender } = render(<SavedPracticeLoopReview sessionId={X} />);
        for (const [id, product] of [[X, 'open_mic'], [Y, 'open_mic'], [F, 'focus_points'], [X, 'open_mic']] as const) {
            rerender(<SavedPracticeLoopReview sessionId={id} />);
            await waitFor(() => expect(screen.getByTestId('saved-review')).toHaveAttribute('data-session-id', id));
            const v = ownPairOnPage(id);
            log({ check: 'C6 page control', take: id.slice(-1), product, verdict: v.verdict, why: v.why });
            expect(v).toEqual({ verdict: 'PASS', why: [] });
            expect(screen.getByTestId('saved-review')).toHaveAttribute('data-product', product);
            // The loader asked for exactly this take.
            expect(store.sessionReads[store.sessionReads.length - 1]).toEqual({ id });
        }
    });

    it('FAULT: a store that ignores the take id shows the newest take\'s coaching on X\'s card, and the check FAILs on pair and identity', async () => {
        store.crossWired = true;
        render(<SavedPracticeLoopReview sessionId={X} />);
        await settle();
        const v = ownPairOnPage(X);
        log({ check: 'C6 page fault (cross-wired store)', take: 'a', verdict: v.verdict, why: v.why });
        expect(v.verdict).toBe('FAIL');
        expect(v.why).toEqual(['another take\'s coaching was shown', 'the card does not name the reopened take']);
    });

    it('FAULT: an Open Mic take swapped for another Open Mic take (same product) is still caught', async () => {
        store.crossWired = true;
        const saved = ROWS.splice(2, 1);
        try {
            render(<SavedPracticeLoopReview sessionId={X} />);
            await settle();
            const v = ownPairOnPage(X);
            log({ check: 'C6 page fault (Open Mic swap)', take: 'a', verdict: v.verdict, why: v.why });
            expect(screen.getByTestId('saved-review')).toHaveAttribute('data-product', 'open_mic');
            expect(v.why).toEqual(['another take\'s coaching was shown', 'the card does not name the reopened take']);
        } finally {
            ROWS.push(...saved);
        }
    });
});
