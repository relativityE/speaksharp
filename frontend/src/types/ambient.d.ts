import { Session, SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    __e2e_e2e_profile_loaded_fired__?: boolean;
    __e2eProfileLoaded__?: boolean;
    __setSupabaseSession?: (session: Session) => Promise<void>;
    supabase?: SupabaseClient;
    _speakSharpRootInitialized?: boolean;
    mswReady?: boolean;
    __E2E_UNHANDLED_REJECTIONS__?: { reason: string; promise: string }[];
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  }
}

export { };
