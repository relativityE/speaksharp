import { useQuery } from "@tanstack/react-query";
import { useAuthProvider } from "../contexts/AuthProvider";
import { getSessionHistory, PaginationOptions } from "../lib/sessionRepository";

export const usePracticeHistory = (
  options: PaginationOptions & { enabled?: boolean } = {}
) => {
  const { user } = useAuthProvider();
  const { enabled = true, ...paginationOptions } = options;
  const sessionJustPersisted =
    typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-session-persisted') === 'true';

  return useQuery({
    queryKey: ["sessionHistory", user?.id, paginationOptions],
    queryFn: () => getSessionHistory(user!.id, paginationOptions),
    enabled: !!user && enabled,
    // Cache session data for 5 minutes to prevent loading state during navigation
    staleTime: sessionJustPersisted ? 0 : 5 * 60 * 1000,
    refetchOnMount: sessionJustPersisted ? 'always' : undefined,
  });
};
