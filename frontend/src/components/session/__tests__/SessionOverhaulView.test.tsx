import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';

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

// #1222 S11 — the view maps the live runtime onto the correct state through the shared shell.
describe('SessionOverhaulView (#1222 S11)', () => {
    it('idle runtime → before state (mic + prompt offer) through the shell', () => {
        render(<SessionOverhaulView {...base} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.getByTestId('mic-card')).toBeInTheDocument();
        expect(screen.getByTestId('prompt-offer')).toBeInTheDocument();
    });

    it('listening runtime → during state (recorder bar + live transcript)', () => {
        render(<SessionOverhaulView {...base} isListening transcriptContent="so um hello" elapsedTime={30} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(screen.getByTestId('recorder-bar')).toBeInTheDocument();
        expect(screen.getByTestId('live-transcript')).toBeInTheDocument();
        expect(screen.getAllByTestId('live-filler').length).toBeGreaterThan(0); // "um" highlighted
    });

    it('stopped runtime → after state, transcript-only (no audio play/time)', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt transcriptContent="so um hello" />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.getByTestId('playback-scrubber')).toBeInTheDocument();
        // Transcript-only: no audio playback affordances.
        expect(screen.queryByTestId('scrubber-play')).toBeNull();
        expect(screen.queryByTestId('scrubber-time')).toBeNull();
        // The filler legend + seekable transcript remain.
        expect(screen.getByTestId('scrubber-legend')).toBeInTheDocument();
    });

    // PO 2026-08-10: the post-Stop FINALIZING window must resolve to `after`, never `before` — otherwise the
    // "Not sure what to say?" prompt offer flashed back AND the captured mic envelope got wiped (flat waveform).
    it('finalizing (stopped, decode running, analytics not yet shown) resolves to AFTER, not the offer', () => {
        render(<SessionOverhaulView {...base} isFinalizing showAnalyticsPrompt={false} transcriptContent="so um hello" />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.getByTestId('playback-scrubber')).toBeInTheDocument();
        // The before-state prompt offer must NOT appear during finalizing.
        expect(screen.queryByTestId('prompt-offer')).toBeNull();
    });

    it('a mic-permission error keeps the before state and surfaces the error in the mic card', () => {
        render(<SessionOverhaulView {...base} sttStatus={{ type: 'error', message: 'Mic blocked' } as SttStatus} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.getByTestId('mic-error')).toHaveTextContent('Mic blocked');
    });
});

// #1046 Focus Points integration — a bound brief (objectivePoints) makes slot D carry the points
// (plan before/during) then their resolved coverage (after), so a Focus Points session is its own thing
// on the shared shell instead of rendering as an Open Floor session.
describe('SessionOverhaulView Focus Points (#1046)', () => {
    const POINTS = ['Name the price', 'State the guarantee'];

    it('objective before → points plan in slot D (not the coaching card)', () => {
        render(<SessionOverhaulView {...base} objectivePoints={POINTS} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.getByTestId('focus-points-plan')).toBeInTheDocument();
        expect(screen.getByTestId('focus-points-plan-summary')).toHaveTextContent('2 to cover');
        expect(screen.getByTestId('focus-plan-point-0')).toHaveTextContent('Name the price');
        // Not yet scored → no coverage rail before recording.
        expect(screen.queryByTestId('coverage-rail')).toBeNull();
    });

    it('objective during → points plan stays in slot D', () => {
        render(<SessionOverhaulView {...base} objectivePoints={POINTS} isListening transcriptContent="hello" elapsedTime={10} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(screen.getByTestId('focus-points-plan')).toBeInTheDocument();
        expect(screen.queryByTestId('coverage-rail')).toBeNull();
    });

    it('objective after with resolved coverage → coverage rail replaces the plan/verdict', () => {
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={POINTS}
                objectiveCoverage={[
                    { id: 'c0', label: 'Name the price', status: 'covered' },
                    { id: 'c1', label: 'State the guarantee', status: 'missing' },
                ]}
                showAnalyticsPrompt
                transcriptContent="so um hello"
            />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.getByTestId('coverage-rail')).toBeInTheDocument();
        expect(screen.getByTestId('coverage-rail-summary')).toHaveTextContent('1/2 covered');
    });

    it('objective after with no coverage yet → falls back to the pending plan (never a stale verdict)', () => {
        render(<SessionOverhaulView {...base} objectivePoints={POINTS} objectiveCoverage={null} showAnalyticsPrompt transcriptContent="hello" />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.getByTestId('focus-points-plan')).toBeInTheDocument();
        expect(screen.queryByTestId('coverage-rail')).toBeNull();
    });

    it('no brief (Open Floor) → slot D is the coaching path, never a points plan', () => {
        render(<SessionOverhaulView {...base} objectivePoints={null} />);
        expect(screen.queryByTestId('focus-points-plan')).toBeNull();
        expect(screen.queryByTestId('coverage-rail')).toBeNull();
    });
});
