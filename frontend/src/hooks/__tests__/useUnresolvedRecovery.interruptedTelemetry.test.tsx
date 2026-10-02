import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { renderHook } from '@testing-library/react';
import { useUnresolvedRecovery } from '../useUnresolvedRecovery';
import { saveSessionRecoveryDraft, getSessionRecoveryDraft } from '@/services/sessionRecoveryDraft';

// #1258 flight recorder (PO 2026-10-01): the next Session load reports a take that was never durably finalized/saved, ONCE.
const push = vi.fn();
vi.mock('@/services/AnalyticsBuffer', () => ({ analyticsBuffer: { push: (...args: unknown[]) => push(...args) } }));
vi.mock('@/services/SpeechRuntimeController', () => ({
    speechRuntimeController: { rehydrateUnresolvedRecording: vi.fn(), retireRehydratedRecoveryFor: vi.fn() },
}));

const USER = 'user-A';
// A real finalized draft carries a valid next action; without one the draft store downgrades it to interrupted.
const NEXT_ACTION = { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' } as const;
const seed = (recoveryState: 'active_interrupted' | 'finalized_pending_save') =>
    saveSessionRecoveryDraft({
        sessionId: 'sess-1', userId: USER, recoveryState, durationSeconds: 49, mode: 'private', metrics: { totalWords: 40 },
        product: 'open_mic', ...(recoveryState === 'finalized_pending_save' ? { nextActionSignal: NEXT_ACTION as never } : {}),
    });
const args = { authUserId: USER, isListening: false, sessionSaved: false, transcriptContent: '' };
const interrupted = () => push.mock.calls.filter(([event]) => event === 'recording_interrupted');

beforeEach(() => { window.localStorage.clear(); push.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('useUnresolvedRecovery → recording_interrupted', () => {
    it('RED on main: an interrupted draft found on the next Session load is reported once, then cleared', () => {
        seed('active_interrupted');
        renderHook(() => useUnresolvedRecovery(args));
        expect(interrupted()).toHaveLength(1);
        // The draft store keeps `product` only for a FINALIZED draft (captured at Stop), so an interrupted take reports
        // 'unknown' — stated, never inferred.
        expect(interrupted()[0][1]).toMatchObject({ product: 'unknown', mode: 'private', take_seconds: 49 });
        expect(typeof interrupted()[0][1].heartbeat_age_seconds).toBe('number');
        expect(getSessionRecoveryDraft()).toBeNull();
    });

    it('Strict Mode double effects and re-renders still report it exactly once (the draft is gone after the first)', () => {
        seed('active_interrupted');
        const { rerender } = renderHook(() => useUnresolvedRecovery(args), { wrapper: StrictMode });
        rerender(); rerender();
        expect(interrupted()).toHaveLength(1);
    });

    it('a second app load after the report sends nothing more', () => {
        seed('active_interrupted');
        renderHook(() => useUnresolvedRecovery(args)).unmount();
        renderHook(() => useUnresolvedRecovery(args));
        expect(interrupted()).toHaveLength(1);
    });

    it('a FINALIZED draft (finalization completed) is never reported as unresolved, and is kept for Retry Save', () => {
        seed('finalized_pending_save');
        renderHook(() => useUnresolvedRecovery(args));
        expect(interrupted()).toHaveLength(0);
    });

    it('no signed-in owner → no read, no report (account isolation unchanged)', () => {
        seed('active_interrupted');
        renderHook(() => useUnresolvedRecovery({ ...args, authUserId: null }));
        expect(interrupted()).toHaveLength(0);
    });
});
