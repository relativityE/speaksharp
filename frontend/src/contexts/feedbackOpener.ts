import React from 'react';

/**
 * #1474 (Browser PM opener disposition 6239720648, Sam GO 6239797815) — ONE typed, owner-scoped path that opens the
 * Navigation-owned Share Feedback dialog from page content ("Count look wrong?" in THIS RUN).
 *
 * The dialog lives in `Navigation`, a sibling of the routed page, and owns its own open state and opening initialization
 * (the session-option snapshot, the restored-choice → viewed → newest → No session default, the draft restore). A page
 * therefore never opens it directly: it files a REQUEST here, and the dialog — the only consumer — honours it through
 * that same initialization, only when the request's owner is the dialog's signed-in user. No DOM click on a navigation
 * test id, no second form, no unscoped global event. Opening never submits and never copies anything into the report.
 */
export interface FeedbackOpenRequest {
    /** Monotonic, so a repeated press is a new request even with the same owner and trigger. */
    seq: number;
    /** The signed-in user the opening page belongs to; a request for anyone else is never honoured. */
    ownerId: string;
    /** Where focus returns when the dialog closes — the control that asked for it. */
    returnFocus: HTMLElement | null;
}

export interface FeedbackOpenerValue {
    request: FeedbackOpenRequest | null;
    requestOpen: (ownerId: string, returnFocus: HTMLElement | null) => void;
    /** The dialog acknowledges a request it has handled (opened, or refused for a different owner). */
    settle: (seq: number) => void;
}

export const FeedbackOpenerContext = React.createContext<FeedbackOpenerValue | null>(null);

/** For the Share Feedback dialog only: the pending request, if any, and how to acknowledge it. */
export function useFeedbackOpenRequest(): Pick<FeedbackOpenerValue, 'request' | 'settle'> | null {
    const ctx = React.useContext(FeedbackOpenerContext);
    return ctx ? { request: ctx.request, settle: ctx.settle } : null;
}

/**
 * For page content: an opener bound to the signed-in owner, or null when there is no owner or no dialog to open — the
 * caller then renders no entry point at all, because a link that opens nothing is worse than an absent one.
 */
export function useOpenShareFeedback(ownerId: string | null | undefined): ((trigger: HTMLElement) => void) | null {
    const ctx = React.useContext(FeedbackOpenerContext);
    const requestOpen = ctx?.requestOpen;
    return React.useMemo(
        () => (requestOpen && ownerId ? (trigger: HTMLElement) => requestOpen(ownerId, trigger) : null),
        [requestOpen, ownerId],
    );
}
