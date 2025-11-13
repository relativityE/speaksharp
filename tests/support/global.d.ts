import type { Vi } from 'vitest';
import { Session } from '@supabase/supabase-js';
import { UserProfile } from '@/types/user'; // Adjust this import path if needed
import { SupabaseClient } from '@supabase/supabase-js';

declare global {
  const vi: Vi;

  interface Window {
    __E2E_MODE__?: boolean;
    __E2E_MOCK_SESSION__?: Session;
    __E2E_PROFILE__?: UserProfile;
    getSupabaseClient?: () => SupabaseClient;
  }
}