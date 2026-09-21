import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import { useSessionStore } from '@/stores/useSessionStore';
import { isPrivateModelBlockingStart } from '@/services/transcription/privateModelStartBlock';
import { micControlFor, NON_ACTIONABLE_STATUS } from '../../../../../tests/helpers/micControls';
import type { SttStatus } from '@/types/transcription';

/**
 * #1306 — THE FIRST-RUN COLD START MUST BE PRESSABLE.
 *
 * WHAT THIS CATCHES, AND WHY THREE GREEN TEST FILES DID NOT.
 *
 * The three-session production proof failed twice, identically, on a brand-new account, before any
 * recording: `mic-download` rendered DISABLED. Every component involved passed its own tests.
 *
 *   - `MicCard.renderedState.test.tsx` renders `download-required` and asserts the control is enabled —
 *     but it never passes `disabled`, so it asserts a prop combination production never produces.
 *   - `SessionOverhaulView.progressGate.test.tsx` exercises the durable Progress gate — but never
 *     passes `isButtonDisabled`, so that input is always `undefined` there.
 *   - `useSessionLifecycle.test.tsx` pinned `isButtonDisabled === true` for `download-required`, which
 *     was correct while the cold control only downloaded and was force-enabled downstream.
 *
 * The defect lived in NONE of them: it is the composition. `useSessionLifecycle` blocks start on
 * `download-required`; that flows to this view's `disabled` prop; #1415 narrowed `MicCard`'s
 * always-enabled branch to the RETRY action alone, so nothing forced it back on. The result is the
 * cold-start dead end — "One-time download needed" over a button that cannot be pressed.
 *
 * So this file renders the REAL view, with `isButtonDisabled` taken from the REAL predicate rather
 * than a literal, and with the control resolved from the SAME map the live proof builds its locators
 * from. Hardcoding either side would reintroduce exactly the blindness above.
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

/** Exactly what SessionPage composes: the real predicate feeding the real view. */
const renderCold = (privateModelStatus: string, overrides: Partial<SessionOverhaulViewProps> = {}) => {
    const onStartStop = vi.fn();
    render(
        <SessionOverhaulView
            {...base}
            onStartStop={onStartStop}
            privateModelStatus={privateModelStatus}
            isButtonDisabled={isPrivateModelBlockingStart('private', privateModelStatus)}
            {...overrides}
        />,
    );
    return { onStartStop };
};

beforeEach(() => {
    // A resolved, debt-free owner: the Progress gate is NOT what is under test here, and leaving it
    // unresolved would disable every control and make this file pass for the wrong reason.
    useSessionStore.getState().setProgressGate(null);
    useSessionStore.getState().setProgressGateResolvedFor('user-1');
});

describe('#1306 — a first-run account can press the control that ends its first-run state', () => {
    it('CASUALTY: the cold-start control is ENABLED and invokes the recording intent', () => {
        const { onStartStop } = renderCold('download-required');
        const cold = screen.getByTestId(micControlFor('download-required')!);
        expect(cold, 'the first-run cold-start control must be pressable').toBeEnabled();
        fireEvent.click(cold);
        expect(onStartStop, 'pressing it must invoke the one activation that downloads AND records').toHaveBeenCalledTimes(1);
    });

    it('the card never shows a one-time-download prompt over a control that cannot be pressed', () => {
        renderCold('download-required');
        expect(screen.getByTestId('mic-status')).toHaveTextContent(/one-time download needed/i);
        expect(screen.getByTestId(micControlFor('download-required')!)).toBeEnabled();
    });

    it('a DOWNLOADING model still greys the mic, so this is not a blanket unlock', () => {
        // The download is already in flight: there is nothing for the user to press, and the map says
        // so by naming no control for this state.
        expect(micControlFor(NON_ACTIONABLE_STATUS)).toBeNull();
        renderCold(NON_ACTIONABLE_STATUS);
        expect(screen.getByTestId('mic-start')).toBeDisabled();
    });

    it.each(['init-failed', 'error'] as const)(
        'a %s setup is not a dead end either — its retry stays pressable (#1258)',
        (status) => {
            renderCold(status);
            expect(screen.getByTestId(micControlFor(status)!)).toBeEnabled();
        },
    );

    it('CASUALTY: the durable Progress gate still disables the cold start, and says why', () => {
        // The fix must not become the #1415 regression in the other direction: a gated user pressing
        // the cold control would start a recording AND a large download the gate exists to prevent.
        useSessionStore.getState().setProgressGate({ sessionId: 's-prev', ownerId: 'user-1', state: 'queued' });
        renderCold('download-required');
        const cold = screen.getByTestId(micControlFor('download-required')!);
        expect(cold, 'queued Progress debt must still hold the cold start').toBeDisabled();
        expect(screen.getByTestId('mic-status')).toHaveTextContent(/finishing your last session/i);
        expect(screen.getByTestId('mic-status')).not.toHaveTextContent(/one-time download needed/i);
    });

    it('CASUALTY: an UNRESOLVED gate still disables the cold start — no enabled frame on reload', () => {
        useSessionStore.getState().setProgressGateResolvedFor(null);
        renderCold('download-required');
        expect(screen.getByTestId(micControlFor('download-required')!)).toBeDisabled();
        expect(screen.getByTestId('mic-card')).toHaveTextContent(/checking your last session/i);
    });

    it('the predicate names model readiness only, and never the state the user resolves by pressing', () => {
        // Pinned against the map the live proof reads, so a future status rename cannot quietly
        // reintroduce the dead end.
        expect(isPrivateModelBlockingStart('private', 'download-required')).toBe(false);
        expect(isPrivateModelBlockingStart('private', 'ready')).toBe(false);
        expect(isPrivateModelBlockingStart('private', 'idle')).toBe(false);
        expect(['loading', 'init-failed', 'error'].map((s) => isPrivateModelBlockingStart('private', s)))
            .toEqual([true, true, true]);
    });
});
