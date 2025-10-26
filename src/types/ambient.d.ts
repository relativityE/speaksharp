import { Session, SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    TEST_MODE?: boolean;
    __E2E_MODE__?: boolean;
    __E2E_PROFILE_LOADED__?: boolean;
    __setSupabaseSession?: (session: Session) => Promise<void>;
    supabase?: SupabaseClient;
    _speakSharpRootInitialized?: boolean;
    __E2E_MOCK_SESSION__?: Session;
    __E2E_MOCK_PROFILE__?: UserProfile;
    mswReady?: boolean;
    __E2E_UNHANDLED_REJECTIONS__?: { reason: string; promise: string }[];
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  }
}

export {};
