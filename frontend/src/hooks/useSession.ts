import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSessionById } from "../lib/storage";
import { useAuthProvider } from "../contexts/AuthProvider";

/**
 * Hook to fetch a single session by its ID.
 * @param {string} sessionId - The ID of the session.
 * @returns {object} The query result, plus `abandonCurrentRead()`.
 */
export const useSession = (sessionId?: string) => {
    const { user } = useAuthProvider();

    /**
     * #1422 — THE READ IS ABANDONED WHEN **WE** DECIDE, NOT WHEN THE CACHE HAPPENS TO.
     *
     * The first version of this passed React Query's own `signal` straight through to PostgREST. That
     * looked like the obvious wiring and it broke the product twice in CI: React Query aborts the signal
     * it owns for its own reasons — garbage collection, an observer coming and going, a superseded
     * refetch — and once PostgREST honours it, every one of those previously harmless aborts kills a
     * legitimate in-flight read. Saved sessions stopped rendering their retained transcript.
     *
     * So the controller is OURS. It is aborted on exactly two occasions, both of which mean the answer
     * can no longer be wanted: this read has been superseded by another, or the reader has gone away.
     * A caller that has stopped waiting on purpose calls `abandonCurrentRead()`. Nothing else can
     * silently cancel a read that is still needed.
     */
    const inFlight = React.useRef<AbortController | null>(null);

    React.useEffect(() => () => {
        // The reader is gone; nothing is waiting for this answer.
        inFlight.current?.abort();
        inFlight.current = null;
    }, []);

    const query = useQuery({
        queryKey: ["session", sessionId],
        queryFn: () => {
            // A new read supersedes the previous one. Two reads for the same key cannot both be current,
            // and the older one's answer would land in the cache under the same key as the newer one's.
            inFlight.current?.abort();
            const controller = new AbortController();
            inFlight.current = controller;
            return getSessionById(sessionId!, controller.signal);
        },
        enabled: !!user && !!sessionId,
        staleTime: 5 * 60 * 1000,
    });

    /** Stop the read at the wire. For a caller that has deliberately stopped waiting for it. */
    const abandonCurrentRead = React.useCallback(() => {
        inFlight.current?.abort();
        inFlight.current = null;
    }, []);

    return { ...query, abandonCurrentRead };
};
