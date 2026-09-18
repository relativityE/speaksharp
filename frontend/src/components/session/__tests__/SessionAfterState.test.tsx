import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionAfterState } from '../SessionAfterState';
import { SessionBeforeState } from '../SessionBeforeState';
import { SessionDuringState } from '../SessionDuringState';
import { SessionVerdict } from '../SessionVerdict';

const afterProps = {
    // S-11: the run's static shape with the mic returned — no transport, because there is no audio.
    runShape: {
        durationSeconds: 124,
        amplitudes: Array.from({ length: 10 }, () => 0.5),
        fillerBars: [3],
        onStart: vi.fn(),
    },
    transcript: {
        tokens: [{ text: 'So' }, { text: 'um', filler: true }, { text: 'today' }],
        // The banned playback instruction is gone: `RECORDER_SPEC` §4 forbids "tap a highlight to hear it"
        // and every variant, because there is nothing to hear.
        headerMeta: '318 words · 2.4 fillers/min',
        stats: '5 fillers · 142 wpm · 2:04 spoken',
    },
    review: (
        <SessionVerdict
            verdictLine="Your cleanest session yet."
            fix="You opened three sentences with 'um'."
            onPracticeAgain={vi.fn()}
            onSeeAllSessions={vi.fn()}
        />
    ),
    rail: <div data-testid="rail-content">rail</div>,
};

describe('SessionAfterState — the shared slot map', () => {
    it('maps the run shape, the review, the transcript and the rail into A, B, C, D', () => {
        render(<SessionAfterState {...afterProps} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.getByTestId('session-slot-a')).toContainElement(screen.getByTestId('run-shape'));
        // The AFTER state's slot B renders the transcript the SERVER retained, not the ephemeral working
        // memory the DURING state shows, so it carries its own identity — otherwise a leak of working memory
        // and a correctly restored review are indistinguishable to the suite.
        expect(screen.getByTestId('session-slot-c')).toContainElement(screen.getByTestId('review-transcript'));
        expect(screen.queryByTestId('live-transcript')).toBeNull();
        // S-12: the review sits in slot B, full width, directly under the recorder, on ink.
        expect(screen.getByTestId('session-slot-b')).toContainElement(screen.getByTestId('session-verdict'));
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('rail-content'));
    });

    /*
     * S-13 — the highlights are READ-ONLY, and that absence is structural rather than visual. The old
     * shape passed an `onFillerSeek` callback, so the seek path existed and the privacy claim was one prop
     * away from being false. The prop is deleted, not defaulted off.
     */
    it('CASUALTY: a filler highlight is not interactive — there is no audio to seek to', () => {
        render(<SessionAfterState {...afterProps} />);
        const filler = screen.getByTestId('live-filler');
        expect(filler.tagName).toBe('MARK');
        expect(filler.closest('button')).toBeNull();
        expect(screen.queryByRole('button', { name: /seek|play|pause/i })).toBeNull();
    });

    it('CASUALTY: no playback promise survives anywhere in the state', () => {
        const text = render(<SessionAfterState {...afterProps} />).container.textContent ?? '';
        expect(text).not.toMatch(/hear it|listen back|replay|tap a highlight/i);
        expect(text).not.toMatch(/\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}/);
    });

    /*
     * S-13 — after the run the transcript is reference, capped so it cannot push the rail's counts off screen.
     * The cap is CSS ONLY: live specs and the benchmark harness read `transcript-content` by `textContent`,
     * so truncating the text itself would silently change what they measure.
     */
    it('S-13: the transcript is capped with internal scroll, and lifts in place', () => {
        render(<SessionAfterState {...afterProps} />);
        const content = screen.getByTestId('transcript-content');
        expect(content).toHaveAttribute('data-transcript-capped', 'true');
        expect(content.className).toContain('max-h-[280px]');
        expect(content.className).toContain('overflow-y-auto');
        fireEvent.click(screen.getByTestId('read-full-transcript'));
        expect(screen.getByTestId('transcript-content')).toHaveAttribute('data-transcript-capped', 'false');
        expect(screen.queryByTestId('read-full-transcript')).toBeNull();
    });

    it('CASUALTY S-13: the cap never removes words from the DOM', () => {
        render(<SessionAfterState {...afterProps} />);
        // Every token is present while capped — the harness reads textContent, not the visible box.
        const text = screen.getByTestId('transcript-content').textContent ?? '';
        for (const token of ['So', 'um', 'today']) expect(text).toContain(token);
    });

    it('shows the stats strip', () => {
        render(<SessionAfterState {...afterProps} />);
        expect(screen.getByTestId('after-stats')).toHaveTextContent('5 fillers · 142 wpm · 2:04 spoken');
    });
});

// G1 across the FULL journey: four slots, one order, in every state. The previous shell promoted the
// review by swapping columns in `after` (A, D, C, B); the shared map needs no swap because B is already
// full width under the recorder.
describe('before → during → after (G1 — slots never move)', () => {
    it('CASUALTY: holds A, B, C, D and the same landmarks in all three states', () => {
        const beforeProps = {
            mic: { onStart: vi.fn() },
            transcript: { offerDismissed: false, onRestoreOffer: vi.fn(), onTakePrompt: vi.fn(), onReadSample: vi.fn() },
            rail: <div>rail</div>,
        };
        const duringProps = {
            recorder: { elapsedSeconds: 30, amplitudes: [0.4, 0.6], recordedCount: 1, onStop: vi.fn() },
            transcript: { tokens: [{ text: 'hi' }], words: 20, fillersPerMin: 1 },
            rail: <div>rail</div>,
        };
        const order = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));
        const landmarks = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('aria-label'));
        const LANDMARKS = ['Recorder', 'Coaching', 'Transcript', 'This run'];

        const { rerender } = render(<SessionBeforeState {...beforeProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        expect(landmarks()).toEqual(LANDMARKS);
        rerender(<SessionDuringState {...duringProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        expect(landmarks()).toEqual(LANDMARKS);
        rerender(<SessionAfterState {...afterProps} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        expect(landmarks()).toEqual(LANDMARKS);
    });
});
