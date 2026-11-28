import { render, screen, fireEvent, act } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';
import { useSessionStore } from '@/stores/useSessionStore';
import { clearConfidencePilot, confidencePilotSnapshot } from '@/services/confidenceCheck/pilotState';

/**
 * Practice confidence check pilot wired into the session page (spec Revision 1). The view's state follows the props:
 * before (idle), during (listening + capture live), after (stopped with the review prompt).
 */
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
const REVIEW = <div data-testid="review-probe">Your coaching review</div>;
const before = (over: Partial<SessionOverhaulViewProps> = {}) => <SessionOverhaulView {...base} {...over} />;
const during = (over: Partial<SessionOverhaulViewProps> = {}) => <SessionOverhaulView {...base} isListening elapsedTime={40} {...over} />;
const after = (over: Partial<SessionOverhaulViewProps> = {}) => <SessionOverhaulView {...base} showAnalyticsPrompt scoringElapsedSeconds={40}
    reviewTranscript={{ kind: 'available', text: 'um so hello there' }} practiceLoopReview={REVIEW} {...over} />;

beforeEach(() => {
    clearConfidencePilot();
    useSessionStore.setState({ captureLive: true, progressGate: null, progressGateResolvedFor: 'user-1' });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('confidence check pilot in the session page', () => {
    it('flag off (default): no question before or after, and the review shows exactly as today', () => {
        const { rerender } = render(before());
        expect(screen.queryByTestId('confidence-pre')).toBeNull();
        rerender(during()); rerender(after());
        fireEvent.click(screen.getByTestId('verdict-practice-again'));
        rerender(during()); rerender(after());
        expect(screen.queryByTestId('confidence-post')).toBeNull();
        expect(screen.getByTestId('review-probe')).toBeInTheDocument();
        expect(screen.getByTestId('this-run-card')).toBeInTheDocument();
    });

    it('flag on: an explicit loop asks before the first take, then asks after the repeat BEFORE showing anything measured', () => {
        vi.stubEnv('VITE_CONFIDENCE_CHECK_PILOT_ENABLED', 'true');
        const { rerender } = render(before());
        expect(screen.getByTestId('confidence-pre')).toBeInTheDocument();
        expect(screen.queryByTestId('confidence-pre-rating')).toBeNull();
        fireEvent.click(screen.getByTestId('confidence-start-loop'));
        fireEvent.click(screen.getByTestId('confidence-pre-rating-2'));
        fireEvent.click(screen.getByTestId('mic-start'));
        expect(base.onStartStop).toHaveBeenCalled();

        rerender(during()); rerender(after());
        // The first take's after screen: no post questions, the normal review.
        expect(screen.queryByTestId('confidence-post')).toBeNull();
        expect(screen.getByTestId('review-probe')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('verdict-practice-again'));
        // Still the first take's after screen while the repeat starts: it does not switch to the questions.
        expect(screen.queryByTestId('confidence-post')).toBeNull();
        // The repeat's normal save: the after screen first shows while finalizing, then once saved.
        rerender(during());
        rerender(<SessionOverhaulView {...base} isFinalizing scoringElapsedSeconds={40} practiceLoopReview={REVIEW} />);
        expect(screen.getByTestId('confidence-post')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('confidence-post-rating-4'));
        rerender(after());

        expect(screen.getByTestId('confidence-post')).toBeInTheDocument();
        expect(screen.getByTestId('confidence-post-rating-4')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByTestId('review-probe')).toBeNull();
        expect(screen.queryByTestId('this-run-card')).toBeNull();

        expect(screen.getByTestId('confidence-feel')).toHaveTextContent('Compared with your last take, this take felt:');
        fireEvent.click(screen.getByTestId('confidence-feel-easier'));
        fireEvent.click(screen.getByTestId('confidence-reveal'));

        expect(screen.queryByTestId('confidence-post')).toBeNull();
        expect(screen.getByTestId('review-probe')).toBeInTheDocument();
        expect(screen.getByTestId('this-run-card')).toBeInTheDocument();
        expect(screen.getByTestId('confidence-you-said'))
            .toHaveTextContent('You said: readiness 2 (A little) before the loop, 4 (Mostly) now · target felt: easier. Self-reported, not a measurement of your delivery.');
    });

    it('flag on: "Show my review" skips straight to the review; nothing is asked again on re-render', () => {
        vi.stubEnv('VITE_CONFIDENCE_CHECK_PILOT_ENABLED', 'true');
        const { rerender } = render(after());
        fireEvent.click(screen.getByTestId('verdict-practice-again'));
        rerender(during()); rerender(after());
        fireEvent.click(screen.getByTestId('confidence-reveal'));
        expect(screen.getByTestId('review-probe')).toBeInTheDocument();
        rerender(after());
        expect(screen.queryByTestId('confidence-post')).toBeNull();
        expect(screen.queryByTestId('confidence-you-said')).toBeNull();
    });

    it('flag on: a linked repeat (from a saved review) gets no before question, but is asked after', () => {
        vi.stubEnv('VITE_CONFIDENCE_CHECK_PILOT_ENABLED', 'true');
        const practiceTarget = { kind: 'ready', instruction: 'Cut filler words toward 2%' } as const;
        const { rerender } = render(before({ practiceTarget }));
        expect(screen.queryByTestId('confidence-pre')).toBeNull();
        fireEvent.click(screen.getByTestId('mic-start'));
        rerender(during({ practiceTarget })); rerender(after({ practiceTarget }));
        expect(screen.getByTestId('confidence-post')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('confidence-post-rating-3'));
        expect(screen.getByTestId('confidence-feel')).toHaveTextContent('How did your practice target feel this time?');
    });

    it('flag on: a plain one-off take is never asked anything', () => {
        vi.stubEnv('VITE_CONFIDENCE_CHECK_PILOT_ENABLED', 'true');
        const { rerender } = render(before());
        fireEvent.click(screen.getByTestId('mic-start'));
        rerender(during()); rerender(after());
        expect(screen.queryByTestId('confidence-post')).toBeNull();
        expect(screen.queryByTestId('confidence-you-said')).toBeNull();
        expect(screen.getByTestId('review-probe')).toBeInTheDocument();
    });

    it('flag on: signing out drops the answers', () => {
        vi.stubEnv('VITE_CONFIDENCE_CHECK_PILOT_ENABLED', 'true');
        const { rerender } = render(before());
        fireEvent.click(screen.getByTestId('confidence-start-loop'));
        fireEvent.click(screen.getByTestId('confidence-pre-rating-5'));
        expect(screen.getByTestId('confidence-pre-rating-5')).toHaveAttribute('aria-pressed', 'true');
        act(() => { rerender(before({ authUserId: null })); });
        rerender(before());
        expect(screen.queryByTestId('confidence-pre-rating')).toBeNull();
        expect(screen.getByTestId('confidence-start-loop')).toBeInTheDocument();
    });

    it('flag on: leaving the repeat\'s review screen before answering (Progress, History) counts as a skip; nothing is gated', () => {
        vi.stubEnv('VITE_CONFIDENCE_CHECK_PILOT_ENABLED', 'true');
        const { rerender, unmount } = render(after());
        fireEvent.click(screen.getByTestId('verdict-practice-again'));
        rerender(during()); rerender(after());
        expect(screen.getByTestId('confidence-post')).toBeInTheDocument();
        unmount();
        expect(confidencePilotSnapshot()).toMatchObject({ askPost: false, post: 'skipped', feel: 'skipped' });
        render(after());
        expect(screen.queryByTestId('confidence-post')).toBeNull();
        expect(screen.getByTestId('review-probe')).toBeInTheDocument();
    });

    it('a reload starts empty: the answers lived only in page memory', async () => {
        vi.stubEnv('VITE_CONFIDENCE_CHECK_PILOT_ENABLED', 'true');
        const { rerender } = render(before());
        fireEvent.click(screen.getByTestId('confidence-start-loop'));
        fireEvent.click(screen.getByTestId('confidence-pre-rating-3'));
        expect(confidencePilotSnapshot()).toMatchObject({ pre: 3 });
        rerender(<></>);
        vi.resetModules();
        const fresh = await import('@/services/confidenceCheck/pilotState');
        expect(fresh.confidencePilotSnapshot()).toBeNull();
    });

    it('flag on: after a completed loop, a new set offers "Start a practice loop" again and takes a fresh baseline', () => {
        vi.stubEnv('VITE_CONFIDENCE_CHECK_PILOT_ENABLED', 'true');
        const { rerender } = render(before());
        fireEvent.click(screen.getByTestId('confidence-start-loop'));
        fireEvent.click(screen.getByTestId('confidence-pre-rating-2'));
        fireEvent.click(screen.getByTestId('mic-start'));
        rerender(during()); rerender(after());
        // "Start a new set" (or any return to the before screen) after the loop's take
        rerender(before());
        expect(screen.queryByTestId('confidence-pre-rating')).toBeNull();
        fireEvent.click(screen.getByTestId('confidence-start-loop'));
        fireEvent.click(screen.getByTestId('confidence-pre-rating-5'));
        expect(screen.getByTestId('confidence-pre-rating-5')).toHaveAttribute('aria-pressed', 'true');
        expect(confidencePilotSnapshot()).toMatchObject({ loopStarted: true, pre: 5, tookTake: false });
    });

    it('flag on: a linked repeat of a DIFFERENT saved session never shows an earlier loop\'s baseline as "before the loop"', () => {
        vi.stubEnv('VITE_CONFIDENCE_CHECK_PILOT_ENABLED', 'true');
        const { rerender } = render(before());
        fireEvent.click(screen.getByTestId('confidence-start-loop'));
        fireEvent.click(screen.getByTestId('confidence-pre-rating-2'));
        fireEvent.click(screen.getByTestId('mic-start'));
        rerender(during()); rerender(after());
        fireEvent.click(screen.getByTestId('verdict-practice-again'));
        rerender(during()); rerender(after());
        fireEvent.click(screen.getByTestId('confidence-post-rating-4'));
        fireEvent.click(screen.getByTestId('confidence-reveal'));
        // Later: History → another saved session → its linked "Practice again".
        const practiceTarget = { kind: 'ready', instruction: 'Cut filler words toward 2%' } as const;
        rerender(before({ practiceTarget }));
        fireEvent.click(screen.getByTestId('mic-start'));
        rerender(during({ practiceTarget })); rerender(after({ practiceTarget }));
        fireEvent.click(screen.getByTestId('confidence-post-rating-5'));
        fireEvent.click(screen.getByTestId('confidence-reveal'));
        expect(screen.getByTestId('confidence-you-said')).toHaveTextContent('You said: readiness 5 (Fully ready) now.');
        expect(screen.getByTestId('confidence-you-said')).not.toHaveTextContent('before the loop');
    });

    it('flag on: a linked repeat keeps its target question after its Progress settles (target hook goes to none)', () => {
        vi.stubEnv('VITE_CONFIDENCE_CHECK_PILOT_ENABLED', 'true');
        const practiceTarget = { kind: 'ready', instruction: 'Cut filler words toward 2%' } as const;
        const { rerender } = render(before({ practiceTarget }));
        fireEvent.click(screen.getByTestId('mic-start'));
        rerender(during({ practiceTarget }));
        // the repeat's attempt resolves during save: useRepeatPracticeTarget now reports kind none
        rerender(after({ practiceTarget: { kind: 'none' } }));
        fireEvent.click(screen.getByTestId('confidence-post-rating-3'));
        expect(screen.getByTestId('confidence-feel')).toHaveTextContent('How did your practice target feel this time?');
        // a later in-session repeat of that take compares with the last take
        fireEvent.click(screen.getByTestId('confidence-reveal'));
        fireEvent.click(screen.getByTestId('verdict-practice-again'));
        rerender(during({ practiceTarget: { kind: 'none' } })); rerender(after({ practiceTarget: { kind: 'none' } }));
        fireEvent.click(screen.getByTestId('confidence-post-rating-3'));
        expect(screen.getByTestId('confidence-feel')).toHaveTextContent('Compared with your last take, this take felt:');
    });
});

