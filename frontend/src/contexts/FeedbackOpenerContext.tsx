import React from 'react';
import { FeedbackOpenerContext, type FeedbackOpenRequest } from './feedbackOpener';

/**
 * #1474 — the provider for the one owner-scoped Share Feedback opening path (see `./feedbackOpener`). It spans Navigation
 * (which owns the dialog) and the routed page (whose "Count look wrong?" files a request).
 */
export const FeedbackOpenerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [request, setRequest] = React.useState<FeedbackOpenRequest | null>(null);
    const seqRef = React.useRef(0);
    const requestOpen = React.useCallback((ownerId: string, returnFocus: HTMLElement | null) => {
        seqRef.current += 1;
        setRequest({ seq: seqRef.current, ownerId, returnFocus });
    }, []);
    const settle = React.useCallback((seq: number) => {
        setRequest((current) => (current && current.seq === seq ? null : current));
    }, []);
    const value = React.useMemo(() => ({ request, requestOpen, settle }), [request, requestOpen, settle]);
    return <FeedbackOpenerContext.Provider value={value}>{children}</FeedbackOpenerContext.Provider>;
};
