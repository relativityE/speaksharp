import { render, screen, act } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';
import { useSessionStore } from '@/stores/useSessionStore';

// #1258 C10 — ONE definition of "recording begins" (PRODUCT_REQUIREMENTS §5): the take is live only when capture is live on
// real microphone frames. Entering RECORDING (`isListening`) without real frames keeps the start state: no recorder bar,
// no RECORDING/timer, and the pressed control still reads `Starting…`.
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

describe('C10 — the live state waits for real-frame capture', () => {
    beforeEach(() => {
        useSessionStore.setState({ captureLive: false, startupWaitStartedAt: null, progressGate: null, progressGateResolvedFor: 'user-1' });
    });

    it('RECORDING without real frames stays in the start state: no recorder bar, the control reads Starting…', () => {
        useSessionStore.setState({ startupWaitStartedAt: Date.now() });
        render(<SessionOverhaulView {...base} isListening />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.queryByTestId('recorder-bar')).toBeNull();
        expect(screen.getByTestId('mic-start')).toHaveTextContent('Starting…');
        expect(screen.getByTestId('mic-start')).toBeDisabled();
    });

    it('real-frame capture makes it live: the recorder bar appears and Starting… is gone', () => {
        useSessionStore.setState({ startupWaitStartedAt: Date.now() });
        const { rerender } = render(<SessionOverhaulView {...base} isListening />);
        act(() => { useSessionStore.setState({ captureLive: true }); });
        rerender(<SessionOverhaulView {...base} isListening />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(screen.getByTestId('recorder-bar')).toBeInTheDocument();
        expect(screen.queryByText('Starting…')).toBeNull();
    });
});
