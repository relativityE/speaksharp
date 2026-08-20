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
  BASICALLY: 'basically',
  LITERALLY: 'literally',
  KIND_OF: 'Kind Of',
  SORT_OF: 'Sort Of',
} as const;

// #1046 filler two-tier (reviewer-approved): only three of the tracked words are TRUE, non-lexical
// fillers ("hesitation sounds") — um/uh/ah (uh also matches er). The other ten are DISCOURSE MARKERS
// (like/so/actually/…) that are legitimate in most speech; flagging every occurrence produced false
// coaching (e.g. reading "…who is actually in the arena…"). Coaching is gated to true fillers + the
// user's own words unless a discourse marker is genuinely overused (see the coaching guard in
// liveCoaching). 3 true + 10 discourse = the 13 tracked patterns.
export const TRUE_FILLER_WORDS: readonly string[] = [FILLER_WORD_KEYS.UM, FILLER_WORD_KEYS.UH, FILLER_WORD_KEYS.AH];
export const DISCOURSE_MARKER_WORDS: readonly string[] = [
  FILLER_WORD_KEYS.LIKE, FILLER_WORD_KEYS.YOU_KNOW, FILLER_WORD_KEYS.SO, FILLER_WORD_KEYS.ACTUALLY,
  FILLER_WORD_KEYS.OH, FILLER_WORD_KEYS.I_MEAN, FILLER_WORD_KEYS.BASICALLY, FILLER_WORD_KEYS.LITERALLY,
  FILLER_WORD_KEYS.KIND_OF, FILLER_WORD_KEYS.SORT_OF,
];

// Pause detection configuration
export const PAUSE_DETECTION = {
  SILENCE_THRESHOLD: 0.01,      // RMS threshold for silence detection
  MIN_PAUSE_DURATION_MS: 500,   // Minimum pause duration in milliseconds
} as const;

// User words limits (dynamic baseline)
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

export const STT_CONFIG = {
  MAX_PRIVATE_ATTEMPTS: 2,
  LOAD_CACHE_TIMEOUT_MS: 2000,
  // AssemblyAI requires audio packets between 50-1000ms
  // At 16kHz: 50ms = 800 samples, 1000ms = 16000 samples
  ASSEMBLYAI_MIN_PACKET_MS: 50,
  ASSEMBLYAI_MAX_PACKET_MS: 1000,
  ASSEMBLYAI_MIN_SAMPLES: 800,   // 50ms at 16kHz
  ASSEMBLYAI_MAX_SAMPLES: 16000, // 1000ms at 16kHz
  HEARTBEAT_TIMEOUT_MS: 30000,
  FAILURE_HOLD_DURATION_MS: 1500,
  VISIBLE_HOLD_DURATION_MS: 2500,
  STRATEGY_INIT_TIMEOUT_MS: 5000,
  ALPHANUMERIC_RADIX: 36, // Used for random string generation (0-9, a-z)
} as const;


export const UI_CONFIG = {
  DEFAULT_TOAST_LENGTH_SECS: 3.5,
} as const;

// Rate limiting configuration
// Set to 0 to disable client-side rate limiting (AssemblyAI has server-side limits)
export const RATE_LIMIT_CONFIG = {
  ASSEMBLYAI_TOKEN_INTERVAL_MS: 0,  // Minimum ms between token requests (0 = disabled)
  ASSEMBLYAI_TOKEN_MAX_CALLS: 5,    // Max calls per minute (matches AssemblyAI's limit)
} as const;
