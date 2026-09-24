import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUnresolvedRecovery } from '../useUnresolvedRecovery';
import {
    getRecoverableDraftForUser,
    saveSessionRecoveryDraft,
} from '@/services/sessionRecoveryDraft';

// #1476 casualty (consolidated #1455). On a same-user reload with an empty transcript the hook's first effect
// acknowledged — and synchronously DELETED — the finalized draft, and only then did the rehydration effect import
// the controller, whose `rehydrateUnresolvedRecording()` rereads localStorage. It found nothing, so the page said
// the session "finished but was not saved" while no Retry Save was ever armed: the saved-able work was lost.
//
// The controller primitive is replaced by a probe that records what IT would read at the moment it runs.
const seenAtRehydrate: Array<{ userId: string; draftSessionId: string | null }> = [];
vi.mock('@/services/SpeechRuntimeController', () => ({
    speechRuntimeController: {
        rehydrateUnresolvedRecording: (userId: string) => {
            seenAtRehydrate.push({ userId, draftSessionId: getRecoverableDraftForUser(userId)?.sessionId ?? null });
            return true;
        },
        retireRehydratedRecoveryFor: () => undefined,
    },
}));

const USER = 'user-A';
const NEXT_ACTION = {
    reasonCode: 'PACE_TOO_FAST', actionCode: 'SLOW_DOWN', metric: 'wpm', value: 170, comparator: 'above_target', templateVersion: 'rec_v1',
} as const;

const seedFinalized = (sessionId: string) => saveSessionRecoveryDraft({
    sessionId, userId: USER, recoveryState: 'finalized_pending_save', durationSeconds: 60, mode: 'private',
    metrics: { totalWords: 120, wpm: 170, fillerCounts: {} }, nextActionSignal: NEXT_ACTION,
});

const args = (over: Partial<Parameters<typeof useUnresolvedRecovery>[0]> = {}) => ({
    authUserId: USER, isListening: false, sessionSaved: false, transcriptContent: '', ...over,
});

beforeEach(() => {
    window.localStorage.clear();
    seenAtRehydrate.length = 0;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('#1476 / #1455 — a finalized draft is rehydrated before anything deletes it', () => {
    it('CASUALTY: same-user reload with an empty transcript — the controller still reads the finalized draft when it rehydrates', async () => {
        seedFinalized('sess-finalized');
        renderHook(() => useUnresolvedRecovery(args()));
        await waitFor(() => expect(seenAtRehydrate).toHaveLength(1));
        expect(seenAtRehydrate[0]).toEqual({ userId: USER, draftSessionId: 'sess-finalized' });
    });

    it('CASUALTY: the finalized draft is still durable after the reload settles, so Retry Save has something to replay', async () => {
        seedFinalized('sess-finalized');
        renderHook(() => useUnresolvedRecovery(args()));
        await waitFor(() => expect(seenAtRehydrate).toHaveLength(1));
        expect(getRecoverableDraftForUser(USER)?.sessionId).toBe('sess-finalized');
    });

    it('CONTROL: an interrupted (non-replayable) draft may still be acknowledged and cleared', async () => {
        saveSessionRecoveryDraft({
            sessionId: 'sess-interrupted', userId: USER, recoveryState: 'active_interrupted', durationSeconds: 20, mode: 'private',
            metrics: { totalWords: 10 },
        });
        renderHook(() => useUnresolvedRecovery(args()));
        await waitFor(() => expect(seenAtRehydrate).toHaveLength(1));
        expect(getRecoverableDraftForUser(USER)).toBeNull();
    });

    it('CONTROL: a saved session still clears the owned draft', () => {
        seedFinalized('sess-finalized');
        renderHook(() => useUnresolvedRecovery(args({ sessionSaved: true })));
        expect(getRecoverableDraftForUser(USER)).toBeNull();
    });
});
