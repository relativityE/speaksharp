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
        queryFn: () => getSessionById(sessionId!),
        enabled: !!user && !!sessionId,
        staleTime: 5 * 60 * 1000,
    });
};
