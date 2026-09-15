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
