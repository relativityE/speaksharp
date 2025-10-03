declare module '@/config';
declare module '../config';
declare module '@/lib/supabaseClient';
declare module '../lib/supabaseClient';
declare module '@/lib/logger';
declare module '@/lib/utils';
import type { UserProfile } from './user';
declare module '@/hooks/useBrowserSupport';

import { Session } from '@supabase/supabase-js';

declare global {
  interface Window {
    TEST_MODE?: boolean;
    _speakSharpRootInitialized?: boolean;
    __E2E_MOCK_SESSION__?: Session | null;
    __E2E_MODE__?: boolean;
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
