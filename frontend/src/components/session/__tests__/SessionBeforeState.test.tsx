import { render, screen, within } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionBeforeState } from '../SessionBeforeState';

// Design Correction Brief — the `before` state on the shared slot map (S-1…S-7).
describe('SessionBeforeState', () => {
    const props = {
        mic: { onStart: vi.fn() },
        transcript: {
            offerDismissed: false,
            onRestoreOffer: vi.fn(),
            onTakePrompt: vi.fn(),
            onReadSample: vi.fn(),
        },
        rail: <p data-testid="rail-content">First session — this run becomes your baseline.</p>,
    };

    it('fills the slot map: A mic, B coaching, C transcript, D rail', () => {
        render(<SessionBeforeState {...props} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.getByTestId('session-slot-a')).toContainElement(screen.getByTestId('mic-card'));
        expect(screen.getByTestId('session-slot-b')).toContainElement(screen.getByTestId('coaching-card'));
        expect(screen.getByTestId('session-slot-c')).toContainElement(screen.getByTestId('transcript-card'));
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('rail-content'));
    });

    it('S-3: slot B says four words of intent under a yellow eyebrow, and nothing about its own mechanics', () => {
        render(<SessionBeforeState {...props} />);
        const b = screen.getByTestId('session-slot-b');
        expect(within(b).getByTestId('coaching-eyebrow')).toHaveTextContent(/live coaching/i);
        expect(within(b).getByTestId('coaching-eyebrow')).toHaveClass('text-signature');
        expect(b).toHaveTextContent('Tips appear as you speak.');
        // G3: the interface describing when the UI will update.
        expect(b).not.toHaveTextContent(/20 seconds|appears here|based on what you actually say/i);
        // Checklist #17: slot B in `before` is six words or fewer.
        const words = b.textContent!.trim().split(/\s+/).filter(Boolean);
        expect(words.length).toBeLessThanOrEqual(6);
    });

    it('CASUALTY S-4: no practice-focus chips — the page asks for one decision, the prompt pair', () => {
        render(<SessionBeforeState {...props} />);
        expect(screen.queryByText(/practice focus/i)).toBeNull();
        expect(screen.queryByText(/optional/i)).toBeNull();
        // The only buttons offered besides the mic are the prompt pair.
        const buttons = screen.getAllByRole('button').map((b) => b.textContent?.trim());
        expect(buttons).toEqual(expect.arrayContaining(['Give me a prompt', 'Read a sample']));
        expect(buttons.filter((t) => t !== 'Give me a prompt' && t !== 'Read a sample' && !/start recording/i.test(t ?? ''))).toEqual([]);
    });

    it('CASUALTY S-4: the transcript is not dismissible — no ✕ anywhere on it', () => {
        render(<SessionBeforeState {...props} />);
        expect(screen.queryByTestId('transcript-dismiss-offer')).toBeNull();
        expect(within(screen.getByTestId('transcript-card')).queryByText('✕')).toBeNull();
    });

    it('G3: the prompt offer no longer narrates its own behaviour', () => {
        render(<SessionBeforeState {...props} />);
        const offer = screen.getByTestId('prompt-offer');
        expect(offer).toHaveTextContent('Not sure what to say?');
        expect(offer).not.toHaveTextContent(/stays right here|saved or scored/i);
    });

    it('S-6 / S-7: one instruction under the mic, and readiness is not coloured as progress', () => {
        render(<SessionBeforeState {...props} />);
        const mic = screen.getByTestId('mic-card');
        expect(mic).toHaveTextContent('Space bar works too');
        expect(mic).not.toHaveTextContent(/aim for|60 seconds/i);
        const status = screen.getByTestId('mic-status');
        expect(status).toHaveTextContent('Mic ready on this device');
        expect(status.style.color).toBe('var(--brand-neutral-secondary)');
        expect((status.querySelector('span') as HTMLElement).style.backgroundColor).toBe('var(--brand-progress-bar)');
    });

    it('renders a supplied header action in the transcript header (S-4)', () => {
        render(
            <SessionBeforeState
                {...props}
                transcript={{ ...props.transcript, headerAction: <button type="button">Add your filler words</button> }}
            />,
        );
        expect(within(screen.getByTestId('transcript-card')).getByRole('button', { name: 'Add your filler words' })).toBeInTheDocument();
    });

    it('renders NO STT engine selector — Private only (#1184/#1229)', () => {
        render(<SessionBeforeState {...props} />);
        expect(screen.queryByTestId('mic-device-select')).toBeNull();
        for (const label of [/engine/i, /browser/i, /cloud/i, /native/i]) {
            expect(screen.queryByRole('combobox', { name: label })).toBeNull();
        }
    });
});
