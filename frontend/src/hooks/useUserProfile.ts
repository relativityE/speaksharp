import { useQuery } from "@tanstack/react-query";
import { useAuthProvider } from "../contexts/AuthProvider";
import { profileService } from "../services/domainServices";
import { UserProfile } from "../types/user";

export const useUserProfile = () => {
  const { session } = useAuthProvider();

  const query = useQuery({
    queryKey: ['userProfile', session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id) {
        console.log('[useUserProfile] No session or user id, returning null');
        return null;
      }

      // P2-6 FIX: Use domain service instead of direct Supabase call
      const profile = await profileService.getById(session.user.id);

      // DEFENSIVE: Verify profile data returned
      if (!profile) {
        console.error('[useUserProfile WARNING] No profile found for user:', session.user.id);
      } else if (!profile.subscription_status) {
        console.error('[useUserProfile WARNING] Profile missing subscription_status:', profile);
      }

      return profile;
    },
    enabled: !!session?.user,
    // Cache profile data for 5 minutes to prevent skeleton flashing during navigation
    staleTime: 5 * 60 * 1000,
  });

  // DEV BYPASS: Return mock profile immediately for UI testing
  if (window.location.search.includes('devBypass=true')) {
    return {
      ...query,
      data: {
        id: 'dev-bypass-user-id',
        subscription_status: 'pro',
        usage_seconds: 0,
        usage_reset_date: new Date(Date.now() + 30 * 86400000).toISOString(),
        created_at: new Date().toISOString(),
      } as UserProfile
    };
  }

  return query;
};
