import { useQuery } from "@tanstack/react-query";
import { useAuthProvider } from "../contexts/AuthProvider";
import { getSessionHistory, PaginationOptions } from "../lib/storage";

export const usePracticeHistory = (options: PaginationOptions = {}) => {
  const { user } = useAuthProvider();

  return useQuery({
    queryKey: ["sessionHistory", user?.id, options],
    queryFn: () => getSessionHistory(user!.id, options),
    enabled: !!user,
    // Cache session data for 5 minutes to prevent loading state during navigation
    staleTime: 5 * 60 * 1000,
  });
};
