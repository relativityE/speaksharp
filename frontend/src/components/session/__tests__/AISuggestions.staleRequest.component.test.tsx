/**
 * #1258 (RWT runs 37547966019 and 37550720328) — the card lost its own answer.
 *
 * In both Production runs `get-ai-suggestions` received exactly one request for the saved take and answered it
 * (503 at +8 s in the first run, two valid phrases at +25 s in the second), while the RWT receipt recorded the card
 * as `empty`. These cases probe whether the card can lose an in-flight answer across session-id transitions.
 * Diagnostic only: the readiness fix is F4; see the slow-answer E2E for the real session page.
 */
import React from 'react';
import { render, screen, cleanup, waitFor } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AISuggestions from '@/components/session/AISuggestions';
import { getSupabaseClient } from '@/lib/supabaseClient';

vi.mock('@/lib/supabaseClient');

const invoke = vi.fn();
const OK = {
    data: { suggestions: { version: 'gemini_coaching_v1', what_worked: 'Clear opening on the plan.', what_to_try_next: 'Pause before each main point.' } },
    error: null,
};
const deferred = () => {
    let resolve!: (value: unknown) => void;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
};
const card = () => screen.getByTestId('ai-suggestions-headline').closest('[data-review-state]') as HTMLElement;

describe('#1258 — an in-flight review survives the session page\'s id transitions', () => {
    beforeEach(() => {
        invoke.mockReset();
        vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as unknown as ReturnType<typeof getSupabaseClient>);
    });
    afterEach(() => { cleanup(); vi.clearAllMocks(); });

    /**
     * KNOWN VULNERABILITY, NOT FIXED HERE (diagnostic branch). On main the answer is discarded (the generation guard marks
     * the request stale) and the card never re-asks, so this case FAILS; `it.fails` records that without breaking CI.
     * Not shown to occur in Production: the session page publishes one id per save (SpeechRuntimeController), and the
     * 2026-10-07 runs are explained by the spec reading the pre-request `empty` instant (F4). Flip to `it` with a fix.
     */
    it.fails('CASUALTY: the id blips to undefined and back while the one request is in flight — the answer still renders', async () => {
        const first = deferred();
        invoke.mockImplementationOnce(() => first.promise).mockResolvedValue(OK);
        const { rerender } = render(<AISuggestions transcript="Hello world" canReview sessionId="s1" />);
        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

        rerender(<AISuggestions transcript="Hello world" canReview={false} sessionId={undefined} />);
        rerender(<AISuggestions transcript="Hello world" canReview sessionId="s1" />);
        first.resolve(OK);

        expect(await screen.findByText('Clear opening on the plan.')).toBeInTheDocument();
        expect(card()).toHaveAttribute('data-review-state', 'ready');
        // One generation for one take: a re-request is acceptable only if the first answer was really lost.
        expect(invoke.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('CONTROL: readiness blips (same id) while in flight — the answer renders', async () => {
        const first = deferred();
        invoke.mockImplementationOnce(() => first.promise);
        const { rerender } = render(<AISuggestions transcript="Hello world" canReview sessionId="s1" />);
        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
        rerender(<AISuggestions transcript="Hello world" canReview={false} sessionId="s1" />);
        rerender(<AISuggestions transcript="Hello world" canReview sessionId="s1" />);
        first.resolve(OK);
        expect(await screen.findByText('Clear opening on the plan.')).toBeInTheDocument();
    });

    it('CONTROL: a remount while in flight — the new card asks again and renders', async () => {
        invoke.mockImplementationOnce(() => new Promise(() => { /* the old card's request never settles */ })).mockResolvedValue(OK);
        const first = render(<AISuggestions transcript="Hello world" canReview sessionId="s1" />);
        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
        first.unmount();
        render(<AISuggestions transcript="Hello world" canReview sessionId="s1" />);
        expect(await screen.findByText('Clear opening on the plan.')).toBeInTheDocument();
    });
});
