import { Session, SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    // Test flags
    TEST_MODE?: boolean;
    __E2E_MODE__?: boolean;
    __E2E_PROFILE_LOADED__?: boolean;

    // E2E test helpers
    __E2E_MOCK_SESSION__?: Session;
    __setSupabaseSession?: (session: Session) => Promise<void>;
    supabase?: SupabaseClient;

    // App init flags
    _speakSharpRootInitialized?: boolean;
    mswReady?: boolean;

    // Web Speech API
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export {};
