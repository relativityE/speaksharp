import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';

// #1466 PM acceptance lock (P1, PO evidence on 576c4712): after a completed session the Practice Loop must be
// at eye level — ahead of transcript detail and secondary session actions — in every review state, on phones
// as well as desktop, and in keyboard / screen-reader order. "Ahead" is DOM order.
//
// Design Correction Brief S-12 changes the mechanism, not the requirement. #1466 met it with a band rendered
// ABOVE the whole shell, because the old shell had no full-width slot under the recorder. The shared slot map
// has one: slot B, directly under the recorder and ahead of the transcript (C) and the rail (D) in every
// state. The review now lives there, so these locks assert B's position instead of the band's.

const base: SessionOverhaulViewProps = {
    authUserId: 'user-1',
    isListening: false,
    sttStatus: { type: 'idle' } as SttStatus,
    elapsedTime: 0,
    micLevel: 0,
    transcriptContent: '',
    showAnalyticsPrompt: false,
    metricsFillerCount: 0,
    onStartStop: vi.fn(),
    history: [],
};

const POINTS = ['Name the price', 'State the guarantee'];

/** `a` comes before `b` in document (and therefore tab / reading) order. */
const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** Stand-ins for the review's terminal states — the view must place every one of them in the same primary band. */
const REVIEW_STATES = [
    ['loading', <div key="l" data-testid="review-probe" data-review-state="loading" role="status">Preparing your review</div>],
    ['rendered', <div key="r" data-testid="review-probe" data-review-state="rendered"><button type="button">Try this next</button></div>],
    ['failed', <div key="f" data-testid="review-probe" data-review-state="failed" role="status">Review unavailable<button type="button">Retry</button></div>],
] as const;

describe('#1466 Practice Loop placement — Open Mic after state', () => {
    it.each(REVIEW_STATES)('CASUALTY: the %s review sits in slot B, ahead of the transcript and the rail', (_state, review) => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={review} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        const band = screen.getByTestId('open-mic-practice-loop-review');
        expect(band).toContainElement(screen.getByTestId('review-probe'));
        expect(screen.getByTestId('session-slot-b')).toContainElement(band);
        expect(precedes(band, screen.getByTestId('session-slot-c'))).toBe(true);
        expect(precedes(band, screen.getByTestId('session-slot-d'))).toBe(true);
    });

    it('CASUALTY: the review band precedes the transcript and the secondary Practice-this-again action', () => {
        render(
            <SessionOverhaulView
                {...base}
                showAnalyticsPrompt
                reviewTranscript={{ kind: 'available', text: 'so hello there' }}
                practiceLoopReview={REVIEW_STATES[1][1]}
            />,
        );
        const band = screen.getByTestId('open-mic-practice-loop-review');
        expect(precedes(band, screen.getByTestId('review-transcript'))).toBe(true);
        expect(precedes(band, screen.getByTestId('verdict-practice-again'))).toBe(true);
    });

    it('CASUALTY: keyboard order reaches the review control before any session action', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[2][1]} />);
        const tabbable = [...document.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
        const retry = screen.getByRole('button', { name: 'Retry' });
        expect(tabbable.indexOf(retry)).toBeGreaterThanOrEqual(0);
        expect(tabbable.indexOf(retry)).toBeLessThan(tabbable.indexOf(screen.getByTestId('verdict-practice-again')));
    });

    it('CONTROL (#1422 P1): the review never evicts the verdict — Practice this again sits under it in slot B', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[1][1]} />);
        const b = screen.getByTestId('session-slot-b');
        expect(b).toContainElement(screen.getByTestId('verdict-practice-again'));
        expect(b).toContainElement(screen.getByTestId('review-probe'));
        expect(precedes(screen.getByTestId('review-probe'), screen.getByTestId('verdict-practice-again'))).toBe(true);
    });

    it('CONTROL (#1422 P1): with no review yet, Practice this again is still reachable in slot B', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={undefined} />);
        expect(screen.getByTestId('session-slot-b')).toContainElement(screen.getByTestId('verdict-practice-again'));
    });
});

describe('#1466 Practice Loop placement — Focus Points after state', () => {
    it.each(REVIEW_STATES)('CASUALTY: the %s review sits in slot B, exactly as Open Mic (F-1)', (_state, review) => {
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={POINTS}
                showAnalyticsPrompt
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
                elapsedTime={84}
                practiceLoopReview={review}
            />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        const band = screen.getByTestId('focus-practice-loop-review');
        expect(screen.getByTestId('session-slot-b')).toContainElement(band);
        expect(precedes(band, screen.getByTestId('session-slot-c'))).toBe(true);
        expect(precedes(band, screen.getByTestId('session-slot-d'))).toBe(true);
    });

    it('CONTROL: the resolved coverage rail stays in slot D', () => {
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={POINTS}
                showAnalyticsPrompt
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
                elapsedTime={84}
                practiceLoopReview={REVIEW_STATES[1][1]}
            />,
        );
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('focus-point-0'));
    });
});

