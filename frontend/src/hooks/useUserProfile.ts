import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { useAuthProvider } from "../contexts/AuthProvider";
import { profileService } from "../services/domainServices";
import { UserProfile } from "../types/user";
import logger from "../lib/logger";
import { IS_TEST_ENVIRONMENT } from "../config/env";

/**
 * ARCHITECTURE NOTE (Senior Architect):
 * 
 * Profile loading failures are common due to Supabase Edge Function cold starts.
 * This hook uses React Query's retry mechanism with exponential backoff.
 * 
 * OBSERVABILITY:
 * - Retry attempts are logged via Pino (captured by Sentry)
 * - Failures after max retries trigger error logging
 * - Production monitoring should alert on high retry rates
 * 
 * CONFIGURATION: Retry behavior is injectable for testing.
 */

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
        logger.debug('[useUserProfile] No session user or devBypass, skipping fetch');
        return null;
      }

      const startTime = Date.now();

      try {
        // P2-6 FIX: Use domain service instead of direct Supabase call
        const profile = await profileService.getById(session.user.id);
        const duration = Date.now() - startTime;

        logger.info({ userId: session.user.id, durationMs: duration }, '[useUserProfile] Profile fetched successfully');

        // DEFENSIVE: Verify profile data returned
        if (!profile) {
          logger.warn({ userId: session.user.id }, '[useUserProfile] No profile found for user');
        } else if (!profile.subscription_status) {
          logger.warn({ profile }, '[useUserProfile] Profile missing subscription_status');
        }

        // Signal for E2E tests that the profile is settled and available on the window
        // NOTE: Use __E2E_CONTEXT__ directly (not IS_TEST_ENVIRONMENT) because live tests
        // don't set VITE_TEST_MODE=true, only VITE_USE_LIVE_DB=true.
        if (typeof window !== 'undefined' && (window.__E2E_CONTEXT__ || window.TEST_MODE)) {
          window.__e2eProfileLoaded__ = true;
          window.dispatchEvent(new CustomEvent('e2e:profile-loaded'));
          logger.debug('[E2E Signal] Profile loaded');
        }

        return profile;
      } catch (error) {
        const duration = Date.now() - startTime;
        // This error will cause React Query to retry - log for observability
        logger.error({ error, userId: session.user.id, durationMs: duration }, '[useUserProfile] Profile fetch failed (will retry)');
        throw error; // Re-throw to trigger React Query retry
      }
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
