import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUnresolvedRecovery } from '../useUnresolvedRecovery';

// #1476 Codex P1 on 4a5f0798 — the hook drives the owner fence: every account change (including sign-out) retires the
// DEPARTING owner's rehydrated controller state before anything is rehydrated for the new owner.
const calls: string[] = [];
vi.mock('@/services/SpeechRuntimeController', () => ({
    speechRuntimeController: {
        rehydrateUnresolvedRecording: (uid: string) => { calls.push(`rehydrate:${uid}`); return false; },
        retireRehydratedRecoveryFor: (uid: string) => { calls.push(`retire:${uid}`); },
    },
}));

const args = (authUserId: string | null) => ({ authUserId, isListening: false, sessionSaved: false, transcriptContent: '' });

beforeEach(() => { window.localStorage.clear(); calls.length = 0; });

describe('#1476 useUnresolvedRecovery — account switch retires the previous owner\'s controller state', () => {
    it('CASUALTY: A → B retires A before rehydrating B', async () => {
        const { rerender } = renderHook(({ uid }) => useUnresolvedRecovery(args(uid)), { initialProps: { uid: 'user-A' as string | null } });
        await waitFor(() => expect(calls).toEqual(['rehydrate:user-A']));
        rerender({ uid: 'user-B' });
        await waitFor(() => expect(calls).toEqual(['rehydrate:user-A', 'retire:user-A', 'rehydrate:user-B']));
    });

    it('CASUALTY: signing out retires the departing owner too', async () => {
        const { rerender } = renderHook(({ uid }) => useUnresolvedRecovery(args(uid)), { initialProps: { uid: 'user-A' as string | null } });
        await waitFor(() => expect(calls).toEqual(['rehydrate:user-A']));
        rerender({ uid: null });
        await waitFor(() => expect(calls).toEqual(['rehydrate:user-A', 'retire:user-A']));
    });

    it('CONTROL: the first owner resolving retires nobody', async () => {
        renderHook(() => useUnresolvedRecovery(args('user-A')));
        await waitFor(() => expect(calls).toEqual(['rehydrate:user-A']));
    });
});
