import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { useAuthProvider } from "../contexts/AuthProvider";
import { profileService } from "../services/domainServices";
import logger from "../lib/logger";
import { ENV } from "../config/TestFlags";
import * as Sentry from "@sentry/react";

declare global {
  interface Window {
    __e2e_e2e_profile_loaded_fired__?: boolean;
    __e2eProfileLoaded__?: boolean;
  }
}

/**
 * ARCHITECTURE NOTE (Senior Architect):
 * 
 * Profile loading failures are common due to Supabase Edge Function cold starts.
 * This hook uses React Query's retry mechanism with exponential backoff.
 * 
 * OBSERVABILITY:
 * - Retry attempts are logged as info and attached to Sentry as breadcrumbs
 * - Failures after max retries trigger one explicit Sentry error in ProfileGuard
 * - Production monitoring should alert on high retry rates
 * 
 * CONFIGURATION: Retry behavior is injectable for testing.
 */

export interface UseUserProfileOptions {
  /** Override retry behavior (default: 3 retries with exponential backoff) */
  retry?: UseQueryOptions['retry'];
  /** Override retry delay (default: exponential backoff up to 30s) */
  retryDelay?: UseQueryOptions['retryDelay'];
  /** Override the per-attempt fetch timeout (default 12s). 0 disables it. */
  fetchTimeoutMs?: number;
}

/**
 * Bound a fetch so a hung request (network stall, post-decode contention) becomes
 * a *rejection* instead of pending forever. Without this, a never-settling profile
 * fetch wedges ProfileGuard on the "Readying your experience" screen indefinitely
 * (React Query's `retry` only fires on rejection), blocking the whole app —
 * including the analytics/detail journey after a session save (#28).
 */
export class ProfileFetchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Profile fetch timed out after ${timeoutMs}ms`);
    this.name = 'ProfileFetchTimeoutError';
  }
}

const DEFAULT_PROFILE_FETCH_TIMEOUT_MS = 12_000;

function withFetchTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProfileFetchTimeoutError(timeoutMs)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export const useUserProfile = (options: UseUserProfileOptions = {}) => {
  const { session } = useAuthProvider();

  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_PROFILE_FETCH_TIMEOUT_MS;

  // Production defaults: 3 retries with exponential backoff
  const retryConfig = options.retry ?? 3;
  const retryDelayConfig = options.retryDelay ?? ((attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000));

  const query = useQuery({
    queryKey: ['userProfile', session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id) {
        logger.debug('[useUserProfile] No session user, skipping fetch');
        return null;
      }

      const startTime = Date.now();

      try {
        // P2-6 FIX: Use domain service instead of direct Supabase call.
        // Bounded so a hung fetch can't wedge ProfileGuard on the loading screen (#28).
        const profile = await withFetchTimeout(profileService.getById(session.user.id), fetchTimeoutMs);
        const duration = Date.now() - startTime;

        logger.info({ userId: session.user.id, durationMs: duration }, '[useUserProfile] Profile fetched successfully');

        // DEFENSIVE: Verify profile data returned
        if (!profile) {
          logger.warn({ userId: session.user.id }, '[useUserProfile] No profile found for user');
        } else if (!profile.subscription_status) {
          logger.warn({ profile }, '[useUserProfile] Profile missing subscription_status');
        }

        // Signal for E2E tests via Strict Zero Manifest
        if (ENV.isE2E && typeof window !== 'undefined') {
          window.__e2eProfileLoaded__ = true;
          window.__e2e_e2e_profile_loaded_fired__ = true;
          window.dispatchEvent(new CustomEvent('e2e:profile-loaded'));
          logger.debug('[E2E Signal] Profile loaded via Manifest');
        }

        return profile;
      } catch (error) {
        const duration = Date.now() - startTime;
        // React Query owns retry/final failure state. Keep retry attempts out of
        // Sentry's console error/warn capture so transient aborts do not page us.
        Sentry.addBreadcrumb({
          category: 'profile.fetch',
          level: 'info',
          message: 'Profile fetch attempt failed; React Query will retry',
          data: {
            userId: session.user.id,
            durationMs: duration,
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
        logger.info({ error, userId: session.user.id, durationMs: duration }, '[useUserProfile] Profile fetch attempt failed; React Query will retry');
        throw error; // Re-throw to trigger React Query retry
      }
    },
    enabled: !!session?.user,
    // Injectable retry config for testability
    retry: retryConfig,
    retryDelay: retryDelayConfig,
    // Cache profile data for 5 minutes to prevent skeleton flashing during navigation
    staleTime: 5 * 60 * 1000,
  });

  return {
    ...query,
    isVerified: !!query.data && !query.isLoading
  };
};
