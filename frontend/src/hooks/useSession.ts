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

    return useQuery({
        queryKey: ["session", sessionId],
        // React Query hands the query its own AbortSignal and aborts it when the query is cancelled
        // or garbage-collected. Passing it through is what makes `cancelQueries` actually stop the
        // request instead of merely stopping us from listening to it.
        queryFn: ({ signal }) => getSessionById(sessionId!, signal),
        enabled: !!user && !!sessionId,
        staleTime: 5 * 60 * 1000,
    });
};
