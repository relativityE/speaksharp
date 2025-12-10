import { useQuery } from "@tanstack/react-query";
import { useAuthProvider } from "../contexts/AuthProvider";
import { getSupabaseClient } from "../lib/supabaseClient";
import { UserProfile } from "../types/user";



export const useUserProfile = () => {
  const { session } = useAuthProvider();

  const query = useQuery({
    queryKey: ['userProfile', session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id) return null;

      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (error) {
        console.error('Error fetching profile:', error);
        throw error;
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
