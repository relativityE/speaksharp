import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { LiveTranscript } from '../LiveTranscript';
import { formatLiveMeta } from '@/utils/sessionFormat';

describe('formatLiveMeta', () => {
    it('renders "{n} words · {x} fillers/min" with one decimal', () => {
        expect(formatLiveMeta(184, 2.6)).toBe('184 words · 2.6 fillers/min');
        expect(formatLiveMeta(10, 0)).toBe('10 words · 0.0 fillers/min');
    });
});

// #1222 slot B (during) — filler highlights land instantly + a live caret.
describe('LiveTranscript (#1222 slot B during)', () => {
    const tokens = [
        { text: 'So' },
        { text: 'um', filler: true },
        { text: 'today' },
        { text: 'like', filler: true },
        { text: 'we' },
    ];

    it('highlights only the filler tokens', () => {
        render(<LiveTranscript tokens={tokens} />);
        const fillers = screen.getAllByTestId('live-filler') as HTMLElement[];
        expect(fillers.map((f) => f.textContent)).toEqual(['um', 'like']);
        // Assert the inline style directly (jsdom's UA stylesheet on <mark> shadows getComputedStyle).
        expect(fillers[0].style.backgroundColor).toBe('rgb(253, 243, 226)'); // #fdf3e2
        expect(fillers[0].style.borderBottom).toContain('rgb(217, 138, 31)'); // #d98a1f
    });

    it('shows the live caret while recording, and hides it when asked', () => {
        const { rerender } = render(<LiveTranscript tokens={tokens} />);
        expect(screen.getByTestId('live-caret')).toBeInTheDocument();
        rerender(<LiveTranscript tokens={tokens} showCaret={false} />);
        expect(screen.queryByTestId('live-caret')).toBeNull();
    });
});
