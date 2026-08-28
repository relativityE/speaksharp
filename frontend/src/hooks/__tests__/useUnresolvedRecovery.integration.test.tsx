import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUnresolvedRecovery } from '../useUnresolvedRecovery';
import {
    saveSessionRecoveryDraft,
    getSessionRecoveryDraft,
    type SessionRecoveryDraft,
} from '@/services/sessionRecoveryDraft';
import { useSessionStore } from '@/stores/useSessionStore';

// #1033 Part-2b A5/A6 integration. Real draft store (localStorage) + real session store; the
// controller's rehydration primitive is spied so we can assert it is invoked exactly once, for the
// right owner, and never for a foreign/ownerless draft.
//
// Model note: when the visible transcript is EMPTY the hook AUTO-ACKNOWLEDGES the owned draft (and the
// banner state clears); when a transcript is already on screen it KEEPS the draft for a manual
// restore/dismiss banner. Tests set transcriptContent accordingly.
const rehydrate = vi.fn();
vi.mock('@/services/SpeechRuntimeController', () => ({
    speechRuntimeController: { rehydrateUnresolvedRecording: (uid: string) => rehydrate(uid) },
}));

const USER_A = 'user-A';
const USER_B = 'user-B';
// #1306: content-free finalized draft (metrics + next action, NO transcript).
const seed = (userId: string | undefined, sessionId: string) =>
    saveSessionRecoveryDraft({ sessionId, userId, recoveryState: 'finalized_pending_save', durationSeconds: 30, mode: 'private', metrics: { totalWords: 40 } });
const fullDraft = (userId: string, sessionId: string): SessionRecoveryDraft =>
    ({ sessionId, userId, recoveryState: 'finalized_pending_save', durationSeconds: 1, mode: 'private', metrics: { totalWords: 1 }, nextActionSignal: null, savedAt: new Date(0).toISOString() });

const args = (over: Partial<Parameters<typeof useUnresolvedRecovery>[0]>) => ({
    authUserId: null, isListening: false, sessionSaved: false, transcriptContent: '', ...over,
});

// #1306: recovery is content-free — restore surfaces a STATUS (never rehydrates transcript). Spy on setSTTStatus.
let statusSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    window.localStorage.clear();
    rehydrate.mockClear();
    statusSpy = vi.spyOn(useSessionStore.getState(), 'setSTTStatus');
});
afterEach(() => { vi.restoreAllMocks(); });

