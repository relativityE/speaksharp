import { render, screen } from '../../../../tests/support/test-utils';
import { fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PracticeFocusChooser } from '../PracticeFocusChooser';
import { PRACTICE_FOCUS_OPTIONS } from '@/constants/practiceFocus';

// #1264 — the Practice Focus chooser is a WAI-ARIA radiogroup: it must be keyboard- and screen-reader
// operable and expose the selection state, since selecting an intention is the whole feature.
describe('PracticeFocusChooser (#1264)', () => {
    it('renders all five options as a radiogroup with the selected one checked', () => {
        render(<PracticeFocusChooser value="reduce_fillers" onSelect={vi.fn()} />);
        const group = screen.getByRole('radiogroup', { name: /practice focus/i });
        expect(group).toBeInTheDocument();
        const radios = screen.getAllByRole('radio');
        expect(radios).toHaveLength(PRACTICE_FOCUS_OPTIONS.length);
        expect(screen.getByTestId('practice-focus-reduce_fillers')).toHaveAttribute('aria-checked', 'true');
        // Every other option is unchecked.
        expect(screen.getByTestId('practice-focus-just_practice')).toHaveAttribute('aria-checked', 'false');
    });

    it('roving tabindex: only the selected option is in the tab order (else the first)', () => {
        const { rerender } = render(<PracticeFocusChooser value={null} onSelect={vi.fn()} />);
        // No selection → the first option is the tab anchor.
        expect(screen.getByTestId('practice-focus-just_practice')).toHaveAttribute('tabindex', '0');
        expect(screen.getByTestId('practice-focus-concise')).toHaveAttribute('tabindex', '-1');
        rerender(<PracticeFocusChooser value="steady_pace" onSelect={vi.fn()} />);
        expect(screen.getByTestId('practice-focus-steady_pace')).toHaveAttribute('tabindex', '0');
        expect(screen.getByTestId('practice-focus-just_practice')).toHaveAttribute('tabindex', '-1');
    });

    it('click selects an option', () => {
        const onSelect = vi.fn();
        render(<PracticeFocusChooser value={null} onSelect={onSelect} />);
        fireEvent.click(screen.getByTestId('practice-focus-concise'));
        expect(onSelect).toHaveBeenCalledWith('concise');
    });

    it('ArrowRight/ArrowLeft move selection through the group (wrapping)', () => {
        const onSelect = vi.fn();
        render(<PracticeFocusChooser value="just_practice" onSelect={onSelect} />);
        fireEvent.keyDown(screen.getByTestId('practice-focus-just_practice'), { key: 'ArrowRight' });
        expect(onSelect).toHaveBeenLastCalledWith('concise');
        // Wrap from the first backwards to the last.
        fireEvent.keyDown(screen.getByTestId('practice-focus-just_practice'), { key: 'ArrowLeft' });
        expect(onSelect).toHaveBeenLastCalledWith(PRACTICE_FOCUS_OPTIONS[PRACTICE_FOCUS_OPTIONS.length - 1].id);
    });

    it('Home/End jump to the first/last option; Space selects the focused one', () => {
        const onSelect = vi.fn();
        render(<PracticeFocusChooser value="concise" onSelect={onSelect} />);
        fireEvent.keyDown(screen.getByTestId('practice-focus-concise'), { key: 'End' });
        expect(onSelect).toHaveBeenLastCalledWith(PRACTICE_FOCUS_OPTIONS[PRACTICE_FOCUS_OPTIONS.length - 1].id);
        fireEvent.keyDown(screen.getByTestId('practice-focus-concise'), { key: 'Home' });
        expect(onSelect).toHaveBeenLastCalledWith('just_practice');
        fireEvent.keyDown(screen.getByTestId('practice-focus-concise'), { key: ' ' });
        expect(onSelect).toHaveBeenLastCalledWith('concise');
    });

    it('each option exposes an accessible name that includes its hint (screen-reader support)', () => {
        render(<PracticeFocusChooser value={null} onSelect={vi.fn()} />);
        expect(screen.getByTestId('practice-focus-reduce_fillers')).toHaveAttribute(
            'aria-label',
            expect.stringMatching(/reduce fillers/i),
        );
    });
});
