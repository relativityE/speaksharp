import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { usePromptOfferDismissed } from '../usePromptOfferDismissed';

// #1222 S3 — the prompt-offer dismissal persists PER USER and is recoverable.
describe('usePromptOfferDismissed (#1222 S3)', () => {
    beforeEach(() => localStorage.clear());

    it('starts visible, dismisses, and persists across a remount for the same user', () => {
        const { result, unmount } = renderHook(() => usePromptOfferDismissed('user-1'));
        expect(result.current.dismissed).toBe(false);

        act(() => result.current.dismiss());
        expect(result.current.dismissed).toBe(true);

        unmount();
        const { result: remounted } = renderHook(() => usePromptOfferDismissed('user-1'));
        expect(remounted.current.dismissed).toBe(true); // read back from storage on mount
    });

    it('restore() brings the offer back and clears the persisted dismissal', () => {
        const { result } = renderHook(() => usePromptOfferDismissed('user-1'));
        act(() => result.current.dismiss());
        expect(result.current.dismissed).toBe(true);

        act(() => result.current.restore());
        expect(result.current.dismissed).toBe(false);

        const { result: remounted } = renderHook(() => usePromptOfferDismissed('user-1'));
        expect(remounted.current.dismissed).toBe(false); // nothing persisted after restore
    });

    it('one user\'s dismissal does NOT leak to another user on the same device', () => {
        const { result: userA } = renderHook(() => usePromptOfferDismissed('user-A'));
        act(() => userA.current.dismiss());

        const { result: userB } = renderHook(() => usePromptOfferDismissed('user-B'));
        expect(userB.current.dismissed).toBe(false); // scoped per user id
    });

    it('anonymous (no id) dismissal is in-memory only — never written to shared storage', () => {
        const { result } = renderHook(() => usePromptOfferDismissed(null));
        act(() => result.current.dismiss());
        expect(result.current.dismissed).toBe(true);
        // Nothing persisted → a fresh mount starts visible again.
        const { result: remounted } = renderHook(() => usePromptOfferDismissed(null));
        expect(remounted.current.dismissed).toBe(false);
        expect(localStorage.length).toBe(0);
    });
});