describe('#1033 A5/A6 — same-user recovery + cross-account isolation (integration)', () => {
    it('1. same-user reload AUTO-ACKNOWLEDGES the owned draft (content-free status, no transcript) and rehydrates', async () => {
        seed(USER_A, 'sess-A');
        renderHook(() => useUnresolvedRecovery(args({ authUserId: USER_A })));
        // #1360: the status no longer says "Recovered an unsaved session". Nothing is recovered — the
        // draft is content-free and this path clears it — so the message states what actually happened
        // and what survived, and must not imply a transcript came back.
        expect(statusSpy).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringMatching(/was not saved|was interrupted/),
        }));
        const [status] = statusSpy.mock.calls[0] as [{ message: string; detail?: string }];
        expect(`${status.message} ${status.detail ?? ''}`).not.toMatch(/recovered|restore/i);
        await waitFor(() => expect(rehydrate).toHaveBeenCalledWith(USER_A));
    });

    it('1b. with a transcript already on screen the owned draft is KEPT for the manual dismiss banner', () => {
        seed(USER_A, 'sess-A');
        const { result } = renderHook(() => useUnresolvedRecovery(args({ authUserId: USER_A, transcriptContent: 'on screen' })));
        expect(result.current.recoveryDraft?.sessionId).toBe('sess-A');
        expect(statusSpy).not.toHaveBeenCalled(); // not auto-acknowledged while visible text exists
    });

    it('2. React Strict Mode / re-renders rehydrate EXACTLY ONCE', async () => {
        seed(USER_A, 'sess-A');
        const { rerender } = renderHook(() => useUnresolvedRecovery(args({ authUserId: USER_A })), { wrapper: StrictMode });
        rerender(); rerender();
        await waitFor(() => expect(rehydrate).toHaveBeenCalledTimes(1));
    });

    it('3. rehydration reuses the authenticated owner identity (no foreign id)', async () => {
        seed(USER_A, 'sess-A');
        renderHook(() => useUnresolvedRecovery(args({ authUserId: USER_A })));
        await waitFor(() => expect(rehydrate).toHaveBeenCalledTimes(1));
        expect(rehydrate.mock.calls[0][0]).toBe(USER_A);
    });

    it('4./5. a FOREIGN draft is never surfaced, restored, rehydrated, or actionable for the current user', async () => {
        seed(USER_A, 'sess-A'); // owned by A
        const { result } = renderHook(() => useUnresolvedRecovery(args({ authUserId: USER_B, transcriptContent: 'on screen' })));
        expect(result.current.recoveryDraft).toBeNull();
        expect(statusSpy).not.toHaveBeenCalled();
        // rehydrate is scoped to B (who has no draft); the controller primitive is a no-op for B, and it
        // is NEVER called with A's identity.
        await waitFor(() => expect(rehydrate).toHaveBeenCalledWith(USER_B));
        expect(rehydrate.mock.calls.every(c => c[0] !== USER_A)).toBe(true);
    });

    it('6. user B saving does NOT delete user A\'s durable draft', () => {
        seed(USER_A, 'sess-A');
        renderHook(() => useUnresolvedRecovery(args({ authUserId: USER_B, sessionSaved: true })));
        expect(getSessionRecoveryDraft()?.sessionId).toBe('sess-A');
    });

    it('7. an OWNERLESS legacy draft is neither adopted nor auto-cleared', () => {
        seed(undefined, 'sess-legacy');
        const { result, rerender } = renderHook(
            (p: Parameters<typeof useUnresolvedRecovery>[0]) => useUnresolvedRecovery(p),
            { initialProps: args({ authUserId: USER_A, transcriptContent: 'on screen' }) },
        );
        expect(result.current.recoveryDraft).toBeNull();
        expect(statusSpy).not.toHaveBeenCalled();
        rerender(args({ authUserId: USER_A, sessionSaved: true }));
        expect(getSessionRecoveryDraft()?.sessionId).toBe('sess-legacy');
    });

    it('8. no authenticated owner => no read, no restore, no rehydrate, no delete', () => {
        seed(USER_A, 'sess-A');
        const { result, rerender } = renderHook(
            (p: Parameters<typeof useUnresolvedRecovery>[0]) => useUnresolvedRecovery(p),
            { initialProps: args({ authUserId: null, transcriptContent: 'on screen' }) },
        );
        expect(result.current.recoveryDraft).toBeNull();
        expect(rehydrate).not.toHaveBeenCalled();
        expect(statusSpy).not.toHaveBeenCalled();
        rerender(args({ authUserId: null, sessionSaved: true }));
        expect(getSessionRecoveryDraft()?.sessionId).toBe('sess-A');
    });

    it('9./10. account switch A->B isolates in-memory state but keeps A\'s durable draft; returning as A rehydrates again', async () => {
        seed(USER_A, 'sess-A');
        const { result, rerender } = renderHook(
            (p: Parameters<typeof useUnresolvedRecovery>[0]) => useUnresolvedRecovery(p),
            { initialProps: args({ authUserId: USER_A, transcriptContent: 'on screen' }) },
        );
        expect(result.current.recoveryDraft?.sessionId).toBe('sess-A');
        await waitFor(() => expect(rehydrate).toHaveBeenCalledTimes(1));

        await act(async () => { rerender(args({ authUserId: USER_B, transcriptContent: 'on screen' })); });
        expect(result.current.recoveryDraft).toBeNull();               // A's projection dropped
        expect(getSessionRecoveryDraft()?.sessionId).toBe('sess-A');    // A's durable draft retained

        rehydrate.mockClear();
        await act(async () => { rerender(args({ authUserId: USER_A, transcriptContent: 'on screen' })); });
        expect(rehydrate.mock.calls.some(c => c[0] === USER_A)).toBe(true); // A can rehydrate again
    });

    it('prop-wiring: exposes restore + dismiss; dismiss clears the OWNED draft by its own session id', () => {
        seed(USER_A, 'sess-A');
        const { result } = renderHook(() => useUnresolvedRecovery(args({ authUserId: USER_A, transcriptContent: 'on screen' })));
        // #1360: renamed from `restoreRecoveryDraft`. It never restored anything — it clears the draft
        // and reports what survived — and the old name told every reader of this file otherwise.
        expect(typeof result.current.acknowledgeRecoveryDraft).toBe('function');
        expect(typeof result.current.dismissRecoveryDraft).toBe('function');
        act(() => result.current.dismissRecoveryDraft(fullDraft(USER_A, 'sess-A')));
        expect(getSessionRecoveryDraft()).toBeNull();
    });
});
