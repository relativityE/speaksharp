declare module '@/config' {
  export const APP_TAGLINE: string;
  export const SPEECH_RECOGNITION_LANG: string;
  export const FILLER_WORD_KEYS: { [key: string]: string };
}

declare module '../config' {
  export const APP_TAGLINE: string;
  export const SPEECH_RECOGNITION_LANG: string;
  export const FILLER_WORD_KEYS: { [key: string]: string };
}

declare module '@/lib/supabaseClient';
declare module '../lib/supabaseClient';
declare module '@/lib/logger';
declare module '@/lib/utils';
declare module '@/hooks/useBrowserSupport';
