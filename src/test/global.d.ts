import type { Session } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition: any;
    webkitAudioContext: any;
    TEST_MODE: boolean;
    __E2E_MODE__?: boolean;
    __TRANSCRIPTION_READY__: boolean;
    transcriptionServiceRef: any;
    __SESSION_READY__: boolean;
    __STUBS_READY__: boolean;
    __E2E_MOCK_SESSION__?: Session | null;
    __MOCK_LOCAL_WHISPER__: boolean;
    _speakSharpRootInitialized?: boolean;
  }
}

// This is necessary to make the file a module.
export {};
