import { render, screen, fireEvent, cleanup } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveRecordingCard } from '../LiveRecordingCard';
import { TEST_IDS } from '@/constants/testIds';
import { emitPrivateSample, PRIVATE_SAMPLE_EVENTS } from '@/services/transcription/privateSampleTelemetry';

// Mock ONLY the emitter (keep the real event enum) so the nudge funnel emissions are assertable.
vi.mock('@/services/transcription/privateSampleTelemetry', async (orig) => {
    const actual = await (orig() as Promise<Record<string, unknown>>);
    return { ...actual, emitPrivateSample: vi.fn() };
});

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
        expect(cue).toHaveTextContent('Ready on this device');
        // 13px/700 muted grey — orange is reserved for meaningful accents (the record button).
        expect(cue).toHaveClass('text-[13px]', 'font-bold', 'text-muted-foreground');
        expect(cue).not.toHaveClass('text-primary');
        // The `?` no longer sits beside the label; it belongs to the mode selector.
        expect(cue.parentElement?.querySelector('[data-testid="stt-mode-help"]')).toBeNull();
    });

    it('keeps mode help reachable (it is the only touch path to per-mode info)', () => {
        render(<LiveRecordingCard {...defaultProps} />);
        expect(screen.getByTestId('stt-mode-help')).toBeInTheDocument();
    });

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

    it('EXCLUDED FROM #1047: the record button keeps its orange fill and outlined mic glyph', () => {
        const { container } = render(<LiveRecordingCard {...defaultProps} />);

        const record = screen.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        // Orange = the `primary` token. Not teal (`accent`), not red (`destructive`).
        expect(record).toHaveClass('bg-primary', 'text-primary-foreground', 'rounded-full');
        expect(record).not.toHaveClass('bg-accent');
        expect(record).not.toHaveClass('bg-destructive');
        expect(record).toHaveAttribute('aria-label', 'Start Recording');

        // The OUTLINED mic: the lucide mic plus the diagonal slash overlay, unchanged.
        expect(container.querySelector('.lucide-mic')).not.toBeNull();
        expect(record.querySelector('.-rotate-45')).not.toBeNull();
    });
});

