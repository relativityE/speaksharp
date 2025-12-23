export const APP_TAGLINE = 'Private Practice. Public Impact!' as const;
export const SPEECH_RECOGNITION_LANG = 'en-US' as const;

export const FILLER_WORD_KEYS = {
  UM: 'um',
  UH: 'uh',
  AH: 'ah',
  LIKE: 'like',
  YOU_KNOW: 'You Know',
  SO: 'so',
  ACTUALLY: 'actually',
  OH: 'oh',
  I_MEAN: 'I Mean',
} as const;

// Session time limits (in seconds)
export const SESSION_LIMITS = {
  ANONYMOUS: 120,        // 2 minutes for anonymous users
  FREE: 1800,            // 30 minutes for free tier
  PRO: null,             // unlimited for pro users
} as const;

// Pause detection configuration
export const PAUSE_DETECTION = {
  SILENCE_THRESHOLD: 0.01,      // RMS threshold for silence detection
  MIN_PAUSE_DURATION_MS: 500,   // Minimum pause duration in milliseconds
} as const;

// Custom vocabulary limits (tier-based)
export const VOCABULARY_LIMITS = {
  MAX_WORD_LENGTH: 50,          // Maximum characters per word
  MAX_WORDS_PER_USER: 100,      // Maximum words for pro users
  MAX_WORDS_FREE: 10,            // Maximum words for free tier users
} as const;

// Audio processing configuration
export const AUDIO_CONFIG = {
  SAMPLE_RATE: 16000,            // Sample rate in Hz
  FRAME_SIZE: 1024,              // Audio frame size
} as const;

export const API_CONFIG = {
  ASSEMBLYAI_TOKEN_ENDPOINT: 'assemblyai-token',
} as const;

export const SUBSCRIPTION_LIMITS = {
  FREE_MONTHLY_MINUTES: 30,
} as const;
