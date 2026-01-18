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

// Custom vocabulary limits (dynamic baseline)
export const VOCABULARY_LIMITS = {
  MAX_WORD_LENGTH: 50,          // Maximum characters per word
  BASE_CAPACITY: 100,           // Initial capacity (expands in 100-word increments)
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

export const STT_CONFIG = {
  MAX_PRIVATE_ATTEMPTS: 2,
  // AssemblyAI requires audio packets between 50-1000ms
  // At 16kHz: 50ms = 800 samples, 1000ms = 16000 samples
  ASSEMBLYAI_MIN_PACKET_MS: 50,
  ASSEMBLYAI_MAX_PACKET_MS: 1000,
  ASSEMBLYAI_MIN_SAMPLES: 800,   // 50ms at 16kHz
  ASSEMBLYAI_MAX_SAMPLES: 16000, // 1000ms at 16kHz
} as const;

// Rate limiting configuration
// Set to 0 to disable client-side rate limiting (AssemblyAI has server-side limits)
export const RATE_LIMIT_CONFIG = {
  ASSEMBLYAI_TOKEN_INTERVAL_MS: 0,  // Minimum ms between token requests (0 = disabled)
  ASSEMBLYAI_TOKEN_MAX_CALLS: 5,    // Max calls per minute (matches AssemblyAI's limit)
} as const;

