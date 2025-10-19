declare module '@/config';
declare module '../config';
declare module '@/lib/supabaseClient';
declare module '../lib/supabaseClient';
declare module '@/lib/logger';
declare module '@/lib/utils';
import type { UserProfile } from './user';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

declare module '@/hooks/useBrowserSupport';

declare global {
  interface Window {
    mswReady?: Promise<boolean>;
    TEST_MODE?: boolean;
    _speakSharpRootInitialized?: boolean;
    __E2E_MOCK_SESSION__?: boolean;
    __E2E_MODE__?: boolean;
    __MOCK_SPEECH_RECOGNITION__?: DeepPartial<ReturnType<typeof useSpeechRecognition>>;
    // For E2E test debugging
    consoleLog?: string[];
    __E2E_CONSOLE_ERRORS__?: string[];
    supabase?: SupabaseClient;
    __setSupabaseSession?: (session: Session) => Promise<void>;
    transcriptionServiceRef?: React.RefObject<{
      init: () => Promise<{ success: boolean }>;
      startTranscription: () => Promise<void>;
      stopTranscription: () => Promise<string>;
      destroy: () => Promise<void>;
      getMode: () => 'native' | 'cloud' | 'on-device' | null;
    } | null>;
    __TRANSCRIPTION_READY__?: boolean;
    __USER__?: UserProfile | null;
    SpeechRecognition: {
      new (): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      new (): SpeechRecognition;
    };
  }
}

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]>; } : T;
