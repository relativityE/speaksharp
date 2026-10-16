import { render, screen } from '../../../../tests/support/test-utils';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MobileActionBar } from '../MobileActionBar';
import { useSessionStore } from '@/stores/useSessionStore';

// #1258 C10 (Codex r4290831295 / r4290831299) — ONE live moment on every surface. The mobile sticky control never claims
// recording before capture is live, and the session clock starts at that moment, not at FSM RECORDING.
const base = { isListening: false, isButtonDisabled: false, modelLoadingProgress: null, onStartStop: vi.fn(), mode: 'private' as const,
    privateModelStatus: 'ready' as const, onDownloadModel: vi.fn(), blockedReason: null };

describe('C10 mobile control', () => {
    it('while starting — including FSM RECORDING before real frames — it reads Starting…, disabled, never Stop Recording', () => {
        for (const isListening of [false, true]) {
            const { unmount } = render(<MobileActionBar {...base} isListening={isListening} starting />);
            const button = screen.getByTestId(/-mobile$/);
            expect(button).toHaveTextContent('Starting…');
            expect(button).toBeDisabled();
            expect(screen.queryByText('Stop Recording')).toBeNull();
            unmount();
        }
    });
    it('CONTROL: once live it is the Stop control; before any press it is Start', () => {
        const live = render(<MobileActionBar {...base} isListening starting={false} />);
        expect(screen.getByTestId(/-mobile$/)).toHaveTextContent('Stop Recording');
        live.unmount();
        render(<MobileActionBar {...base} />);
        expect(screen.getByTestId(/-mobile$/)).toHaveTextContent('Start Recording');
    });
});

describe('C10 session clock starts at the live moment', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T04:00:00Z')); useSessionStore.getState().resetSession(); });
    afterEach(() => { vi.useRealTimers(); });

    it('FSM RECORDING at t0, real frames at t0+4 s: the clock is re-based to the live moment (elapsed 0)', () => {
        useSessionStore.getState().startSession(); // the RECORDING transition
        const t0 = useSessionStore.getState().startTime!;
        vi.setSystemTime(new Date(t0 + 4_000));
        useSessionStore.getState().setCaptureLive(true); // the engine's real-frame readiness
        expect(useSessionStore.getState().startTime).toBe(t0 + 4_000);
        expect(useSessionStore.getState().elapsedTime).toBe(0);
    });
    it('a repeated live signal does not re-base again; capture going live on a take that is not listening does not touch the clock', () => {
        useSessionStore.getState().startSession();
        vi.setSystemTime(Date.now() + 2_000);
        useSessionStore.getState().setCaptureLive(true);
        const live = useSessionStore.getState().startTime;
        vi.setSystemTime(Date.now() + 3_000);
        useSessionStore.getState().setCaptureLive(true);
        expect(useSessionStore.getState().startTime, 'already live: unchanged').toBe(live);
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setCaptureLive(true);
        expect(useSessionStore.getState().startTime, 'not listening: no clock').toBeNull();
    });
});
