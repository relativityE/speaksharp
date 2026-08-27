import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import { useSessionStore } from '@/stores/useSessionStore';
import type { SttStatus } from '@/types/transcription';

// #1354 CASE 4/6 — the RENDERED gate, for both entry points.
//
// A disabled button is a cue, never the gate: `startRecording` re-reads the durable queue on every
// attempt regardless of what is rendered. What this file protects is that the UI never TELLS the user
// they may record when they may not — including the reload window where the answer is not yet known.
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
const startButton = () => screen.getByTestId('mic-start');

beforeEach(() => {
    useSessionStore.getState().setProgressGate(null);
    useSessionStore.getState().setProgressGateResolved(false);
});

describe('the rendered Start control reflects the Progress gate', () => {
    it('NO ENABLED FRAME while the gate is still unknown', () => {
        // On reload `progressGate: null` means both "nothing owed" and "we have not looked yet".
        // Rendering enabled during that window is the flash this prevents.
        render(<SessionOverhaulView {...base} />);
        expect(startButton()).toBeDisabled();
    });

    it('enabled once the question is RESOLVED and nothing is owed', () => {
        useSessionStore.getState().setProgressGateResolved(true);
        render(<SessionOverhaulView {...base} />);
        expect(startButton()).toBeEnabled();
    });

    it.each(['resolving', 'queued', 'unresolved'] as const)('a %s gate disables Start', (state) => {
        useSessionStore.getState().setProgressGateResolved(true);
        useSessionStore.getState().setProgressGate({ sessionId: 's-prev', ownerId: 'user-1', state });
        render(<SessionOverhaulView {...base} />);
        expect(startButton()).toBeDisabled();
    });

    it('PARITY: Focus Points renders the same gate as Open Mic', () => {
        // Both entry points render through this component and this single `mic.disabled`, so parity is
        // structural rather than two copies kept in step by hand.
        useSessionStore.getState().setProgressGateResolved(true);
        useSessionStore.getState().setProgressGate({ sessionId: 's-prev', ownerId: 'user-1', state: 'queued' });

        const openMic = render(<SessionOverhaulView {...base} />);
        expect(startButton()).toBeDisabled();
        openMic.unmount();

        render(<SessionOverhaulView {...base} objectiveTopic="my topic" objectivePoints={['a', 'b']} />);
        expect(startButton(), 'Focus Points must not be startable while Open Mic is blocked').toBeDisabled();
    });
});
