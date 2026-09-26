import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';
import { useSessionStore } from '@/stores/useSessionStore';

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
    // #1533 P2 #3: after-session actions share the mic's live gate — resolve it for this owner, nothing owed.
    beforeEach(() => { useSessionStore.setState({ progressGate: null, progressGateResolvedFor: 'user-1' }); });
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

// #1258 RWT (PM: VALID P2) — a Stop tapped during a phone fling: the momentum carried the page past the one reveal.
// The reveal now arms a bounded re-check. These pin its bounds: a correction each time scrolling comes to rest away from
// the top (a fling can pause and resume), at most 3; it ends at rest-at-top, at the person's own input, or after 3 s.
describe('#1258 Practice Loop reveal — momentum after the reveal (bounded re-check)', () => {
    let y = 0;
    let scrollTo: ReturnType<typeof vi.spyOn>;
    let position: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        vi.useFakeTimers();
        y = 900;
        // Browser-faithful (Codex P2 r4112253576): a programmatic scrollTo that moves the page emits its own `scroll`.
        scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(((opts: ScrollToOptions) => {
            const target = opts.top ?? y;
            const moved = target !== y;
            y = target;
            if (moved) window.dispatchEvent(new Event('scroll'));
        }) as typeof window.scrollTo);
        position = vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
    });
    afterEach(() => { scrollTo.mockRestore(); position.mockRestore(); vi.useRealTimers(); });
    const momentum = (to: number) => { y = to; window.dispatchEvent(new Event('scroll')); };

    it('CASUALTY: momentum that carries the page off its top after the reveal is returned there when it comes to rest', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        expect(scrollTo).toHaveBeenCalledTimes(1);
        momentum(300); vi.advanceTimersByTime(50); momentum(700); vi.advanceTimersByTime(50); momentum(837);
        vi.advanceTimersByTime(149);
        expect(scrollTo, 'not while still moving').toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(scrollTo).toHaveBeenCalledTimes(2);
        expect(y).toBe(0);
    });

    it('CASUALTY (Codex P2 r4112253576): the correction\'s own scroll event does not disarm it — a fling that pauses >150 ms at the top and then resumes is corrected again', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        momentum(700); vi.advanceTimersByTime(150);   // rests off the top → correction; its own scroll event fires at y=0
        expect(scrollTo).toHaveBeenCalledTimes(2);
        expect(y).toBe(0);
        vi.advanceTimersByTime(400);                  // a pause longer than 150 ms, resting at the top
        momentum(300); vi.advanceTimersByTime(150);   // the fling resumes and rests again
        expect(scrollTo, 'the resumed fling is corrected').toHaveBeenCalledTimes(3);
        expect(y).toBe(0);
    });

    it('CASUALTY (traced): a fling that pauses, is corrected, then resumes is corrected again when it rests', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        momentum(335); vi.advanceTimersByTime(150);          // a pause that looks like rest → first correction
        expect(scrollTo).toHaveBeenCalledTimes(2);
        momentum(75); vi.advanceTimersByTime(20); momentum(96); // the remaining fling resumes after the correction
        vi.advanceTimersByTime(150);
        expect(scrollTo).toHaveBeenCalledTimes(3);
        expect(y).toBe(0);
    });

    it('CONTROL: never a loop — at most 3 corrections even if the page keeps drifting', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        for (let i = 0; i < 6; i += 1) { momentum(200); vi.advanceTimersByTime(150); }
        expect(scrollTo).toHaveBeenCalledTimes(1 + 3);
    });

    it.each(['touchstart', 'wheel', 'keydown', 'pointerdown'])('CONTROL: after the reveal, the person\'s own %s disarms it — their scrolling is never fought', (type) => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        window.dispatchEvent(new Event(type));
        momentum(400); vi.advanceTimersByTime(500);
        expect(scrollTo).toHaveBeenCalledTimes(1);
        expect(y).toBe(400);
    });

    it('CASUALTY (Codex P2 r4112400154): a touch that began BEFORE the guard armed — only moves after — is the person\'s scroll, never fought', () => {
        window.dispatchEvent(new Event('touchstart')); // the finger went down before the review settled (no listener yet)
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        expect(scrollTo).toHaveBeenCalledTimes(1);       // the one reveal
        window.dispatchEvent(new Event('touchmove'));     // the same finger keeps moving
        momentum(400); vi.advanceTimersByTime(500);
        expect(scrollTo).toHaveBeenCalledTimes(1);
        expect(y).toBe(400);
    });

    it('CASUALTY (Codex P2 r4112400154): a pointer moving WITH a pressed contact disarms it', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1 }));
        momentum(400); vi.advanceTimersByTime(500);
        expect(scrollTo).toHaveBeenCalledTimes(1);
        expect(y).toBe(400);
    });

    it('CONTROL: hover (a pointer move with no contact) does NOT disable the guard — momentum after it is still corrected', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        window.dispatchEvent(new MouseEvent('pointermove', { buttons: 0 }));
        momentum(700); vi.advanceTimersByTime(150);
        expect(scrollTo).toHaveBeenCalledTimes(2);
        expect(y).toBe(0);
    });

    it('CONTROL: bounded in time — scrolling that starts after 3 s is left alone', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        vi.advanceTimersByTime(3000);
        momentum(400); vi.advanceTimersByTime(500);
        expect(scrollTo).toHaveBeenCalledTimes(1);
    });

    it('CONTROL: momentum that comes to rest AT the top needs no second scroll', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        momentum(0); vi.advanceTimersByTime(500);
        expect(scrollTo).toHaveBeenCalledTimes(1);
    });

    it('CONTROL: a top-of-page user arms nothing (no reveal, no re-check)', () => {
        y = 0;
        render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        momentum(400); vi.advanceTimersByTime(500);
        expect(scrollTo).not.toHaveBeenCalled();
    });

    it('CONTROL: leaving the review (unmount) removes the guard — no scroll after it is gone', () => {
        const view = render(<SessionOverhaulView {...base} showAnalyticsPrompt practiceLoopReview={REVIEW_STATES[0][1]} />);
        view.unmount();
        momentum(400); vi.advanceTimersByTime(500);
        expect(scrollTo).toHaveBeenCalledTimes(1);
    });
});
