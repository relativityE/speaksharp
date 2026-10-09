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
