import { useQuery } from "@tanstack/react-query";
import { useAuthProvider } from "../contexts/AuthProvider";
import { getSupabaseClient } from "../lib/supabaseClient";
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

      const supabase = getSupabaseClient();

      // DEFENSIVE: Verify Supabase client exists
      if (!supabase) {
        console.error('[useUserProfile CRITICAL] getSupabaseClient() returned null/undefined!');
        throw new Error('Supabase client not initialized');
      }

      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (error) {
        console.error('[useUserProfile ERROR] Fetch failed:', error.message);
        console.error('[useUserProfile ERROR] User ID:', session.user.id);
        throw error;
      }

      // DEFENSIVE: Verify profile data returned
      if (!data) {
        console.error('[useUserProfile WARNING] Query succeeded but no data returned for user:', session.user.id);
      } else if (!data.subscription_status) {
        console.error('[useUserProfile WARNING] Profile missing subscription_status:', data);
      }

      return data;
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
        first_name: 'Dev',
        last_name: 'User',
        full_name: 'Dev User',
        avatar_url: null,
        email: 'dev@example.com',
        subscription_status: 'pro', // Changed to pro for validation
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as UserProfile
    };
  }

  return query;
};
