import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';

/**
 * #1416 F-05 — the REVIEW reads the retained transcript, through the rendered parent.
 *
 * `purgeTranscriptWorkingMemory` empties `transcriptContent` at finalization by contract, so every
 * case below passes `transcriptContent: ''` — that is the real post-finalization input, not a
 * contrivance. What the user reads must come from the retained authority instead.
 *
 * Driven through `SessionOverhaulView` rather than the notice component, because the defect is that
 * the PARENT was wired to working memory. A component test of the notice would have passed
 * throughout the entire period this was broken.
 */
const after: SessionOverhaulViewProps = {
    authUserId: 'user-1',
    isListening: false,
    sttStatus: { type: 'ready' } as SttStatus,
    elapsedTime: 42,
    micLevel: 0,
    // Purged. This is what finalization leaves behind.
    transcriptContent: '',
    showAnalyticsPrompt: true,
    metricsFillerCount: 0,
    onStartStop: vi.fn(),
    history: [],
};

describe('#1416 F-05 the review transcript comes from the retained authority', () => {
    it('renders the RETAINED words even though working memory was purged', () => {
        render(<SessionOverhaulView {...after} reviewTranscript={{ kind: 'available', text: 'the words I actually said' }} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        // The transcript renders as per-word tokens, so the phrase is split across spans; assert on
        // the rendered text of the slot rather than a single node.
        expect(screen.getByTestId('session-shell').textContent).toContain('actually');
        expect(screen.getByTestId('session-shell').textContent).toContain('said');
        expect(screen.queryByTestId('review-transcript-notice')).not.toBeInTheDocument();
    });

    it('CASUALTY: a FAILED read is not reported as aged out — it offers a retry', () => {
        // The distinction that matters most. Telling a user their transcript expired when the read
        // merely stalled is a false statement about their own session, and it is unrecoverable from
        // their side — they stop looking for something that is still there.
        render(<SessionOverhaulView {...after} reviewTranscript={{ kind: 'unavailable' }} onRetryReviewTranscript={vi.fn()} />);
        const notice = screen.getByTestId('review-transcript-notice');
        expect(notice).toHaveAttribute('data-outcome', 'unavailable');
        expect(notice).not.toHaveTextContent(/no longer stored/i);
        expect(notice).not.toHaveTextContent(/no speech was captured/i);
        expect(screen.getByTestId('review-transcript-retry')).toBeInTheDocument();
    });

    it('CASUALTY: a failed read does not render an empty transcript either', () => {
        // The pre-fix behaviour: silence. An empty transcript reads as "your words are gone" without
        // ever saying so, which is the least recoverable version of being wrong.
        render(<SessionOverhaulView {...after} reviewTranscript={{ kind: 'unavailable' }} />);
        expect(screen.getByTestId('review-transcript-notice')).toBeInTheDocument();
    });

    it('CASUALTY: a read that has not settled says LOADING, not that it failed', () => {
        // `unavailable` means two different things and the shared authority cannot tell them apart,
        // because it reads a saved row and finalization is a client lifecycle. Mid-finalization it is
        // a wait; settled it is a failure with a retry. Collapsing them either invents a failure or
        // hides one.
        render(<SessionOverhaulView {...after} reviewStillSettling reviewTranscript={{ kind: 'unavailable' }} />);
        const notice = screen.getByTestId('review-transcript-notice');
        expect(notice).toHaveAttribute('data-outcome', 'pending');
        expect(notice).toHaveTextContent(/loading/i);
        expect(screen.queryByTestId('review-transcript-retry')).not.toBeInTheDocument();
    });

    it('keeps aged-out and never-captured as different sentences', () => {
        const { rerender } = render(<SessionOverhaulView {...after} reviewTranscript={{ kind: 'expired' }} />);
        expect(screen.getByTestId('review-transcript-notice')).toHaveTextContent(/no longer stored/i);

        rerender(<SessionOverhaulView {...after} reviewTranscript={{ kind: 'not_captured' }} />);
        expect(screen.getByTestId('review-transcript-notice')).toHaveTextContent(/no speech was captured/i);
    });

    it('CASUALTY: an UNWIRED parent shows no transcript, not working memory', () => {
        // No `reviewTranscript` prop at all — a parent that has not been migrated. It must not
        // silently keep reading the purged buffer, because that is the defect wearing a default.
        render(<SessionOverhaulView {...after} transcriptContent="stale residue from a different take" />);
        expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'unavailable');
        expect(screen.getByTestId('session-shell').textContent).not.toContain('stale residue');
    });

    it('CASUALTY: the review never falls back to working memory', () => {
        // If the parent fell back to `transcriptContent` when the authority says nothing is readable,
        // a stale buffer would be presented as the saved session — and the fix would look like it
        // worked, intermittently.
        render(
            <SessionOverhaulView
                {...after}
                transcriptContent="stale residue from a different take"
                reviewTranscript={{ kind: 'expired' }}
            />,
        );
        expect(screen.getByTestId('session-shell').textContent).not.toContain('stale residue');
    });
});
