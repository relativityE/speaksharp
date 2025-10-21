declare global {
  interface Window {
    TEST_MODE?: boolean;
    __E2E_MODE__?: boolean;
    __E2E_PROFILE_LOADED__?: boolean;
    __setSupabaseSession?: (session: any) => Promise<void>;
    supabase?: any;
  }
}

export {};