describe('LiveRecordingCard — #1047 Free→Private trial nudge (conversion repair)', () => {
    const emit = vi.mocked(emitPrivateSample);
    // An eligible Free user: Browser selected, idle, engine unlocked, sample available.
    const eligibleProps = {
        mode: 'native' as const,
        isListening: false,
        isReady: true,
        canUsePrivate: true,
        isPaidProUser: false,
        privateTrialAvailable: true,
        privateTrialFresh: true,
        privateTrialRemainingSeconds: 300,
        privateTrialLimitSeconds: 300,
        engineSelectionLocked: false,
        formattedTime: '00:00',
        elapsedSeconds: 0,
        isButtonDisabled: false,
        privateModelStatus: 'idle',
        activeEngine: null as 'native' | 'cloud' | 'private' | 'none' | null,
        onModeChange: vi.fn(),
        onStartStop: vi.fn(),
        onDownloadModel: vi.fn(),
    };

    beforeEach(() => { emit.mockClear(); });
    afterEach(() => { cleanup(); });

    it('FRESH sample: shows the trial copy (derived from the server limit) and emits NUDGE_VIEWED once', () => {
        render(<LiveRecordingCard {...eligibleProps} />);
        const nudge = screen.getByTestId('private-trial-nudge');
        expect(nudge).toHaveTextContent('5-minute Private trial available');
        expect(nudge).toHaveTextContent('Audio stays on this device.');
        expect(screen.getByTestId('private-trial-nudge-cta')).toHaveTextContent('Try Private');
        expect(emit).toHaveBeenCalledWith(PRIVATE_SAMPLE_EVENTS.NUDGE_VIEWED);
        expect(emit.mock.calls.filter((c) => c[0] === PRIVATE_SAMPLE_EVENTS.NUDGE_VIEWED)).toHaveLength(1);
    });

    it('the "N-minute" figure comes from the SERVER limit, not a hard-coded 5', () => {
        render(<LiveRecordingCard {...eligibleProps} privateTrialLimitSeconds={600} privateTrialRemainingSeconds={600} />);
        expect(screen.getByTestId('private-trial-nudge-title')).toHaveTextContent('10-minute Private trial available');
    });

    it('PARTIALLY-USED sample: converts with truthful "Continue with Private — X minutes remaining" copy', () => {
        render(<LiveRecordingCard {...eligibleProps} privateTrialFresh={false} privateTrialRemainingSeconds={120} privateTrialLimitSeconds={300} />);
        const nudge = screen.getByTestId('private-trial-nudge');
        expect(nudge).toBeInTheDocument(); // still offered — a partial sample must not lose the conversion
        expect(screen.getByTestId('private-trial-nudge-title')).toHaveTextContent('Continue with Private — 2 minutes remaining');
        expect(nudge).not.toHaveTextContent('trial available'); // never overstate a full trial
    });

    it('partial with under a minute left rounds UP and stays singular-correct', () => {
        render(<LiveRecordingCard {...eligibleProps} privateTrialFresh={false} privateTrialRemainingSeconds={40} privateTrialLimitSeconds={300} />);
        expect(screen.getByTestId('private-trial-nudge-title')).toHaveTextContent('Continue with Private — 1 minute remaining');
    });

    it.each([
        ['Pro user', { isPaidProUser: true }],
        ['sample unavailable', { privateTrialAvailable: false }],
        ['Private unavailable in this runtime/browser', { canUsePrivate: false }],
        ['Private already selected', { mode: 'private' as const }],
        ['Cloud selected', { mode: 'cloud' as const }],
        ['recording', { isListening: true }],
        ['engine selection locked', { engineSelectionLocked: true }],
    ])('hides the nudge when %s', (_label, override) => {
        render(<LiveRecordingCard {...eligibleProps} {...override} />);
        expect(screen.queryByTestId('private-trial-nudge')).toBeNull();
        expect(emit).not.toHaveBeenCalledWith(PRIVATE_SAMPLE_EVENTS.NUDGE_VIEWED);
    });

    it('emits NUDGE_VIEWED at most once per mount even when the nudge hides and reappears', () => {
        const { rerender } = render(<LiveRecordingCard {...eligibleProps} />);
        const viewed = () => emit.mock.calls.filter((c) => c[0] === PRIVATE_SAMPLE_EVENTS.NUDGE_VIEWED).length;
        expect(viewed()).toBe(1);
        // hide (switch to recording), then reappear (back to idle Browser) — no second view event.
        rerender(<LiveRecordingCard {...eligibleProps} isListening />);
        rerender(<LiveRecordingCard {...eligibleProps} />);
        expect(screen.getByTestId('private-trial-nudge')).toBeInTheDocument();
        expect(viewed()).toBe(1); // NOT inflated by the hide/show cycle
    });

    it('"Try Private" selects Private only — no recording, no model download — and emits the funnel events', () => {
        render(<LiveRecordingCard {...eligibleProps} />);
        fireEvent.click(screen.getByTestId('private-trial-nudge-cta'));
        // selects Private
        expect(eligibleProps.onModeChange).toHaveBeenCalledWith('private');
        // does NOT start recording and does NOT download the model
        expect(eligibleProps.onStartStop).not.toHaveBeenCalled();
        expect(eligibleProps.onDownloadModel).not.toHaveBeenCalled();
        // nudge-attributed intent + the mode-switch SELECTED both fire
        expect(emit).toHaveBeenCalledWith(PRIVATE_SAMPLE_EVENTS.NUDGE_SELECTED);
        expect(emit).toHaveBeenCalledWith(PRIVATE_SAMPLE_EVENTS.SELECTED);
    });
});
