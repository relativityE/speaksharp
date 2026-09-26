import { act, fireEvent, render, screen } from '../../../../tests/support/test-utils';
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
    useSessionStore.getState().setProgressGateResolvedFor(null);
});

describe('the rendered Start control reflects the Progress gate', () => {
    it('NO ENABLED FRAME while the gate is still unknown', () => {
        // On reload `progressGate: null` means both "nothing owed" and "we have not looked yet".
        // Rendering enabled during that window is the flash this prevents.
        render(<SessionOverhaulView {...base} />);
        expect(startButton()).toBeDisabled();
    });

    it('enabled once the question is RESOLVED and nothing is owed', () => {
        useSessionStore.getState().setProgressGateResolvedFor('user-1');
        render(<SessionOverhaulView {...base} />);
        expect(startButton()).toBeEnabled();
    });

    it.each(['resolving', 'queued', 'unresolved'] as const)('a %s gate disables Start', (state) => {
        useSessionStore.getState().setProgressGateResolvedFor('user-1');
        useSessionStore.getState().setProgressGate({ sessionId: 's-prev', ownerId: 'user-1', state });
        render(<SessionOverhaulView {...base} />);
        expect(startButton()).toBeDisabled();
    });

    it('the card STATES the reason instead of contradicting itself', () => {
        // THE CONTRADICTION. While the gate blocked Start the card still showed a GREEN
        // "Mic ready on this device", the title "Press to start speaking" and "Space bar works too" —
        // over a button that could not be pressed. Telling someone to press a control you have
        // disabled is not a cosmetic problem; it makes the product look broken rather than busy.
        useSessionStore.getState().setProgressGateResolvedFor('user-1');
        useSessionStore.getState().setProgressGate({ sessionId: 's-prev', ownerId: 'user-1', state: 'queued' });
        render(<SessionOverhaulView {...base} />);

        expect(startButton()).toBeDisabled();
        expect(screen.getByTestId('mic-status')).not.toHaveTextContent(/mic ready/i);
        expect(screen.getByTestId('mic-status')).toHaveTextContent(/finishing your last session/i);
        expect(screen.getByTestId('mic-card')).not.toHaveTextContent(/press to start speaking/i);
        expect(screen.getByTestId('mic-card')).not.toHaveTextContent(/space bar works too/i);
        expect(screen.getByTestId('mic-card')).toHaveTextContent(/retry automatically/i);
    });

    it('while the answer is UNKNOWN the card says so rather than claiming ready', () => {
        useSessionStore.getState().setProgressGateResolvedFor(null);
        render(<SessionOverhaulView {...base} />);
        expect(startButton()).toBeDisabled();
        expect(screen.getByTestId('mic-card')).toHaveTextContent(/checking your last session/i);
    });

    it('ACCOUNT TRANSITION: an answer determined for another owner does not unlock this one', () => {
        // Debt is owner-scoped. A resolution inherited from the PREVIOUS account would render an
        // enabled Start for the new one before their queue had ever been read. Storing the owner
        // rather than a boolean makes the switch invalidate the answer immediately, with no effect
        // needing to run first.
        useSessionStore.getState().setProgressGateResolvedFor('someone-else');
        useSessionStore.getState().setProgressGate(null);
        render(<SessionOverhaulView {...base} />);
        expect(startButton()).toBeDisabled();
    });

    it('PARITY: Focus Points renders the same gate as Open Mic', () => {
        // Both entry points render through this component and this single `mic.disabled`, so parity is
        // structural rather than two copies kept in step by hand.
        useSessionStore.getState().setProgressGateResolvedFor('user-1');
        useSessionStore.getState().setProgressGate({ sessionId: 's-prev', ownerId: 'user-1', state: 'queued' });

        const openMic = render(<SessionOverhaulView {...base} />);
        expect(startButton()).toBeDisabled();
        openMic.unmount();

        render(<SessionOverhaulView {...base} objectiveTopic="my topic" objectivePoints={['a', 'b']} />);
        expect(startButton(), 'Focus Points must not be startable while Open Mic is blocked').toBeDisabled();
    });
});

