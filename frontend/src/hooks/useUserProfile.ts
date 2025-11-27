import { useQuery } from "@tanstack/react-query";
import { useAuthProvider } from "../contexts/AuthProvider";
import { getSupabaseClient } from "../lib/supabaseClient";
import { UserProfile } from "../types/user";

const getProfileFromDb = async (userId: string): Promise<UserProfile | null> => {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error('Error fetching profile:', e);
    return null;
  }
};

export const useUserProfile = () => {
  const { user } = useAuthProvider();

  console.log('[DEBUG] useUserProfile hook called. User:', user?.id);

  return useQuery({
    queryKey: ["userProfile", user?.id],
    queryFn: async () => {
      console.log('[DEBUG] useUserProfile queryFn executing for user:', user?.id);
      if (!user?.id) {
        console.log('[DEBUG] useUserProfile: No user ID, returning null');
        return null;
      }
      const result = await getProfileFromDb(user.id);
      console.log('[DEBUG] useUserProfile queryFn result:', result ? 'Found' : 'Null');
      return result;
    },
    enabled: !!user,
  });
};
