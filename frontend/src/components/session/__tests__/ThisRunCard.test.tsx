import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '../../../../tests/support/test-utils';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ThisRunCard } from '../ThisRunCard';

/**
 * S-13's rail companion — `THIS RUN`, final, on white, because slot B's ink is the one dark surface per
 * screen. Each metric keeps the colour it carries everywhere else, and an absent measurement is OMITTED:
 * a fabricated `0 fillers` is indistinguishable from a genuinely clean run, which is the flattering lie
 * this page must never tell (G4).
 */
describe('ThisRunCard (S-13 rail)', () => {
    afterEach(cleanup);

    it('states the three rows with their metric colours and units', () => {
        render(<ThisRunCard fillers={6} fillersPerMinute={2.9} wordsPerMinute={122} words={147} />);
        const fillers = screen.getByTestId('this-run-card-fillers');
        expect(fillers).toHaveTextContent('6');
        expect(fillers).toHaveTextContent('2.9/min');
        expect(fillers.querySelector('.text-signature-text')).not.toBeNull();
        expect(screen.getByTestId('this-run-card-pace')).toHaveTextContent('122');
        expect(screen.getByTestId('this-run-card-pace').querySelector('.text-status')).not.toBeNull();
        expect(screen.getByTestId('this-run-card-words')).toHaveTextContent('147');
        expect(screen.getByTestId('this-run-card').textContent).toContain('Counted on device from the transcript.');
    });

    it('CASUALTY: an absent measurement is omitted — never a zero and never an em-dash', () => {
        render(<ThisRunCard fillers={null} fillersPerMinute={null} wordsPerMinute={null} words={147} />);
        expect(screen.queryByTestId('this-run-card-fillers')).toBeNull();
        expect(screen.queryByTestId('this-run-card-pace')).toBeNull();
        const text = screen.getByTestId('this-run-card').textContent ?? '';
        expect(text).not.toContain('—');
        expect(text).not.toMatch(/\b0\b/);
        // The row that IS measured still renders.
        expect(screen.getByTestId('this-run-card-words')).toHaveTextContent('147');
    });

    it('a genuine zero is shown, because a measured zero is a real reading', () => {
        render(<ThisRunCard fillers={0} fillersPerMinute={0} wordsPerMinute={118} words={90} />);
        expect(screen.getByTestId('this-run-card-fillers')).toHaveTextContent('0');
    });

    it('the correction path fires when an opener exists, and is absent otherwise', () => {
        const onCountLookWrong = vi.fn();
        render(<ThisRunCard fillers={6} fillersPerMinute={2.9} wordsPerMinute={122} words={147} onCountLookWrong={onCountLookWrong} />);
        fireEvent.click(screen.getByTestId('this-run-card-count-wrong'));
        expect(onCountLookWrong).toHaveBeenCalledOnce();
        cleanup();
        // A link that opens nothing is worse than an absent one.
        render(<ThisRunCard fillers={6} fillersPerMinute={2.9} wordsPerMinute={122} words={147} />);
        expect(screen.queryByTestId('this-run-card-count-wrong')).toBeNull();
    });

    it('is white — the ink band in slot B is the one dark surface per screen', () => {
        render(<ThisRunCard fillers={1} fillersPerMinute={0.5} wordsPerMinute={100} words={120} />);
        const card = screen.getByTestId('this-run-card');
        expect(card.className).toContain('bg-white');
        expect(card.className).not.toMatch(/\bbg-ink\b/);
    });
});
