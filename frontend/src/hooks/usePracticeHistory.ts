import { useQuery } from "@tanstack/react-query";
import { useAuthProvider } from "../contexts/AuthProvider";
import { getSessionHistory } from "../lib/storage";

export const usePracticeHistory = () => {
  const { user } = useAuthProvider();

  return useQuery({
    queryKey: ["sessionHistory", user?.id],
    queryFn: () => getSessionHistory(user!.id),
    enabled: !!user,
    // Cache session data for 5 minutes to prevent loading state during navigation
    staleTime: 5 * 60 * 1000,
  });
};
