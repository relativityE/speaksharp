export {};

declare global {
  var __TEST__: boolean | undefined;

  interface Window {
    __SS_E2E__?: {
      isActive: boolean;
      engineType?: 'mock' | 'real' | 'system';
      debug?: boolean;
      flags?: {
        bypassMutex?: boolean;
        fastTimers?: boolean;
      };
      registry?: Record<string, unknown>;
    };
    VITE_USE_REAL_DATABASE?: string;
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
    __TEST_REGISTRY__?: {
        register: (mode: string, factory: unknown) => void;
        clear: () => void;
    };
    __activeSpeechRecognition?: unknown;
  }
}
