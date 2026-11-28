import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ConfidencePostCard, ConfidencePreCard } from '../ConfidenceCheck';
import { youSaidText } from '@/services/confidenceCheck/youSaidText';

const FORBIDDEN = /improv|because|caused|proves?|great|well done|better|worse|confident score/i;

describe('confidence check cards', () => {
    it('pre card: starting a loop is its own choice; only then the exact question, 1-5 labels, Skip and the session-only note', () => {
        const onAnswer = vi.fn(); const onStartLoop = vi.fn();
        const { rerender } = render(<ConfidencePreCard loopStarted={false} pre={null} onStartLoop={onStartLoop} onAnswer={onAnswer} />);
        expect(screen.queryByTestId('confidence-pre-rating')).toBeNull();
        expect(screen.getByTestId('confidence-pre')).not.toHaveTextContent('How ready');
        fireEvent.click(screen.getByTestId('confidence-start-loop'));
        expect(onStartLoop).toHaveBeenCalledTimes(1);
        expect(onAnswer).not.toHaveBeenCalled();
        rerender(<ConfidencePreCard loopStarted pre={null} onStartLoop={onStartLoop} onAnswer={onAnswer} />);
        const card = screen.getByTestId('confidence-pre');
        expect(card).toHaveTextContent('How ready would you feel to give this presentation now?');
        expect(card).toHaveTextContent('Optional. Your answer stays on this device for this session only.');
        for (const label of ['1 · Not ready', '2 · A little', '3 · Somewhat', '4 · Mostly', '5 · Fully ready']) expect(card).toHaveTextContent(label);
        fireEvent.click(screen.getByTestId('confidence-pre-rating-4'));
        expect(onAnswer).toHaveBeenCalledWith(4);
        fireEvent.click(screen.getByTestId('confidence-pre-skip'));
        expect(onAnswer).toHaveBeenCalledWith('skipped');
        expect(card).not.toHaveTextContent(FORBIDDEN);
    });

    it('post card: readiness first; the target chips appear only after it; the review is always one press away', () => {
        const onRate = vi.fn(); const onFeel = vi.fn(); const onReveal = vi.fn();
        const { rerender } = render(<ConfidencePostCard post={null} feel={null} targetLabel="How did your practice target feel this time?" onRate={onRate} onFeel={onFeel} onReveal={onReveal} />);
        expect(screen.queryByTestId('confidence-feel')).toBeNull();
        fireEvent.click(screen.getByTestId('confidence-reveal'));
        expect(onReveal).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('confidence-post-rating-2'));
        expect(onRate).toHaveBeenCalledWith(2);
        rerender(<ConfidencePostCard post={2} feel={null} targetLabel="How did your practice target feel this time?" onRate={onRate} onFeel={onFeel} onReveal={onReveal} />);
        const feel = screen.getByTestId('confidence-feel');
        expect(feel).toHaveTextContent('How did your practice target feel this time?');
        for (const label of ['Easier', 'About the same', 'Harder', 'Not sure']) expect(feel).toHaveTextContent(label);
        fireEvent.click(screen.getByTestId('confidence-feel-not_sure'));
        expect(onFeel).toHaveBeenCalledWith('not_sure');
        expect(screen.getByTestId('confidence-post-rating-2')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('confidence-post')).not.toHaveTextContent(FORBIDDEN);
    });

    it('You said: self-reported answers only, and nothing for skipped answers', () => {
        expect(youSaidText({ pre: 2, post: 4, feel: 'easier' })).toBe('You said: readiness 2 (A little) before the loop, 4 (Mostly) now · target felt: easier.');
        expect(youSaidText({ pre: null, post: 3, feel: 'skipped' })).toBe('You said: readiness 3 (Somewhat) now.');
        expect(youSaidText({ pre: 'skipped', post: 'skipped', feel: 'not_sure' })).toBe('You said: target felt: not sure.');
        expect(youSaidText({ pre: 'skipped', post: 'skipped', feel: 'skipped' })).toBeNull();
        expect(youSaidText({ pre: 5, post: null, feel: null })).toBeNull();
    });
});
