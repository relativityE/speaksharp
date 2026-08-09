import { useCallback, useState } from 'react';
import { safeLocalStorageGet, safeLocalStorageSet, safeLocalStorageRemove } from '@/lib/safeStorage';

/**
 * #1222 slot B (before) — the prompt offer lives inside the transcript empty state. Dismissing the
 * offer (`✕`) must persist PER USER so a returning user who already made the choice is not re-nagged,
 * while a `Need a prompt?` recovery link can always bring it back.
 *
 * Persistence is keyed by the authenticated user id. An anonymous user (no id) gets an in-memory-only
 * dismissal for the session — nothing is written to shared storage, so it can never leak across users
 * on a shared device.
 */
const KEY_PREFIX = 'speaksharp_prompt_offer_dismissed_v1:';

const keyFor = (userId: string | null | undefined): string | null =>
    userId ? `${KEY_PREFIX}${userId}` : null;

export interface PromptOfferDismissal {
    /** True when the offer should be hidden (dismissed and not re-summoned). */
    dismissed: boolean;
    /** Hide the offer and persist the choice for this user. */
    dismiss: () => void;
    /** Bring the offer back (the `Need a prompt?` recovery link); clears the persisted dismissal. */
    restore: () => void;
}

export function usePromptOfferDismissed(userId: string | null | undefined): PromptOfferDismissal {
    // Initialise from storage so a returning user never sees a flash of the offer they already dismissed.
    const [dismissed, setDismissed] = useState<boolean>(() => {
        const key = keyFor(userId);
        return key ? safeLocalStorageGet(key) === '1' : false;
    });

    const dismiss = useCallback(() => {
        setDismissed(true);
        const key = keyFor(userId);
        if (key) safeLocalStorageSet(key, '1');
    }, [userId]);

    const restore = useCallback(() => {
        setDismissed(false);
        const key = keyFor(userId);
        if (key) safeLocalStorageRemove(key);
    }, [userId]);

    return { dismissed, dismiss, restore };
}
