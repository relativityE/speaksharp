import * as React from 'react';
import { render, screen, cleanup } from '../../../../tests/support/test-utils';
import { describe, it, expect, afterEach } from 'vitest';
import { ThisRunRail } from '../ThisRunRail';

/**
 * S-10 — slot D in `during`, on ink.
 *
 * The colour assignment is the point and it was wrong in an earlier appendix: the filler count is the one
 * number the user is trying to move, so it takes the accent; pace is context at the SAME size, because the
 * two are read as a pair; and the tip stays neutral, because two yellows on one ink card means neither
 * reads as the emphasis.
 */
describe('ThisRunRail (S-10)', () => {
    afterEach(cleanup);

    it('is the ink ground with the single yellow eyebrow', () => {
        render(<ThisRunRail fillerCount={3} wordsPerMinute={122} tip={null} />);
        const rail = screen.getByTestId('this-run-rail');
        expect(rail.className).toContain('bg-ink');
        expect(rail.className).not.toMatch(/gradient|opacity/);       // flat fill only (G2)
        expect(screen.getByText('This run').className).toContain('text-signature');
    });

    it('CASUALTY: the filler count takes the accent and pace matches its SIZE in white', () => {
        render(<ThisRunRail fillerCount={3} wordsPerMinute={122} tip={null} />);
        const fillers = screen.getByTestId('this-run-fillers');
        const pace = screen.getByTestId('this-run-pace');
        expect(fillers).toHaveTextContent('3');
        expect(fillers.className).toContain('text-signature');
        expect(fillers.className).toContain('text-[40px]');
        expect(pace).toHaveTextContent('122');
        expect(pace.className).toContain('text-ink-text');            // white, not the accent
        expect(pace.className).toContain('text-[40px]');              // the pair is read together
        expect(pace.className).not.toContain('text-[24px]');
    });

    it('CASUALTY: the tip is neutral, not a second yellow', () => {
        render(<ThisRunRail fillerCount={1} wordsPerMinute={100} tip="Finish the thought, then fix it." />);
        const tip = screen.getByTestId('this-run-tip');
        expect(tip).toHaveTextContent('Finish the thought, then fix it.');
        expect(tip.className).toContain('text-ink-text');
        expect(tip.className).not.toContain('text-signature');
    });

    it('one tip, never a stack — and no tip strip when there is nothing to say', () => {
        render(<ThisRunRail fillerCount={0} wordsPerMinute={90} tip="Only this one." />);
        expect(screen.getAllByTestId('this-run-tip')).toHaveLength(1);
        cleanup();
        render(<ThisRunRail fillerCount={0} wordsPerMinute={90} tip="   " />);
        expect(screen.queryByTestId('this-run-tip')).toBeNull();
    });

    it('a live zero is a true reading and is shown; an unstatable pace is omitted, never dashed', () => {
        render(<ThisRunRail fillerCount={0} wordsPerMinute={null} tip={null} />);
        expect(screen.getByTestId('this-run-fillers')).toHaveTextContent('0');
        expect(screen.queryByTestId('this-run-pace')).toBeNull();
        expect(screen.getByTestId('this-run-rail').textContent ?? '').not.toContain('—');
    });
});
