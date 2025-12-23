import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { useAuthProvider } from "../contexts/AuthProvider";
import { profileService } from "../services/domainServices";
import { UserProfile } from "../types/user";

export interface UseUserProfileOptions {
  /** Override retry behavior (default: 3 retries with exponential backoff) */
  retry?: UseQueryOptions['retry'];
  /** Override retry delay (default: exponential backoff up to 30s) */
  retryDelay?: UseQueryOptions['retryDelay'];
}

export const useUserProfile = (options: UseUserProfileOptions = {}) => {
  const { session } = useAuthProvider();
  const isDevBypass = window.location.search.includes('devBypass=true');

  // Production defaults: 3 retries with exponential backoff
  const retryConfig = options.retry ?? 3;
  const retryDelayConfig = options.retryDelay ?? ((attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000));

  const query = useQuery({
    queryKey: ['userProfile', session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id || isDevBypass) {
        console.log('[useUserProfile] No session user or devBypass active, skipping fetch');
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
    enabled: !!session?.user && !isDevBypass,
    // Injectable retry config for testability
    retry: retryConfig,
    retryDelay: retryDelayConfig,
    // Cache profile data for 5 minutes to prevent skeleton flashing during navigation
    staleTime: 5 * 60 * 1000,
  });

  // DEV BYPASS: Return mock profile immediately for UI testing
  if (isDevBypass) {
    return {
      ...query,
      data: {
        id: '00000000-0000-0000-0000-000000000000',
        subscription_status: 'pro',
        usage_seconds: 0,
        usage_reset_date: new Date(Date.now() + 30 * 86400000).toISOString(),
        created_at: new Date().toISOString(),
      } as UserProfile
    };
  }

  return query;
};
