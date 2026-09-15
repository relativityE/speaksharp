import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';

// #1466 PM acceptance lock (P1, PO evidence on 576c4712): after a completed session the Practice Loop must be
// at eye level — ahead of transcript detail and secondary session actions — in every review state, on phones
// as well as desktop, and in keyboard / screen-reader order. The shell stacks to one column on phones, so
// "ahead" is DOM order: a band rendered after `session-shell` is last on every breakpoint and for every
// assistive technology, which is exactly where the PO found it. A scroll does not change that order.

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
    it.each(REVIEW_STATES)('CASUALTY: the %s review band precedes the session shell', (_state, review) => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={review} />);
        const shell = screen.getByTestId('session-shell');
        expect(shell).toHaveAttribute('data-session-state', 'after');
        const band = screen.getByTestId('open-mic-practice-loop-review');
        expect(band).toContainElement(screen.getByTestId('review-probe'));
        expect(precedes(band, shell)).toBe(true);
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
        expect(precedes(band, screen.getByTestId('session-slot-b'))).toBe(true);
        expect(precedes(band, screen.getByTestId('verdict-practice-again'))).toBe(true);
    });

    it('CASUALTY: keyboard order reaches the review control before any session action', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[2][1]} />);
        const tabbable = [...document.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
        const retry = screen.getByRole('button', { name: 'Retry' });
        expect(tabbable.indexOf(retry)).toBeGreaterThanOrEqual(0);
        expect(tabbable.indexOf(retry)).toBeLessThan(tabbable.indexOf(screen.getByTestId('verdict-practice-again')));
    });

    it('CONTROL (#1422 P1): the review never evicts the verdict — Practice this again stays in slot D', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[1][1]} />);
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('verdict-practice-again'));
        expect(screen.getByTestId('session-slot-d')).not.toContainElement(screen.getByTestId('review-probe'));
    });
});

describe('#1466 Practice Loop placement — Focus Points after state', () => {
    it.each(REVIEW_STATES)('CASUALTY: the %s review band precedes the session shell', (_state, review) => {
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
        const shell = screen.getByTestId('session-shell');
        expect(shell).toHaveAttribute('data-session-state', 'after');
        const band = screen.getByTestId('focus-practice-loop-review');
        expect(precedes(band, shell)).toBe(true);
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

// #1466 PM RETURN 5673020845 (Codex P1 4010908720) — placement first in the DOM is not enough for a user who stopped
// while scrolled down: browsers keep that lower viewport while the band is inserted above it. After the session
// settles, the view reveals the band ONCE per completed take, and ONLY when its heading/current state is outside the
// viewport; a user who can already see it is never moved, and later review-state transitions never jump the page.
// jsdom has no layout, so each test states where the band sits (viewport-relative top) and spies on the page scroll.
describe('#1466 Practice Loop reveal — stopped while scrolled down', () => {
    const withLayout = (bandTop: number | null) => {
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const id = this.getAttribute('data-testid');
            const isBand = id === 'open-mic-practice-loop-review' || id === 'focus-practice-loop-review';
            const top = isBand && bandTop !== null ? bandTop : 0;
            return { top, bottom: top + 220, left: 0, right: 375, width: 375, height: 220, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
        });
        const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(812);
        return { scrollTo, restore: () => { scrollTo.mockRestore(); rect.mockRestore(); height.mockRestore(); } };
    };

    it('CASUALTY: a band above the viewport at completion is revealed exactly once', () => {
        const layout = withLayout(-900);
        try {
            render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
            expect(layout.scrollTo).toHaveBeenCalledTimes(1);
            expect(layout.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
        } finally { layout.restore(); }
    });

    it('CASUALTY: a band below the viewport at completion is revealed exactly once', () => {
        const layout = withLayout(1400);
        try {
            render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
            expect(layout.scrollTo).toHaveBeenCalledTimes(1);
        } finally { layout.restore(); }
    });

    it('CONTROL: a band already in view never moves the page', () => {
        const layout = withLayout(260);
        try {
            const view = render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
            view.rerender(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[1][1]} />);
            expect(layout.scrollTo).not.toHaveBeenCalled();
        } finally { layout.restore(); }
    });

    it('CASUALTY: loading → rendered → failed transitions do not jump the page again', () => {
        const layout = withLayout(-900);
        try {
            const view = render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
            view.rerender(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[1][1]} />);
            view.rerender(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[2][1]} />);
            expect(layout.scrollTo).toHaveBeenCalledTimes(1);
        } finally { layout.restore(); }
    });

    it('CASUALTY: nothing moves while the transcript is still finalizing; the reveal waits for the settled result', () => {
        const layout = withLayout(-900);
        try {
            const view = render(<SessionOverhaulView {...base} isFinalizing transcriptContent="so hello" practiceLoopReview={REVIEW_STATES[0][1]} />);
            expect(layout.scrollTo).not.toHaveBeenCalled();
            view.rerender(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
            expect(layout.scrollTo).toHaveBeenCalledTimes(1);
        } finally { layout.restore(); }
    });

    it('CASUALTY: the next completed take may reveal once more — once per take, not once per page', () => {
        const layout = withLayout(-900);
        try {
            const view = render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[1][1]} />);
            view.rerender(<SessionOverhaulView {...base} isListening transcriptContent="again" elapsedTime={10} practiceLoopReview={REVIEW_STATES[1][1]} />);
            view.rerender(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[1][1]} />);
            expect(layout.scrollTo).toHaveBeenCalledTimes(2);
        } finally { layout.restore(); }
    });

    it('CASUALTY: Focus Points follows the same reveal', () => {
        const layout = withLayout(-900);
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
        const layout = withLayout(-900);
        try {
            const view = render(<SessionOverhaulView {...base} practiceLoopReview={REVIEW_STATES[1][1]} />);
            view.rerender(<SessionOverhaulView {...base} isListening transcriptContent="so hello" elapsedTime={20} practiceLoopReview={REVIEW_STATES[1][1]} />);
            expect(layout.scrollTo).not.toHaveBeenCalled();
        } finally { layout.restore(); }
    });
});
