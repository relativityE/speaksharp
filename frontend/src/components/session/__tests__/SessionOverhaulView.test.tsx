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

// #1046 Focus Points — a distinct product on the shared shell (spec: "slots are shared; semantics are
// not"). A bound brief (objectivePoints) turns slot C into live coverage, slot D into the points, strips
// the prompt offer + filler chrome, and highlights coverage in the transcript. Coverage is derived from
// the transcript by the local keyword matcher, so these tests drive it with real covering text.
describe('SessionOverhaulView Focus Points (#1046)', () => {
    const POINTS = ['Name the price', 'State the guarantee'];

    it('objective before → NO coverage/pace card (slot C absent), points rail present; no prompt offer', () => {
        render(<SessionOverhaulView {...base} objectivePoints={POINTS} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        // §2: Slot C does not render in `before` — the rail begins with Slot D (the one intentional break).
        expect(screen.queryByTestId('coverage-pace')).toBeNull();
        expect(screen.queryByTestId('session-slot-c')).toBeNull();
        expect(screen.getByTestId('focus-points-rail')).toBeInTheDocument();
        expect(screen.getByTestId('focus-point-0')).toHaveTextContent('Name the price');
        // The Open-Mic prompt offer does not belong on Focus Points.
        expect(screen.queryByTestId('prompt-offer')).toBeNull();
    });

    it('objective during → Coverage & pace shows the count and a covered point ticks in slot D', () => {
        render(<SessionOverhaulView {...base} objectivePoints={POINTS} isListening transcriptContent="I will name the price now." elapsedTime={20} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('1/2');
        expect(screen.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'covered');
    });

    it('objective after → coverage count, missed-point reason, retry + delivery strip', () => {
        render(<SessionOverhaulView {...base} objectivePoints={POINTS} showAnalyticsPrompt transcriptContent="I will name the price now." elapsedTime={84} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('1/2');
        // The missed point is the most important line — it names the honest cause + the forward move.
        expect(screen.getByTestId('focus-point-1-not-detected')).toBeInTheDocument();
        expect(screen.getByTestId('focus-points-retry')).toBeInTheDocument();
        expect(screen.getByTestId('focus-delivery-strip')).toBeInTheDocument();
    });

    it('no brief (Open Mic) → no coverage/pace card / points rail; the prompt offer is present', () => {
        render(<SessionOverhaulView {...base} objectivePoints={null} />);
        expect(screen.queryByTestId('coverage-pace')).toBeNull();
        expect(screen.queryByTestId('focus-points-rail')).toBeNull();
        expect(screen.getByTestId('prompt-offer')).toBeInTheDocument();
    });
});
