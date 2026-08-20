import { useQuery } from "@tanstack/react-query";
import { useAuthProvider } from "../contexts/AuthProvider";
import { sessionService } from "@/services/domainServices";

/**
 * #1042 PR4: the most-recent REVIEWABLE session for the Practice Home continuity card.
 *
 * Deliberately narrow: it calls sessionService.getRecentReviewable, which selects only id/created_at/
 * duration/status for a single newest row — never transcript, scores, WPM, engine data, or full history.
 *
 * The query key is user-specific, so a late response for user A can never render after switching to user B
 * (React Query keys the cache entry by id; A's in-flight result resolves into A's entry, not B's). The
 * "session just persisted" freshness behavior mirrors usePracticeHistory so returning from a completed
 * recording immediately reflects the new session.
 */
export const useRecentPracticeSummary = () => {
  const { user } = useAuthProvider();
  const sessionJustPersisted =
    typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-session-persisted') === 'true';

  return useQuery({
    queryKey: ["recentPracticeSummary", user?.id],
    queryFn: () => sessionService.getRecentReviewable(user!.id),
    enabled: !!user,
    staleTime: sessionJustPersisted ? 0 : 5 * 60 * 1000,
    refetchOnMount: sessionJustPersisted ? 'always' : undefined,
  });
};
