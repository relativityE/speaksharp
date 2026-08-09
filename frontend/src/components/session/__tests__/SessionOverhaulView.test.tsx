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

    it('a mic-permission error keeps the before state and surfaces the error in the mic card', () => {
        render(<SessionOverhaulView {...base} sttStatus={{ type: 'error', message: 'Mic blocked' } as SttStatus} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.getByTestId('mic-error')).toHaveTextContent('Mic blocked');
    });
});
