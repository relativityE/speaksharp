import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CoachingCard } from '../CoachingCard';

describe('#1548 visible practice instruction without replacing live coaching', () => {
    it.each(['before', 'during'] as const)('shows the identical accepted instruction %s, preserving tips/nudges', state => {
        render(<CoachingCard sessionState={state} practiceTarget={{ kind: 'ready', instruction: 'Name the price first.' }} liveTip="Slow down." nudge="Cover the second point." />);
        expect(screen.getByTestId('repeat-practice-target')).toHaveTextContent('Name the price first.');
        expect(screen.getByText(state === 'during' ? 'Slow down.' : 'Tips appear as you speak.')).toBeInTheDocument();
    });
    it('clears old advice on mismatch, offers exact-reference retry and an existing saved-review route', () => {
        const retry = vi.fn();
        const view = render(<MemoryRouter><CoachingCard sessionState="before" practiceTarget={{ kind: 'ready', instruction: 'Old advice.' }} /></MemoryRouter>);
        view.rerender(<MemoryRouter><CoachingCard sessionState="before" practiceTarget={{ kind: 'unavailable', retry, sourceSessionId: 'source-1' }} /></MemoryRouter>);
        expect(screen.queryByText('Old advice.')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry this target' }));
        expect(retry).toHaveBeenCalledOnce();
        expect(screen.getByRole('link', { name: 'Reopen saved review' })).toHaveAttribute('href', '/progress/source-1');
    });
    it('keeps a Focus nudge and removes the inherited instruction after the take', () => {
        const view = render(<CoachingCard sessionState="during" practiceTarget={{ kind: 'ready', instruction: 'Name the price first.' }} nudge="Cover the second point." />);
        expect(screen.getByTestId('coverage-pace-nudge')).toHaveTextContent('Cover the second point.');
        view.rerender(<CoachingCard sessionState="after" practiceTarget={{ kind: 'ready', instruction: 'Name the price first.' }} verdict="Saved review." />);
        expect(screen.queryByTestId('repeat-practice-target')).not.toBeInTheDocument();
        expect(screen.getByTestId('coaching-verdict')).toHaveTextContent('Saved review.');
    });
});
