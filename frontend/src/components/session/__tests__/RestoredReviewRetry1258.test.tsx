/**
 * #1258 (Rev 2 §4.2; PO 2026-10-09) — Try again on a reopened session with no saved coaching. Nothing is requested on
 * render; only the press mounts AISuggestions for THIS saved session. A session whose transcript is no longer kept gets
 * the terminal message and no button — never a fake retry.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mounted = vi.fn();
vi.mock('../AISuggestions', () => ({
    default: (props: Record<string, unknown>) => { mounted(props); return <div data-testid="ai-suggestions-stub" />; },
}));

const { RestoredReviewRetry } = await import('../RestoredReviewRetry');

beforeEach(() => mounted.mockReset());

describe('RestoredReviewRetry', () => {
    it('transcript kept: the failed band with Try again; nothing is requested until the press, then ONE review for this session', () => {
        render(<RestoredReviewRetry sessionId="s-9" product="open_mic" sessionLabel="7 Oct, 18:12" transcriptAvailable />);
        expect(screen.getByTestId('restored-review-retry')).toHaveTextContent("The review didn't load. Your session is saved.");
        expect(screen.getByTestId('restored-review-retry')).toHaveTextContent("Sends this session's transcript to Google Gemini");
        expect(mounted).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('restored-review-retry-button'));
        expect(screen.getByTestId('ai-suggestions-stub')).toBeInTheDocument();
        expect(mounted).toHaveBeenLastCalledWith(expect.objectContaining({ canReview: true, sessionId: 's-9', product: 'open_mic', sessionLabel: '7 Oct, 18:12' }));
        expect(screen.queryByTestId('restored-review-retry-button')).toBeNull();
    });

    it('CASUALTY (Codex 4235188535): the practice action stays before AND after Try again', () => {
        render(<RestoredReviewRetry sessionId="s-9" product="open_mic" transcriptAvailable action={<button data-testid="practice-again">Practice again?</button>} />);
        expect(screen.getByTestId('practice-again')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('restored-review-retry-button'));
        expect([screen.queryByTestId('ai-suggestions-stub') !== null, screen.queryByTestId('practice-again') !== null]).toEqual([true, true]);
    });

    // #1577 Codex P2 4235535990: AISuggestions has no ground of its own, so the requested review (loading, failure and
    // success alike) must stay on the same ink review surface, with the practice action.
    it('CASUALTY (Codex 4235535990): the requested review stays on the ink review surface, with the practice action', () => {
        render(<RestoredReviewRetry sessionId="s-9" product="open_mic" transcriptAvailable action={<button data-testid="practice-again">Practice again?</button>} />);
        fireEvent.click(screen.getByTestId('restored-review-retry-button'));
        const surface = screen.getByTestId('ai-suggestions-stub').closest('section');
        expect([surface?.getAttribute('data-testid'), surface?.className.includes('bg-ink'), surface?.contains(screen.getByTestId('practice-again'))])
            .toEqual(['restored-review-requested', true, true]);
    });

    // #1577 Codex P2 4235535994: with no resolved product the coaching function answers product_unknown (422), so a retry
    // could never generate coaching: terminal, no button, no claimed send, no request. Open Mic and Focus still retry.
    it.each([
        ['open_mic', true, "Sends this session's transcript to Google Gemini"],
        ['focus_points', true, 'your Focus Points topic and points'],
        [null, false, null],
    ] as const)('CASUALTY (Codex 4235535994): product %s → Try again offered: %s', (product, offered, disclosure) => {
        render(<RestoredReviewRetry sessionId="s-9" product={product} transcriptAvailable action={<button data-testid="practice-again">Practice again?</button>} />);
        const band = screen.getByTestId('restored-review-retry');
        expect([screen.queryAllByTestId('restored-review-retry-button').length, band.textContent?.includes('Google Gemini')])
            .toEqual([offered ? 1 : 0, offered]);
        expect(disclosure === null || band.textContent?.includes(disclosure)).toBe(true);
        expect(screen.queryAllByTestId('restored-review-not-available').length).toBe(offered ? 0 : 1);
        expect(screen.getByTestId('practice-again')).toBeInTheDocument();
        expect(mounted).not.toHaveBeenCalled();
    });

    it('Focus Points: the disclosure names the topic and points it sends', () => {
        render(<RestoredReviewRetry sessionId="s-9" product="focus_points" transcriptAvailable />);
        expect(screen.getByTestId('restored-review-retry')).toHaveTextContent('your Focus Points topic and points');
    });

    it('CASUALTY: transcript no longer kept → "Review isn\'t available for this session", no button, nothing requested', () => {
        render(<RestoredReviewRetry sessionId="s-9" product="open_mic" transcriptAvailable={false} />);
        expect(screen.getByTestId('restored-review-not-available')).toHaveTextContent("Review isn't available for this session.");
        expect(screen.queryByRole('button')).toBeNull();
        expect(mounted).not.toHaveBeenCalled();
    });
});