/**
 * #1533 Codex P2 #3 (PM FIX NOW) — the after-session Start entry points are fenced by the SAME live same-owner gate as
 * the mic. A Practice-again reaching the controller while a gate is published could race its settlement and leave a
 * refusal over the completed review. While the gate is published the action is disabled, a stale activation that still
 * reaches the handler does nothing, and once the gate settles the review stays and one deliberate press starts.
 */
describe('#1533 — after-session Practice again / Retry are fenced by the live Progress gate', () => {
    const after = {
        ...base,
        showAnalyticsPrompt: true,
        reviewTranscript: { kind: 'available' as const, text: 'I will name the price now.' },
    };
    const OWNED = { sessionId: 's-prev', ownerId: 'user-1', state: 'queued' as const };
    /** A stale activation: the button was rendered enabled, then the gate appeared before the press was handled. */
    const staleActivate = (el: HTMLElement) => { (el as HTMLButtonElement).disabled = false; fireEvent.click(el); };

    it('Open Mic: disabled with the visible reason while the gate is published; a stale activation starts nothing; settlement re-enables and one press starts', () => {
        const onStartStop = vi.fn();
        useSessionStore.getState().setProgressGateResolvedFor('user-1');
        useSessionStore.getState().setProgressGate(OWNED);
        render(<SessionOverhaulView {...after} onStartStop={onStartStop} />);

        const practice = screen.getByTestId('verdict-practice-again');
        expect(practice).toBeDisabled();
        expect(practice).toHaveAttribute('aria-describedby', 'run-shape-blocked-reason');
        expect(screen.getByTestId('run-shape-blocked-reason')).toHaveTextContent(/Finishing up your last session/);
        staleActivate(practice);
        expect(onStartStop, 'no controller Start while the gate is published').not.toHaveBeenCalled();

        // Settlement: the completed review remains; the action is enabled; the next deliberate press starts.
        act(() => { useSessionStore.getState().setProgressGate(null); });
        expect(screen.getByTestId('verdict-practice-again')).toBeEnabled();
        expect(screen.queryByTestId('run-shape-blocked-reason')).not.toBeInTheDocument();
        expect(screen.getByTestId('verdict-practice-again')).not.toHaveAttribute('aria-describedby');
        fireEvent.click(screen.getByTestId('verdict-practice-again'));
        expect(onStartStop).toHaveBeenCalledTimes(1);
    });

    it('Focus Points: Retry this set is fenced the same way (no rebind, no Start) and re-enables on settlement', () => {
        const onRetryPoints = vi.fn();
        useSessionStore.getState().setProgressGateResolvedFor('user-1');
        useSessionStore.getState().setProgressGate(OWNED);
        render(<SessionOverhaulView {...after} objectivePoints={['Name the price', 'State the guarantee']}
            objectiveCoverage={[{ id: 'p1', label: 'Name the price', status: 'covered' }, { id: 'p2', label: 'State the guarantee', status: 'missing' }]}
            onRetryPoints={onRetryPoints} />);

        const retry = screen.getByTestId('focus-points-retry');
        expect(retry).toBeDisabled();
        expect(retry).toHaveAttribute('aria-describedby', 'run-shape-blocked-reason');
        staleActivate(retry);
        expect(onRetryPoints, 'no rebind / Start while the gate is published').not.toHaveBeenCalled();

        act(() => { useSessionStore.getState().setProgressGate(null); });
        expect(screen.getByTestId('focus-points-retry')).toBeEnabled();
        fireEvent.click(screen.getByTestId('focus-points-retry'));
        expect(onRetryPoints).toHaveBeenCalledTimes(1);
    });

    it('an unresolved owner also fences the action (the mic\'s predicate, not a new one)', () => {
        useSessionStore.getState().setProgressGateResolvedFor(null);
        render(<SessionOverhaulView {...after} />);
        expect(screen.getByTestId('verdict-practice-again')).toBeDisabled();
    });
});
