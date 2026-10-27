/**
 * #1491 6238566653 — the mic shows the download progress the session store actually holds.
 *
 * The store publishes an integer PERCENT (`normalizeModelLoadingProgress` turns a 0..1 fraction into one and clamps to
 * 0–100). MicCard read the same value as a fraction, so every stored value from 1 upwards rendered as 100% — a cold
 * Private download claimed to be complete from its first percent. These tests write through the store's real setter,
 * read the value back, and render it, so the two ends of the contract can never disagree again.
 */
import { render, screen } from '../../../../tests/support/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicCard } from '../MicCard';
import { useSessionStore } from '@/stores/useSessionStore';

/** Write `input` through the store's own normalization, then render the mic with exactly what the store holds. */
function renderFromStore(input: number | null) {
    useSessionStore.getState().setModelLoadingProgress(input);
    const stored = useSessionStore.getState().modelLoadingProgress;
    render(<MicCard onStart={vi.fn()} privateModelStatus="loading" modelLoadingProgress={stored} />);
    return stored;
}

afterEach(() => useSessionStore.getState().setModelLoadingProgress(null));

describe('#1491 MicCard renders the store\'s download progress truthfully', () => {
    it.each([
        ['a percent', 42, 42],
        ['a fraction (normalized by the store)', 0.42, 42],
    ])('%s: the store holds 42 and the mic shows 42%%, never 100%%', (_label, input, expected) => {
        expect(renderFromStore(input)).toBe(expected);
        expect(screen.getByTestId('mic-progress')).toHaveTextContent(/^42%$/);
        expect(screen.getByTestId('mic-status')).toHaveTextContent(/Downloading private transcription… 42%/);
        expect(screen.getByTestId('mic-status')).not.toHaveTextContent(/100%/);
    });

    it('0: the very start of a download reads 0%', () => {
        expect(renderFromStore(0)).toBe(0);
        expect(screen.getByTestId('mic-progress')).toHaveTextContent(/^0%$/);
        expect(screen.getByTestId('mic-status')).toHaveTextContent(/Downloading private transcription… 0%/);
    });

    it('100: a finished download reads 100%', () => {
        expect(renderFromStore(100)).toBe(100);
        expect(screen.getByTestId('mic-progress')).toHaveTextContent(/^100%$/);
    });

    it('null: no number is invented while there is no progress to show', () => {
        expect(renderFromStore(null)).toBeNull();
        expect(screen.queryByTestId('mic-progress')).toBeNull();
        expect(screen.getByTestId('mic-status')).toHaveTextContent(/Downloading private transcription…/);
        expect(screen.getByTestId('mic-status')).not.toHaveTextContent(/\d+%/);
    });

    it('loading still disables the mic until the model is ready (behaviour unchanged)', () => {
        renderFromStore(42);
        expect(screen.getByTestId('mic-start')).toBeDisabled();
    });
});
