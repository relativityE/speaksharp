import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../contexts/useAuth";
import { getSessionHistory } from "../lib/storage";

export const usePracticeHistory = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["sessionHistory", user?.id],
    queryFn: () => getSessionHistory(user!.id),
    enabled: !!user,
  });
};
