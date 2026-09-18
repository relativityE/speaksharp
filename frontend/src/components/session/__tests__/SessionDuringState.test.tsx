import { render, screen, fireEvent, within } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionDuringState } from '../SessionDuringState';
import { SessionBeforeState } from '../SessionBeforeState';

const duringProps = {
    recorder: { elapsedSeconds: 72, amplitudes: [0.5, 0.7, 0.4], recordedCount: 2, onStop: vi.fn() },
    transcript: { tokens: [{ text: 'So' }, { text: 'um', filler: true }], words: 184, fillersPerMin: 2.6 },
    rail: <div data-testid="rail-content">rail</div>,
};

describe('SessionDuringState — the shared slot map', () => {
    it('maps recorder, coaching, live transcript and rail into A, B, C, D', () => {
        render(<SessionDuringState {...duringProps} liveTip={<span data-testid="tip">Pause instead of um</span>} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(screen.getByTestId('session-slot-a')).toContainElement(screen.getByTestId('recorder-bar'));
        expect(screen.getByTestId('session-slot-b')).toContainElement(screen.getByTestId('tip'));
        expect(screen.getByTestId('session-slot-c')).toContainElement(screen.getByTestId('live-transcript'));
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('rail-content'));
    });

    it('F-1: a Focus Points nudge renders in slot B, on ink, where Open Mic coaches', () => {
        render(<SessionDuringState {...duringProps} nudge="Good moment to bring in point 3." />);
        const b = screen.getByTestId('session-slot-b');
        const nudge = within(b).getByTestId('coverage-pace-nudge');
        expect(nudge).toHaveTextContent('Good moment to bring in point 3.');
        expect(nudge).toHaveClass('text-ink-text');
        expect(within(screen.getByTestId('session-slot-d')).queryByTestId('coverage-pace-nudge')).toBeNull();
    });

    it('a silent band keeps its resting line rather than emptying, so nothing below it moves', () => {
        render(<SessionDuringState {...duringProps} nudge={null} />);
        expect(within(screen.getByTestId('session-slot-b')).getByText('Tips appear as you speak.')).toBeInTheDocument();
    });

    it('never shows a tip and a nudge together — the tip wins', () => {
        render(<SessionDuringState {...duringProps} liveTip={<span data-testid="tip">tip</span>} nudge="a nudge" />);
        expect(screen.getByTestId('tip')).toBeInTheDocument();
        expect(screen.queryByTestId('coverage-pace-nudge')).toBeNull();
    });

    it('the transcript header carries live counts and the "not scored until you stop" note', () => {
        render(<SessionDuringState {...duringProps} />);
        expect(screen.getByTestId('transcript-header-meta')).toHaveTextContent('184 words · 2.6 fillers/min');
        expect(screen.getByTestId('transcript-footer')).toHaveTextContent(/Nothing is scored until you stop/);
    });
});

// The governing rule at composition level: the four slots keep identity + order from before → during.
describe('before → during (G1 — slots never move)', () => {
    it('keeps slot order A,B,C,D across the state change', () => {
        const beforeProps = {
            mic: { onStart: vi.fn() },
            transcript: {
                offerDismissed: false,
                onRestoreOffer: vi.fn(), onTakePrompt: vi.fn(), onReadSample: vi.fn(),
            },
            rail: <div>rail</div>,
        };
        const { rerender } = render(<SessionBeforeState {...beforeProps} />);
        const order = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));
        expect(order()).toEqual(['A', 'B', 'C', 'D']);

        rerender(<SessionDuringState {...duringProps} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
    });
});

// #1222 (PO 2026-08-10): a long taken sample must never hide the user's own live transcript. The reading
// prompt is height-bounded (its own scroll) AND collapsible so the space can be reclaimed entirely.
// Sample-overlay split lifespan (PO Option 1): a pinned sample/prompt sits inside the transcript with a
// ✕ dismiss; a prompt that auto-hid offers a "Need a prompt?" reopen chip. Visibility is parent-owned.
describe('SessionDuringState reading prompt (split lifespan)', () => {
    const withSample = {
        ...duringProps,
        transcript: {
            ...duringProps.transcript,
            chosenPrompt: 'Read this long sample aloud while you record.',
            promptKind: 'sample' as const,
            onDismissPin: vi.fn(),
        },
    };

    it('shows the sample above the live transcript with a ✕ dismiss (never covers the transcript)', () => {
        render(<SessionDuringState {...withSample} />);
        const prompt = screen.getByTestId('during-reading-prompt');
        expect(prompt).toHaveTextContent('Read this long sample aloud');
        expect(prompt).toHaveAttribute('data-prompt-kind', 'sample');
        expect(screen.getByTestId('live-transcript')).toBeInTheDocument();
        expect(screen.getByTestId('during-reading-prompt-dismiss')).toBeInTheDocument();
    });

    it('✕ calls onDismissPin (parent removes the pin)', () => {
        const onDismissPin = vi.fn();
        render(<SessionDuringState {...withSample} transcript={{ ...withSample.transcript, onDismissPin }} />);
        fireEvent.click(screen.getByTestId('during-reading-prompt-dismiss'));
        expect(onDismissPin).toHaveBeenCalledTimes(1);
    });

    it('offers a "Need a prompt?" reopen chip when a prompt auto-hid', () => {
        const onReopenPin = vi.fn();
        render(
            <SessionDuringState
                {...duringProps}
                transcript={{ ...duringProps.transcript, chosenPrompt: null, showReopenChip: true, onReopenPin }}
            />,
        );
        const chip = screen.getByTestId('during-reopen-prompt');
        expect(chip).toHaveTextContent('Need a prompt?');
        fireEvent.click(chip);
        expect(onReopenPin).toHaveBeenCalledTimes(1);
    });
});
