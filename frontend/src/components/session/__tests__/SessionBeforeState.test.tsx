import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionBeforeState } from '../SessionBeforeState';
import { computeProgressVsBaseline } from '@/utils/progressVsBaseline';

// #1222 S3 — the before-state renders all four slots through the fixed shell, Private-only (no engine selector).
describe('SessionBeforeState (#1222 before)', () => {
    const props = {
        mic: { onStart: vi.fn() },
        transcript: {
            offerDismissed: false,
            onDismissOffer: vi.fn(),
            onRestoreOffer: vi.fn(),
            onTakePrompt: vi.fn(),
            onReadSample: vi.fn(),
        },
        progress: computeProgressVsBaseline([{ fillerCount: 6, durationSeconds: 120 }]),
    };

    it('fills all four slots (A mic, B transcript+offer, C progress, D coaching) via the shell', () => {
        render(<SessionBeforeState {...props} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.getByTestId('session-slot-a')).toContainElement(screen.getByTestId('mic-card'));
        expect(screen.getByTestId('session-slot-b')).toContainElement(screen.getByTestId('transcript-card'));
        expect(screen.getByTestId('session-slot-c')).toContainElement(screen.getByTestId('progress-vs-baseline'));
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('coaching-card'));
    });

    it('shows the prompt offer in slot B and the coaching placeholder in slot D', () => {
        render(<SessionBeforeState {...props} />);
        expect(screen.getByTestId('prompt-offer')).toBeInTheDocument();
        expect(screen.getByTestId('coaching-placeholder')).toBeInTheDocument();
    });

    it('renders NO STT engine selector — Private only (#1184/#1229)', () => {
        render(<SessionBeforeState {...props} />);
        // The only select is the microphone INPUT-device picker, and only when devices are provided.
        expect(screen.queryByTestId('mic-device-select')).toBeNull();
        for (const label of [/engine/i, /browser/i, /cloud/i, /native/i]) {
            expect(screen.queryByRole('combobox', { name: label })).toBeNull();
        }
    });

    // #1255 — Focus Points supplies its own Slot C (the guide-only Coverage & pace card). Slot C is never
    // omitted: the shell renders whatever slotCContent is passed, replacing the default Progress vs baseline.
    it('renders a supplied slotCContent in the fixed Slot C, replacing the default progress card', () => {
        render(
            <SessionBeforeState
                {...props}
                slotCContent={<div data-testid="fp-slot-c">Coverage &amp; pace</div>}
            />,
        );
        expect(screen.getByTestId('session-slot-c')).toContainElement(screen.getByTestId('fp-slot-c'));
        // The Focus Points card supersedes Open Mic's default; the two never render together.
        expect(screen.queryByTestId('progress-vs-baseline')).toBeNull();
    });
});
