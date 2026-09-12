import { useQuery } from "@tanstack/react-query";
import { getSessionById } from "../lib/storage";
import { useAuthProvider } from "../contexts/AuthProvider";

/**
 * Hook to fetch a single session by its ID.
 * @param {string} sessionId - The ID of the session.
 * @returns {object} The query result.
 */
export const useSession = (sessionId?: string) => {
    const { user } = useAuthProvider();

    /**
     * #1422 — NO ABORT SIGNAL REACHES THE REQUEST, DELIBERATELY.
     *
     * Two versions of this hook cancelled the read at the wire — first with React Query's own signal,
     * then with a controller of our own — and both broke the product in CI, in four separate runs:
     * saved sessions stopped rendering their retained transcript and Focus Points lost its coverage
     * card. Whatever this app's navigation does to a query's lifecycle, an abort that reaches PostgREST
     * kills reads that were going to succeed.
     *
     * The finding behind those attempts is still real: an answer to a read nobody is waiting for must
     * not appear in the cache. That is closed one layer up instead, by cancelling the QUERY — React
     * Query discards a cancelled query's result rather than publishing it under its key. The request
     * itself is allowed to finish and be thrown away. That wastes one response and breaks nothing,
     * which is the right side of this trade.
     */
    return useQuery({
        queryKey: ["session", sessionId],
        queryFn: () => getSessionById(sessionId!),
        enabled: !!user && !!sessionId,
        staleTime: 5 * 60 * 1000,
    });
};
