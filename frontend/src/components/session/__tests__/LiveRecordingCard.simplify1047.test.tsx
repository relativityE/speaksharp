import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { LiveRecordingCard } from '../LiveRecordingCard';
import { TEST_IDS } from '@/constants/testIds';

/**
 * #1047 — Practice Session simplification, recorder card.
 *
 * The single most important assertion in this file is the LAST one: the record button's colour and
 * glyph must NOT drift. The Product Owner explicitly kept the orange circle with the outlined mic; an
 * earlier draft spec proposing teal/red was WITHDRAWN. Any change there is a regression, so it is
 * pinned here rather than left to review.
 */
describe('LiveRecordingCard — #1047', () => {
    const defaultProps = {
        mode: 'private' as const,
        isListening: false,
        isReady: true,
        canUsePrivate: true,
        formattedTime: '00:00',
        elapsedSeconds: 0,
        isButtonDisabled: false,
        privateModelStatus: 'ready',
        activeEngine: null as 'native' | 'cloud' | 'private' | 'none' | null,
        onModeChange: vi.fn(),
        onStartStop: vi.fn(),
    };

    it('demotes "Ready on this device" to a quiet muted label with no help icon beside it', () => {
        render(<LiveRecordingCard {...defaultProps} />);

        const cue = screen.getByTestId('stt-mode-cue');
        expect(cue).toHaveTextContent('Private · on this device');
        // 13px/700 muted grey — orange is reserved for meaningful accents (the record button).
        expect(cue).toHaveClass('text-[13px]', 'font-bold', 'text-foreground');
        expect(cue).not.toHaveClass('text-primary');
        // The `?` no longer sits beside the label; it belongs to the mode selector.
        expect(cue.parentElement?.querySelector('[data-testid="stt-mode-help"]')).toBeNull();
    });

    // #1184: the "About transcription modes" help was removed with the selector (Private is the only
    // engine); there is no per-mode info to reach. The engine identity lives in the header cue.

    it('renders the timer grey while idle and dark ink once running', () => {
        const { rerender } = render(<LiveRecordingCard {...defaultProps} />);

        const idleTimer = screen.getByTestId('session-timer');
        expect(idleTimer).toHaveTextContent('00:00');
        expect(idleTimer).toHaveAttribute('data-timer-active', 'false');
        expect(idleTimer).toHaveClass('text-[40px]', 'font-extrabold', 'text-muted-foreground');
        expect(idleTimer.className).toContain('[font-variant-numeric:tabular-nums]');

        rerender(<LiveRecordingCard {...defaultProps} isListening formattedTime="00:42" />);
        const runningTimer = screen.getByTestId('session-timer');
        expect(runningTimer).toHaveAttribute('data-timer-active', 'true');
        expect(runningTimer).toHaveClass('text-foreground');
    });

    it('the record button keeps its orange fill and shows a PLAIN mic (no muted slash)', () => {
        const { container } = render(<LiveRecordingCard {...defaultProps} />);

        const record = screen.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        // Orange = the `primary` token. Not teal (`accent`), not red (`destructive`).
        expect(record).toHaveClass('bg-primary', 'text-primary-foreground', 'rounded-full');
        expect(record).not.toHaveClass('bg-accent');
        expect(record).not.toHaveClass('bg-destructive');
        expect(record).toHaveAttribute('aria-label', 'Start Recording');

        // #1046 slice 0.1: a PLAIN mic — the diagonal slash overlay is GONE (a slashed mic reads as
        // "muted/unavailable", the opposite of a ready Start control).
        expect(container.querySelector('.lucide-mic')).not.toBeNull();
        expect(record.querySelector('.-rotate-45')).toBeNull();
    });
});
