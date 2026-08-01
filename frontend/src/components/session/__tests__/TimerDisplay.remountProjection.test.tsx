// @vitest-environment jsdom
/**
 * #1089 remount projection (adversarial-review gap #1).
 *
 * The store-level fix is proven in useSessionStore.test.ts; this adds the RENDERED proof the reviewer
 * asked for. Against the REAL global store (not a mock, not recreated between renders), a stale Ready timer
 * must project 00:00 and stay 00:00 across unmount → remount, while the completed session's review evidence
 * (completedSessionDurationSeconds) survives, and a pure remount fires no lifecycle transition.
 *
 * The defect this would catch: if setSTTStatus's Ready/Idle normalization ran only on a status CHANGE (not a
 * same-status republish), navigating back to Ready would paint the previous take's elapsed time (the
 * observed 00:09-while-Ready), and/or a remount would resurrect a stale running timer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TimerDisplay } from '@/components/session/TimerDisplay';
import { useSessionStore } from '@/stores/useSessionStore';

describe('#1089 TimerDisplay remount projection', () => {
    beforeEach(() => { useSessionStore.getState().resetSession(); });
    afterEach(() => { cleanup(); });

    it('normalizes a stale Ready timer to 00:00 and holds it across unmount/remount; completed evidence survives', () => {
        // A completed take left review evidence AND a stale live timer; the app then republishes the SAME
        // Ready status (the #1089 bug path). The store fix must zero only the live timer.
        const ready = { type: 'ready' as const, message: 'Ready to record' };
        useSessionStore.setState({
            runtimeState: 'READY', sttStatus: ready, elapsedTime: 187, startTime: 123,
            completedSessionDurationSeconds: 187,
        });
        useSessionStore.getState().setSTTStatus({ ...ready }); // same-status republish

        render(<TimerDisplay isListening={false} />);
        expect(screen.getByTestId('session-timer').textContent).toBe('00:00');

        // Unmount then remount WITHOUT recreating the global store (Zustand module singleton persists).
        cleanup();
        const runtimeBefore = useSessionStore.getState().runtimeState;
        render(<TimerDisplay isListening={false} />);

        expect(screen.getByTestId('session-timer').textContent).toBe('00:00'); // Ready still projects 00:00
        expect(useSessionStore.getState().completedSessionDurationSeconds).toBe(187); // review evidence intact
        expect(useSessionStore.getState().runtimeState).toBe(runtimeBefore);   // remount fired no transition
        expect(useSessionStore.getState().isListening).toBe(false);            // no Start on remount
    });

    it('an unresolved recovery draft does not resurrect an ordinary running Ready timer on remount', () => {
        const ready = { type: 'ready' as const, message: 'Ready to record' };
        // A pending recovery resolution is present alongside a stale timer.
        useSessionStore.setState({
            runtimeState: 'READY', sttStatus: ready, elapsedTime: 42, startTime: 99,
            completedSessionDurationSeconds: 42, pendingResolutionKind: 'full_save',
        });
        useSessionStore.getState().setSTTStatus({ ...ready });

        render(<TimerDisplay isListening={false} />);
        expect(screen.getByTestId('session-timer').textContent).toBe('00:00');
        cleanup();
        render(<TimerDisplay isListening={false} />);
        // Ready is normalized (00:00), not presented as an ordinary running session, and the recovery
        // affordance is still pending for the user to act on.
        expect(screen.getByTestId('session-timer').textContent).toBe('00:00');
        expect(useSessionStore.getState().pendingResolutionKind).toBe('full_save');
    });
});