describe('#1466 Practice Loop placement — before and during are unchanged', () => {
    it('CONTROL: no review band before recording', () => {
        render(<SessionOverhaulView {...base} practiceLoopReview={REVIEW_STATES[1][1]} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.queryByTestId('open-mic-practice-loop-review')).toBeNull();
    });

    it('CONTROL: no review band while recording', () => {
        render(<SessionOverhaulView {...base} isListening transcriptContent="so hello" elapsedTime={20} practiceLoopReview={REVIEW_STATES[1][1]} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(screen.queryByTestId('open-mic-practice-loop-review')).toBeNull();
    });
});

// #1466 PM RETURN 5673020845 (Codex P1 4010908720) — a user who stopped while scrolled down keeps that lower
// viewport. After the session settles, the view returns the page to its top ONCE per completed take, where the saved
// confirmation and the review sit together; a top-of-page user is never moved, and later review-state transitions
// never jump the page. jsdom has no layout, so each test states the page's scroll position and spies on the scroll.
describe('#1466 Practice Loop reveal — stopped while scrolled down', () => {
    const withLayout = (scrollY: number) => {
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
        const position = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(scrollY);
        return { scrollTo, restore: () => { scrollTo.mockRestore(); position.mockRestore(); } };
    };

    it('CASUALTY: a page scrolled down at completion returns to its top exactly once', () => {
        const layout = withLayout(900);
        try {
            render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
            expect(layout.scrollTo).toHaveBeenCalledTimes(1);
            expect(layout.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
        } finally { layout.restore(); }
    });

    it('CASUALTY: scrolled only far enough to hide the saved confirmation — the review may be visible — still returns to the top', () => {
        // The recorder sits between the confirmation and slot B, so a visible review heading does not mean a visible
        // confirmation. Deciding on the heading alone left the confirmation off screen (CI, desktop, #1493).
        const layout = withLayout(120);
        try {
            render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
            expect(layout.scrollTo).toHaveBeenCalledTimes(1);
        } finally { layout.restore(); }
    });

    it('CONTROL: a top-of-page user is never moved', () => {
        const layout = withLayout(0);
        try {
            const view = render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
            view.rerender(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[1][1]} />);
            expect(layout.scrollTo).not.toHaveBeenCalled();
        } finally { layout.restore(); }
    });

    it('CASUALTY: loading → rendered → failed transitions do not jump the page again', () => {
        const layout = withLayout(900);
        try {
            const view = render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
            view.rerender(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[1][1]} />);
            view.rerender(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[2][1]} />);
            expect(layout.scrollTo).toHaveBeenCalledTimes(1);
        } finally { layout.restore(); }
    });

    it('CASUALTY: nothing moves while the transcript is still finalizing; the reveal waits for the settled result', () => {
        const layout = withLayout(900);
        try {
            const view = render(<SessionOverhaulView {...base} isFinalizing transcriptContent="so hello" practiceLoopReview={REVIEW_STATES[0][1]} />);
            expect(layout.scrollTo).not.toHaveBeenCalled();
            view.rerender(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
            expect(layout.scrollTo).toHaveBeenCalledTimes(1);
        } finally { layout.restore(); }
    });

    it('CASUALTY: the next completed take may reveal once more — once per take, not once per page', () => {
        const layout = withLayout(900);
        try {
            const view = render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[1][1]} />);
            view.rerender(<SessionOverhaulView {...base} isListening transcriptContent="again" elapsedTime={10} practiceLoopReview={REVIEW_STATES[1][1]} />);
            view.rerender(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[1][1]} />);
            expect(layout.scrollTo).toHaveBeenCalledTimes(2);
        } finally { layout.restore(); }
    });

    it('CASUALTY: Focus Points follows the same reveal', () => {
        const layout = withLayout(900);
        try {
            render(
                <SessionOverhaulView
                    {...base}
                    objectivePoints={POINTS}
                    showAnalyticsPrompt
                    reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
                    elapsedTime={84}
                    practiceLoopReview={REVIEW_STATES[1][1]}
                />,
            );
            expect(layout.scrollTo).toHaveBeenCalledTimes(1);
        } finally { layout.restore(); }
    });

    it('CONTROL: no reveal before or during recording', () => {
        const layout = withLayout(900);
        try {
            const view = render(<SessionOverhaulView {...base} practiceLoopReview={REVIEW_STATES[1][1]} />);
            view.rerender(<SessionOverhaulView {...base} isListening transcriptContent="so hello" elapsedTime={20} practiceLoopReview={REVIEW_STATES[1][1]} />);
            expect(layout.scrollTo).not.toHaveBeenCalled();
        } finally { layout.restore(); }
    });
});
