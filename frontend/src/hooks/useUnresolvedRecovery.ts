import React from 'react';
import { useSessionStore } from '@/stores/useSessionStore';
import {
    clearSessionRecoveryDraft,
    getRecoverableDraftForUser,
    type SessionRecoveryDraft,
} from '@/services/sessionRecoveryDraft';

/**
 * #1033 Part-2b (A5/A6) — the SessionPage recovery wiring, extracted so its account-isolation and
 * rehydration behavior is directly testable against the real controller + real draft store.
 *
 * Account-isolation invariants (device-local, same-browser):
 *  - reads ONLY via getRecoverableDraftForUser(authUserId) — never the unscoped reader;
 *  - fails CLOSED when no authenticated owner is resolved (no read, no restore, no delete);
 *  - never restores a foreign or ownerless draft;
 *  - deletes ONLY a draft the current owner actually holds, addressed by that draft's session id
 *    (so account B's save can never delete account A's durable draft);
 *  - an account CHANGE clears the previous account's in-memory projection but RETAINS the durable
 *    draft for its real owner.
 *
 * Same-user reload (A5): once the owner resolves, re-arm the controller's unresolved-recording state
 * from that user's own draft EXACTLY ONCE (ref keyed on user id → rerenders / effect re-runs /
 * React Strict Mode double-invoke cannot rehydrate twice or duplicate a session).
 */
export interface UseUnresolvedRecoveryArgs {
    authUserId: string | null;
    isListening: boolean;
    sessionSaved: boolean;
    transcriptContent: string;
}

export function useUnresolvedRecovery({
    authUserId,
    isListening,
    sessionSaved,
    transcriptContent,
}: UseUnresolvedRecoveryArgs) {
    const [recoveryDraft, setRecoveryDraft] = React.useState<SessionRecoveryDraft | null>(null);
    const setRecoveredStatus = useSessionStore((s) => s.setSTTStatus);

    // #1306: recovery is CONTENT-FREE — there is no transcript to rehydrate into the UI. A finalized draft's
    // metrics are re-armed for a save retry by the controller (rehydrateUnresolvedRecording); an interrupted
    // draft carries only partial counters and cannot be completed. Here we just surface an honest status.
    const restoreRecoveryDraft = React.useCallback((draft: SessionRecoveryDraft) => {
        clearSessionRecoveryDraft(draft.sessionId);
        setRecoveredStatus({
            type: 'warning',
            message: 'Recovered an unsaved session.',
            detail: draft.recoveryState === 'finalized_pending_save'
                ? 'Your last session’s measurements were kept on this device.'
                : 'Your last session was interrupted; only partial measurements were available.',
        });
        setRecoveryDraft(null);
    }, [setRecoveredStatus]);

    // Owner-scoped read + auto-restore, with a scoped clear on save.
    React.useEffect(() => {
        if (isListening) {
            setRecoveryDraft(null);
            return;
        }
        if (sessionSaved) {
            // DATA-LOSS FIX: clear ONLY a draft we own, by its own session id — never a no-arg clear
            // that would delete another account's draft on a shared browser.
            const owned = authUserId ? getRecoverableDraftForUser(authUserId) : null;
            if (owned) clearSessionRecoveryDraft(owned.sessionId);
            setRecoveryDraft(null);
            return;
        }
        // Fail closed: no resolved authenticated owner => no recovery read at all.
        if (!authUserId) {
            setRecoveryDraft(null);
            return;
        }
        const draft = getRecoverableDraftForUser(authUserId);
        setRecoveryDraft(draft);
        if (!draft || transcriptContent.trim()) return;
        restoreRecoveryDraft(draft);
    }, [isListening, sessionSaved, restoreRecoveryDraft, transcriptContent, authUserId]);

    // A5 + A6 in ONE effect (avoids cross-effect ordering fragility between the rehydrate-dedup and the
    // account-change reset): whenever the resolved owner CHANGES to a new value we have not yet
    // rehydrated for, drop the previous account's in-memory projection (A6 — the durable draft is
    // retained) and rehydrate the controller's unresolved-recording state exactly once for the new
    // owner (A5). Keyed on the owner id, so rerenders / effect re-runs / React Strict Mode's
    // double-invoke cannot rehydrate twice or duplicate a session; returning as a prior owner
    // rehydrates again because the key changed in between.
    const lastRehydratedUserRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (lastRehydratedUserRef.current === authUserId) return;
        const isAccountChange = lastRehydratedUserRef.current !== null;
        lastRehydratedUserRef.current = authUserId;
        if (isAccountChange) setRecoveryDraft(null); // A6: clear the departing account's projection
        if (!authUserId) return;                     // no owner => nothing to rehydrate
        void import('@/services/SpeechRuntimeController')
            .then((m) => m.speechRuntimeController.rehydrateUnresolvedRecording(authUserId));
    }, [authUserId]);

    // Owner-scoped dismissal: clear the draft by its own session id and drop the in-memory projection.
    const dismissRecoveryDraft = React.useCallback((draft: SessionRecoveryDraft) => {
        clearSessionRecoveryDraft(draft.sessionId);
        setRecoveryDraft(null);
    }, []);

    return { recoveryDraft, restoreRecoveryDraft, dismissRecoveryDraft };
}
